"""Config flow for NocoDB Electrical integration."""
from __future__ import annotations

import logging
from typing import Any

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_BASE_ID,
    CONF_NOCODB_TOKEN,
    CONF_NOCODB_URL,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_NOCODB_URL): str,
        vol.Required(CONF_NOCODB_TOKEN): str,
        vol.Required(CONF_BASE_ID): str,
        vol.Optional(CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL): vol.All(
            vol.Coerce(int), vol.Range(min=60, max=3600)
        ),
    }
)


async def validate_input(hass, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the user input by testing the NocoDB connection."""
    session = async_get_clientsession(hass)
    url = f"{data[CONF_NOCODB_URL]}/api/v2/meta/bases/{data[CONF_BASE_ID]}/tables"
    headers = {"xc-auth": data[CONF_NOCODB_TOKEN]}

    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 200:
                result = await resp.json()
                table_count = len(result.get("list", []))
                return {"title": f"NocoDB Electrical ({table_count} tables)"}
            elif resp.status == 401:
                raise InvalidAuth
            else:
                raise CannotConnect(f"HTTP {resp.status}")
    except aiohttp.ClientError as err:
        raise CannotConnect(str(err)) from err


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for NocoDB Electrical."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                info = await validate_input(self.hass, user_input)
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except Exception:
                _LOGGER.exception("Unexpected exception")
                errors["base"] = "unknown"
            else:
                return self.async_create_entry(title=info["title"], data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )


class CannotConnect(Exception):
    """Error to indicate we cannot connect."""


class InvalidAuth(Exception):
    """Error to indicate invalid authentication."""
