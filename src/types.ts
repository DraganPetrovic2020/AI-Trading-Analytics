export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Indicators {
  sma5: (number | null)[];
  sma20: (number | null)[];
  ema5: (number | null)[];
  ema20: (number | null)[];
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
  rsi14: number;
  rsi: (number | null)[];
  bb_upper: (number | null)[];
  bb_mid: (number | null)[];
  bb_lower: (number | null)[];
}

export interface Level {
  price: number;
  touches: number;
  last_index: number;
  type: 'support' | 'resistance';
  distance_pct?: number;
}

export interface Signal {
  label: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
}

export interface EngineStatus {
  engine: string;
  trained: boolean;
  train_samples: number;
  buy_threshold: number;
  sell_threshold: number;
}

export interface CandlesResponse {
  symbol: string;
  interval: Interval;
  candles: Candle[];
  indicators: Indicators;
  levels: Level[];
  signal: Signal;
}

export interface AccountSnapshot {
  cash: number;
  qty: number;
  equity: number;
  reserved_cash: number;
  reserved_qty: number;
  mode: 'SIM' | 'LIVE';
  fee_rate: number;
  total_fees: number;
  live_usdt?: number;
  live_sol?: number;
  live_error?: string;
}

export interface Trade {
  id: string;
  mode: string;
  order_type: string;
  side: string;
  symbol: string;
  price: number;
  qty: number;
  amount_usdt: number;
  note: string;
  created_at: string;
}

export interface Ticker24h {
  last_price: number;
  price_change: number;
  price_change_pct: number;
  high: number;
  low: number;
  volume: number;
  quote_volume: number;
}

export interface PendingOrder {
  id: number;
  side: string;
  price: number;
  amount: number | null;
  qty: number | null;
  live: boolean;
}

export interface AutoState {
  auto: boolean;
  last_signal: string | null;
}

export interface LiveStatus {
  connected: boolean;
  masked_key: string;
  testnet: boolean;
  max_order_usdt: number;
}
