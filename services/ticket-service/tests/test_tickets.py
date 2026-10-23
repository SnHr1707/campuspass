import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import make_engine, metadata
from app.main import create_app
from app.tokens import make_token, parse_token

SECRET = "test-signing-secret-at-least-32-chars!!"
EVENT = "b" * 24
STAFF = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "volunteer"}


@pytest.fixture()
def client():
    engine = make_engine("sqlite://")
    metadata.create_all(engine)
    return TestClient(create_app(engine, SECRET))


def issue(client, user_id=None, booking_id=None):
    body = {
        "bookingId": booking_id or str(uuid.uuid4()),
        "eventId": EVENT,
        "eventTitle": "Garba Night",
        "startsAt": "2026-11-01T18:00:00Z",
        "venue": "Open Air Theatre",
        "userId": user_id or str(uuid.uuid4()),
        "holderName": "Meera Shah",
    }
    res = client.post("/internal/tickets", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_refuses_weak_secret():
    with pytest.raises(RuntimeError):
        create_app(make_engine("sqlite://"), "short")


def test_token_roundtrip_and_tamper_detection():
    token = make_token(SECRET, "t1", EVENT)
    assert parse_token(SECRET, token) == ("t1", EVENT)
    assert parse_token(SECRET, token.replace("t1", "t2")) is None
    assert parse_token("another-secret-that-is-also-long-enough", token) is None
    assert parse_token(SECRET, "garbage") is None


def test_issue_is_idempotent_per_booking(client):
    booking = str(uuid.uuid4())
    first = issue(client, booking_id=booking)
    second = issue(client, booking_id=booking)
    assert first["id"] == second["id"]
    assert first["token"].startswith("CP1.")


def test_my_tickets(client):
    user = str(uuid.uuid4())
    issue(client, user_id=user)
    issue(client)
    res = client.get("/tickets/me", headers={"X-User-Id": user})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert client.get("/tickets/me").status_code == 401


def test_checkin_first_scan_valid_second_rejected(client):
    ticket = issue(client)
    first = client.post("/tickets/verify", json={"token": ticket["token"]}, headers=STAFF)
    assert first.status_code == 200
    assert first.json()["status"] == "valid"
    assert "Meera Shah" in first.json()["message"]

    second = client.post("/tickets/verify", json={"token": ticket["token"]}, headers=STAFF)
    assert second.status_code == 409
    assert second.json()["status"] == "already_used"


def test_checkin_rejects_forged_token(client):
    forged = f"CP1.{uuid.uuid4()}.{EVENT}.notarealsignaturexxxxxxxxxxxxxxx"
    res = client.post("/tickets/verify", json={"token": forged}, headers=STAFF)
    assert res.status_code == 400
    assert res.json()["status"] == "invalid"


def test_checkin_rejects_validly_signed_unknown_ticket(client):
    token = make_token(SECRET, str(uuid.uuid4()), EVENT)
    res = client.post("/tickets/verify", json={"token": token}, headers=STAFF)
    assert res.status_code == 404


def test_students_cannot_check_in(client):
    ticket = issue(client)
    res = client.post(
        "/tickets/verify", json={"token": ticket["token"]}, headers={"X-User-Id": "x", "X-User-Role": "student"}
    )
    assert res.status_code == 403


def test_validation(client):
    res = client.post("/internal/tickets", json={"bookingId": "short", "eventId": "x"})
    assert res.status_code == 422


def test_health_and_metrics(client):
    assert client.get("/health").status_code == 200
    client.get("/tickets/me", headers={"X-User-Id": "u"})
    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "http_requests_total" in metrics.text
