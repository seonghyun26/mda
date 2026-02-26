"""SQLite user database with PBKDF2-SHA256 password hashing (stdlib only).

DB location: $AMD_DB_PATH  or  ~/.amd/users.db

Schema
------
users(id, username UNIQUE, password_hash, created_at)

Hash format  (colon-separated, all fields in the hash string):
    pbkdf2:sha256:<iterations>:<hex-salt>:<hex-digest>
"""

from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────

DB_PATH = Path(os.getenv("AMD_DB_PATH", str(Path.home() / ".amd" / "users.db")))
_ITERATIONS = 260_000

# Default users seeded on first run.
_DEFAULT_USERS: list[tuple[str, str]] = [
    ("admin", "amd123"),
    ("hyun", "1126"),
    ("debug", "1234"),
]

# ── Hashing ───────────────────────────────────────────────────────────


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS)
    return f"pbkdf2:sha256:{_ITERATIONS}:{salt}:{digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        _, algo, iters_s, salt, expected_hex = stored.split(":")
        digest = hashlib.pbkdf2_hmac(algo, password.encode(), salt.encode(), int(iters_s))
        return secrets.compare_digest(digest.hex(), expected_hex)
    except Exception:
        return False


# ── DB helpers ────────────────────────────────────────────────────────


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(str(DB_PATH))


def init_db() -> None:
    """Create tables and seed default users (idempotent)."""
    with _conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    UNIQUE NOT NULL,
                password_hash TEXT    NOT NULL,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        for username, password in _DEFAULT_USERS:
            exists = con.execute(
                "SELECT 1 FROM users WHERE username = ?", (username,)
            ).fetchone()
            if not exists:
                con.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, _hash_password(password)),
                )


def verify_user(username: str, password: str) -> bool:
    """Return True if the username/password pair is valid."""
    with _conn() as con:
        row = con.execute(
            "SELECT password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
    return _verify_password(password, row[0]) if row else False


def add_user(username: str, password: str) -> None:
    """Insert a new user (raises sqlite3.IntegrityError if username exists)."""
    with _conn() as con:
        con.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, _hash_password(password)),
        )


def change_password(username: str, new_password: str) -> bool:
    """Update password. Returns False if user not found."""
    with _conn() as con:
        cur = con.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (_hash_password(new_password), username),
        )
    return cur.rowcount > 0
