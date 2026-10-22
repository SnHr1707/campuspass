"""Signed QR ticket tokens.

Format: CP1.<ticket id>.<event id>.<signature>
The signature is an HMAC-SHA256 over the ticket and event ids, keyed with a secret
only ticket-service knows. Anyone can read a token, but nobody can forge one.
"""

import base64
import hashlib
import hmac

PREFIX = "CP1"


def _sign(secret: str, ticket_id: str, event_id: str) -> str:
    digest = hmac.new(secret.encode(), f"{ticket_id}.{event_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:32]


def make_token(secret: str, ticket_id: str, event_id: str) -> str:
    return f"{PREFIX}.{ticket_id}.{event_id}.{_sign(secret, ticket_id, event_id)}"


def parse_token(secret: str, token: str) -> tuple[str, str] | None:
    """Returns (ticket_id, event_id) if the token is genuine, otherwise None."""
    parts = token.strip().split(".")
    if len(parts) != 4 or parts[0] != PREFIX:
        return None
    _, ticket_id, event_id, signature = parts
    expected = _sign(secret, ticket_id, event_id)
    # compare_digest avoids leaking how many characters matched through timing.
    if not hmac.compare_digest(expected, signature):
        return None
    return ticket_id, event_id
