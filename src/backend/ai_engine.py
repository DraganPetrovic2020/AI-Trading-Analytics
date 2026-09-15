"""LightGBM AI signal engine.

Replaces the previous sklearn logistic-regression / SGDClassifier engine with
LightGBM, a gradient-boosted decision tree model that is closer to real-world
quant practice: it captures non-linear feature interactions and is robust on
small tabular datasets like intraday candles.

The engine trains on historical candle features (RSI, MACD histogram, Bollinger
%B, SMA trend, return, volatility) and predicts the probability that the next
candle closes higher. A rule-based fallback guarantees a signal even before the
model has enough data to train.
"""

from __future__ import annotations

import logging
import threading
from typing import Dict, List, Optional, Tuple

import numpy as np

import lightgbm as lgb

from indicators import bollinger, ema_series, macd_hist, rsi, sma

logger = logging.getLogger("LightGBMEngine")


def _features_row(closes: List[float], i: int) -> Optional[List[float]]:
    """Feature vector at index i using data up to and including i."""
    window = closes[: i + 1]
    if len(window) < 30:
        return None
    r = rsi(window, 14)
    m = macd_hist(window)
    up, mid, low = bollinger(window, 20, 2.0)
    if r is None or m is None or up is None or low is None or up == low:
        return None
    price = closes[i]
    pct_b = (price - low) / (up - low)
    s5 = sma(window, 5)
    s20 = sma(window, 20)
    trend = (s5 - s20) if (s5 is not None and s20 is not None) else 0.0
    ret1 = (closes[i] - closes[i - 1]) / closes[i - 1] if i > 0 else 0.0
    ret5 = (closes[i] - closes[i - 5]) / closes[i - 5] if i >= 5 else 0.0
    vol20 = float(np.std(closes[max(0, i - 19) : i + 1])) if i >= 1 else 0.0
    return [float(r), float(m), float(pct_b), float(trend), float(ret1), float(ret5), float(vol20)]


FEATURE_NAMES = ["rsi", "macd_hist", "pct_b", "trend", "ret1", "ret5", "vol20"]


class LightGBMEngine:
    def __init__(self, buy_threshold: float = 0.58, sell_threshold: float = 0.42) -> None:
        self.buy_threshold = buy_threshold
        self.sell_threshold = sell_threshold
        self.model: Optional[lgb.LGBMClassifier] = None
        self.trained = False
        self.last_train_n = 0
        self._lock = threading.Lock()

    def train(self, candles: List[Dict]) -> None:
        if len(candles) < 80:
            return
        closes = [float(c["c"]) for c in candles]
        X: List[List[float]] = []
        y: List[int] = []
        for i in range(30, len(closes) - 1):
            feat = _features_row(closes, i)
            if feat is None:
                continue
            X.append(feat)
            y.append(1 if closes[i + 1] > closes[i] else 0)
        if len(X) < 40 or len(set(y)) < 2:
            return
        X_arr = np.array(X)
        y_arr = np.array(y)
        model = lgb.LGBMClassifier(
            n_estimators=120,
            max_depth=4,
            learning_rate=0.05,
            num_leaves=15,
            min_child_samples=8,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_lambda=1.0,
            verbose=-1,
        )
        try:
            model.fit(X_arr, y_arr)
        except Exception as e:
            logger.error("LightGBM train failed: %s", e)
            return
        with self._lock:
            self.model = model
            self.trained = True
            self.last_train_n = len(X)
        logger.info("LightGBM trained on %d samples", len(X))

    def predict(self, candles: List[Dict]) -> Tuple[str, float, str]:
        if len(candles) < 30:
            return "HOLD", 0.5, "Insufficient data"
        closes = [float(c["c"]) for c in candles]
        feat = _features_row(closes, len(closes) - 1)
        if feat is None:
            return "HOLD", 0.5, "Indicator unavailable"

        r, m, pct_b, trend = feat[0], feat[1], feat[2], feat[3]

        if self.trained and self.model is not None:
            try:
                with self._lock:
                    proba_up = float(self.model.predict_proba([feat])[0][1])
                if proba_up >= self.buy_threshold:
                    return "BUY", proba_up, f"LightGBM up prob {proba_up*100:.1f}% (RSI {r:.0f})"
                if proba_up <= self.sell_threshold:
                    return "SELL", 1 - proba_up, f"LightGBM down prob {(1-proba_up)*100:.1f}% (RSI {r:.0f})"
                return "HOLD", proba_up, f"LightGBM neutral ({proba_up*100:.1f}%)"
            except Exception as e:
                logger.error("LightGBM predict failed, rule fallback: %s", e)

        # rule-based fallback
        score = 0
        reasons: List[str] = []
        if r < 30:
            score += 1
            reasons.append("RSI oversold")
        elif r > 70:
            score -= 1
            reasons.append("RSI overbought")
        if m > 0:
            score += 1
            reasons.append("MACD up")
        else:
            score -= 1
            reasons.append("MACD down")
        if pct_b < 0.2:
            score += 1
            reasons.append("BB lower")
        elif pct_b > 0.8:
            score -= 1
            reasons.append("BB upper")
        score += 1 if trend > 0 else -1
        conf = min(abs(score) / 4, 1.0)
        label = "BUY" if score >= 2 else "SELL" if score <= -2 else "HOLD"
        return label, conf, "[rule] " + ", ".join(reasons)

    def status(self) -> Dict:
        return {
            "engine": "LightGBM",
            "trained": self.trained,
            "train_samples": self.last_train_n,
            "buy_threshold": self.buy_threshold,
            "sell_threshold": self.sell_threshold,
        }
