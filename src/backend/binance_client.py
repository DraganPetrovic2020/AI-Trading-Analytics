"""Binance REST client for market data and signed trading requests.

Uses only the Python standard library (hmac/hashlib/urllib) so no SDK install
is required. Public market-data calls use `data-api.binance.vision` which is
the official public mirror that is not geo-restricted; signed trading calls
fall back to api.binance.com / testnet.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

PUBLIC_BASE = "https://data-api.binance.vision"
TRADE_BASE_MAIN = "https://api.binance.com"
TRADE_BASE_TESTNET = "https://testnet.binance.vision"

INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"]


def _http_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 10) -> Any:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} from {url}: {body}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error reaching {url}: {e.reason}") from None


class BinanceClient:
    """Public market-data client (no API key needed)."""

    def __init__(self, base: str = PUBLIC_BASE) -> None:
        self.bases = [base, TRADE_BASE_MAIN]

    def _get(self, endpoint: str, timeout: int = 10) -> Any:
        last_err = None
        tried = set()
        for b in self.bases + [TRADE_BASE_MAIN, PUBLIC_BASE]:
            if b in tried:
                continue
            tried.add(b)
            try:
                return _http_get(f"{b}{endpoint}", timeout=timeout)
            except Exception as e:
                last_err = e
        raise RuntimeError(f"Binance public API error: {last_err}")

    def get_price(self, symbol: str = "SOLUSDT") -> float:
        data = self._get(f"/api/v3/ticker/price?symbol={symbol}")
        return float(data["price"])

    def get_24h_ticker(self, symbol: str = "SOLUSDT") -> Dict[str, Any]:
        try:
            data = self._get(f"/api/v3/ticker/24hr?symbol={symbol}")
            return {
                "last_price": float(data["lastPrice"]),
                "price_change": float(data["priceChange"]),
                "price_change_pct": float(data["priceChangePercent"]),
                "high": float(data["highPrice"]),
                "low": float(data["lowPrice"]),
                "volume": float(data["volume"]),
                "quote_volume": float(data["quoteVolume"]),
            }
        except Exception as e:
            try:
                price = self.get_price(symbol)
                candles = self.get_candles(symbol, "1h", limit=24)
                if candles:
                    high = max(c["h"] for c in candles)
                    low = min(c["l"] for c in candles)
                    open_p = candles[0]["o"]
                    change = price - open_p
                    change_pct = (change / open_p) * 100 if open_p else 0
                    vol = sum(c["v"] for c in candles)
                    return {
                        "last_price": price,
                        "price_change": round(change, 2),
                        "price_change_pct": round(change_pct, 2),
                        "high": high,
                        "low": low,
                        "volume": vol,
                        "quote_volume": vol * price,
                    }
            except Exception:
                pass
            raise e

    def get_candles(self, symbol: str = "SOLUSDT", interval: str = "5m", limit: int = 200) -> List[Dict]:
        url_path = f"/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
        raw = self._get(url_path, timeout=15)
        out: List[Dict] = []
        for k in raw:
            out.append(
                {
                    "t": int(k[0]),
                    "o": float(k[1]),
                    "h": float(k[2]),
                    "l": float(k[3]),
                    "c": float(k[4]),
                    "v": float(k[5]),
                }
            )
        return out


class BinanceTrader:
    """Signed REST client for live/testnet spot trading."""

    def __init__(self) -> None:
        self.api_key: Optional[str] = None
        self.api_secret: Optional[str] = None
        self.base_url: str = TRADE_BASE_MAIN
        self.testnet: bool = False
        self.max_order_usdt: float = 50.0

    def configure(self, api_key: str, api_secret: str, testnet: bool, max_order_usdt: float) -> Dict[str, Any]:
        base = TRADE_BASE_TESTNET if testnet else TRADE_BASE_MAIN
        probe = self._signed_request("GET", "/api/v3/account", {}, base, api_key, api_secret)
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = base
        self.testnet = testnet
        self.max_order_usdt = max_order_usdt
        return probe

    @property
    def connected(self) -> bool:
        return self.api_key is not None and self.api_secret is not None

    @property
    def masked_key(self) -> str:
        if not self.api_key:
            return "-"
        return f"{self.api_key[:6]}...{self.api_key[-4:]}"

    def _signed_request(
        self,
        method: str,
        path: str,
        params: Dict[str, Any],
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
    ) -> Any:
        base_url = base_url or self.base_url
        api_key = api_key or self.api_key
        api_secret = api_secret or self.api_secret
        if not api_key or not api_secret:
            raise RuntimeError("Live trading not connected: API key/secret missing")

        payload = dict(params)
        payload["timestamp"] = int(time.time() * 1000)
        payload.setdefault("recvWindow", 5000)
        query = urllib.parse.urlencode(payload)
        signature = hmac.new(api_secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        url = f"{base_url}{path}?{query}&signature={signature}"
        req = urllib.request.Request(url, method=method, headers={"X-MBX-APIKEY": api_key})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Binance API error ({e.code}): {body}") from None

    def account_summary(self) -> Dict[str, float]:
        acc = self._signed_request("GET", "/api/v3/account", {})
        balances = {b["asset"]: float(b["free"]) + float(b["locked"]) for b in acc.get("balances", [])}
        return {"usdt": balances.get("USDT", 0.0), "sol": balances.get("SOL", 0.0)}

    def market_order(self, symbol: str, side: str, quote_usdt: Optional[float] = None, qty: Optional[float] = None) -> Dict:
        params: Dict[str, Any] = {"symbol": symbol, "side": side, "type": "MARKET"}
        if side == "BUY":
            params["quoteOrderQty"] = round(quote_usdt, 2)
        else:
            params["quantity"] = round(qty, 5)
        return self._signed_request("POST", "/api/v3/order", params)

    def place_limit_order(self, symbol: str, side: str, qty: float, price: float) -> Dict:
        params = {
            "symbol": symbol,
            "side": side,
            "type": "LIMIT",
            "timeInForce": "GTC",
            "quantity": round(qty, 5),
            "price": f"{price:.4f}",
        }
        return self._signed_request("POST", "/api/v3/order", params)

    def fetch_open_orders(self, symbol: str) -> List[Dict]:
        return self._signed_request("GET", "/api/v3/openOrders", {"symbol": symbol})

    def cancel_order(self, symbol: str, order_id: int) -> Dict:
        return self._signed_request("DELETE", "/api/v3/order", {"symbol": symbol, "orderId": order_id})
