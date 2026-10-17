"""Exit non-zero until BowlByte can reach Supabase without printing secrets."""

from __future__ import annotations

import os
import sys

from app.services.supabase_identity import (
    credentials_rotation_acknowledged,
    missing_cutover_names,
)


def main() -> int:
    missing = missing_cutover_names(dict(os.environ))
    if missing:
        print("Supabase cutover is blocked. Missing or unusable settings:")
        for name in missing:
            print(f"- {name}")
        print("Docker remains the BowlByte runtime. No cloud write was attempted.")
        return 2
    if not credentials_rotation_acknowledged(os.environ.get("SUPABASE_CREDENTIALS_ROTATED", "")):
        print("Supabase secret key and database password rotation has not been acknowledged.")
        print("Identity import and live cutover stay stopped.")
        print("Docker remains the BowlByte runtime. No cloud write was attempted.")
        return 2
    print("Supabase cutover settings are present. A data restore still has to be verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
