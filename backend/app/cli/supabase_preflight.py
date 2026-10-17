"""Exit non-zero until BowlByte can reach Supabase without printing secrets."""

from __future__ import annotations

import os
import sys

from app.services.supabase_identity import missing_cutover_names


def main() -> int:
    missing = missing_cutover_names(dict(os.environ))
    if missing:
        print("Supabase cutover is blocked. Missing or unusable settings:")
        for name in missing:
            print(f"- {name}")
        print("Docker remains the BowlByte runtime. No cloud write was attempted.")
        return 2
    print("Supabase cutover settings are present. A data restore still has to be verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
