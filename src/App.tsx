import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Bot,
  Brain,
  CandlestickChart,
  Download,
  Gauge,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
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
  Signal,
  Ticker24h,
  Trade,
} from '@/types';

const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

type SortKey = 'time' | 'mode' | 'side' | 'price' | 'qty' | 'amount';

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
  const signalColor =
    signal?.label === 'BUY' ? 'text-emerald-400' : signal?.label === 'SELL' ? 'text-red-400' : 'text-slate-400';
  const signalBg =
    signal?.label === 'BUY' ? 'bg-emerald-500/10 border-emerald-500/30' : signal?.label === 'SELL' ? 'bg-red-500/10 border-red-500/30' : 'bg-slate-700/10 border-slate-600/30';

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
  const lastMacd = ind?.macd?.slice(-1)[0] ?? null;
  const lastSignal = ind?.signal?.slice(-1)[0] ?? null;
  const lastHist = ind?.hist?.slice(-1)[0] ?? null;
  const lastSma5 = ind?.sma5?.slice(-1)[0] ?? null;
  const lastSma20 = ind?.sma20?.slice(-1)[0] ?? null;
  const lastBbUpper = ind?.bb_upper?.slice(-1)[0] ?? null;
  const lastBbLower = ind?.bb_lower?.slice(-1)[0] ?? null;
  const lastBbMid = ind?.bb_mid?.slice(-1)[0] ?? null;
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

  return (
    <div className="h-screen bg-[#080a0f] text-slate-200 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-slate-800 bg-[#0b0e14] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center">
            <CandlestickChart size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">SOL/USDT AI Trading</h1>
            <p className="text-sm text-slate-500">Binance + LightGBM Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">
              {price > 0 ? `$${price.toFixed(2)}` : '—'}
            </div>
            {ticker && (
              <div className={`text-sm tabular-nums ${ticker.price_change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {ticker.price_change_pct >= 0 ? '+' : ''}{ticker.price_change_pct.toFixed(2)}% / 24h
              </div>
            )}
          </div>

          {signal && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${signalBg}`}>
              {signal.label === 'BUY' ? <TrendingUp size={15} className="text-emerald-400" /> : signal.label === 'SELL' ? <TrendingDown size={15} className="text-red-400" /> : <Activity size={15} className="text-slate-400" />}
              <div>
                <div className={`text-sm font-bold ${signalColor}`}>{signal.label}</div>
                <div className="text-xs text-slate-500">{(signal.confidence * 100).toFixed(0)}% conf</div>
              </div>
            </div>
          )}

          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-bold ${mode === 'LIVE' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
            {mode === 'LIVE' ? <Wifi size={12} /> : <WifiOff size={12} />}
            {mode}
          </div>

          <button
            onClick={() => setShowLiveModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium transition-colors"
          >
            <Zap size={13} /> Live Connect
          </button>
        </div>
      </header>

      {/* Interval bar */}
      <div className="flex items-center gap-1 px-5 py-1.5 border-b border-slate-800 bg-[#0b0e14] flex-shrink-0">
        <span className="text-sm text-slate-500 uppercase tracking-wider mr-2">Interval</span>
        {INTERVALS.map((intv) => (
          <button
            key={intv}
            onClick={() => setInterval(intv)}
            className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
              interval === intv ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {intv}
          </button>
        ))}
        <div className="flex-1" />
        {signal && (
          <span className="text-sm text-slate-500 font-mono truncate max-w-md">{signal.reason}</span>
        )}
        <button onClick={loadAll} className="ml-3 p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Main body: left column (chart + history) + right sidebar */}
      <div className="flex-1 flex gap-2 p-2 min-h-0 overflow-hidden">
        {/* Left: chart (top) + trade history (bottom) */}
        <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0">
          {/* Chart — 60% of left column height */}
          <div className="flex-[4.5] min-h-0">
            {data && (
              <TradingChart
                candles={data.candles}
                indicators={data.indicators}
                levels={data.levels}
                interval={interval}
                currentPrice={price}
                trades={trades}
              />
            )}
          </div>

          {/* Trade History — below chart, larger for 3-4 rows */}
          <div className="flex-[1.6] bg-[#0b0e14] border border-slate-800 rounded-lg p-3 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">Trade History</span>
                <span className="text-xs text-slate-500">{trades.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={exportTrades} className="p-1 rounded text-slate-500 hover:text-slate-300" title="Export CSV">
                  <Download size={12} />
                </button>
                <button onClick={handleClearTrades} className="p-1 rounded text-slate-500 hover:text-red-400" title="Clear">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 thin-scrollbar">
              {trades.length === 0 ? (
                <p className="text-sm text-slate-600 text-center py-4">No trades yet</p>
              ) : (
                <table className="w-full text-sm font-mono">
                  <thead className="sticky top-0 bg-[#0b0e14]">
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th onClick={() => toggleSort('time')} className="text-left py-1.5 px-2 font-medium cursor-pointer hover:text-slate-300 select-none">Time {sortKey === 'time' && (sortDir === 'asc' ? '▲' : '▼')}</th>
                      <th onClick={() => toggleSort('mode')} className="text-left py-1.5 px-2 font-medium cursor-pointer hover:text-slate-300 select-none">Mode {sortKey === 'mode' && (sortDir === 'asc' ? '▲' : '▼')}</th>
                      <th onClick={() => toggleSort('side')} className="text-left py-1.5 px-2 font-medium cursor-pointer hover:text-slate-300 select-none">Side {sortKey === 'side' && (sortDir === 'asc' ? '▲' : '▼')}</th>
                      <th onClick={() => toggleSort('price')} className="text-right py-1.5 px-2 font-medium cursor-pointer hover:text-slate-300 select-none">Price {sortKey === 'price' && (sortDir === 'asc' ? '▲' : '▼')}</th>
                      <th onClick={() => toggleSort('qty')} className="text-right py-1.5 px-2 font-medium cursor-pointer hover:text-slate-300 select-none">Qty {sortKey === 'qty' && (sortDir === 'asc' ? '▲' : '▼')}</th>
                      <th onClick={() => toggleSort('amount')} className="text-right py-1.5 px-2 font-medium cursor-pointer hover:text-slate-300 select-none">Amount {sortKey === 'amount' && (sortDir === 'asc' ? '▲' : '▼')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTrades.map((t) => (
                      <tr key={t.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                        <td className="py-1.5 px-2 text-slate-400">
                          {new Date(t.created_at).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className={`px-1.5 rounded text-xs ${t.mode === 'LIVE' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                            {t.mode}
                          </span>
                        </td>
                        <td className={`py-1.5 px-2 font-bold ${t.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.side}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-300">${t.price.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-400">{t.qty.toFixed(5)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300">${t.amount_usdt.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right: trading sidebar */}
        <div className="w-[442px] flex-shrink-0 flex flex-col gap-2 min-h-0 overflow-y-auto thin-scrollbar">
          {/* AI Signal panel */}
          <div className="bg-[#0b0e14] border border-sky-500/20 rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2.5">
              <Brain size={14} className="text-sky-400" />
              <span className="text-sm font-bold">AI Signal</span>
              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded font-bold ${signal?.label === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : signal?.label === 'SELL' ? 'bg-red-500/20 text-red-300' : 'bg-slate-700/40 text-slate-400'}`}>
                {signal?.label || 'HOLD'}
              </span>
            </div>
            {signal ? (
              <div className="space-y-1.5">
                {/* Confidence bar */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-500">Confidence</span>
                    <span className="text-slate-300 font-mono">{(signal.confidence * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${signal.label === 'BUY' ? 'bg-emerald-500' : signal.label === 'SELL' ? 'bg-red-500' : 'bg-slate-500'}`}
                      style={{ width: `${Math.max(3, signal.confidence * 100)}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed bg-slate-900/40 rounded px-2 py-1.5">
                  {signal.reason}
                </p>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  <MetricRow icon={<Gauge size={10} />} label="RSI" value={lastRsi > 0 ? lastRsi.toFixed(1) : '—'} accent={lastRsi > 70 ? 'text-red-400' : lastRsi < 30 ? 'text-emerald-400' : 'text-slate-300'} />
                  <MetricRow icon={<Activity size={10} />} label="Trend" value={trendDir} accent={trendDir === 'UP' ? 'text-emerald-400' : trendDir === 'DOWN' ? 'text-red-400' : 'text-slate-400'} />
                  <MetricRow icon={<TrendingUp size={10} />} label="MACD" value={lastMacd !== null ? (lastMacd as number).toFixed(4) : '—'} accent={lastMacd !== null && lastMacd > 0 ? 'text-emerald-400' : 'text-red-400'} />
                  <MetricRow icon={<TrendingDown size={10} />} label="Signal" value={lastSignal !== null ? (lastSignal as number).toFixed(4) : '—'} accent="text-amber-400" />
                  <MetricRow icon={<Activity size={10} />} label="Hist" value={lastHist !== null ? (lastHist as number).toFixed(4) : '—'} accent={lastHist !== null && lastHist > 0 ? 'text-emerald-400' : 'text-red-400'} />
                  <MetricRow icon={<Gauge size={10} />} label="BB %B" value={bbPos !== null ? bbPos.toFixed(1) + '%' : '—'} accent={bbPos !== null && bbPos > 80 ? 'text-red-400' : bbPos !== null && bbPos < 20 ? 'text-emerald-400' : 'text-slate-300'} />
                </div>
                <div className="border-t border-slate-800 pt-1.5 mt-1.5 space-y-0.5">
                  <MetricRow label="SMA 5" value={lastSma5 !== null ? (lastSma5 as number).toFixed(2) : '—'} />
                  <MetricRow label="SMA 20" value={lastSma20 !== null ? (lastSma20 as number).toFixed(2) : '—'} />
                  <MetricRow label="BB Upper" value={lastBbUpper !== null ? (lastBbUpper as number).toFixed(2) : '—'} />
                  <MetricRow label="BB Lower" value={lastBbLower !== null ? (lastBbLower as number).toFixed(2) : '—'} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600 text-center py-2">Loading AI signal...</p>
            )}
          </div>

          {/* Order panel — moved above Account */}
          <div className="bg-[#0b0e14] border border-sky-500/20 rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2.5">
              <Plus size={14} className="text-emerald-400" />
              <span className="text-sm font-bold">Place Order</span>
            </div>
            <div className="space-y-2">
              <div className="flex gap-1">
                <button
                  onClick={() => setOrderType('market')}
                  className={`flex-1 py-1 rounded text-sm font-medium ${orderType === 'market' ? 'bg-slate-700 text-slate-200' : 'bg-slate-800/40 text-slate-500'}`}
                >
                  Market
                </button>
                <button
                  onClick={() => setOrderType('limit')}
                  className={`flex-1 py-1 rounded text-sm font-medium ${orderType === 'limit' ? 'bg-slate-700 text-slate-200' : 'bg-slate-800/40 text-slate-500'}`}
                >
                  Limit
                </button>
              </div>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount (USDT for Buy / SOL for Sell)"
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono focus:border-sky-500 outline-none"
              />
              {orderType === 'limit' && (
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Limit price USDT"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono focus:border-sky-500 outline-none"
                />
              )}
              <div className="text-xs text-slate-500 font-mono text-center bg-slate-900/40 rounded py-1">
                Fee: ${feeAmount.toFixed(2)} ({(feeRate * 100).toFixed(2)}%)
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => doTrade('BUY')}
                  disabled={loading}
                  className="py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold transition-colors"
                >
                  BUY
                </button>
                <button
                  onClick={() => doTrade('SELL')}
                  disabled={loading}
                  className="py-2 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold transition-colors"
                >
                  SELL
                </button>
              </div>
            </div>
          </div>

          {/* Account + fees — moved below Place Order */}
          <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Wallet size={14} className="text-sky-400" />
              <span className="text-sm font-bold">Account</span>
              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${mode === 'LIVE' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                {mode}
              </span>
            </div>
            {account && (
              <div className="space-y-1 text-sm font-mono">
                <Row label="Cash" value={`$${account.cash.toLocaleString()}`} />
                <Row label="SOL" value={account.qty.toFixed(6)} />
                <Row label="Equity" value={`$${account.equity.toLocaleString()}`} accent="text-sky-300" />
                {(account.reserved_cash > 0 || account.reserved_qty > 0) && (
                  <Row label="Reserved" value={`$${account.reserved_cash.toFixed(0)} + ${account.reserved_qty.toFixed(4)} SOL`} accent="text-amber-400" />
                )}
                <div className="border-t border-slate-800 my-1.5" />
                <Row label="Fee Rate" value={`${(account.fee_rate * 100).toFixed(2)}%`} accent="text-amber-400" />
                <Row label="Total Fees" value={`$${account.total_fees.toFixed(4)}`} accent="text-amber-400" />
                {account.live_usdt !== undefined && (
                  <>
                    <div className="border-t border-slate-800 my-1.5" />
                    <Row label="Live USDT" value={`$${account.live_usdt}`} />
                    <Row label="Live SOL" value={account.live_sol?.toFixed(6) || '0'} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* AI Auto-Trade */}
          <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Bot size={14} className="text-violet-400" />
              <span className="text-sm font-bold">AI Auto-Trade</span>
            </div>
            <button
              onClick={toggleAuto}
              disabled={mode === 'LIVE'}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 transition-all ${
                auto.auto
                  ? 'border-violet-500 bg-violet-500/15 text-violet-300'
                  : 'border-slate-700 bg-slate-800/30 text-slate-400 hover:border-slate-600'
              } ${mode === 'LIVE' ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Radio size={15} className={auto.auto ? 'animate-pulse' : ''} />
              <span className="text-sm font-bold">{auto.auto ? 'AUTO ACTIVE' : 'AUTO INACTIVE'}</span>
            </button>
            {auto.last_signal && (
              <p className="text-xs text-slate-500 mt-1.5 text-center">Last: {auto.last_signal}</p>
            )}
            {mode === 'LIVE' && (
              <p className="text-xs text-red-400 mt-1.5">Disabled in LIVE mode</p>
            )}
          </div>

          {/* Pending orders */}
          <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold">Pending Orders</span>
              <span className="text-xs text-slate-500">{pending.length}</span>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto thin-scrollbar">
              {pending.length === 0 ? (
                <p className="text-sm text-slate-600">No pending orders</p>
              ) : (
                pending.map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-sm font-mono bg-slate-900/50 rounded px-2 py-1">
                    <span className={o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                      {o.side} @ {o.price.toFixed(2)}
                    </span>
                    <button onClick={() => cancelPending(o.id)} className="text-slate-500 hover:text-red-400">
                      <X size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Support/Resistance */}
          <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={14} className="text-amber-400" />
              <span className="text-sm font-bold">Support / Resistance</span>
            </div>
            <div className="space-y-0.5 max-h-36 overflow-y-auto thin-scrollbar">
              {data?.levels.length === 0 ? (
                <p className="text-sm text-slate-600">No levels detected</p>
              ) : (
                data?.levels.map((l: Level, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm font-mono py-0.5">
                    <span className={l.type === 'support' ? 'text-emerald-400' : 'text-red-400'}>
                      {l.type === 'support' ? 'S' : 'R'} ${l.price.toFixed(2)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">x{l.touches}</span>
                      <span className={l.distance_pct && l.distance_pct > 0 ? 'text-emerald-500/60' : 'text-red-500/60'}>
                        {l.distance_pct?.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Reset */}
          <button
            onClick={handleReset}
            className="flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-sm font-medium transition-colors flex-shrink-0"
          >
            <RotateCcw size={12} /> Reset Account
          </button>
        </div>
      </div>

      {/* Live connect modal */}
      {showLiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowLiveModal(false)}>
          <div className="bg-[#0b0e14] border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold">Connect Binance Live Trading</h2>
              <button onClick={() => setShowLiveModal(false)} className="text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-500 uppercase">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm font-mono mt-1 focus:border-sky-500 outline-none"
                  placeholder="Your Binance API key"
                />
              </div>
              <div>
                <label className="text-sm text-slate-500 uppercase">API Secret</label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm font-mono mt-1 focus:border-sky-500 outline-none"
                  placeholder="Your Binance API secret"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-500 uppercase">Max Order (USDT)</label>
                  <input
                    type="number"
                    value={maxOrder}
                    onChange={(e) => setMaxOrder(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs font-mono mt-1 focus:border-sky-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-500 uppercase">Network</label>
                  <div className="flex items-center gap-3 mt-2">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={testnet} onChange={(e) => setTestnet(e.target.checked)} className="accent-sky-500" />
                      Testnet
                    </label>
                  </div>
                </div>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-sm text-amber-300/80">
                Enable Spot Trading only. Never enable Withdraw permission. Your keys are used only for signed requests and never logged.
              </div>
              <button
                onClick={connectLive}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-bold transition-colors"
              >
                {loading ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium border ${toast.ok ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-red-500/15 border-red-500/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={accent || 'text-slate-300'}>{value}</span>
    </div>
  );
}

function MetricRow({ icon, label, value, accent }: { icon?: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5 bg-slate-900/40 rounded px-1.5 py-1">
      {icon && <span className="text-slate-500 flex-shrink-0">{icon}</span>}
      <span className="text-slate-500 text-sm flex-1">{label}</span>
      <span className={`text-sm font-mono ${accent || 'text-slate-300'}`}>{value}</span>
    </div>
  );
}
