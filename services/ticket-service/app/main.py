"""CampusPass ticket-service: issues signed QR tickets and checks them in at the gate."""

import logging
import os
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from prometheus_client import Counter
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel, Field
from sqlalchemy import insert, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from .db import make_engine, metadata, tickets
from .tokens import make_token, parse_token

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format='{"time":"%(asctime)s","level":"%(levelname)s","service":"ticket-service","msg":"%(message)s"}',
)
log = logging.getLogger("ticket-service")

CHECKINS = Counter("campuspass_checkins_total", "Gate check-ins by result", ["result"])
STAFF_ROLES = {"volunteer", "organiser"}


class IssueRequest(BaseModel):
    bookingId: str = Field(min_length=36, max_length=36)
    eventId: str = Field(pattern=r"^[a-f0-9]{24}$")
    eventTitle: str = Field(min_length=1, max_length=160)
    startsAt: str | None = Field(default=None, max_length=40)
    venue: str | None = Field(default=None, max_length=160)
    userId: str = Field(min_length=36, max_length=36)
    holderName: str = Field(default="", max_length=80)


class VerifyRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)


def to_dict(row, secret: str) -> dict:
    return {
        "id": row.id,
        "token": make_token(secret, row.id, row.event_id),
        "eventId": row.event_id,
        "eventTitle": row.event_title,
        "startsAt": row.starts_at,
        "venue": row.venue,
        "holderName": row.holder_name,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "usedAt": row.used_at.isoformat() if row.used_at else None,
    }


router = APIRouter()


def _engine(request: Request) -> Engine:
    return request.app.state.engine


def _secret(request: Request) -> str:
    return request.app.state.secret


# Internal only: called by booking-service. The gateway does not route /internal.
@router.post("/internal/tickets", status_code=201)
def issue(body: IssueRequest, request: Request):
    engine, secret = _engine(request), _secret(request)
    row = {
        "id": str(uuid.uuid4()),
        "booking_id": body.bookingId,
        "event_id": body.eventId,
        "event_title": body.eventTitle,
        "starts_at": body.startsAt,
        "venue": body.venue,
        "user_id": body.userId,
        "holder_name": body.holderName or "Student",
        "created_at": datetime.now(timezone.utc),
    }
    with engine.begin() as conn:
        try:
            conn.execute(insert(tickets).values(**row))
        except IntegrityError:
            # Idempotent: a retried request for the same booking returns the existing ticket.
            pass
    with engine.connect() as conn:
        saved = conn.execute(select(tickets).where(tickets.c.booking_id == body.bookingId)).one()
    return to_dict(saved, secret)


@router.get("/tickets/me")
def my_tickets(request: Request, x_user_id: str | None = Header(default=None)):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Login required")
    with _engine(request).connect() as conn:
        rows = conn.execute(
            select(tickets).where(tickets.c.user_id == x_user_id).order_by(tickets.c.created_at.desc())
        ).all()
    return [to_dict(r, _secret(request)) for r in rows]


@router.post("/tickets/verify")
def verify(
    body: VerifyRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
    x_user_role: str | None = Header(default=None),
):
    if x_user_role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Only volunteers and organisers can check tickets in")
    engine, secret = _engine(request), _secret(request)

    parsed = parse_token(secret, body.token)
    if not parsed:
        CHECKINS.labels("invalid").inc()
        return JSONResponse(status_code=400, content={"status": "invalid", "message": "Fake or damaged ticket"})
    ticket_id, event_id = parsed

    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        # Single conditional UPDATE: two volunteers scanning the same QR at once cannot both succeed.
        result = conn.execute(
            update(tickets)
            .where(tickets.c.id == ticket_id, tickets.c.event_id == event_id, tickets.c.used_at.is_(None))
            .values(used_at=now, checked_in_by=x_user_id)
        )
        row = conn.execute(select(tickets).where(tickets.c.id == ticket_id)).one_or_none()

    if row is None:
        CHECKINS.labels("not_found").inc()
        return JSONResponse(status_code=404, content={"status": "invalid", "message": "Ticket not found"})
    if result.rowcount == 1:
        CHECKINS.labels("valid").inc()
        return {"status": "valid", "message": f"Welcome, {row.holder_name}", "ticket": to_dict(row, secret)}
    CHECKINS.labels("already_used").inc()
    return JSONResponse(
        status_code=409,
        content={"status": "already_used", "message": "This ticket was already scanned", "ticket": to_dict(row, secret)},
    )


@router.get("/health")
def health(request: Request):
    try:
        with _engine(request).connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "service": "ticket-service"}
    except Exception:  # noqa: BLE001 - any DB error means unhealthy
        return JSONResponse(status_code=503, content={"status": "down", "service": "ticket-service"})


async def access_log(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    if request.url.path not in ("/health", "/metrics"):
        log.info(
            "%s %s %s %.1fms reqId=%s",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - start) * 1000,
            request.headers.get("x-request-id", "-"),
        )
    return response


def create_app(engine: Engine, secret: str) -> FastAPI:
    if not secret or len(secret) < 32:
        raise RuntimeError("TICKET_SIGNING_SECRET must be set and at least 32 characters long")

    app = FastAPI(title="CampusPass ticket-service", version="1.0.0", docs_url="/tickets/docs", openapi_url="/tickets/openapi.json")
    app.state.engine = engine
    app.state.secret = secret
    app.middleware("http")(access_log)
    app.include_router(router)
    Instrumentator(excluded_handlers=["/metrics", "/health"]).instrument(app).expose(app, include_in_schema=False)
    return app


def _create_tables_with_retry(engine: Engine, attempts: int = 30) -> None:
    for attempt in range(1, attempts + 1):
        try:
            metadata.create_all(engine)
            return
        except Exception as exc:  # noqa: BLE001
            log.warning("database not ready (attempt %d): %s", attempt, exc)
            time.sleep(2)  # nosemgrep: arbitrary-sleep (deliberate back-off while the database starts)
    raise RuntimeError("Could not connect to the database")


def build() -> FastAPI:
    engine = make_engine(os.environ["DATABASE_URL"])
    _create_tables_with_retry(engine)
    return create_app(engine, os.getenv("TICKET_SIGNING_SECRET", ""))
