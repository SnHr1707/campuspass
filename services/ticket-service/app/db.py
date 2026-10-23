"""Database tables for ticket-service (PostgreSQL in production, SQLite in unit tests)."""

from sqlalchemy import (
    Column,
    DateTime,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool

metadata = MetaData()

tickets = Table(
    "tickets",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("booking_id", String(36), nullable=False),
    Column("event_id", String(24), nullable=False, index=True),
    Column("event_title", String(160), nullable=False),
    Column("starts_at", String(40)),
    Column("venue", String(160)),
    Column("user_id", String(36), nullable=False, index=True),
    Column("holder_name", String(80), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("used_at", DateTime(timezone=True)),
    Column("checked_in_by", String(36)),
    UniqueConstraint("booking_id", name="one_ticket_per_booking"),
)


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    return create_engine(url, pool_size=10, max_overflow=10, pool_pre_ping=True)
