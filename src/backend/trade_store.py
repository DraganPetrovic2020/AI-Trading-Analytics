"""Trade history persistence with robust in-memory fallback.

Stores every executed trade (SIM + LIVE, manual + auto) in memory and/or Supabase
so the frontend trade-history panel always displays and preserves them.
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

_MEMORY_TRADES: List[Dict] = []
_mem_id_seq = 1


def _load_env() -> None:
    for env_path in [
        Path(__file__).resolve().parent.parent.parent / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]:
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")


def _rest(path: str, method: str = "GET", body: Optional[Dict] = None) -> List[Dict]:
    if not SUPABASE_URL or not ANON_KEY:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=3) as res:
            raw = res.read()
            return json.loads(raw) if raw else []
    except Exception:
        return []


def insert_trade(
    mode: str,
    order_type: str,
    side: str,
    price: float,
    qty: float,
    amount_usdt: float,
    note: str = "",
    symbol: str = "SOLUSDT",
) -> Optional[Dict]:
    global _mem_id_seq
    now_str = datetime.utcnow().isoformat() + "Z"
    trade_dict = {
        "id": f"mem-{_mem_id_seq}",
        "mode": mode,
        "order_type": order_type,
        "side": side,
        "symbol": symbol,
        "price": round(price, 6),
        "qty": round(qty, 8),
        "amount_usdt": round(amount_usdt, 2),
        "note": note,
        "created_at": now_str,
    }
    _mem_id_seq += 1
    _MEMORY_TRADES.insert(0, trade_dict)

    try:
        rows = _rest(
            "trades",
            method="POST",
            body={
                "mode": mode,
                "order_type": order_type,
                "side": side,
                "symbol": symbol,
                "price": round(price, 6),
                "qty": round(qty, 8),
                "amount_usdt": round(amount_usdt, 2),
                "note": note,
            },
        )
        if rows:
            return rows[0]
    except Exception:
        pass

    return trade_dict


def list_trades(limit: int = 200) -> List[Dict]:
    supabase_trades = []
    try:
        supabase_trades = _rest("trades?order=created_at.desc&limit=" + str(limit))
    except Exception:
        pass

    combined = supabase_trades + [
        t for t in _MEMORY_TRADES
        if not any(st.get("created_at") == t.get("created_at") and st.get("price") == t.get("price") and st.get("side") == t.get("side") for st in supabase_trades)
    ]
    combined.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return combined[:limit]


def clear_trades() -> int:
    global _MEMORY_TRADES
    _MEMORY_TRADES = []
    try:
        _rest("trades?id=neq.00000000-0000-0000-0000-000000000000", method="DELETE")
    except Exception:
        pass
    return 0
