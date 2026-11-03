import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import TradingChart from '@/components/TradingChart';
import { api } from '@/api';
import type {
  AccountSnapshot,
  AutoState,
  CandlesResponse,
  Interval,
  Level,
  LiveStatus,
  PendingOrder,
  Ticker24h,
  Trade,
} from '@/types';

const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

type SortKey = 'time' | 'mode' | 'side' | 'price' | 'qty' | 'amount';
type BottomTab = 'trades' | 'orders' | 'levels';

const sideText = (label?: string) =>
  label === 'BUY' ? 'text-emerald-400' : label === 'SELL' ? 'text-red-400' : 'text-slate-300';

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(err: unknown) {
    console.error('[App] caught error:', err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-[#080a0f] flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-red-400 text-2xl font-bold mb-2">Render Error</div>
            <p className="text-slate-500 text-sm mb-4">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppInner />
    </AppErrorBoundary>
  );
}

function AppInner() {
  const [interval, setInterval] = useState<Interval>('5m');
  const [data, setData] = useState<CandlesResponse | null>(null);
  const [price, setPrice] = useState(0);
  const [ticker, setTicker] = useState<Ticker24h | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [auto, setAuto] = useState<AutoState>({ auto: false, last_signal: null });
  const [live, setLive] = useState<LiveStatus>({ connected: false, masked_key: '-', testnet: false, max_order_usdt: 50 });

  const [amount, setAmount] = useState('100');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [mode, setMode] = useState<'SIM' | 'LIVE'>('SIM');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [showLiveModal, setShowLiveModal] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [testnet, setTestnet] = useState(false);
  const [maxOrder, setMaxOrder] = useState('50');

  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [tab, setTab] = useState<BottomTab>('trades');

  const pollRef = useRef<number | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const loadCandlesOnly = useCallback(async () => {
    try {
      const cd = await api.candles(interval);
      setData(cd);
    } catch (e) {
      console.error(e);
    }
  }, [interval]);

  const loadAll = useCallback(async () => {
    try {
      const [cd, pr, tk, acc, tr, pend, au, lv] = await Promise.all([
        api.candles(interval),
        api.price().catch(() => ({ symbol: 'SOLUSDT', price: 0 })),
        api.ticker24().catch(() => null),
        api.account().catch(() => null),
        api.trades().catch(() => ({ trades: [] })),
        api.pending().catch(() => ({ orders: [], live: false })),
        api.getAuto().catch(() => ({ auto: false, last_signal: null })),
        api.liveStatus().catch(() => ({ connected: false, masked_key: '-', testnet: false, max_order_usdt: 50 })),
      ]);
      setData(cd);
      setPrice(pr.price);
      setTicker(tk);
      setAccount(acc);
      setTrades((tr as { trades: Trade[] }).trades);
      setPending((pend as { orders: PendingOrder[] }).orders);
      setAuto(au);
      setLive(lv);
      if (acc?.mode === 'LIVE') setMode('LIVE');
    } catch (e) {
      showToast(`Data load failed: ${e instanceof Error ? e.message : e}`, false);
    }
  }, [interval]);

  useEffect(() => {
    loadCandlesOnly();
    loadAll();
  }, [interval, loadCandlesOnly, loadAll]);

  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      api.price().then((p) => setPrice(p.price)).catch(() => {});
      api.getAuto().then(setAuto).catch(() => {});
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(loadAll, 12000);
    return () => window.clearInterval(t);
  }, [loadAll]);

  const signal = data?.signal;

  const loadTradesAndAccount = useCallback(async () => {
    try {
      const [tr, acc, pend] = await Promise.all([
        api.trades().catch(() => ({ trades: [] })),
        api.account().catch(() => null),
        api.pending().catch(() => ({ orders: [], live: false })),
      ]);
      setTrades((tr as { trades: Trade[] }).trades);
      if (acc) setAccount(acc);
      if (pend) setPending((pend as { orders: PendingOrder[] }).orders);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const feeRate = account?.fee_rate ?? 0.001;
  const feeAmount = (parseFloat(amount) || 0) * feeRate;

  // AI signal panel data
  const ind = data?.indicators;
  const lastRsi = ind?.rsi14 ?? 0;
  const lastHist = ind?.hist?.slice(-1)[0] ?? null;
  const lastSma5 = ind?.sma5?.slice(-1)[0] ?? null;
  const lastSma20 = ind?.sma20?.slice(-1)[0] ?? null;
  const lastBbUpper = ind?.bb_upper?.slice(-1)[0] ?? null;
  const lastBbLower = ind?.bb_lower?.slice(-1)[0] ?? null;
  const trendDir = lastSma5 !== null && lastSma20 !== null ? (lastSma5 > lastSma20 ? 'UP' : 'DOWN') : '—';
  const bbPos = lastBbUpper !== null && lastBbLower !== null && lastBbUpper !== lastBbLower
    ? ((price - (lastBbLower as number)) / ((lastBbUpper as number) - (lastBbLower as number)) * 100)
    : null;

  const doTrade = async (side: 'BUY' | 'SELL') => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      showToast('Enter a valid amount', false);
      return;
    }
    if (orderType === 'limit') {
      const lp = parseFloat(limitPrice);
      if (!lp || lp <= 0) {
        showToast('Enter a valid limit price', false);
        return;
      }
      setLoading(true);
      try {
        await api.limitOrder(side, amt, lp);
        showToast(`Limit ${side} order placed @ ${lp}`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Order failed', false);
      } finally {
        setLoading(false);
        loadTradesAndAccount();
      }
      return;
    }
    setLoading(true);
    try {
      await api.trade(side, amt, mode);
      showToast(`${side} ${amt} ${side === 'BUY' ? 'USDT' : 'SOL'} executed`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Trade failed', false);
    } finally {
      setLoading(false);
      loadTradesAndAccount();
    }
  };

  const toggleAuto = async () => {
    try {
      await api.setAuto(!auto.auto);
      setAuto((a) => ({ ...a, auto: !a.auto }));
      showToast(`Auto-trade ${!auto.auto ? 'ON' : 'OFF'}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', false);
    }
  };

  const cancelPending = async (id: number) => {
    try {
      await api.cancelPending(id);
      showToast('Order cancelled');
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Cancel failed', false);
    }
  };

  const handleReset = async () => {
    try {
      await api.reset();
      showToast('Account reset');
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Reset failed', false);
    }
  };

  const handleClearTrades = async () => {
    try {
      await api.clearTrades();
      setTrades([]);
      showToast('Trade history cleared');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Clear failed', false);
    }
  };

  const connectLive = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      showToast('Enter API key and secret', false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.liveConnect(apiKey, apiSecret, testnet, parseFloat(maxOrder) || 50);
      setLive({ connected: true, masked_key: res.masked_key, testnet: res.testnet, max_order_usdt: res.max_order_usdt });
      setMode('LIVE');
      setShowLiveModal(false);
      showToast(`Live connected: ${res.masked_key}`);
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Connection failed', false);
    } finally {
      setLoading(false);
    }
  };

  const exportTrades = () => {
    const header = 'Time,Mode,Type,Side,Price,Qty,Amount(USDT),Note\n';
    const rows = trades
      .map((t) => `${t.created_at},${t.mode},${t.order_type},${t.side},${t.price},${t.qty},${t.amount_usdt},"${t.note}"`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sol_trades_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sortedTrades = useMemo(() => {
    const sorted = [...trades];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'time': cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
        case 'mode': cmp = a.mode.localeCompare(b.mode); break;
        case 'side': cmp = a.side.localeCompare(b.side); break;
        case 'price': cmp = a.price - b.price; break;
        case 'qty': cmp = a.qty - b.qty; break;
        case 'amount': cmp = a.amount_usdt - b.amount_usdt; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [trades, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };


  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  const levels = data?.levels ?? [];

  return (
    <div className="h-screen bg-[#07090d] text-slate-200 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-6 px-5 h-14 border-b border-slate-800/70 flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold text-slate-400">SOL/USDT</h1>
          <span className="text-xl font-semibold tabular-nums">{price > 0 ? `$${price.toFixed(2)}` : '—'}</span>
          {ticker && (
            <span className={`text-sm tabular-nums ${ticker.price_change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {ticker.price_change_pct >= 0 ? '+' : ''}
              {ticker.price_change_pct.toFixed(2)}%
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 bg-slate-900 rounded-lg p-0.5">
          {INTERVALS.map((intv) => (
            <button
              key={intv}
              onClick={() => setInterval(intv)}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                interval === intv ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {intv}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button onClick={loadAll} className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800" title="Refresh">
          <RefreshCw size={15} />
        </button>
        <span
          className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
            mode === 'LIVE' ? 'bg-red-500/15 text-red-300' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {mode === 'LIVE' ? 'LIVE' : 'Practice'}
        </span>
        <button
          onClick={() => setShowLiveModal(true)}
          className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-sm transition-colors"
        >
          {live.connected ? `Binance ${live.masked_key}` : 'Connect Binance'}
        </button>
      </header>

      <div className="flex-1 flex gap-3 p-3 min-h-0">
        {/* Left: chart + tabbed panel */}
        <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
          <div className="flex-[3] min-h-0">
            {data ? (
              <TradingChart
                candles={data.candles}
                indicators={data.indicators}
                levels={data.levels}
                interval={interval}
                currentPrice={price}
                trades={trades}
              />
            ) : (
              <div className="h-full rounded-lg border border-slate-800/70 flex items-center justify-center text-sm text-slate-500">
                Waiting for backend on localhost:8001…
              </div>
            )}
          </div>

          <section className="flex-1 min-h-[180px] bg-[#0b0e14] border border-slate-800/70 rounded-lg flex flex-col">
            <div className="flex items-center gap-5 px-4 border-b border-slate-800/70 flex-shrink-0">
              <TabButton active={tab === 'trades'} onClick={() => setTab('trades')} label="Trades" count={trades.length} />
              <TabButton active={tab === 'orders'} onClick={() => setTab('orders')} label="Open orders" count={pending.length} />
              <TabButton active={tab === 'levels'} onClick={() => setTab('levels')} label="Support / Resistance" count={levels.length} />
              <div className="flex-1" />
              {tab === 'trades' && trades.length > 0 && (
                <div className="flex items-center gap-1">
                  <IconButton onClick={exportTrades} title="Export CSV"><Download size={14} /></IconButton>
                  <IconButton onClick={handleClearTrades} title="Clear history" danger><Trash2 size={14} /></IconButton>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 thin-scrollbar">
              {tab === 'trades' &&
                (trades.length === 0 ? (
                  <Empty>No trades yet</Empty>
                ) : (
                  <table className="w-full text-sm tabular-nums">
                    <thead className="sticky top-0 bg-[#0b0e14] text-slate-500 text-xs">
                      <tr>
                        <Th onClick={() => toggleSort('time')}>Time{sortArrow('time')}</Th>
                        <Th onClick={() => toggleSort('side')}>Side{sortArrow('side')}</Th>
                        <Th onClick={() => toggleSort('price')} right>Price{sortArrow('price')}</Th>
                        <Th onClick={() => toggleSort('qty')} right>SOL{sortArrow('qty')}</Th>
                        <Th onClick={() => toggleSort('amount')} right>USDT{sortArrow('amount')}</Th>
                        <Th onClick={() => toggleSort('mode')} right>Mode{sortArrow('mode')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTrades.map((t) => (
                        <tr key={t.id} className="border-t border-slate-800/50">
                          <td className="py-2 px-4 text-slate-400">
                            {new Date(t.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </td>
                          <td className={`py-2 px-4 font-medium ${sideText(t.side)}`}>{t.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                          <td className="py-2 px-4 text-right">${t.price.toFixed(2)}</td>
                          <td className="py-2 px-4 text-right text-slate-400">{t.qty.toFixed(4)}</td>
                          <td className="py-2 px-4 text-right">${t.amount_usdt.toFixed(2)}</td>
                          <td className="py-2 px-4 text-right text-xs text-slate-500">{t.mode === 'LIVE' ? 'Live' : 'Practice'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

              {tab === 'orders' &&
                (pending.length === 0 ? (
                  <Empty>No open orders</Empty>
                ) : (
                  <ul>
                    {pending.map((o) => (
                      <li key={o.id} className="flex items-center justify-between px-4 py-2 border-t border-slate-800/50 first:border-t-0 text-sm tabular-nums">
                        <span>
                          <span className={`font-medium ${sideText(o.side)}`}>{o.side === 'BUY' ? 'Buy' : 'Sell'}</span>
                          <span className="text-slate-400"> at ${o.price.toFixed(2)}</span>
                        </span>
                        <button onClick={() => cancelPending(o.id)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400">
                          <X size={12} /> Cancel
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}

              {tab === 'levels' &&
                (levels.length === 0 ? (
                  <Empty>No levels detected</Empty>
                ) : (
                  <ul>
                    {levels.map((l: Level, i: number) => (
                      <li key={i} className="flex items-center justify-between px-4 py-2 border-t border-slate-800/50 first:border-t-0 text-sm tabular-nums">
                        <span>
                          <span className={l.type === 'support' ? 'text-emerald-400' : 'text-red-400'}>
                            {l.type === 'support' ? 'Support' : 'Resistance'}
                          </span>
                          <span className="text-slate-300"> ${l.price.toFixed(2)}</span>
                        </span>
                        <span className="text-xs text-slate-500">
                          {l.distance_pct != null && `${l.distance_pct > 0 ? '+' : ''}${l.distance_pct.toFixed(2)}% away · `}
                          tested {l.touches}×
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </section>
        </div>

        {/* Right sidebar */}
        <aside className="w-[340px] flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto thin-scrollbar">
          {/* AI signal */}
          <Card title="AI signal">
            {signal ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className={`text-3xl font-semibold ${sideText(signal.label)}`}>{signal.label}</span>
                  <span className="text-sm text-slate-400 tabular-nums">{(signal.confidence * 100).toFixed(0)}% confidence</span>
                </div>
                <div className="h-1 bg-slate-800 rounded-full overflow-hidden mt-2">
                  <div
                    className={`h-full rounded-full ${signal.label === 'BUY' ? 'bg-emerald-500' : signal.label === 'SELL' ? 'bg-red-500' : 'bg-slate-500'}`}
                    style={{ width: `${Math.max(3, signal.confidence * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-3 leading-relaxed">{signal.reason}</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm tabular-nums">
                  <Stat label="RSI" value={lastRsi > 0 ? lastRsi.toFixed(1) : '—'} accent={lastRsi > 70 ? 'text-red-400' : lastRsi < 30 && lastRsi > 0 ? 'text-emerald-400' : undefined} />
                  <Stat label="Trend" value={trendDir === 'UP' ? 'Up' : trendDir === 'DOWN' ? 'Down' : '—'} accent={trendDir === 'UP' ? 'text-emerald-400' : trendDir === 'DOWN' ? 'text-red-400' : undefined} />
                  <Stat label="MACD hist" value={lastHist !== null ? (lastHist as number).toFixed(3) : '—'} accent={lastHist !== null ? (lastHist > 0 ? 'text-emerald-400' : 'text-red-400') : undefined} />
                  <Stat label="Bollinger %B" value={bbPos !== null ? `${bbPos.toFixed(0)}%` : '—'} />
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Loading…</p>
            )}
          </Card>

          {/* Order */}
          <Card title="Place order">
            <div className="flex gap-0.5 bg-slate-900 rounded-lg p-0.5">
              {(['market', 'limit'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={`flex-1 py-1.5 rounded-md text-sm capitalize transition-colors ${
                    orderType === t ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <Field label="Amount (USDT to buy, SOL to sell)" className="mt-3">
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </Field>
            {orderType === 'limit' && (
              <Field label="Limit price (USDT)" className="mt-3">
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={price > 0 ? price.toFixed(2) : ''}
                  className={inputCls}
                />
              </Field>
            )}
            <p className="text-xs text-slate-500 mt-2 tabular-nums">
              Fee ≈ ${feeAmount.toFixed(2)} ({(feeRate * 100).toFixed(2)}%)
            </p>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={() => doTrade('BUY')}
                disabled={loading}
                className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                Buy
              </button>
              <button
                onClick={() => doTrade('SELL')}
                disabled={loading}
                className="py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                Sell
              </button>
            </div>
          </Card>

          {/* Account */}
          <Card title="Account">
            {account ? (
              <>
                <div className="text-xs text-slate-500">Total value</div>
                <div className="text-2xl font-semibold tabular-nums">
                  ${account.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="space-y-1.5 mt-3 text-sm tabular-nums">
                  <Row label="Cash" value={`$${account.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                  <Row label="SOL" value={account.qty.toFixed(4)} />
                  {(account.reserved_cash > 0 || account.reserved_qty > 0) && (
                    <Row label="In open orders" value={`$${account.reserved_cash.toFixed(0)} + ${account.reserved_qty.toFixed(4)} SOL`} />
                  )}
                  <Row label="Fees paid" value={`$${account.total_fees.toFixed(2)}`} />
                  {account.live_usdt !== undefined && (
                    <>
                      <Row label="Binance USDT" value={`$${account.live_usdt}`} />
                      <Row label="Binance SOL" value={account.live_sol?.toFixed(4) || '0'} />
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Loading…</p>
            )}

            <div className="border-t border-slate-800/70 mt-4 pt-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm">Auto-trade</div>
                <div className="text-xs text-slate-500">
                  {mode === 'LIVE' ? 'Not available in live mode' : auto.last_signal ? `Last: ${auto.last_signal}` : 'Follow AI signals automatically'}
                </div>
              </div>
              <Switch on={auto.auto} disabled={mode === 'LIVE'} onClick={toggleAuto} />
            </div>

            <button
              onClick={handleReset}
              className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors"
            >
              <RotateCcw size={12} /> Reset practice account
            </button>
          </Card>
        </aside>
      </div>

      {/* Connect Binance modal */}
      {showLiveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowLiveModal(false)}>
          <div className="bg-[#0b0e14] border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold">Connect Binance</h2>
              <button onClick={() => setShowLiveModal(false)} className="text-slate-500 hover:text-slate-200">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <Field label="API key">
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputCls} />
              </Field>
              <Field label="API secret">
                <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Max order size (USDT)">
                <input type="number" value={maxOrder} onChange={(e) => setMaxOrder(e.target.value)} className={inputCls} />
              </Field>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={testnet} onChange={(e) => setTestnet(e.target.checked)} className="accent-sky-500" />
                Use Testnet (recommended first)
              </label>
              <p className="text-xs text-amber-300/80 leading-relaxed">
                Only enable Spot Trading on this key. Never enable withdrawals.
              </p>
              <button
                onClick={connectLive}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {loading ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-xl text-sm bg-[#11151d] border ${
            toast.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm tabular-nums focus:border-slate-500 outline-none';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-[#0b0e14] border border-slate-800/70 rounded-lg p-4 flex-shrink-0">
      <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={accent || 'text-slate-200'}>{value}</span>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-sky-600' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`py-2.5 text-sm border-b-2 -mb-px transition-colors ${
        active ? 'border-sky-500 text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'
      }`}
    >
      {label} <span className="text-slate-600">{count}</span>
    </button>
  );
}

function IconButton({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded text-slate-500 hover:bg-slate-800 ${danger ? 'hover:text-red-400' : 'hover:text-slate-200'}`}
    >
      {children}
    </button>
  );
}

function Th({ onClick, right, children }: { onClick: () => void; right?: boolean; children: ReactNode }) {
  return (
    <th onClick={onClick} className={`py-2 px-4 font-normal cursor-pointer select-none hover:text-slate-300 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-600 text-center py-8">{children}</p>;
}
