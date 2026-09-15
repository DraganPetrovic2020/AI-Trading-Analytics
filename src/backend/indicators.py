"""Technical indicators: SMA, EMA, RSI, MACD, Bollinger, support/resistance.

Pure-Python implementations matching Binance/TradingView conventions so the
LightGBM feature extraction and the frontend chart agree on the same numbers.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np


def sma(values: List[float], n: int) -> Optional[float]:
    """Latest simple moving average over the last n values."""
    if len(values) < n:
        return None
    return float(np.mean(values[-n:]))


def sma_series(values: List[float], n: int) -> List[Optional[float]]:
    """Full SMA series aligned to the input length (None until enough data)."""
    out: List[Optional[float]] = [None] * (min(n - 1, len(values)))
    for i in range(n - 1, len(values)):
        out.append(float(np.mean(values[i - n + 1 : i + 1])))
    return out


def ema_series(values: List[float], n: int) -> List[Optional[float]]:
    """Full EMA series using SMA seed for the first valid value (TradingView style)."""
    if len(values) < n:
        return [None] * len(values)
    k = 2 / (n + 1)
    out: List[Optional[float]] = [None] * (n - 1)
    seed = sum(values[:n]) / n
    out.append(seed)
    for v in values[n:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def ema(values: List[float], n: int) -> Optional[float]:
    series = ema_series(values, n)
    return series[-1] if series and series[-1] is not None else None


def rsi(values: List[float], n: int = 14) -> Optional[float]:
    """Wilder's smoothing RSI (Binance standard)."""
    if len(values) < n + 1:
        return None
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, len(values)):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains[:n]) / n
    avg_loss = sum(losses[:n]) / n
    for i in range(n, len(gains)):
        avg_gain = (avg_gain * (n - 1) + gains[i]) / n
        avg_loss = (avg_loss * (n - 1) + losses[i]) / n
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd_series(
    values: List[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    """Return (macd_line, signal_line, histogram) aligned to input length."""
    ema_fast = ema_series(values, fast)
    ema_slow = ema_series(values, slow)
    macd_line: List[Optional[float]] = [None] * len(values)
    offset = len(ema_fast) - len(ema_slow)
    for i in range(len(values)):
        f = ema_fast[i]
        s = ema_slow[i - offset] if i - offset >= 0 else None
        if f is not None and s is not None:
            macd_line[i] = f - s
    # signal line = EMA of the valid macd values, re-aligned
    valid = [v for v in macd_line if v is not None]
    if len(valid) >= signal:
        sig = ema_series(valid, signal)
        sig_full: List[Optional[float]] = [None] * (len(values) - len(sig))
        sig_full.extend(sig)
    else:
        sig_full = [None] * len(values)
    hist: List[Optional[float]] = []
    for m, s in zip(macd_line, sig_full):
        hist.append(m - s if (m is not None and s is not None) else None)
    return macd_line, sig_full, hist


def macd_hist(values: List[float], fast: int = 12, slow: int = 26, signal: int = 9) -> Optional[float]:
    _, _, hist = macd_series(values, fast, slow, signal)
    return hist[-1] if hist and hist[-1] is not None else None


def bollinger(values: List[float], n: int = 20, k: float = 2.0) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Latest (upper, middle, lower) Bollinger band values."""
    if len(values) < n:
        return None, None, None
    window = values[-n:]
    mean = sum(window) / n
    var = sum((x - mean) ** 2 for x in window) / n
    std = var ** 0.5
    return float(mean + k * std), float(mean), float(mean - k * std)


def bollinger_series(values: List[float], n: int = 20, k: float = 2.0) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    """Full (upper, middle, lower) Bollinger band series aligned to input length."""
    upper: List[Optional[float]] = [None] * len(values)
    middle: List[Optional[float]] = [None] * len(values)
    lower: List[Optional[float]] = [None] * len(values)
    for i in range(n - 1, len(values)):
        window = values[i - n + 1 : i + 1]
        mean = sum(window) / n
        var = sum((x - mean) ** 2 for x in window) / n
        std = var ** 0.5
        upper[i] = float(mean + k * std)
        middle[i] = float(mean)
        lower[i] = float(mean - k * std)
    return upper, middle, lower


def rsi_series(values: List[float], n: int = 14) -> List[Optional[float]]:
    """Full Wilder's RSI series aligned to input length."""
    out: List[Optional[float]] = [None] * len(values)
    if len(values) < n + 1:
        return out
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, len(values)):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains[:n]) / n
    avg_loss = sum(losses[:n]) / n
    out[n] = 100.0 if avg_loss == 0 else 100 - (100 / (1 + avg_gain / avg_loss))
    for i in range(n, len(gains)):
        avg_gain = (avg_gain * (n - 1) + gains[i]) / n
        avg_loss = (avg_loss * (n - 1) + losses[i]) / n
        out[i + 1] = 100.0 if avg_loss == 0 else 100 - (100 / (1 + avg_gain / avg_loss))
    return out


# ------------------------------------------------------------------
# Support / Resistance detection (pivot clustering)
# ------------------------------------------------------------------


def _find_pivots(
    highs: List[float], lows: List[float], left: int = 3, right: int = 3
) -> Tuple[List[Tuple[int, float]], List[Tuple[int, float]]]:
    pivot_highs: List[Tuple[int, float]] = []
    pivot_lows: List[Tuple[int, float]] = []
    n = len(highs)
    for i in range(left, n - right):
        wh = highs[i - left : i + right + 1]
        if highs[i] == max(wh) and wh.count(highs[i]) == 1:
            pivot_highs.append((i, highs[i]))
        wl = lows[i - left : i + right + 1]
        if lows[i] == min(wl) and wl.count(lows[i]) == 1:
            pivot_lows.append((i, lows[i]))
    return pivot_highs, pivot_lows


def _cluster(
    pivots: List[Tuple[int, float]], level_type: str, tolerance_pct: float
) -> List[Dict]:
    levels: List[Dict] = []
    for idx, price in pivots:
        merged = False
        for lvl in levels:
            if lvl["price"] != 0 and abs(price - lvl["price"]) / lvl["price"] * 100 <= tolerance_pct:
                cur = lvl["touches"]
                lvl["price"] = (lvl["price"] * cur + price) / (cur + 1)
                lvl["touches"] += 1
                lvl["last_index"] = max(lvl["last_index"], idx)
                merged = True
                break
        if not merged:
            levels.append({"price": price, "touches": 1, "last_index": idx, "type": level_type})
    return levels


def detect_support_resistance(
    candles: List[Dict], left: int = 3, right: int = 3, tolerance_pct: float = 0.25, min_touches: int = 2
) -> List[Dict]:
    if len(candles) < left + right + 1:
        return []
    highs = [c["h"] for c in candles]
    lows = [c["l"] for c in candles]
    ph, pl = _find_pivots(highs, lows, left, right)
    res = _cluster(ph, "resistance", tolerance_pct)
    sup = _cluster(pl, "support", tolerance_pct)
    levels = [l for l in (res + sup) if l["touches"] >= min_touches]
    levels.sort(key=lambda l: l["price"], reverse=True)
    return levels


def build_indicator_payload(candles: List[Dict]) -> Dict:
    """Build the chart-ready indicator arrays the frontend renders."""
    closes = [c["c"] for c in candles]
    sma5 = sma_series(closes, 5)
    sma20 = sma_series(closes, 20)
    ema5 = ema_series(closes, 5)
    ema20 = ema_series(closes, 20)
    macd_line, signal_line, hist = macd_series(closes)
    bb_upper, bb_mid, bb_lower = bollinger_series(closes, 20, 2.0)
    rsi_arr = rsi_series(closes, 14)
    return {
        "sma5": [round(v, 4) if v is not None else None for v in sma5],
        "sma20": [round(v, 4) if v is not None else None for v in sma20],
        "ema5": [round(v, 4) if v is not None else None for v in ema5],
        "ema20": [round(v, 4) if v is not None else None for v in ema20],
        "macd": [round(v, 6) if v is not None else None for v in macd_line],
        "signal": [round(v, 6) if v is not None else None for v in signal_line],
        "hist": [round(v, 6) if v is not None else None for v in hist],
        "rsi14": round(rsi(closes, 14) or 0, 2),
        "rsi": [round(v, 2) if v is not None else None for v in rsi_arr],
        "bb_upper": [round(v, 4) if v is not None else None for v in bb_upper],
        "bb_mid": [round(v, 4) if v is not None else None for v in bb_mid],
        "bb_lower": [round(v, 4) if v is not None else None for v in bb_lower],
    }
