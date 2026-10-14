"""Import a student roster CSV.

Columns: roll_number, enrollment_code. Enrollment codes are hashed before they
are stored. The command prints counts, not the codes.
"""

import sys

from app.db.session import SessionLocal
from app.services.identity import BootstrapError, import_roster


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m app.cli.import_roster ROSTER.csv", file=sys.stderr)
        raise SystemExit(2)
    db = SessionLocal()
    try:
        counts = import_roster(db, sys.argv[1])
    except (BootstrapError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
    finally:
        db.close()
    print(
        "Roster import finished. "
        f"imported={counts['imported']} updated={counts['updated']} "
        f"skipped_claimed={counts['skipped_claimed']}"
    )


if __name__ == "__main__":
    main()
