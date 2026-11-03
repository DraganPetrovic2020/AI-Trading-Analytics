# 🚀 SOL/USDT AI Trading & Analytics Platform

<div align="center">

![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.5%2B-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)
![React](https://img.shields.io/badge/React-18.3-61DAFB.svg)
![LightGBM](https://img.shields.io/badge/LightGBM-4.0%2B-orange.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A professional, high-performance cryptocurrency trading dashboard and machine learning signal engine built for **SOL/USDT** spot trading on Binance, featuring an interactive HTML5 Canvas charting interface and a robust Python FastAPI backend.

</div>

---

## 🎬 Platform Demonstration & UI Preview

> _Experience lightning-fast multi-timeframe candlestick charting, real-time AI signal predictions, and automated risk management._

### 📊 Interactive Charting & Technical Analysis

```
+-----------------------------------------------------------------------+
|  SOL/USDT  |  $101.96  +0.75% / 24h  |  AI Signal: BUY (84% Conf)  [SIM]  |
+-----------------------------------------------------------------------+
| Interval: [ 1m ] [ 5m ] [ 15m ] [ 1h ] [ 4h ] [ 1d ]                    |
+-----------------------------------------------------------------------+
|                                                                       |
|   Candlestick Chart with TradingView-Style Mouse Scaling & Dragging   |
|   - Drag chart body horizontally to pan through historical candles    |
|   - Drag on the right Y-axis price scale to press/stretch candle height |
|   - Double-click to reset view and zoom                               |
|                                                                       |
+-----------------------------------------------------------------------+
| VOL | ████▄█▇▆▅▄▃▂  ▂▃▄▅▆▇█▇▆▅▄▃▂   VOL (24h)                         |
+-----------------------------------------------------------------------+
| MACD| ██████████▄▄▄▄      ▂▂▂▃▃▄▅▅██  MACD (12, 26, 9)                  |
+-----------------------------------------------------------------------+
```

_Interactive preview GIF / Demo screenshot placeholders:_

- **Dashboard Overview**: `![Dashboard Preview](docs/demo.gif)`
- **Trading Chart & Tooltips**: `![Trading Chart](docs/chart.png)`

---

## ✨ Key Features

1. **⚡ High-Performance Candlestick Charting**
   - Multi-timeframe interval switching (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) with instant background caching.
   - TradingView-style interactions: Time panning on chart body and vertical price scale scaling (press/stretch candle height) by dragging on the right Y-axis.
   - English tooltips displaying Open, High, Low, Close, Volume, and Percentage Change.

2. **📈 Advanced Technical Indicators**
   - **Moving Averages**: Simple (SMA 5, 20) and Exponential (EMA 5, 20).
   - **RSI**: Relative Strength Index with Wilder's smoothing.
   - **MACD**: Moving Average Convergence Divergence histogram.
   - **Bollinger Bands**: Dynamic upper, middle, and lower volatility bands.

3. **🔍 Support & Resistance Level Detection**
   - Automated pivot high and low algorithms.
   - Clustering engine identifying major support and resistance zones with touch counts and distance percentage metrics.

4. **🤖 AI Signal Engine & Machine Learning**
   - **LightGBM Classifier**: Gradient-boosted decision trees trained on intraday features (RSI, MACD, Bollinger %B, trend, returns, volatility) to predict next-candle direction probability.
   - **Rule-Based Fallback**: Robust multi-indicator scoring fallback guaranteeing signals under all market conditions.

5. **💼 Dual Trading Modes (SIM & LIVE)**
   - **Simulation Mode (SIM)**: Risk-free paper trading with real-time portfolio tracking, slippage, and fee calculation.
   - **Live Trading Mode (LIVE)**: Direct REST API spot trading on Binance / Binance Testnet using HMAC-SHA256 request signing with Python standard libraries.

---

## 📂 Project Directory Structure

```text
AI-Trading-Analytics/
├── src/
│   ├── backend/
│   │   ├── account.py               # Paper account balance & portfolio management
│   │   ├── ai_engine.py             # LightGBM machine learning & rule-based engine
│   │   ├── binance_client.py        # Binance public & signed REST API client
│   │   ├── indicators.py            # Technical indicators & S/R detection
│   │   ├── server.py                # FastAPI backend REST API server
│   │   ├── trade_store.py           # SQLite / Supabase trade history store
│   │   └── sol_binance_ai_trading.py# Standalone Tkinter GUI trading script
│   ├── components/
│   │   └── TradingChart.tsx         # Interactive HTML5 Canvas candlestick chart
│   ├── App.tsx                      # Main React dashboard interface
│   ├── api.ts                       # Frontend API client
│   └── types.ts                     # TypeScript data interfaces
├── supabase/
│   └── migrations/                  # Database schema migrations
├── package.json                     # Frontend dependencies & npm scripts
├── tailwind.config.js               # Tailwind CSS styling configuration
└── readme.md                        # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **Node.js 18+** & `npm`

### 1. Backend Setup (FastAPI)

Navigate to the backend directory, install Python dependencies, and start the server:

```bash
cd src/backend
pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### 2. Frontend Setup (React & Vite)

Open a new terminal in the project root directory, install npm packages, and launch the Vite dev server:

```bash
npm install
npm run dev
```

Open your browser at `http://localhost:5173` to access the trading platform.

---

## ⚙️ Configuration & Live Trading

To connect your Binance account for **LIVE** spot trading, use the Live Connect modal in the UI or configure API credentials securely:

```json
{
  "api_key": "YOUR_BINANCE_API_KEY",
  "api_secret": "YOUR_BINANCE_API_SECRET",
  "testnet": false,
  "max_order_usdt": 50.0
}
```

> **Security Best Practices**:
>
> - Never commit API keys or secret files to version control.
> - Enable **Spot Trading** permissions only; never enable withdrawals.
> - Use Binance **Testnet** (`testnet: true`) for initial strategy testing.

---

## 🛡️ License

This project is licensed under the [MIT License](LICENSE). Provided for educational, analytical, and research purposes.
