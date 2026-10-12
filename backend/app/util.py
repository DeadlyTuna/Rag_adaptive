"""Small helpers shared across modules."""

from __future__ import annotations

import itertools
import math
import secrets
import time


def r3(x: float) -> float:
    """Round to 3 decimals the way JavaScript's Math.round(x*1000)/1000 does
    (half up), so numbers match the frontend's demo engine exactly."""
    return math.floor(x * 1000 + 0.5) / 1000


def r2(x: float) -> float:
    return math.floor(x * 100 + 0.5) / 100


_counter = itertools.count(1)


def uid(prefix: str) -> str:
    n = next(_counter) % 1_000_000
    return f"{prefix}-{_b36(int(time.time() * 1000))}{_b36(n)}{secrets.token_hex(2)}"


def _b36(n: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = chars[r] + out
        if n == 0:
            return out
