"""
Mirrors monitoring-app/config.js — keep in sync when event mapping changes.
"""

EXCLUDED_EVENT_NAMES = frozenset(
    {
        "Telemetry communication with machine",
        "EVA-DTS failed",
    }
)

# raw Vendon name/base_code -> display label (same keys as config.js EVENT_NAME_MAPPING)
EVENT_NAME_MAPPING = {
    "Component at critical level": "REFILL",
    "Component is empty": "REFILL",
    "Power Supply Interrupted": "Machine OFF",
    "Machine out of order due to power failure": "Machine OFF",
    "Cashless": "KNet OFF",
    "Cashless status: Inhibit": "KNet OFF",
    "Cashless status: OFF": "KNet OFF",
    "vBox offline": "Vendon OFF",
    "Connection to vBox lost": "Vendon OFF",
    "Product dispense/vend failed": "Dispense Failed",
    "Door opened": "Door opened",
    "Cabinet door opened": "Door opened",
    "Service door opened": "Door opened",
    "Locker door opened": "Door opened",
    "All Products refilled": "All Products refilled",
}
