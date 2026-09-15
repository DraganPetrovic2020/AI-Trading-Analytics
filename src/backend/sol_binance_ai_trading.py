"""
SOL/USDT (Binance) AI Trading GUI - SIM / LIVE Dual Mode
--------------------------------------------------------------
Fetches real SOL/USDT prices & candles from Binance Public API (api.binance.com)
- TradingView style candlestick chart (1m/5m/15m/1h/4h/1d timeframe switching + mouse wheel zoom/pan)
- Automatic support/resistance detection and detailed list (price, strength, distance from current price)
- AI signal engine (scikit-learn Logistic Regression based, or rule-based fallback if unavailable) calculating buy/sell/hold signals & confidence
- Market (immediate execution) + Limit (manual) buy/sell, AI signal based automated trading
- Price lookup and SIM trading are fully available without API keys (Binance public API doesn't require keys).
- For LIVE trading, connect a Binance API key file. No separate SDK needed; handles signing & orders using Python standard libraries (hmac/urllib).

Key file format (e.g., binance_config.json) - NEVER commit to public repositories:
{
  "api_key": "Your Binance API Key",
  "api_secret": "Your Binance API Secret",
  "testnet": false,
  "max_order_usdt": 50
}
* Setting testnet to true connects to Binance Testnet (virtual funds). Recommended for beginners.
* When generating Binance API keys, enable "Enable Spot Trading" only and disable "Withdraw" permissions.
This program does not use withdrawal features.

Precautions
-----------
1) In LIVE mode, real orders are sent to Binance and real funds are used. This cannot be undone.
2) AI signals are statistical estimates based on historical data and do not constitute financial advice.
3) API secrets are used only within program memory and are never printed to screen or logs.
   Storage of the key file (file permissions, .gitignore, etc.) is the user's responsibility.

Execution (simulation mode only requires these two lines):
    pip install matplotlib numpy scikit-learn
    python sol_binance_ai_trading.py
"""

import csv
import hashlib
import hmac
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime

import logging
from typing import Tuple, List, Dict, Any, Optional
from sklearn.linear_model import SGDClassifier

import tkinter as tk
from tkinter import ttk, messagebox, filedialog

import numpy as np
import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.patches import Rectangle
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk

try:
    from sklearn.linear_model import LogisticRegression
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

# Live logging configuration
logger = logging.getLogger("LiveSignalEngine")

# ============================================================
# 1. Binance Public Ticker API (No key required - sufficient for SIM)
# ============================================================

class BinanceClient:
    BASE_URL = "https://api.binance.com"

    def get_mid_price(self, symbol: str) -> float:
        url = f"{self.BASE_URL}/api/v3/ticker/price?symbol={symbol}"
        with urllib.request.urlopen(url, timeout=5) as res:
            data = json.loads(res.read())
        return float(data["price"])

    def get_candles(self, symbol: str, interval: str, count: int = 150):
        url = f"{self.BASE_URL}/api/v3/klines?symbol={symbol}&interval={interval}&limit={count}"
        with urllib.request.urlopen(url, timeout=10) as res:
            raw = json.loads(res.read())
        candles = []
        for k in raw:
            # Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
            candles.append({
                "t": datetime.fromtimestamp(k[0] / 1000),
                "o": float(k[1]), "h": float(k[2]),
                "l": float(k[3]), "c": float(k[4]),
                "v": float(k[5]),
            })
        return candles


# ============================================================
# 1-1. Live Trading Connection (User-owned Binance API Key, standard libraries only)
# ============================================================

class BinanceLiveConnector:
    """
    Reads user Binance API key file (JSON) and sends direct REST requests using HMAC-SHA256 signatures.
    No separate SDK required (hmac, hashlib, urllib are Python standard libraries).
    Secrets are kept strictly in instance memory and never exposed to logs or UI.

    Binance policy compliance: Query strings are percent-encoded (urlencode) first,
    then the resulting string is signed directly.
    """

    def __init__(self):
        self.api_key = None
        self.api_secret = None
        self.base_url = "https://api.binance.com"
        self.testnet = False
        self.max_order_usdt = 50.0

    def load_from_file(self, path: str):
        with open(path, "r", encoding="utf-8") as f:
            cfg = json.load(f)

        api_key = cfg["api_key"]
        api_secret = cfg["api_secret"]
        testnet = bool(cfg.get("testnet", False))
        max_order_usdt = float(cfg.get("max_order_usdt", 50.0))
        base_url = "https://testnet.binance.vision" if testnet else "https://api.binance.com"

        # Read-only signed probe call to verify connection (raises exception on failure)
        probe = self._signed_request("GET", "/api/v3/account", {}, base_url, api_key, api_secret)

        self.api_key, self.api_secret = api_key, api_secret
        self.base_url, self.testnet, self.max_order_usdt = base_url, testnet, max_order_usdt
        del api_secret
        return probe

    @property
    def connected(self) -> bool:
        return self.api_key is not None and self.api_secret is not None

    @property
    def masked_key(self) -> str:
        if not self.api_key:
            return "-"
        return f"{self.api_key[:6]}...{self.api_key[-4:]}"

    def _signed_request(self, method, path, params, base_url=None, api_key=None, api_secret=None):
        base_url = base_url or self.base_url
        api_key = api_key or self.api_key
        api_secret = api_secret or self.api_secret

        payload = dict(params)
        payload["timestamp"] = int(time.time() * 1000)
        payload.setdefault("recvWindow", 5000)

        query = urllib.parse.urlencode(payload)
        signature = hmac.new(api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
        query = f"{query}&signature={signature}"

        url = f"{base_url}{path}?{query}"
        req = urllib.request.Request(url, method=method, headers={"X-MBX-APIKEY": api_key})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Binance API error ({e.code}): {body}") from None

    def account_summary(self) -> dict:
        acc = self._signed_request("GET", "/api/v3/account", {})
        balances = {b["asset"]: float(b["free"]) + float(b["locked"]) for b in acc.get("balances", [])}
        return {"usdt": balances.get("USDT", 0.0), "sol": balances.get("SOL", 0.0)}

    def market_order(self, symbol: str, side: str, quote_usdt: float = None, qty: float = None):
        params = {"symbol": symbol, "side": side, "type": "MARKET"}
        if side == "BUY":
            params["quoteOrderQty"] = round(quote_usdt, 2)
        else:
            params["quantity"] = round(qty, 5)
        return self._signed_request("POST", "/api/v3/order", params)

    def place_limit_order(self, symbol: str, side: str, qty: float, price: float):
        params = {
            "symbol": symbol, "side": side, "type": "LIMIT", "timeInForce": "GTC",
            "quantity": round(qty, 5), "price": f"{price:.4f}",
        }
        return self._signed_request("POST", "/api/v3/order", params)

    def fetch_open_orders(self, symbol: str):
        return self._signed_request("GET", "/api/v3/openOrders", {"symbol": symbol})

    def cancel_order(self, symbol: str, order_id: int):
        return self._signed_request("DELETE", "/api/v3/order", {"symbol": symbol, "orderId": order_id})


# ============================================================
# 2. Technical Indicators
# ============================================================

def sma(value: list, n: int):
    """Calculates Simple Moving Average (SMA) for latest closes (value) over period (n)."""
    if len(value) < n: 
        return None
    return float(np.mean(value[-n:]))

def ema_series(value: list, n: int):
    """Returns EMA series array for all data points."""
    if len(value) < n:
        return [None] * len(value)
    k = 2 / (n + 1)
    out = [None] * (n - 1)
    first_sma = sum(value[:n]) / n
    out.append(first_sma)
    for v in value[n:]:
        next_ema = v * k + out[-1] * (1 - k)
        out.append(next_ema)
    return out

def rsi(value: list, n: int = 200):
    """Binance standard RSI function with Wilder's Smoothing."""
    if len(value) < n + 1:
        return None
    gains = []
    losses = []
    for i in range(1, len(value)):
        diff = value[i] - value[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
        
    avg_gain = sum(gains[:n]) / n
    avg_loss = sum(losses[:n]) / n
    
    for i in range(n, len(gains)):
        avg_gain = (avg_gain * (n - 1) + gains[i]) / n
        avg_loss = (avg_loss * (n - 1) + losses[i]) / n
        
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def macd_hist(value: list, fast: int = 12, slow: int = 26, n: int = 9):
    """Pure Python MACD histogram function matching Binance standard formula."""
    if len(value) < slow + n:
        return None
    ema_fast_list = ema_series(value, fast)
    ema_slow_list = ema_series(value, slow)
    macd_line = []
    offset = len(ema_fast_list) - len(ema_slow_list)
    for i in range(len(ema_slow_list)):
        macd_val = ema_fast_list[offset + i] - ema_slow_list[i]
        macd_line.append(macd_val)
    signal_line = ema_series(macd_line, n)
    if not signal_line or signal_line[-1] is None:
        return None
    return macd_line[-1] - signal_line[-1]

def bollinger(value: list, n: int = 20, k: float = 2.0):
    """Returns single latest Bollinger Bands (Upper, Middle, Lower) values based on latest data."""
    if len(value) < n:
        return None, None, None
    window = value[-n:]
    mean = sum(window) / n
    variance = sum((x - mean) ** 2 for x in window) / n
    std = variance ** 0.5
    return float(mean + k * std), float(mean), float(mean - k * std)


# ============================================================
# 3. Support / Resistance Detection
# ============================================================

def _find_pivots(candles, left=3, right=3):
    highs = [c["h"] for c in candles]
    lows = [c["l"] for c in candles]
    pivot_highs, pivot_lows = [], []
    n = len(candles)
    
    for i in range(left, n - right):
        wh = highs[i - left : i + right + 1]
        
        # Prevent duplicate detection for flat highs (identical maximums)
        if highs[i] == max(wh) and wh.count(highs[i]) == 1:
            pivot_highs.append((i, highs[i]))
            
        wl = lows[i - left : i + right + 1]
        
        # Prevent duplicate detection for flat lows (identical minimums)
        if lows[i] == min(wl) and wl.count(lows[i]) == 1:
            pivot_lows.append((i, lows[i]))
            
    return pivot_highs, pivot_lows


def _cluster(pivots, level_type, tolerance_pct):
    levels = []
    
    for idx, price in pivots:
        merged = False
        
        for lvl in levels:
            relative_diff = abs(price - lvl["price"]) / lvl["price"] * 100
            
            if relative_diff <= tolerance_pct:
                current_touches = lvl["touches"]
                lvl["price"] = ((lvl["price"] * current_touches) + price) / (current_touches + 1)
                lvl["touches"] += 1
                lvl["last_index"] = max(lvl["last_index"], idx)
                merged = True
                break
                
        if not merged:
            levels.append({
                "price": price, 
                "touches": 1, 
                "last_index": idx, 
                "type": level_type
            })
            
    return levels


def detect_support_resistance(candles, left=3, right=3, tolerance_pct=0.25, min_touches=2):
    if len(candles) < (left + right + 1):
        return []
        
    pivot_highs, pivot_lows = _find_pivots(candles, left, right)
    
    res_levels = _cluster(pivot_highs, "Resistance", tolerance_pct)
    sup_levels = _cluster(pivot_lows, "Support", tolerance_pct)
    
    combined_levels = res_levels + sup_levels
    levels = [lvl for lvl in combined_levels if lvl["touches"] >= min_touches]
    
    levels.sort(key=lambda lvl: lvl["price"], reverse=True)
    return levels


# ============================================================
# 4. AI Signal Engine
# ============================================================

class LiveSignalEngine:
    """
    Asynchronous online learning signal engine for live trading (Sklearn safety standards compliant).
    """
    def __init__(self, window_size: int = 500, buy_threshold: float = 0.58, sell_threshold: float = 0.42):
        self.window_size = window_size
        self.buy_threshold = buy_threshold
        self.sell_threshold = sell_threshold
        
        # 1. Initialize SGD Logistic Regression model for online learning
        self.model = SGDClassifier(
            loss='log_loss',
            penalty='l2', 
            alpha=0.0001, 
            learning_rate='optimal',
            warm_start=True
        ) if HAS_SKLEARN else None
        
        self.classes = np.array([0, 1])  # Binary classification classes: Down (0), Up (1)
        self.trained = False
        self._lock = threading.Lock()

    def _get_rolling_stats(self, closes: List[float]) -> Tuple[float, float]:
        recent_closes = closes[-self.window_size:] if len(closes) > self.window_size else closes
        return float(np.mean(recent_closes)), float(np.std(recent_closes) + 1e-8)

    def _features_at(self, closes: List[float], i: int) -> Optional[List[float]]:
        try:
            window = closes[:i + 1]
            if len(window) < 151:
                return None
                
            r = rsi(window, n=150)
            m_hist = macd_hist(window)
            up, mid, low = bollinger(window)
            
            if None in (r, m_hist, up, low) or up == low:
                return None
                
            price = closes[i]
            pct_b = (price - low) / (up - low)
            
            s5, s20 = sma(window, 5), sma(window, 20)
            if s5 is None or s20 is None:
                return None
                
            trend = (s5 - s20)
            return [float(r), float(m_hist), float(pct_b), float(trend)]
        except Exception as e:
            return None

    def _manual_scale(self, feat: List[float], mean_val: float, std_val: float) -> List[float]:
        return [(f - mean_val) / std_val for f in feat]

    def update_online_async(self, candles: List[Dict[str, Any]]) -> None:
        if not HAS_SKLEARN or len(candles) < 152:
            return
        threading.Thread(target=self._run_partial_fit, args=(candles,), daemon=True).start()

    def _run_partial_fit(self, candles: List[Dict[str, Any]]) -> None:
        try:
            closes = [float(c["c"]) for c in candles]
            if len(closes) < 152:
                return

            i = len(closes) - 2
            feat = self._features_at(closes, i)
            if feat is None:
                return

            mean_val, std_val = self._get_rolling_stats(closes[:i])
            scaled_feat = self._manual_scale(feat, mean_val, std_val)
            target_y = 1 if closes[i + 1] > closes[i] else 0

            with self._lock:
                self.model.partial_fit([scaled_feat], [target_y], classes=self.classes)
                self.trained = True
            logger.info(f"[Online Learning Success] 1 record reflected (Y={target_y})")
        except Exception as e:
            logger.error(f"Error during async online learning: {e}")

    def train(self, candles: List[Dict[str, Any]]) -> None:
        self.update_online_async(candles)

    def predict(self, candles: List[Dict[str, Any]]) -> Tuple[str, float, str]:
        if len(candles) < 151:
            return "HOLD", 0.5, "Insufficient Data (Requires 151 candles for RSI)"

        try:
            closes = [float(c["c"]) for c in candles]
            idx_now = len(closes) - 1
            feat = self._features_at(closes, idx_now)
            
            if feat is None:
                return "HOLD", 0.5, "Indicator Calculation Failed"

            r, m_hist, pct_b, trend = feat

            if HAS_SKLEARN and self.trained:
                try:
                    mean_val, std_val = self._get_rolling_stats(closes)
                    scaled_feat = self._manual_scale(feat, mean_val, std_val)

                    with self._lock:
                        proba_up = float(self.model.predict_proba([scaled_feat])[0][1])

                    if proba_up >= self.buy_threshold:
                        return "BUY", proba_up, f"AI Real-time Uptrend Prob {proba_up*100:.1f}% (RSI {r:.0f})"
                    elif proba_up <= self.sell_threshold:
                        return "SELL", 1 - proba_up, f"AI Real-time Downtrend Prob {(1-proba_up)*100:.1f}% (RSI {r:.0f})"
                    else:
                        return "HOLD", proba_up, f"AI Neutral ({proba_up*100:.1f}%)"
                except Exception as ml_err:
                    logger.error(f"AI real-time inference failed, falling back to rules: {ml_err}")

            score, reasons = 0, []
            if r < 30: score += 1; reasons.append("RSI Oversold")
            elif r > 70: score -= 1; reasons.append("RSI Overbought")
            if m_hist > 0: score += 1; reasons.append("MACD Bullish")
            else: score -= 1; reasons.append("MACD Bearish")
            if pct_b < 0.2: score += 1; reasons.append("Bollinger Lower Band")
            elif pct_b > 0.8: score -= 1; reasons.append("Bollinger Upper Band")
            score += 1 if trend > 0 else -1
            
            conf = min(abs(score) / 4, 1.0)
            label = "BUY" if score >= 2 else "SELL" if score <= -2 else "HOLD"
            return label, conf, "[Hybrid Rule Fallback] " + (", ".join(reasons) if reasons else "Flat Trend")

        except Exception as e:
            logger.critical(f"Engine prediction system critical error: {e}")
            return "HOLD", 0.0, f"Error: {str(e)}"


# ============================================================
# 5. Paper Account
# ============================================================

class PaperAccount:
    def __init__(self, cash: float = 10000.0):
        self.cash = cash
        self.qty = 0.0
        self.history = []
        self.reserved_cash = 0.0
        self.reserved_qty = 0.0

    def buy(self, price, amount_usdt):
        if amount_usdt <= 0:
            raise ValueError("Amount must be greater than 0")
        if amount_usdt > self.cash - self.reserved_cash:
            raise ValueError("Insufficient available cash")
        qty = amount_usdt / price
        self.cash -= amount_usdt
        self.qty += qty
        self.history.append((datetime.now(), "BUY", price, qty))
        return qty

    def sell(self, price, qty):
        if qty <= 0:
            raise ValueError("Quantity must be greater than 0")
        if qty > self.qty - self.reserved_qty:
            raise ValueError("Insufficient available SOL quantity")
        amount = qty * price
        self.qty -= qty
        self.cash += amount
        self.history.append((datetime.now(), "SELL", price, qty))
        return amount

    def equity(self, price):
        return self.cash + self.qty * price

    def reserve_buy(self, amount_usdt):
        if amount_usdt <= 0:
            raise ValueError("Amount must be greater than 0")
        if amount_usdt > self.cash - self.reserved_cash:
            raise ValueError("Insufficient available cash (excluding active limit orders)")
        self.reserved_cash += amount_usdt

    def reserve_sell(self, qty):
        if qty <= 0:
            raise ValueError("Quantity must be greater than 0")
        if qty > self.qty - self.reserved_qty:
            raise ValueError("Insufficient available SOL quantity (excluding active limit orders)")
        self.reserved_qty += qty

    def release_buy(self, amount_usdt):
        self.reserved_cash = max(0.0, self.reserved_cash - amount_usdt)

    def release_sell(self, qty):
        self.reserved_qty = max(0.0, self.reserved_qty - qty)

    def fill_buy(self, price, amount_usdt):
        qty = amount_usdt / price
        self.cash -= amount_usdt
        self.reserved_cash = max(0.0, self.reserved_cash - amount_usdt)
        self.qty += qty
        self.history.append((datetime.now(), "BUY (Limit Filled)", price, qty))
        return qty

    def fill_sell(self, price, qty):
        amount = qty * price
        self.qty -= qty
        self.reserved_qty = max(0.0, self.reserved_qty - qty)
        self.cash += amount
        self.history.append((datetime.now(), "SELL (Limit Filled)", price, qty))
        return amount


# ============================================================
# 5-1. Trade Logger (Manual / Auto Separated)
# ============================================================

class TradeLogger:
    """Logs all trade executions into CSV files: manual_trades.csv and auto_trades.csv."""

    HEADER = ["timestamp", "mode", "order_type", "side", "price", "qty", "amount_usdt", "note"]

    def __init__(self, log_dir: str):
        os.makedirs(log_dir, exist_ok=True)
        self.manual_path = os.path.join(log_dir, "manual_trades.csv")
        self.auto_path = os.path.join(log_dir, "auto_trades.csv")
        self._ensure_header(self.manual_path)
        self._ensure_header(self.auto_path)

    def _ensure_header(self, path):
        if not os.path.exists(path):
            with open(path, "w", newline="", encoding="utf-8-sig") as f:
                csv.writer(f).writerow(self.HEADER)

    def _append(self, path, mode, order_type, side, price, qty, amount, note):
        with open(path, "a", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerow([
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                mode, order_type, side, price, qty, amount, note,
            ])

    def log_manual(self, mode, order_type, side, price, qty=None, amount=None, note=""):
        self._append(self.manual_path, mode, order_type, side, price, qty, amount, note)

    def log_auto(self, mode, order_type, side, price, qty=None, amount=None, note=""):
        self._append(self.auto_path, mode, order_type, side, price, qty, amount, note)


# ============================================================
# 6. GUI Application
# ============================================================

SYMBOL = "SOLUSDT"
INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"]


class TradingApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SOL/USDT (Binance) AI Trading Dashboard")
        self.geometry("1380x768")
        self.minsize(1100, 780)

        self.client = BinanceClient()
        self.ai_engine = LiveSignalEngine()
        self.account = PaperAccount()
        self.live = BinanceLiveConnector()
        self.live_balance_cache = None

        self.interval = "5m"
        self.candles = []
        self.levels = []
        self.current_price = 0.0
        self.ai_signal = ("HOLD", 0.5, "Initializing...")
        self.last_auto_signal = None

        self.running = True
        self.auto_trading = False
        self.refresh_event = threading.Event()

        self.pending_orders = []
        self._pending_id_seq = 1

        log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
        self.trade_logger = TradeLogger(log_dir)

        self._build_ui()
        self._start_threads()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        # Top Bar
        top = ttk.Frame(self, padding=10)
        top.pack(fill="x")

        self.price_label = ttk.Label(top, text="SOL/USDT: Fetching...", font=("Arial", 18, "bold"))
        self.price_label.pack(side="left")

        self.ai_badge = ttk.Label(top, text="AI Signal: -", font=("Arial", 13, "bold"), padding=6)
        self.ai_badge.pack(side="left", padx=20)

        self.balance_label = ttk.Label(top, text="", font=("Arial", 11))
        self.balance_label.pack(side="right")

        # Scroll container for content below top bar
        scroll_container = ttk.Frame(self)
        scroll_container.pack(fill="both", expand=True, padx=5, pady=(0, 5))
        v_scrollbar = ttk.Scrollbar(scroll_container, orient="vertical")
        v_scrollbar.pack(side="right", fill="y")

        canvas = tk.Canvas(scroll_container, bd=0, highlightthickness=0, yscrollcommand=v_scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        v_scrollbar.config(command=canvas.yview)

        container = ttk.Frame(canvas)
        canvas_frame_id = canvas.create_window((0, 0), window=container, anchor="nw")

        def on_frame_configure(event):
            canvas.configure(scrollregion=canvas.bbox("all"))

        def on_canvas_configure(event):
            canvas.itemconfig(canvas_frame_id, width=event.width)

        container.bind("<Configure>", on_frame_configure)
        canvas.bind("<Configure>", on_canvas_configure)

        def on_mouse_wheel(event):
            if event.delta:
                canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            elif event.num == 4:
                canvas.yview_scroll(-1, "units")
            elif event.num == 5:
                canvas.yview_scroll(1, "units")

        canvas.bind_all("<MouseWheel>", on_mouse_wheel)
        canvas.bind_all("<Button-4>", on_mouse_wheel)
        canvas.bind_all("<Button-5>", on_mouse_wheel)

        # Timeframe interval bar
        interval_bar = ttk.Frame(container, padding=(10, 0))
        interval_bar.pack(fill="x")
        ttk.Label(interval_bar, text="Timeframe:").pack(side="left", padx=(0, 8))
        self.interval_buttons = {}
        for intv in INTERVALS:
            b = ttk.Button(interval_bar, text=intv, width=5,
                            command=lambda i=intv: self._change_interval(i))
            b.pack(side="left", padx=2)
            self.interval_buttons[intv] = b
        ttk.Button(interval_bar, text="Refresh", command=lambda: self.refresh_event.set()).pack(side="left", padx=15)
        self._highlight_interval()

        # Mode banner
        self.mode_banner = tk.Label(container, text="Simulation Mode (SIM) - Virtual Funds, No API Key Required",
                                     font=("Arial", 11, "bold"), bg="#1e8449", fg="white", pady=4)
        self.mode_banner.pack(fill="x", padx=10, pady=(6, 0))

        # Live trading connection panel
        live_frame = ttk.LabelFrame(container, text="Binance Live Connection (User API Key - Required for Live Trading Only)", padding=8)
        live_frame.pack(fill="x", padx=10, pady=6)

        ttk.Label(live_frame, text="Key File:").grid(row=0, column=0, padx=(0, 5))
        self.key_path_entry = ttk.Entry(live_frame, width=45)
        self.key_path_entry.grid(row=0, column=1, padx=5)
        ttk.Button(live_frame, text="Browse", command=self._browse_key_file).grid(row=0, column=2, padx=5)
        ttk.Button(live_frame, text="Connect", command=self._connect_live).grid(row=0, column=3, padx=5)
        ttk.Button(live_frame, text="Refresh Balance", command=self._refresh_live_balance).grid(row=0, column=4, padx=5)

        self.mode_var = tk.StringVar(value="SIM")
        mode_box = ttk.Frame(live_frame)
        mode_box.grid(row=0, column=5, padx=20)
        ttk.Radiobutton(mode_box, text="SIM", variable=self.mode_var, value="SIM",
                         command=self._on_mode_change).pack(side="left")
        ttk.Radiobutton(mode_box, text="LIVE", variable=self.mode_var, value="LIVE",
                         command=self._on_mode_change).pack(side="left")

        self.live_status_label = ttk.Label(
            live_frame,
            text="Disconnected - Price charts and SIM trading are fully available without a key file.",
            foreground="#666",
        )
        self.live_status_label.grid(row=1, column=0, columnspan=6, sticky="w", pady=(6, 0))

        # Body: Left chart + Right support/resistance panel
        body = ttk.Frame(container)
        body.pack(fill="both", expand=True, padx=10, pady=5)

        chart_frame = ttk.Frame(body)
        chart_frame.pack(side="left", fill="both", expand=True)

        self.fig = Figure(figsize=(9, 5), dpi=100)
        self.ax = self.fig.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.fig, master=chart_frame)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)
        toolbar = NavigationToolbar2Tk(self.canvas, chart_frame)
        toolbar.update()
        self.canvas.mpl_connect("scroll_event", self._on_scroll_zoom)

        # Right: Support / Resistance panel
        sr_frame = ttk.LabelFrame(body, text="Support / Resistance Levels", padding=8, width=320)
        sr_frame.pack(side="right", fill="y", padx=(10, 0))
        sr_frame.pack_propagate(False)

        columns = ("type", "price", "touches", "dist")
        self.sr_tree = ttk.Treeview(sr_frame, columns=columns, show="headings", height=20)
        self.sr_tree.heading("type", text="Type")
        self.sr_tree.heading("price", text="Price (USDT)")
        self.sr_tree.heading("touches", text="Strength")
        self.sr_tree.heading("dist", text="Distance")
        self.sr_tree.column("type", width=65, anchor="center")
        self.sr_tree.column("price", width=95, anchor="e")
        self.sr_tree.column("touches", width=55, anchor="center")
        self.sr_tree.column("dist", width=75, anchor="e")
        self.sr_tree.pack(fill="both", expand=True)
        self.sr_tree.tag_configure("Resistance", foreground="#c0392b")
        self.sr_tree.tag_configure("Support", foreground="#1e8449")
        self.sr_tree.bind("<Double-1>", self._fill_limit_price_from_sr)

        # Bottom: Order controls
        controls = ttk.LabelFrame(container, text="Orders", padding=10)
        controls.pack(fill="x", padx=10, pady=5)

        ttk.Label(controls, text="Trade Amount (USDT):").grid(row=0, column=0, padx=5, sticky="w")
        self.amount_entry = ttk.Entry(controls, width=12)
        self.amount_entry.insert(0, "100")
        self.amount_entry.grid(row=0, column=1, padx=5)

        ttk.Button(controls, text="Buy", command=self.manual_buy).grid(row=0, column=2, padx=5)
        ttk.Button(controls, text="Sell", command=self.manual_sell).grid(row=0, column=3, padx=5)

        self.auto_var = tk.BooleanVar()
        self.auto_check = ttk.Checkbutton(controls, text="Enable AI Auto-Trading (SIM Only)", variable=self.auto_var,
                                           command=self._toggle_auto)
        self.auto_check.grid(row=0, column=4, padx=20, sticky="w")

        ttk.Button(controls, text="Reset Account", command=self._reset_account).grid(row=0, column=5, padx=5)

        # Order type: Market / Limit
        self.order_type_var = tk.StringVar(value="Market")
        order_type_box = ttk.Frame(controls)
        order_type_box.grid(row=1, column=0, columnspan=2, sticky="w", pady=(8, 0))
        ttk.Label(order_type_box, text="Order Type:").pack(side="left", padx=(0, 5))
        ttk.Radiobutton(order_type_box, text="Market", variable=self.order_type_var,
                         value="Market", command=self._on_order_type_change).pack(side="left")
        ttk.Radiobutton(order_type_box, text="Limit", variable=self.order_type_var,
                         value="Limit", command=self._on_order_type_change).pack(side="left")

        ttk.Label(controls, text="Limit Price (USDT):").grid(row=1, column=2, sticky="e", pady=(8, 0))
        self.limit_price_entry = ttk.Entry(controls, width=12, state="disabled")
        self.limit_price_entry.grid(row=1, column=3, padx=5, pady=(8, 0), sticky="w")
        ttk.Label(controls, text="(Double-click S/R table to auto-fill)",
                  foreground="#666").grid(row=1, column=4, columnspan=2, sticky="w", pady=(8, 0))

        engine_txt = "scikit-learn Logistic Regression" if HAS_SKLEARN else "Rule-based Fallback (scikit-learn missing)"
        ttk.Label(controls, text=f"AI Engine: {engine_txt}", foreground="#666").grid(
            row=2, column=0, columnspan=6, sticky="w", pady=(6, 0))

        # Pending limit orders panel
        pending_frame = ttk.LabelFrame(container, text="Open Limit Orders", padding=8)
        pending_frame.pack(fill="x", padx=10, pady=(0, 5))

        pcols = ("id", "side", "price", "size", "note")
        self.pending_tree = ttk.Treeview(pending_frame, columns=pcols, show="headings", height=4)
        for c, w, txt in (("id", 60, "ID"), ("side", 50, "Side"), ("price", 100, "Price"),
                          ("size", 110, "Size/Amount"), ("note", 260, "Note")):
            self.pending_tree.heading(c, text=txt)
            self.pending_tree.column(c, width=w, anchor="center")
        self.pending_tree.pack(side="left", fill="x", expand=True)

        pending_btns = ttk.Frame(pending_frame)
        pending_btns.pack(side="left", padx=10)
        ttk.Button(pending_btns, text="Refresh", command=self._update_pending_panel).pack(fill="x", pady=2)
        ttk.Button(pending_btns, text="Cancel Selected", command=self._cancel_selected_pending).pack(fill="x", pady=2)

        # Trade logs
        log_frame = ttk.LabelFrame(container, text="Trade History", padding=5)
        log_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        log_scroll = ttk.Scrollbar(log_frame, orient="vertical")
        self.log_box = tk.Listbox(log_frame, height=8, yscrollcommand=log_scroll.set)
        log_scroll.config(command=self.log_box.yview)
        self.log_box.pack(side="left", fill="both", expand=True)
        log_scroll.pack(side="right", fill="y")

        self._update_mode_banner()
        self._log("Application started - SIM mode. Prices, charts, and simulation trading are ready without API keys.")
        self._log("To enable LIVE trading, connect your Binance API key file above and switch mode to LIVE.")
        self._log(f"Trade log storage: {self.trade_logger.manual_path} (Manual), {self.trade_logger.auto_path} (Auto)")

    def _highlight_interval(self):
        for intv, btn in self.interval_buttons.items():
            btn.state(["pressed"] if intv == self.interval else ["!pressed"])

    def _start_threads(self):
        threading.Thread(target=self._price_loop, daemon=True).start()
        threading.Thread(target=self._candle_loop, daemon=True).start()

    def _price_loop(self):
        while self.running:
            try:
                price = self.client.get_mid_price(SYMBOL)
                self.current_price = price
                self.after(0, self._refresh_account_ui)
                self.after(0, self._check_pending_orders)
            except Exception as e:
                msg = f"Price fetch failed: {e}"
                self.after(0, lambda m=msg: self.price_label.config(text=m))
            time.sleep(2)

    def _candle_loop(self):
        while self.running:
            try:
                candles = self.client.get_candles(SYMBOL, self.interval, count=200)
                self.candles = candles
                self.levels = detect_support_resistance(candles)
                self.ai_engine.train(candles)
                self.ai_signal = self.ai_engine.predict(candles)
                self.after(0, self._redraw_chart)
                self.after(0, self._update_sr_panel)
                self.after(0, self._update_ai_badge)
                if self.auto_trading:
                    self.after(0, self._auto_trade_from_ai)
            except Exception as e:
                msg = f"Candle fetch failed: {e}"
                self.after(0, lambda m=msg: self._log(m))
            self.refresh_event.wait(timeout=12)
            self.refresh_event.clear()

    def _refresh_account_ui(self):
        self.price_label.config(text=f"SOL/USDT (Binance): {self.current_price:,.2f} USDT")
        if self.mode_var.get() == "LIVE" and self.live.connected:
            if self.live_balance_cache is not None:
                b = self.live_balance_cache
                self.balance_label.config(
                    text=f"[LIVE] USDT {b['usdt']:,.2f} | SOL {b['sol']:.6f}"
                )
            else:
                self.balance_label.config(text="[LIVE] Fetching balance...")
        else:
            eq = self.account.equity(self.current_price)
            self.balance_label.config(
                text=(f"[SIM] Cash {self.account.cash:,.2f} USDT | SOL {self.account.qty:.6f} | "
                      f"Equity {eq:,.2f} USDT")
            )

    def _update_ai_badge(self):
        signal, conf, reason = self.ai_signal
        colors = {"BUY": "#1e8449", "SELL": "#c0392b", "HOLD": "#7f8c8d"}
        labels = {"BUY": "BUY Signal", "SELL": "SELL Signal", "HOLD": "HOLD"}
        self.ai_badge.config(
            text=f"AI: {labels[signal]} (Confidence {conf*100:.0f}%) - {reason}",
            foreground=colors[signal],
        )

    def _update_sr_panel(self):
        for row in self.sr_tree.get_children():
            self.sr_tree.delete(row)
        price = self.current_price or (self.candles[-1]["c"] if self.candles else 0)
        for lvl in self.levels:
            dist = (lvl["price"] - price) / price * 100 if price else 0
            self.sr_tree.insert(
                "", "end",
                values=(lvl["type"], f"{lvl['price']:,.1f}", lvl["touches"], f"{dist:+.2f}%"),
                tags=(lvl["type"],),
            )

    def _redraw_chart(self):
        self.ax.clear()
        candles = self.candles
        if not candles:
            self.canvas.draw()
            return

        closes = [c["c"] for c in candles]
        n = len(candles)
        width = 0.6

        for i, c in enumerate(candles):
            up = c["c"] >= c["o"]
            color = "#26a69a" if up else "#ef5350"
            self.ax.plot([i, i], [c["l"], c["h"]], color=color, linewidth=1)
            lower = min(c["o"], c["c"])
            height = abs(c["c"] - c["o"]) or price_epsilon(closes)
            self.ax.add_patch(Rectangle((i - width / 2, lower), width, height, color=color))

        for period, color in ((5, "#3498db"), (20, "#f39c12")):
            if n >= period:
                vals = [None] * (period - 1) + [
                    sum(closes[j - period + 1:j + 1]) / period for j in range(period - 1, n)
                ]
                self.ax.plot(range(n), vals, linewidth=1.1, color=color, label=f"SMA{period}")

        for lvl in self.levels:
            color = "#1e8449" if lvl["type"] == "Support" else "#c0392b"
            self.ax.axhline(lvl["price"], color=color, linestyle="--", linewidth=0.8, alpha=0.6)

        step = max(n // 8, 1)
        ticks = list(range(0, n, step))
        self.ax.set_xticks(ticks)
        self.ax.set_xticklabels([candles[i]["t"].strftime("%m/%d %H:%M") for i in ticks], rotation=40, fontsize=8)

        self.ax.set_title(f"SOL/USDT {self.interval} Candlestick Chart (Binance)")
        self.ax.set_ylabel("USDT")
        self.ax.legend(loc="upper left", fontsize=8)
        self.ax.set_xlim(-1, n)
        self.fig.tight_layout()
        self.canvas.draw()

    def _on_scroll_zoom(self, event):
        if event.inaxes != self.ax or event.xdata is None:
            return
        cur_xlim = self.ax.get_xlim()
        scale = 0.85 if event.button == "up" else 1.15
        new_width = (cur_xlim[1] - cur_xlim[0]) * scale
        relx = (cur_xlim[1] - event.xdata) / (cur_xlim[1] - cur_xlim[0])
        self.ax.set_xlim(event.xdata - new_width * (1 - relx), event.xdata + new_width * relx)
        self.canvas.draw_idle()

    def _change_interval(self, intv):
        if intv == self.interval:
            return
        self.interval = intv
        self._highlight_interval()
        self.last_auto_signal = None
        self.refresh_event.set()
        self._log(f"Changed timeframe to {intv}")

    def manual_buy(self):
        self._manual_trade("buy")

    def manual_sell(self):
        self._manual_trade("sell")

    def _on_order_type_change(self):
        if self.order_type_var.get() == "Limit":
            self.limit_price_entry.config(state="normal")
        else:
            self.limit_price_entry.config(state="disabled")

    def _fill_limit_price_from_sr(self, event):
        sel = self.sr_tree.selection()
        if not sel:
            return
        price_text = self.sr_tree.item(sel[0], "values")[1]
        self.order_type_var.set("Limit")
        self._on_order_type_change()
        self.limit_price_entry.config(state="normal")
        self.limit_price_entry.delete(0, tk.END)
        self.limit_price_entry.insert(0, price_text.replace(",", ""))

    def _manual_trade(self, side):
        if self.current_price <= 0:
            messagebox.showerror("Error", "Price not loaded yet. Please try again in a moment.")
            return
        try:
            amount = float(self.amount_entry.get())
        except ValueError:
            messagebox.showerror("Error", "Please enter a valid amount")
            return

        if self.order_type_var.get() == "Limit":
            try:
                limit_price = float(self.limit_price_entry.get())
                if limit_price <= 0:
                    raise ValueError
            except ValueError:
                messagebox.showerror("Error", "Please enter a valid limit price")
                return
            if self.mode_var.get() == "LIVE":
                self._live_limit_order(side, amount, limit_price)
            else:
                self._paper_limit_order(side, amount, limit_price)
        else:
            if self.mode_var.get() == "LIVE":
                self._live_trade(side, amount)
            else:
                self._paper_trade(side, amount)

    def _paper_trade(self, side, amount):
        try:
            if side == "buy":
                qty = self.account.buy(self.current_price, amount)
                self._log(f"[SIM] BUY Executed: {qty:.6f} SOL @ {self.current_price:,.2f} USDT")
                self.trade_logger.log_manual("SIM", "Market", "BUY", self.current_price, qty, amount)
            else:
                qty = amount / self.current_price
                self.account.sell(self.current_price, qty)
                self._log(f"[SIM] SELL Executed: {qty:.6f} SOL @ {self.current_price:,.2f} USDT")
                self.trade_logger.log_manual("SIM", "Market", "SELL", self.current_price, qty, amount)
        except ValueError as e:
            messagebox.showerror("Order Failed", str(e))
            return
        self._refresh_account_ui()

    def _paper_limit_order(self, side, amount, limit_price):
        try:
            if side == "buy":
                self.account.reserve_buy(amount)
                order = {"id": self._pending_id_seq, "side": "BUY", "price": limit_price,
                         "amount": amount, "qty": None}
            else:
                qty = amount / limit_price
                self.account.reserve_sell(qty)
                order = {"id": self._pending_id_seq, "side": "SELL", "price": limit_price,
                         "amount": None, "qty": qty}
        except ValueError as e:
            messagebox.showerror("Order Failed", str(e))
            return
        self._pending_id_seq += 1
        self.pending_orders.append(order)
        self._log(f"[SIM Limit Placed] #{order['id']} {order['side']} @ {limit_price:,.2f} "
                  f"(Waiting for price trigger)")
        self._update_pending_panel()
        self._refresh_account_ui()

    def _check_pending_orders(self):
        if self.mode_var.get() == "LIVE" or not self.pending_orders:
            return
        remaining = []
        filled = False
        for po in self.pending_orders:
            try:
                if po["side"] == "BUY" and self.current_price <= po["price"]:
                    qty = self.account.fill_buy(po["price"], po["amount"])
                    self._log(f"[SIM Limit Filled] #{po['id']} BUY {qty:.6f} SOL @ {po['price']:,.2f}")
                    self.trade_logger.log_manual("SIM", "Limit Filled", "BUY", po["price"], qty, po["amount"],
                                                  note=f"order#{po['id']}")
                    filled = True
                    continue
                if po["side"] == "SELL" and self.current_price >= po["price"]:
                    self.account.fill_sell(po["price"], po["qty"])
                    self._log(f"[SIM Limit Filled] #{po['id']} SELL {po['qty']:.6f} SOL @ {po['price']:,.2f}")
                    self.trade_logger.log_manual("SIM", "Limit Filled", "SELL", po["price"], po["qty"],
                                                  po["qty"] * po["price"], note=f"order#{po['id']}")
                    filled = True
                    continue
            except ValueError as e:
                self._log(f"[SIM Limit] #{po['id']} execution failed, cancelling: {e}")
                filled = True
                continue
            remaining.append(po)
        self.pending_orders = remaining
        if filled:
            self._refresh_account_ui()
            self._update_pending_panel()

    def _update_pending_panel(self):
        for row in self.pending_tree.get_children():
            self.pending_tree.delete(row)

        if self.mode_var.get() == "LIVE":
            if not self.live.connected:
                return
            try:
                orders = self.live.fetch_open_orders(SYMBOL)
            except Exception as e:
                self._log(f"Failed to fetch open orders: {e}")
                return
            for o in orders:
                oid = o.get("orderId", "-")
                side = "BUY" if o.get("side") == "BUY" else "SELL"
                price = o.get("price", "-")
                size = o.get("origQty", "-")
                self.pending_tree.insert("", "end", iid=f"live-{oid}",
                                           values=(oid, side, price, size, "LIVE (Binance)"))
        else:
            for po in self.pending_orders:
                size_text = f"{po['amount']:,.2f} USDT" if po["side"] == "BUY" else f"{po['qty']:.6f} SOL"
                self.pending_tree.insert("", "end", iid=f"sim-{po['id']}",
                                           values=(po["id"], po["side"], f"{po['price']:,.2f}", size_text, "SIM"))

    def _cancel_selected_pending(self):
        sel = self.pending_tree.selection()
        if not sel:
            messagebox.showinfo("Notice", "Please select an order to cancel from the list")
            return
        iid = sel[0]

        if iid.startswith("live-"):
            if not messagebox.askyesno("Cancel Live Order", "Are you sure you want to cancel this open order on Binance?"):
                return
            oid = int(iid.split("-", 1)[1])
            try:
                self.live.cancel_order(SYMBOL, oid)
                self._log(f"[LIVE] Order cancelled: orderId={oid}")
            except Exception as e:
                messagebox.showerror("Cancellation Failed", str(e))
                return
        else:
            order_id = int(iid.split("-", 1)[1])
            po = next((p for p in self.pending_orders if p["id"] == order_id), None)
            if po:
                if po["side"] == "BUY":
                    self.account.release_buy(po["amount"])
                else:
                    self.account.release_sell(po["qty"])
                self.pending_orders = [p for p in self.pending_orders if p["id"] != order_id]
                self._log(f"[SIM Limit Cancelled] #{order_id} {po['side']} @ {po['price']:,.2f}")
                self._refresh_account_ui()

        self._update_pending_panel()

    def _live_limit_order(self, side, amount, limit_price):
        if not self.live.connected:
            messagebox.showerror("Error", "Live connection not established")
            return
        if amount > self.live.max_order_usdt:
            messagebox.showerror(
                "Order Limit Exceeded",
                f"Exceeds max single order limit ({self.live.max_order_usdt:.0f} USDT).\n"
                "To adjust, modify max_order_usdt in your key file and reconnect.",
            )
            return

        qty = round(amount / limit_price, 5)
        side_code = "BUY" if side == "buy" else "SELL"
        desc = f"{'BUY' if side == 'buy' else 'SELL'} Limit {qty} SOL @ {limit_price:,.2f}"

        ok = messagebox.askyesno(
            "Live Limit Order Confirmation",
            f"Send the following limit order to Binance:\n\n{desc}\n\n"
            "It will remain in the order book until filled. Real funds will be used. Proceed?",
        )
        if not ok:
            return

        try:
            result = self.live.place_limit_order(SYMBOL, side_code, qty, limit_price)
            self._log(f"[LIVE Limit] {desc} -> Result: {result.get('status', result)}")
            self.trade_logger.log_manual("LIVE", "Limit Order", side_code,
                                           limit_price, qty, qty * limit_price,
                                           note=str(result.get("orderId", "")))
        except Exception as e:
            self._log(f"[LIVE Limit] Order failed: {e}")
            messagebox.showerror("Order Failed", str(e))
            return
        self._update_pending_panel()
        self._refresh_live_balance()

    def _browse_key_file(self):
        path = filedialog.askopenfilename(
            title="Select Binance API Key File",
            filetypes=[("JSON", "*.json"), ("All Files", "*.*")],
        )
        if path:
            self.key_path_entry.delete(0, tk.END)
            self.key_path_entry.insert(0, path)

    def _connect_live(self):
        path = self.key_path_entry.get().strip()
        if not path or not os.path.isfile(path):
            messagebox.showerror("Error", "Please select a valid key file path")
            return
        try:
            self.live.load_from_file(path)
        except Exception as e:
            messagebox.showerror("Connection Failed", f"Failed to read key file or connect:\n{e}")
            return
        net_txt = "Testnet" if self.live.testnet else "Mainnet (Live)"
        self.live_status_label.config(
            text=(f"Connected: {self.live.masked_key}  |  Network: {net_txt}  |  "
                  f"Max Order Limit: {self.live.max_order_usdt:.0f} USDT")
        )
        self._log(f"Binance Live connected: {self.live.masked_key} ({net_txt})")
        self._refresh_live_balance()
        self._update_pending_panel()

    def _refresh_live_balance(self):
        if not self.live.connected:
            return
        try:
            self.live_balance_cache = self.live.account_summary()
            self._refresh_account_ui()
        except Exception as e:
            self._log(f"Balance fetch failed: {e}")

    def _on_mode_change(self):
        mode = self.mode_var.get()
        if mode == "LIVE":
            if not self.live.connected:
                messagebox.showerror("Error", "Please connect an API key file first")
                self.mode_var.set("SIM")
                return
            ok = messagebox.askyesno(
                "Live Mode Confirmation",
                "Are you sure you want to switch to LIVE trading mode?\n\n"
                "In this mode, Buy/Sell buttons will send actual orders to Binance\n"
                "and use real funds. This cannot be undone.\n\n"
                f"Max order limit: {self.live.max_order_usdt:.0f} USDT\n"
                "AI auto-trading is automatically disabled in this mode for safety.\n\n"
                "Do you want to continue?",
            )
            if not ok:
                self.mode_var.set("SIM")
                return
            self.auto_var.set(False)
            self.auto_trading = False
            self._log("⚠ Switched to LIVE trading mode.")
        else:
            self._log("Switched to SIM mode.")
        self._update_mode_banner()
        self._refresh_account_ui()
        self._update_pending_panel()

    def _update_mode_banner(self):
        if self.mode_var.get() == "LIVE":
            self.mode_banner.config(text="⚠ LIVE TRADING MODE - Real funds will be used",
                                     bg="#c0392b", fg="white")
            self.auto_check.config(state="disabled")
        else:
            self.mode_banner.config(text="Simulation Mode (SIM) - Virtual Funds, No API Key Required",
                                     bg="#1e8449", fg="white")
            self.auto_check.config(state="normal")

    def _live_trade(self, side, amount):
        if not self.live.connected:
            messagebox.showerror("Error", "Live connection not established")
            return
        if amount > self.live.max_order_usdt:
            messagebox.showerror(
                "Order Limit Exceeded",
                f"Exceeds max single order limit ({self.live.max_order_usdt:.0f} USDT).\n"
                "To adjust, modify max_order_usdt in your key file and reconnect.",
            )
            return

        if side == "buy":
            desc = f"BUY - ~{amount/self.current_price:.6f} SOL (~{amount:,.2f} USDT) @ Market {self.current_price:,.2f}"
        else:
            desc = f"SELL - ~{amount/self.current_price:.6f} SOL (~{amount:,.2f} USDT) @ Market {self.current_price:,.2f}"

        ok = messagebox.askyesno(
            "Live Order Confirmation",
            f"Send the following order to Binance:\n\n{desc}\n\n"
            "Real funds will be used and this cannot be undone. Proceed?",
        )
        if not ok:
            return

        try:
            if side == "buy":
                result = self.live.market_order(SYMBOL, "BUY", quote_usdt=amount)
                qty_est = amount / self.current_price
            else:
                qty_est = amount / self.current_price
                result = self.live.market_order(SYMBOL, "SELL", qty=qty_est)
            status = result.get("status", result) if isinstance(result, dict) else result
            self._log(f"[LIVE] {desc} -> Result: {status}")
            self.trade_logger.log_manual("LIVE", "Market", "BUY" if side == "buy" else "SELL",
                                           self.current_price, qty_est, amount,
                                           note=str(result.get("orderId", "")) if isinstance(result, dict) else "")
        except Exception as e:
            self._log(f"[LIVE] Order failed: {e}")
            messagebox.showerror("Order Failed", str(e))
            return
        self._refresh_live_balance()

    def _reset_account(self):
        if messagebox.askyesno("Confirmation", "Are you sure you want to reset the account? (All trade history and open limit orders will be cleared)"):
            self.account = PaperAccount()
            self.pending_orders = []
            self.log_box.delete(0, tk.END)
            self.last_auto_signal = None
            self._refresh_account_ui()
            self._update_pending_panel()
            self._log("Account has been reset")

    def _log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log_box.insert(0, f"[{ts}] {msg}")

    def _toggle_auto(self):
        self.auto_trading = self.auto_var.get()
        self.last_auto_signal = None
        self._log(f"AI Auto-Trading {'Started' if self.auto_trading else 'Stopped'}")

    def _auto_trade_from_ai(self):
        if self.mode_var.get() == "LIVE":
            return
        signal, conf, reason = self.ai_signal
        if signal == "HOLD" or conf < 0.55:
            return
        if signal == self.last_auto_signal:
            return
        self.last_auto_signal = signal
        try:
            if signal == "BUY":
                amount = min(self.account.cash - self.account.reserved_cash, 100.0)
                if amount > 1:
                    qty = self.account.buy(self.current_price, amount)
                    self._log(f"[AI Auto] BUY {qty:.6f} SOL @ {self.current_price:,.2f} ({reason})")
                    self.trade_logger.log_auto("SIM", "Market (AI)", "BUY", self.current_price, qty, amount, note=reason)
            else:
                qty = self.account.qty - self.account.reserved_qty
                if qty > 0:
                    self.account.sell(self.current_price, qty)
                    self._log(f"[AI Auto] SELL {qty:.6f} SOL @ {self.current_price:,.2f} ({reason})")
                    self.trade_logger.log_auto("SIM", "Market (AI)", "SELL", self.current_price, qty,
                                                 qty * self.current_price, note=reason)
        except ValueError:
            pass
        self._refresh_account_ui()

    def _on_close(self):
        self.running = False
        self.refresh_event.set()
        self.destroy()


def price_epsilon(closes):
    """Returns minimum thickness so doji (open==close) candle bodies remain visible."""
    if not closes:
        return 0.01
    return max(closes[-1] * 0.0002, 0.01)


if __name__ == "__main__":
    app = TradingApp()
    app.mainloop()
