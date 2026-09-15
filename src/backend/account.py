"""In-memory paper-trading account with limit-order reservation and fee support."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List

FEE_RATE = 0.001  # 0.1% per side (Binance spot taker fee)


class PaperAccount:
    def __init__(self, cash: float = 10000.0, fee_rate: float = FEE_RATE) -> None:
        self.cash = cash
        self.qty = 0.0
        self.history: List[Dict] = []
        self.reserved_cash = 0.0
        self.reserved_qty = 0.0
        self.fee_rate = fee_rate
        self.total_fees = 0.0

    def buy(self, price: float, amount_usdt: float) -> float:
        if amount_usdt <= 0:
            raise ValueError("Amount must be positive")
        if amount_usdt > self.cash - self.reserved_cash:
            raise ValueError("Insufficient available cash")
        fee = amount_usdt * self.fee_rate
        qty = (amount_usdt - fee) / price
        self.cash -= amount_usdt
        self.qty += qty
        self.total_fees += fee
        self.history.append({"t": datetime.now().isoformat(), "side": "BUY", "price": price, "qty": qty, "amount": amount_usdt, "fee": fee})
        return qty

    def sell(self, price: float, qty: float) -> float:
        if qty <= 0:
            raise ValueError("Quantity must be positive")
        if qty > self.qty - self.reserved_qty:
            raise ValueError("Insufficient available SOL")
        gross = qty * price
        fee = gross * self.fee_rate
        net = gross - fee
        self.qty -= qty
        self.cash += net
        self.total_fees += fee
        self.history.append({"t": datetime.now().isoformat(), "side": "SELL", "price": price, "qty": qty, "amount": gross, "fee": fee})
        return net

    def equity(self, price: float) -> float:
        return self.cash + self.qty * price

    def snapshot(self, price: float) -> Dict:
        return {
            "cash": round(self.cash, 2),
            "qty": round(self.qty, 8),
            "equity": round(self.equity(price), 2),
            "reserved_cash": round(self.reserved_cash, 2),
            "reserved_qty": round(self.reserved_qty, 8),
            "fee_rate": self.fee_rate,
            "total_fees": round(self.total_fees, 4),
        }

    # ---- limit order reservation ----

    def reserve_buy(self, amount_usdt: float) -> None:
        if amount_usdt <= 0:
            raise ValueError("Amount must be positive")
        if amount_usdt > self.cash - self.reserved_cash:
            raise ValueError("Insufficient available cash (reserved by other limit orders)")
        self.reserved_cash += amount_usdt

    def reserve_sell(self, qty: float) -> None:
        if qty <= 0:
            raise ValueError("Quantity must be positive")
        if qty > self.qty - self.reserved_qty:
            raise ValueError("Insufficient available SOL (reserved by other limit orders)")
        self.reserved_qty += qty

    def release_buy(self, amount_usdt: float) -> None:
        self.reserved_cash = max(0.0, self.reserved_cash - amount_usdt)

    def release_sell(self, qty: float) -> None:
        self.reserved_qty = max(0.0, self.reserved_qty - qty)

    def fill_buy(self, price: float, amount_usdt: float) -> float:
        fee = amount_usdt * self.fee_rate
        qty = (amount_usdt - fee) / price
        self.cash -= amount_usdt
        self.reserved_cash = max(0.0, self.reserved_cash - amount_usdt)
        self.qty += qty
        self.total_fees += fee
        self.history.append({"t": datetime.now().isoformat(), "side": "BUY", "price": price, "qty": qty, "amount": amount_usdt, "fee": fee, "limit": True})
        return qty

    def fill_sell(self, price: float, qty: float) -> float:
        gross = qty * price
        fee = gross * self.fee_rate
        net = gross - fee
        self.qty -= qty
        self.reserved_qty = max(0.0, self.reserved_qty - qty)
        self.cash += net
        self.total_fees += fee
        self.history.append({"t": datetime.now().isoformat(), "side": "SELL", "price": price, "qty": qty, "amount": gross, "fee": fee, "limit": True})
        return net

    def reset(self) -> None:
        self.cash = 10000.0
        self.qty = 0.0
        self.history = []
        self.reserved_cash = 0.0
        self.reserved_qty = 0.0
        self.total_fees = 0.0
