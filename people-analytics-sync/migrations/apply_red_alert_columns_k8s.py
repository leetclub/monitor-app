"""Run inside people-analytics-api pod: adds Red Alert columns to monitoring_dashboard.live_machine_config."""
import os
from sqlalchemy import create_engine, text

def main() -> None:
    u = (
        f"postgresql://{os.environ['DB_USER']}:{os.environ['DB_PASSWORD']}"
        f"@{os.environ['DB_HOST']}:{os.environ['DB_PORT']}/{os.environ['DASHBOARD_DB_NAME']}?sslmode=require"
    )
    e = create_engine(u)
    with e.connect() as c:
        c.execute(
            text(
                "ALTER TABLE live_machine_config "
                "ADD COLUMN IF NOT EXISTS red_alert_operator_name TEXT, "
                "ADD COLUMN IF NOT EXISTS exclude_cleaning_timeouts_pfa BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
        c.commit()
    print("migration ok")


if __name__ == "__main__":
    main()
