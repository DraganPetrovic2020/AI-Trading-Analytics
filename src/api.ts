import type {
  AccountSnapshot,
  AutoState,
  Candle,
  CandlesResponse,
  EngineStatus,
  Interval,
  Level,
  LiveStatus,
  PendingOrder,
  Signal,
  Ticker24h,
  Trade,
} from './types';

const BASE = 'http://localhost:8001/api';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.detail || body.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ status: string; engine: EngineStatus }>('/health'),
  config: () => req<{ symbol: string; intervals: Interval[]; engine: EngineStatus }>('/config'),

  candles: (interval: Interval, limit = 200) =>
    req<CandlesResponse>(`/candles?interval=${interval}&limit=${limit}`),
  price: () => req<{ symbol: string; price: number }>('/price'),
  ticker24: () => req<Ticker24h>('/ticker24'),
  signal: (interval: Interval) => req<Signal & { engine: EngineStatus }>(`/signal?interval=${interval}`),
  levels: (interval: Interval) => req<{ price: number; levels: Level[] }>(`/levels?interval=${interval}`),

  account: () => req<AccountSnapshot>('/account'),

  trade: (side: 'BUY' | 'SELL', amountUsdt: number, mode: 'SIM' | 'LIVE') =>
    req<{ status: string; price: number; qty: number; account?: AccountSnapshot } & Record<string, unknown>>(
      '/trade',
      { method: 'POST', body: JSON.stringify({ side, amount_usdt: amountUsdt, mode }) }
    ),

  limitOrder: (side: 'BUY' | 'SELL', amountUsdt: number, price: number) =>
    req<{ status: string; order: PendingOrder }>('/limit-order', {
      method: 'POST',
      body: JSON.stringify({ side, amount_usdt: amountUsdt, price }),
    }),

  pending: () => req<{ orders: PendingOrder[]; live: boolean }>('/pending'),
  cancelPending: (id: number) =>
    req<{ status: string }>('/cancel-pending', { method: 'POST', body: JSON.stringify({ id }) }),

  setAuto: (enabled: boolean) =>
    req<{ auto: boolean }>('/auto', { method: 'POST', body: JSON.stringify({ enabled }) }),
  getAuto: () => req<AutoState>('/auto'),

  trades: (limit = 200) => req<{ trades: Trade[] }>(`/trades?limit=${limit}`),
  clearTrades: () => req<{ status: string }>('/trades/clear', { method: 'POST' }),

  liveConnect: (apiKey: string, apiSecret: string, testnet: boolean, maxOrderUsdt: number) =>
    req<{ connected: boolean; masked_key: string; testnet: boolean; max_order_usdt: number }>(
      '/live/connect',
      { method: 'POST', body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret, testnet, max_order_usdt: maxOrderUsdt }) }
    ),
  liveStatus: () => req<LiveStatus>('/live/status'),
  liveBalance: () => req<{ usdt: number; sol: number }>('/live/balance'),

  reset: () => req<{ status: string; account: AccountSnapshot }>('/reset', { method: 'POST' }),
};

export type Api = typeof api;
