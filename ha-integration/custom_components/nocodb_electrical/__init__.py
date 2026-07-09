"""The NocoDB Electrical integration."""
from __future__ import annotations

import logging
from datetime import timedelta

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_BASE_ID,
    CONF_NOCODB_TOKEN,
    CONF_NOCODB_URL,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    TABLE_CIRCUITS,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up NocoDB Electrical from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    nocodb_url = entry.data[CONF_NOCODB_URL]
    nocodb_token = entry.data[CONF_NOCODB_TOKEN]
    base_id = entry.data[CONF_BASE_ID]
    scan_interval = entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)

    session = async_get_clientsession(hass)

    # Store client config for platforms to access
    hass.data[DOMAIN][entry.entry_id] = {
        "session": session,
        "url": nocodb_url,
        "token": nocodb_token,
        "base_id": base_id,
        "scan_interval": timedelta(seconds=scan_interval),
    }

    # Set up platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register services
    await _async_register_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok


async def _async_register_services(hass: HomeAssistant) -> None:
    """Register integration services."""

    async def handle_query(call: ServiceCall) -> None:
        """Handle the query service call."""
        table = call.data["table"]
        filter_expr = call.data.get("filter", "")

        # Find any active config entry to get connection details
        entries = hass.config_entries.async_entries(DOMAIN)
        if not entries:
            _LOGGER.error("No NocoDB Electrical config entries found")
            return

        config = hass.data[DOMAIN][entries[0].entry_id]
        url = f"{config['url']}/api/v2/meta/bases/{config['base_id']}/tables/{table}/records"
        headers = {"xc-auth": config["token"]}
        params = {}
        if filter_expr:
            params["where"] = filter_expr

        async with config["session"].get(url, headers=headers, params=params) as resp:
            if resp.status == 200:
                data = await resp.json()
                # Fire event with results for automations to consume
                hass.bus.async_fire(
                    f"{DOMAIN}_query_result",
                    {"table": table, "count": len(data.get("list", [])), "data": data.get("list", [])},
                )
            else:
                _LOGGER.error("NocoDB query failed: %s", resp.status)

    async def handle_update_record(call: ServiceCall) -> None:
        """Handle the update_record service call."""
        table = call.data["table"]
        record_id = call.data["record_id"]
        update_data = call.data["data"]

        entries = hass.config_entries.async_entries(DOMAIN)
        if not entries:
            _LOGGER.error("No NocoDB Electrical config entries found")
            return

        config = hass.data[DOMAIN][entries[0].entry_id]
        url = f"{config['url']}/api/v2/meta/bases/{config['base_id']}/tables/{table}/records"
        headers = {"xc-auth": config["token"], "Content-Type": "application/json"}

        payload = {"Id": record_id, **update_data}

        async with config["session"].patch(url, headers=headers, json=payload) as resp:
            if resp.status == 200:
                _LOGGER.info("Updated record %s in %s", record_id, table)
            else:
                _LOGGER.error("NocoDB update failed: %s", resp.status)

    # Only register if not already registered
    if not hass.services.has_service(DOMAIN, "query"):
        hass.services.async_register(DOMAIN, "query", handle_query)
    if not hass.services.has_service(DOMAIN, "update_record"):
        hass.services.async_register(DOMAIN, "update_record", handle_update_record)
