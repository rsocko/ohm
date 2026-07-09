"""Sensor platform for NocoDB Electrical integration."""
from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.components.sensor import (
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
    UpdateFailed,
)

from .const import DOMAIN, TABLE_CIRCUITS

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up NocoDB Electrical sensors from a config entry."""
    config = hass.data[DOMAIN][entry.entry_id]

    coordinator = CircuitDataCoordinator(hass, config)
    await coordinator.async_config_entry_first_refresh()

    entities = []
    for circuit in coordinator.data:
        entities.append(CircuitSensor(coordinator, circuit, entry.entry_id))

    async_add_entities(entities, True)


class CircuitDataCoordinator(DataUpdateCoordinator):
    """Coordinator to fetch circuit data from NocoDB."""

    def __init__(self, hass: HomeAssistant, config: dict) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name="NocoDB Circuits",
            update_interval=config["scan_interval"],
        )
        self._config = config

    async def _async_update_data(self) -> list[dict]:
        """Fetch circuit data from NocoDB."""
        url = (
            f"{self._config['url']}/api/v2/meta/bases/"
            f"{self._config['base_id']}/tables/{TABLE_CIRCUITS}/records"
        )
        headers = {"xc-auth": self._config["token"]}
        params = {"limit": 200}

        try:
            async with self._config["session"].get(
                url, headers=headers, params=params
            ) as resp:
                if resp.status != 200:
                    raise UpdateFailed(f"NocoDB returned {resp.status}")
                data = await resp.json()
                return data.get("list", [])
        except Exception as err:
            raise UpdateFailed(f"Error fetching circuits: {err}") from err


class CircuitSensor(CoordinatorEntity, SensorEntity):
    """Representation of an electrical circuit as a HA sensor."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: CircuitDataCoordinator,
        circuit_data: dict,
        entry_id: str,
    ) -> None:
        """Initialize the circuit sensor."""
        super().__init__(coordinator)
        self._circuit_data = circuit_data
        self._entry_id = entry_id

        # Build entity identifiers
        panel_name = circuit_data.get("Panel", {}).get("Title", "unknown")
        circuit_num = circuit_data.get("Number", "0")
        label = circuit_data.get("Label", f"Circuit {circuit_num}")

        self._attr_unique_id = f"{DOMAIN}_{entry_id}_circuit_{panel_name}_{circuit_num}"
        self._attr_name = f"Circuit {circuit_num} - {label}"

        # Icon based on breaker type
        breaker_type = circuit_data.get("Breaker_Type", "Standard")
        if breaker_type == "GFCI":
            self._attr_icon = "mdi:shield-check"
        elif breaker_type == "AFCI":
            self._attr_icon = "mdi:shield-alert"
        else:
            self._attr_icon = "mdi:flash"

    @property
    def native_value(self) -> int:
        """Return the number of loads on this circuit."""
        # Find current data in coordinator
        for circuit in self.coordinator.data:
            if circuit.get("Id") == self._circuit_data.get("Id"):
                loads = circuit.get("Loads", [])
                return len(loads) if isinstance(loads, list) else 0
        return 0

    @property
    def native_unit_of_measurement(self) -> str:
        """Return the unit."""
        return "loads"

    @property
    def extra_state_attributes(self) -> dict:
        """Return extra state attributes."""
        # Find current data
        data = self._circuit_data
        for circuit in self.coordinator.data:
            if circuit.get("Id") == self._circuit_data.get("Id"):
                data = circuit
                break

        panel = data.get("Panel", {})
        area = data.get("Area", {})

        return {
            "panel": panel.get("Title", "Unknown") if isinstance(panel, dict) else str(panel),
            "circuit_number": data.get("Number"),
            "breaker_amps": data.get("Amps"),
            "breaker_type": data.get("Breaker_Type", "Standard"),
            "wire_gauge": data.get("Wire_Gauge"),
            "area": area.get("Title", "") if isinstance(area, dict) else str(area or ""),
            "description": data.get("Label", ""),
            "nocodb_record_id": data.get("Id"),
        }

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        return self.coordinator.last_update_success
