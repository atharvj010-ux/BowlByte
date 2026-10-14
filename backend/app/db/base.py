from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for future domain models.

    P001 does not register ordering, payment, or identity tables.
    """
