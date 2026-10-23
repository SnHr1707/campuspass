#!/usr/bin/env python3
"""End-to-end smoke test for CampusPass.

Walks through the full user journey against a running deployment (docker compose,
Minikube or the public site) and fails loudly if any step misbehaves.
Uses only the Python standard library, so it runs anywhere.

Usage:  python scripts/smoke_test.py http://localhost:3000
Env:    ORGANISER_INVITE_CODE, VOLUNTEER_INVITE_CODE (must match the deployment)
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("BASE_URL", "http://localhost:3000")).rstrip("/")
ORG_CODE = os.getenv("ORGANISER_INVITE_CODE", "ORG-2026")
VOL_CODE = os.getenv("VOLUNTEER_INVITE_CODE", "VOL-2026")
RUN = uuid.uuid4().hex[:8]
if not BASE.startswith(("http://", "https://")):
    sys.exit(f"BASE_URL must start with http:// or https://, got {BASE!r}")
passed = 0


def call(method, path, body=None, token=None, headers=None):
    req = urllib.request.Request(f"{BASE}/api{path}", method=method)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:  # nosemgrep: dynamic-urllib-use-detected (scheme checked above)
            text = res.read().decode()
            return res.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as err:
        text = err.read().decode()
        try:
            return err.code, json.loads(text)
        except json.JSONDecodeError:
            return err.code, text


def check(name, condition, detail=""):
    global passed
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    passed += 1
    print(f"ok    {name}")


def register(name, invite=None):
    body = {"name": name, "email": f"{name.lower().replace(' ', '.')}.{RUN}@nirma.test", "password": "smoke-test-pass"}
    if invite:
        body["inviteCode"] = invite
    status, data = call("POST", "/auth/register", body)
    check(f"register {name}", status == 201, f"{status} {data}")
    return data["token"], data["user"]


def wait_until_up(timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, data = call("GET", "/events")
            if status == 200 and isinstance(data, list):
                return
        except Exception:  # noqa: BLE001 - still starting
            pass
        time.sleep(3)  # nosemgrep: arbitrary-sleep (polling until the deployment is ready)
    check("services become ready", False, f"no healthy response from {BASE} within {timeout}s")


def main():
    print(f"Smoke testing {BASE}")
    wait_until_up()

    org_token, org = register("Smoke Organiser", ORG_CODE)
    check("invite code gives organiser role", org["role"] == "organiser", org)
    vol_token, vol = register("Smoke Volunteer", VOL_CODE)
    check("invite code gives volunteer role", vol["role"] == "volunteer", vol)
    s1_token, _ = register("Smoke Student One")
    s2_token, _ = register("Smoke Student Two")

    event_body = {
        "title": f"Smoke Test Event {RUN}",
        "description": "Created by the smoke test",
        "venue": "CI Runner",
        "category": "tech",
        "startsAt": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        "capacity": 1,
    }

    status, _ = call("POST", "/events", event_body, token=s1_token, headers={"X-User-Role": "organiser"})
    check("forged X-User-Role header is ignored (student cannot create events)", status == 403, status)

    status, event = call("POST", "/events", event_body, token=org_token)
    check("organiser creates an event", status == 201, f"{status} {event}")
    event_id = event["id"]

    status, _ = call("POST", "/bookings", {"eventId": event_id})
    check("booking without login is refused", status == 401, status)

    status, booking = call("POST", "/bookings", {"eventId": event_id}, token=s1_token)
    check("student one books the only seat", status == 201, f"{status} {booking}")
    check("booking returns a signed ticket", booking["ticket"]["token"].startswith("CP1."), booking)

    status, _ = call("POST", "/bookings", {"eventId": event_id}, token=s1_token)
    check("same student cannot book twice", status == 409, status)

    status, data = call("POST", "/bookings", {"eventId": event_id}, token=s2_token)
    check("second student gets sold out", status == 409 and data.get("soldOut") is True, f"{status} {data}")

    status, avail = call("GET", f"/bookings/availability?eventIds={event_id}")
    check("availability shows 0 seats left", status == 200 and avail.get(event_id) == 0, avail)

    status, stats = call("GET", f"/bookings/events/{event_id}/stats", token=org_token)
    check("organiser sees live sales", status == 200 and stats.get("sold") == 1, stats)

    status, tickets = call("GET", "/tickets/me", token=s1_token)
    check("student sees the ticket in My tickets", status == 200 and len(tickets) == 1, tickets)
    token = tickets[0]["token"]

    status, _ = call("POST", "/tickets/verify", {"token": token}, token=s1_token)
    check("students cannot check tickets in", status == 403, status)

    status, data = call("POST", "/tickets/verify", {"token": token}, token=vol_token)
    check("volunteer scan: first scan is valid", status == 200 and data["status"] == "valid", f"{status} {data}")

    status, data = call("POST", "/tickets/verify", {"token": token}, token=vol_token)
    check("volunteer scan: second scan is flagged", status == 409 and data["status"] == "already_used", f"{status} {data}")

    forged = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    status, data = call("POST", "/tickets/verify", {"token": forged}, token=vol_token)
    check("forged QR code is rejected", status == 400, f"{status} {data}")

    status, _ = call("GET", "/auth/verify")
    check("gateway hides the internal /verify endpoint", status == 404, status)

    status, _ = call("POST", "/internal/tickets", {})
    check("gateway hides ticket-service internal routes", status == 404, status)

    status, _ = call("GET", "/tickets/me", token="not.a.jwt")
    check("invalid JWT is rejected at the gateway", status == 401, status)

    print(f"\nAll {passed} checks passed.")


if __name__ == "__main__":
    main()
