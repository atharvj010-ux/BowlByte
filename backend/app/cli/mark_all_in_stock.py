"""Mark every menu item In stock for today's service date."""

from __future__ import annotations

from sqlalchemy import select, update

from app.db.session import SessionLocal
from app.models.ordering import DailyStock, MenuItem
from app.services.ordering import IN_STOCK_QTY, service_today


def main() -> None:
    db = SessionLocal()
    try:
        day = service_today()
        items = list(db.scalars(select(MenuItem)).all())
        existing = {
            row.menu_item_id: row
            for row in db.scalars(select(DailyStock).where(DailyStock.service_date == day)).all()
        }
        created = 0
        for item in items:
            item.is_available = True
            stock = existing.get(item.id)
            if stock is None:
                db.add(
                    DailyStock(
                        menu_item_id=item.id,
                        service_date=day,
                        available_qty=IN_STOCK_QTY,
                        reserved_qty=0,
                        consumed_qty=0,
                    )
                )
                created += 1
        # Force every existing row for today up to the In-stock shelf level.
        forced = db.execute(
            update(DailyStock)
            .where(DailyStock.service_date == day)
            .values(available_qty=IN_STOCK_QTY)
        ).rowcount
        db.commit()
        print(
            f"Marked all dishes In stock for {day}: "
            f"{len(items)} items, {created} rows created, {forced} rows set to qty={IN_STOCK_QTY}."
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
