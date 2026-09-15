"""FastAPI server for the SOL/USDT Binance AI trading dashboard.

Exposes REST endpoints the React frontend consumes:
  GET  /api/health
  GET  /api/config
  GET  /api/candles?interval=5m&limit=200
  GET  /api/price
  GET  /api/ticker24
  GET  /api/indicators?interval=5m
  GET  /api/signal?interval=5m
  GET  /api/levels?interval=5m
  GET  /api/account
  POST /api/trade            (market buy/sell, SIM or LIVE)
  POST /api/limit-order      (SIM limit order)
  GET  /api/pending
  POST /api/cancel-pending
  POST /api/auto             (toggle AI auto-trading)
  GET  /api/auto
  GET  /api/trades
  POST /api/trades/clear
  POST /api/live/connect
  GET  /api/live/status
  GET  /api/live/balance
  POST /api/reset

Run:  uvicorn server:app --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from account import PaperAccount
from ai_engine import LightGBMEngine
from binance_client import BinanceClient, BinanceTrader, INTERVALS
from indicators import build_indicator_payload, detect_support_resistance
from trade_store import clear_trades, insert_trade, list_trades

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("server")

SYMBOL = "SOLUSDT"

app = FastAPI(title="SOL/USDT Binance AI Trading API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = BinanceClient()
ai_engine = LightGBMEngine()
account = PaperAccount()
trader = BinanceTrader()

# state
_state_lock = threading.Lock()
_candle_cache: Dict[str, Dict] = {}  # interval -> {candles, ts, signal, levels, indicators}
_auto_enabled = False
_auto_lock = threading.Lock()
_last_auto_signal: Optional[str] = None
_last_auto_time: float = 0.0
_AUTO_COOLDOWN = 6.0  # seconds between AI scalping auto trades
_pending_orders: List[Dict] = []
_pending_id_seq = 1
_pending_lock = threading.Lock()


def _refresh_candles(interval: str) -> List[Dict]:
    candles = client.get_candles(SYMBOL, interval, limit=200)
    signal = ai_engine.predict(candles)
    ai_engine.train(candles)
    signal = ai_engine.predict(candles)
    levels = detect_support_resistance(candles)
    indicators = build_indicator_payload(candles)
    with _state_lock:
        _candle_cache[interval] = {
            "candles": candles,
            "ts": time.time(),
            "signal": signal,
            "levels": levels,
            "indicators": indicators,
        }
    return candles


def _get_cached(interval: str) -> Dict:
    with _state_lock:
        c = _candle_cache.get(interval)
    if c:
        if time.time() - c["ts"] > 45:
            threading.Thread(target=_refresh_candles, args=(interval,), daemon=True).start()
        return c
    
    # If not in cache yet, trigger background refresh and return any available cache instantly without blocking
    threading.Thread(target=_refresh_candles, args=(interval,), daemon=True).start()
    with _state_lock:
        for other_intv, other_c in _candle_cache.items():
            if other_c and other_c.get("candles"):
                return other_c
    return {
        "candles": [],
        "ts": time.time(),
        "signal": ("HOLD", 0.5, "loading"),
        "levels": [],
        "indicators": build_indicator_payload([]),
    }


# ---------------- models ----------------


class TradeRequest(BaseModel):
    side: str  # "BUY" | "SELL"
    amount_usdt: float
    mode: str = "SIM"  # "SIM" | "LIVE"


class LimitOrderRequest(BaseModel):
    side: str
    amount_usdt: float
    price: float


class CancelPendingRequest(BaseModel):
    id: int


class AutoRequest(BaseModel):
    enabled: bool


class LiveConnectRequest(BaseModel):
    api_key: str
    api_secret: str
    testnet: bool = False
    max_order_usdt: float = 50.0


# ---------------- endpoints ----------------


@app.get("/api/health")
def health() -> Dict:
    return {"status": "ok", "engine": ai_engine.status()}


@app.get("/api/config")
def config() -> Dict:
    return {"symbol": SYMBOL, "intervals": INTERVALS, "engine": ai_engine.status()}


@app.get("/api/candles")
def api_candles(interval: str = "5m", limit: int = 200) -> Dict:
    if interval not in INTERVALS:
        raise HTTPException(400, "Invalid interval")
    c = _get_cached(interval)
    all_candles = c["candles"]
    all_ind = c["indicators"]
    # Slice candles AND indicators to the same limit so they stay aligned
    limit = max(1, min(limit, len(all_candles)))
    candles = all_candles[-limit:]
    ind = {}
    for key, arr in all_ind.items():
        if isinstance(arr, list):
            ind[key] = arr[-limit:] if len(arr) >= limit else arr
        else:
            ind[key] = arr
    return {
        "symbol": SYMBOL,
        "interval": interval,
        "candles": candles,
        "indicators": ind,
        "levels": c["levels"],
        "signal": {"label": c["signal"][0], "confidence": round(c["signal"][1], 4), "reason": c["signal"][2]},
    }


@app.get("/api/price")
def api_price() -> Dict:
    try:
        return {"symbol": SYMBOL, "price": client.get_price(SYMBOL)}
    except Exception as e:
        try:
            c = _get_cached("5m")
            if c and c["candles"]:
                return {"symbol": SYMBOL, "price": c["candles"][-1]["c"]}
        except Exception:
            pass
        raise HTTPException(502, str(e))


@app.get("/api/ticker24")
def api_ticker24() -> Dict:
    try:
        return client.get_24h_ticker(SYMBOL)
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/indicators")
def api_indicators(interval: str = "5m") -> Dict:
    if interval not in INTERVALS:
        raise HTTPException(400, "Invalid interval")
    return _get_cached(interval)["indicators"]


@app.get("/api/signal")
def api_signal(interval: str = "5m") -> Dict:
    if interval not in INTERVALS:
        raise HTTPException(400, "Invalid interval")
    s = _get_cached(interval)["signal"]
    return {"label": s[0], "confidence": round(s[1], 4), "reason": s[2], "engine": ai_engine.status()}


@app.get("/api/levels")
def api_levels(interval: str = "5m") -> Dict:
    if interval not in INTERVALS:
        raise HTTPException(400, "Invalid interval")
    c = _get_cached(interval)
    price = c["candles"][-1]["c"] if c["candles"] else 0.0
    levels = c["levels"]
    for lvl in levels:
        lvl["distance_pct"] = round((lvl["price"] - price) / price * 100, 2) if price else 0
    return {"price": price, "levels": levels}


@app.get("/api/account")
def api_account() -> Dict:
    try:
        price = client.get_price(SYMBOL)
    except Exception:
        price = _get_cached("5m")["candles"][-1]["c"]
    snap = account.snapshot(price)
    snap["mode"] = "LIVE" if trader.connected else "SIM"
    if trader.connected:
        try:
            bal = trader.account_summary()
            snap["live_usdt"] = round(bal["usdt"], 2)
            snap["live_sol"] = round(bal["sol"], 8)
        except Exception as e:
            snap["live_error"] = str(e)
    return snap


@app.post("/api/trade")
def api_trade(req: TradeRequest) -> Dict:
    global _last_auto_signal
    side = req.side.upper()
    if side not in ("BUY", "SELL"):
        raise HTTPException(400, "side must be BUY or SELL")
    if req.amount_usdt <= 0:
        raise HTTPException(400, "amount must be positive")

    try:
        price = client.get_price(SYMBOL)
    except Exception:
        try:
            price = _get_cached("5m")["candles"][-1]["c"]
        except Exception as e:
            raise HTTPException(502, f"Cannot fetch price: {e}")

    mode = req.mode.upper()

    if mode == "LIVE":
        if not trader.connected:
            raise HTTPException(400, "Live trading not connected")
        try:
            if side == "BUY":
                quote_usdt = req.amount_usdt
                if quote_usdt > trader.max_order_usdt:
                    raise HTTPException(400, f"Exceeds max order limit {trader.max_order_usdt} USDT")
                result = trader.market_order(SYMBOL, "BUY", quote_usdt=quote_usdt)
                qty = quote_usdt / price
            else:
                qty = req.amount_usdt  # SOL quantity y
                quote_usdt = qty * price
                result = trader.market_order(SYMBOL, "SELL", qty=qty)
            insert_trade("LIVE", "MARKET", side, price, qty, quote_usdt, note=str(result.get("orderId", "")))
            return {"status": "ok", "mode": "LIVE", "side": side, "price": price, "qty": qty, "result": result}
        except Exception as e:
            raise HTTPException(500, str(e))

    # SIM
    try:
        if side == "BUY":
            quote_usdt = req.amount_usdt
            qty = account.buy(price, quote_usdt)
        else:
            qty = req.amount_usdt  # SOL quantity y
            account.sell(price, qty)
            quote_usdt = qty * price
        insert_trade("SIM", "MARKET", side, price, qty, quote_usdt)
        return {"status": "ok", "mode": "SIM", "side": side, "price": price, "qty": qty, "account": account.snapshot(price)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/limit-order")
def api_limit_order(req: LimitOrderRequest) -> Dict:
    global _pending_id_seq
    side = req.side.upper()
    if side not in ("BUY", "SELL"):
        raise HTTPException(400, "side must be BUY or SELL")
    if req.price <= 0 or req.amount_usdt <= 0:
        raise HTTPException(400, "price and amount must be positive")
    try:
        if side == "BUY":
            account.reserve_buy(req.amount_usdt)
            order = {"id": _pending_id_seq, "side": "BUY", "price": req.price, "amount": req.amount_usdt, "qty": None}
        else:
            qty = req.amount_usdt / req.price
            account.reserve_sell(qty)
            order = {"id": _pending_id_seq, "side": "SELL", "price": req.price, "amount": None, "qty": qty}
    except ValueError as e:
        raise HTTPException(400, str(e))
    with _pending_lock:
        _pending_orders.append(order)
        _pending_id_seq += 1
    return {"status": "pending", "order": order}


@app.get("/api/pending")
def api_pending() -> Dict:
    if trader.connected:
        try:
            orders = trader.fetch_open_orders(SYMBOL)
            mapped = [
                {
                    "id": o.get("orderId"),
                    "side": "BUY" if o.get("side") == "BUY" else "SELL",
                    "price": float(o.get("price", 0)),
                    "qty": float(o.get("origQty", 0)),
                    "live": True,
                }
                for o in orders
            ]
            return {"orders": mapped, "live": True}
        except Exception as e:
            raise HTTPException(500, str(e))
    with _pending_lock:
        sim = [
            {
                "id": o["id"],
                "side": o["side"],
                "price": o["price"],
                "amount": o["amount"],
                "qty": o["qty"],
                "live": False,
            }
            for o in _pending_orders
        ]
    return {"orders": sim, "live": False}


@app.post("/api/cancel-pending")
def api_cancel_pending(req: CancelPendingRequest) -> Dict:
    if trader.connected:
        try:
            trader.cancel_order(SYMBOL, req.id)
            return {"status": "cancelled", "live": True}
        except Exception as e:
            raise HTTPException(500, str(e))
    with _pending_lock:
        for i, o in enumerate(_pending_orders):
            if o["id"] == req.id:
                if o["side"] == "BUY":
                    account.release_buy(o["amount"])
                else:
                    account.release_sell(o["qty"])
                _pending_orders.pop(i)
                return {"status": "cancelled", "live": False}
    raise HTTPException(404, "Order not found")


def _check_pending_fills(price: float) -> None:
    with _pending_lock:
        remaining = []
        for o in _pending_orders:
            filled = False
            try:
                if o["side"] == "BUY" and price <= o["price"]:
                    qty = account.fill_buy(o["price"], o["amount"])
                    insert_trade("SIM", "LIMIT", "BUY", o["price"], qty, o["amount"], note=f"order#{o['id']}")
                    filled = True
                elif o["side"] == "SELL" and price >= o["price"]:
                    account.fill_sell(o["price"], o["qty"])
                    insert_trade("SIM", "LIMIT", "SELL", o["price"], o["qty"], o["qty"] * o["price"], note=f"order#{o['id']}")
                    filled = True
            except ValueError:
                filled = True
            if not filled:
                remaining.append(o)
        _pending_orders.clear()
        _pending_orders.extend(remaining)


@app.post("/api/auto")
def api_auto(req: AutoRequest) -> Dict:
    global _auto_enabled, _last_auto_signal
    with _auto_lock:
        _auto_enabled = req.enabled
        _last_auto_signal = None
    return {"auto": _auto_enabled}


@app.get("/api/auto")
def api_auto_get() -> Dict:
    with _auto_lock:
        return {"auto": _auto_enabled, "last_signal": _last_auto_signal}


def _run_auto_trade() -> None:
    global _last_auto_signal, _last_auto_time
    with _auto_lock:
        if not _auto_enabled:
            return
    if trader.connected:
        return  # safety: never auto-trade live
    # Cooldown: wait at least _AUTO_COOLDOWN seconds between scalping trades
    now = time.time()
    if now - _last_auto_time < _AUTO_COOLDOWN:
        return
    try:
        price = client.get_price(SYMBOL)
    except Exception:
        return
    _check_pending_fills(price)
    c = _get_cached("1m")
    label, conf, reason = c["signal"]
    if label == "HOLD" or conf < 0.51:
        return
    _last_auto_signal = label
    _last_auto_time = now
    try:
        if label == "BUY":
            amount = min(account.cash - account.reserved_cash, 50.0)
            if amount > 5:
                qty = account.buy(price, amount)
                insert_trade("SIM", "SCALP_AUTO", "BUY", price, qty, amount, note=f"[scalp] {reason}")
                logger.info("[scalp auto] BUY %.6f SOL @ %.2f (%s)", qty, price, reason)
        else:
            qty = account.qty - account.reserved_qty
            if qty * price > 5:
                account.sell(price, qty)
                insert_trade("SIM", "SCALP_AUTO", "SELL", price, qty, qty * price, note=f"[scalp] {reason}")
                logger.info("[scalp auto] SELL %.6f SOL @ %.2f (%s)", qty, price, reason)
    except ValueError:
        pass


@app.get("/api/trades")
def api_trades(limit: int = 200) -> Dict:
    return {"trades": list_trades(limit)}


@app.post("/api/trades/clear")
def api_trades_clear() -> Dict:
    clear_trades()
    return {"status": "cleared"}


@app.post("/api/live/connect")
def api_live_connect(req: LiveConnectRequest) -> Dict:
    try:
        trader.configure(req.api_key, req.api_secret, req.testnet, req.max_order_usdt)
        return {
            "connected": True,
            "masked_key": trader.masked_key,
            "testnet": trader.testnet,
            "max_order_usdt": trader.max_order_usdt,
        }
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@app.get("/api/live/status")
def api_live_status() -> Dict:
    return {
        "connected": trader.connected,
        "masked_key": trader.masked_key if trader.connected else "-",
        "testnet": trader.testnet,
        "max_order_usdt": trader.max_order_usdt,
    }


@app.get("/api/live/balance")
def api_live_balance() -> Dict:
    if not trader.connected:
        raise HTTPException(400, "Live trading not connected")
    try:
        return trader.account_summary()
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/reset")
def api_reset() -> Dict:
    global _pending_orders, _last_auto_signal
    account.reset()
    with _pending_lock:
        _pending_orders = []
    _last_auto_signal = None
    return {"status": "reset", "account": account.snapshot(client.get_price(SYMBOL))}


# ---------------- background loops ----------------


def _bg_price_loop() -> None:
    while True:
        try:
            price = client.get_price(SYMBOL)
            _check_pending_fills(price)
            _run_auto_trade()
        except Exception as e:
            logger.warning("price loop: %s", e)
        time.sleep(3)


def _bg_candle_loop() -> None:
    while True:
        for intv in INTERVALS:
            try:
                _refresh_candles(intv)
            except Exception as e:
                logger.warning("candle loop %s: %s", intv, e)
        _run_auto_trade()
        time.sleep(10)


@app.on_event("startup")
def _startup() -> None:
    threading.Thread(target=_bg_price_loop, daemon=True).start()
    threading.Thread(target=_bg_candle_loop, daemon=True).start()
    for intv in INTERVALS:
        threading.Thread(target=_refresh_candles, args=(intv,), daemon=True).start()
    logger.info("Background loops and initial interval caches started")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
