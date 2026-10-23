"""Re-apply vegetarian / non-veg flags from dish names and descriptions.

Usage (from backend/, against the intended DATABASE_URL):

    python -m app.cli.reclassify_menu_diet
    python -m app.cli.reclassify_menu_diet --apply
"""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.ordering import MenuItem
from app.services.menu_diet import infer_is_vegetarian


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write corrections. Without this flag, only print the planned changes.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        items = db.scalars(select(MenuItem).order_by(MenuItem.name)).all()
        changes: list[tuple[str, bool, bool]] = []
        for item in items:
            inferred = infer_is_vegetarian(item.name, item.description or "")
            if inferred != item.is_vegetarian:
                changes.append((item.name, item.is_vegetarian, inferred))
                if args.apply:
                    item.is_vegetarian = inferred
        if args.apply and changes:
            db.commit()
        for name, before, after in changes:
            label = "veg" if after else "non-veg"
            was = "veg" if before else "non-veg"
            print(f"{name}: {was} -> {label}")
        print(
            f"{'Applied' if args.apply else 'Would change'} {len(changes)} of {len(items)} items."
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
