"""Constants for the NocoDB Electrical integration."""

DOMAIN = "nocodb_electrical"

CONF_NOCODB_URL = "nocodb_url"
CONF_NOCODB_TOKEN = "nocodb_token"
CONF_BASE_ID = "base_id"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_SCAN_INTERVAL = 300  # 5 minutes

# NocoDB table names
TABLE_CIRCUITS = "Circuits"
TABLE_LOADS = "Loads"
TABLE_RECEPTACLES = "Receptacles"
TABLE_AREAS = "Areas"
TABLE_PANELS = "Panels"

# Entity prefixes
SENSOR_PREFIX = "circuit"
BINARY_SENSOR_PREFIX = "circuit_protection"
