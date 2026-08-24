from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_add_missing_columns() -> None:
    """Additive-only schema migration: adds columns new model fields expect
    to tables that already exist, without touching existing rows.

    `create_all()` only creates missing *tables*, never alters existing ones —
    and a personal SQLite file can hold real library data, so this avoids
    ever needing to drop/recreate it just to pick up a new column.
    """
    inspector = inspect(engine)
    if "tracks" not in inspector.get_table_names():
        return  # fresh DB — create_all() will build the current schema directly

    existing_columns = {col["name"] for col in inspector.get_columns("tracks")}
    for column in Base.metadata.tables["tracks"].columns:
        if column.name in existing_columns:
            continue
        col_type = column.type.compile(engine.dialect)
        default_clause = ""
        if column.default is not None and column.default.is_scalar:
            default_clause = f" DEFAULT {column.default.arg!r}"
        with engine.begin() as conn:
            conn.execute(text(f'ALTER TABLE tracks ADD COLUMN "{column.name}" {col_type}{default_clause}'))


def init_db() -> None:
    from . import models  # noqa: F401  (register models on Base before create_all)

    Base.metadata.create_all(bind=engine)
    _migrate_add_missing_columns()
