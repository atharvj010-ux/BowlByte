"""Create the first canteen manager.

The password is read from a prompt, or from one stdin line when the command is
not attached to a terminal. It is never accepted as a command-line argument and
it is never printed.
"""

import getpass
import os
import sys

from app.db.session import SessionLocal
from app.services.identity import BootstrapError, bootstrap_first_manager


def main() -> None:
    if len(sys.argv) != 1:
        print(
            "This command does not accept arguments. Pass the password on stdin or at the prompt.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    email = os.environ.get("BOWLBYTE_BOOTSTRAP_EMAIL", "").strip()
    full_name = os.environ.get("BOWLBYTE_BOOTSTRAP_NAME", "").strip()
    if sys.stdin.isatty():
        email = email or input("Manager email: ").strip()
        full_name = full_name or input("Manager name: ").strip()
        password = getpass.getpass("Manager password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords do not match.", file=sys.stderr)
            raise SystemExit(1)
    else:
        password = sys.stdin.readline().rstrip("\n")
    if not email or not full_name or not password:
        print(
            "Set BOWLBYTE_BOOTSTRAP_EMAIL and BOWLBYTE_BOOTSTRAP_NAME, "
            "and provide the password on stdin.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    db = SessionLocal()
    try:
        user = bootstrap_first_manager(
            db,
            email=email,
            full_name=full_name,
            password=password,
        )
    except BootstrapError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
    finally:
        db.close()
    print(f"Canteen manager {user.email} is ready. The password was not stored in the log.")


if __name__ == "__main__":
    main()
