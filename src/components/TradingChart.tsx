import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import type { Candle, Indicators, Level, Trade } from '@/types';

type OverlayKey = 'sma5' | 'sma20' | 'ema5' | 'ema20' | 'bb';

const OVERLAY_LABELS: Record<OverlayKey, string> = {
  sma5: 'SMA 5',
  sma20: 'SMA 20',
  ema5: 'EMA 5',
  ema20: 'EMA 20',
  bb: 'Bollinger',
};

const OVERLAY_COLORS: Record<OverlayKey, string> = {
  sma5: '#38bdf8',
  sma20: '#fbbf24',
  ema5: '#a78bfa',
  ema20: '#fb7185',
  bb: '#64748b',
};

interface Props {
  candles: Candle[];
  indicators: Indicators;
  levels: Level[];
  interval: string;
  currentPrice: number;
  trades: Trade[];
}

interface View {
  offset: number;
  bars: number;
}

const EMPTY_ARR: (number | null)[] = [];
const EMPTY_IND: Indicators = {
  sma5: EMPTY_ARR, sma20: EMPTY_ARR, ema5: EMPTY_ARR, ema20: EMPTY_ARR,
  macd: EMPTY_ARR, signal: EMPTY_ARR, hist: EMPTY_ARR,
  rsi: EMPTY_ARR, rsi14: 0,
  bb_upper: EMPTY_ARR, bb_mid: EMPTY_ARR, bb_lower: EMPTY_ARR,
};

class ChartErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.error('[TradingChart] caught error:', err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full bg-[#0b0e14] rounded-lg border border-slate-800">
          <div className="text-center">
            <p className="text-slate-400 text-sm">Chart render error</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-3 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200"
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

export default function TradingChart(props: Props) {
  return (
    <ChartErrorBoundary>
      <TradingChartInner {...props} />
    </ChartErrorBoundary>
  );
}

const PAD_L = 16;
const PAD_R = 76;
const PAD_T = 12;

function TradingChartInner({ candles, indicators, levels, interval, currentPrice, trades }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 520 });

  const safeInd = useMemo<Indicators>(() => {
    const g = (arr: (number | null)[] | undefined) =>
      Array.isArray(arr) ? arr : EMPTY_ARR;
    return {
      sma5: g(indicators?.sma5),
      sma20: g(indicators?.sma20),
      ema5: g(indicators?.ema5),
      ema20: g(indicators?.ema20),
      macd: g(indicators?.macd),
      signal: g(indicators?.signal),
      hist: g(indicators?.hist),
      rsi: g(indicators?.rsi),
      rsi14: indicators?.rsi14 ?? 0,
      bb_upper: g(indicators?.bb_upper),
      bb_mid: g(indicators?.bb_mid),
      bb_lower: g(indicators?.bb_lower),
    };
  }, [indicators]);

  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    sma5: false,
    sma20: false,
    ema5: false,
    ema20: false,
    bb: false,
  });
  const [showMacd, setShowMacd] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showSR, setShowSR] = useState(false);
  const [showCross, setShowCross] = useState(false);
  const [showTrades, setShowTrades] = useState(false);

  const [view, setView] = useState<View>({ offset: 0, bars: 80 });
  const [priceZoom, setPriceZoom] = useState(1.0);
  const priceZoomRef = useRef(priceZoom);
  priceZoomRef.current = priceZoom;

  const [hover, setHover] = useState<{ x: number; y: number; idx: number } | null>(null);
  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);

  // ref-based view for rAF drag, avoids React re-render on every mousemove
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  type DragState =
    | { type: 'pan'; startX: number; startOffset: number }
    | { type: 'price'; startY: number; startZoom: number };

  const dragRef = useRef<DragState | null>(null);
  const [isOverPriceAxis, setIsOverPriceAxis] = useState(false);
  const rafRef = useRef<number | null>(null);

  const safeCandles = useMemo(() => (Array.isArray(candles) ? candles : []), [candles]);
  const safeTrades = useMemo(() => (Array.isArray(trades) ? trades : []), [trades]);
  const safeLevels = useMemo(() => (Array.isArray(levels) ? levels : []), [levels]);

  const maxBars = safeCandles.length;
  const clampedBars = Math.min(view.bars, Math.max(1, maxBars));
  const maxOffset = Math.max(0, maxBars - clampedBars);
  const startIdx = Math.max(0, Math.min(maxOffset, view.offset));
  const visible = useMemo(
    () => safeCandles.slice(startIdx, startIdx + clampedBars),
    [safeCandles, startIdx, clampedBars]
  );

  const slice = useCallback(
    <T,>(arr: T[]) => (Array.isArray(arr) ? arr.slice(startIdx, startIdx + clampedBars) : []),
    [startIdx, clampedBars]
  );

  const visInd = useMemo(
    () => ({
      sma5: slice(safeInd.sma5),
      sma20: slice(safeInd.sma20),
      ema5: slice(safeInd.ema5),
      ema20: slice(safeInd.ema20),
      bb_upper: slice(safeInd.bb_upper),
      bb_mid: slice(safeInd.bb_mid),
      bb_lower: slice(safeInd.bb_lower),
      macd: slice(safeInd.macd),
      signal: slice(safeInd.signal),
      hist: slice(safeInd.hist),
      volume: visible.map((c) => c.v),
    }),
    [safeInd, visible, slice]
  );

  // ResizeObserver — guarded against infinite loops
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(400, Math.round(r.width));
      const h = Math.max(300, Math.round(r.height));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = size.w;
    const H = size.h;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // layout: price | x-labels gap | subcharts | scrollbar
    const xLabelH = 22;
    const scrollH = 16;
    const subH = (showMacd ? 72 : 0) + (showVolume ? 56 : 0);
    const padB = xLabelH + subH + scrollH;
    const priceH = Math.max(120, H - PAD_T - padB);

    // background
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, W, H);

    if (visible.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Loading chart data...', W / 2, H / 2);
      return;
    }

    const n = visible.length;
    const chartW = W - PAD_L - PAD_R;
    const barW = chartW / n;
    const candleW = Math.max(2, barW * 0.65);

    // price range
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of visible) {
      lo = Math.min(lo, c.l);
      hi = Math.max(hi, c.h);
    }
    if (showSR) {
      for (const l of safeLevels) {
        if (l.price >= lo * 0.95 && l.price <= hi * 1.05) {
          lo = Math.min(lo, l.price);
          hi = Math.max(hi, l.price);
        }
      }
    }
    if (overlays.bb) {
      for (const v of visInd.bb_upper) if (v !== null) hi = Math.max(hi, v);
      for (const v of visInd.bb_lower) if (v !== null) lo = Math.min(lo, v);
    }
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    const mid = (lo + hi) / 2;
    const halfRange = ((hi - lo) / 2) * priceZoom;
    lo = mid - halfRange;
    hi = mid + halfRange;
    const range = hi - lo || 1;

    const xOf = (i: number) => PAD_L + i * barW + barW / 2;
    const yOf = (p: number) => PAD_T + ((hi - p) / range) * priceH;
    const priceBottom = PAD_T + priceH;
    const subTop = priceBottom + xLabelH;

    // grid + y axis labels on the right
    ctx.strokeStyle = '#1a2030';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '13px monospace';
    ctx.textAlign = 'left';
    const ySteps = 6;
    for (let i = 0; i <= ySteps; i++) {
      const p = lo + (range * i) / ySteps;
      const y = yOf(p);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
      ctx.stroke();
      ctx.fillText(p.toFixed(2), W - PAD_R + 6, y + 4);
    }

    // x axis labels — drawn in the gap between price chart and subcharts
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#12161e';
    ctx.fillStyle = '#64748b';
    ctx.font = '13px monospace';
    const xStep = Math.max(1, Math.floor(n / 8));
    for (let i = 0; i < n; i += xStep) {
      const d = new Date(visible[i].t);
      const lbl = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      // label sits in the gap between price bottom and subchart top
      ctx.fillText(lbl, xOf(i), priceBottom + 15);
      // grid line spans only the price chart area
      ctx.beginPath();
      ctx.moveTo(xOf(i), PAD_T);
      ctx.lineTo(xOf(i), priceBottom);
      ctx.stroke();
    }

    // Bollinger Bands fill
    if (overlays.bb) {
      const upper = visInd.bb_upper;
      const lower = visInd.bb_lower;
      ctx.fillStyle = 'rgba(100,116,139,0.08)';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        if (upper[i] === null) continue;
        const x = xOf(i);
        const y = yOf(upper[i] as number);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) {
        if (lower[i] === null) continue;
        ctx.lineTo(xOf(i), yOf(lower[i] as number));
      }
      ctx.closePath();
      ctx.fill();
    }

    // support/resistance lines
    if (showSR) {
      for (const l of safeLevels) {
        if (l.price < lo || l.price > hi) continue;
        const y = yOf(l.price);
        ctx.strokeStyle = l.type === 'support' ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(W - PAD_R, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = l.type === 'support' ? '#22c55e' : '#ef4444';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${l.type === 'support' ? 'S' : 'R'} ${l.price.toFixed(2)}`, W - PAD_R + 5, y + 4);
      }
    }

    // overlay line helper
    const drawOverlayLine = (arr: (number | null)[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = arr[i];
        if (v === null) { started = false; continue; }
        const x = xOf(i);
        const y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // Bollinger band lines
    if (overlays.bb) {
      drawOverlayLine(visInd.bb_upper, 'rgba(100,116,139,0.6)', 1);
      drawOverlayLine(visInd.bb_mid, 'rgba(100,116,139,0.4)', 0.8);
      drawOverlayLine(visInd.bb_lower, 'rgba(100,116,139,0.6)', 1);
    }
    // SMA/EMA overlays — only on price chart
    (['sma5', 'sma20', 'ema5', 'ema20'] as const).forEach((key) => {
      if (!overlays[key]) return;
      drawOverlayLine(visInd[key], OVERLAY_COLORS[key], 1.4);
    });

    // candles
    for (let i = 0; i < n; i++) {
      const c = visible[i];
      const up = c.c >= c.o;
      const color = up ? '#22c55e' : '#ef4444';
      const x = xOf(i);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.h));
      ctx.lineTo(x, yOf(c.l));
      ctx.stroke();
      const yO = yOf(c.o);
      const yC = yOf(c.c);
      const top = Math.min(yO, yC);
      const bh = Math.max(1, Math.abs(yC - yO));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleW / 2, top, candleW, bh);
    }

    // current price line
    if (currentPrice > 0 && currentPrice >= lo && currentPrice <= hi) {
      const y = yOf(currentPrice);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '13px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(currentPrice.toFixed(2), W - PAD_R + 5, y + 4);
    }

    // Golden/Death cross markers (SMA5 vs SMA20)
    if (showCross && overlays.sma5 && overlays.sma20 && safeInd.sma5.length > 1) {
      for (let i = 1; i < safeCandles.length; i++) {
        const s5p = safeInd.sma5[i - 1];
        const s20p = safeInd.sma20[i - 1];
        const s5c = safeInd.sma5[i];
        const s20c = safeInd.sma20[i];
        if (s5p === null || s20p === null || s5c === null || s20c === null) continue;
        const visI = i - startIdx;
        if (visI < 0 || visI >= n) continue;
        const golden = s5p <= s20p && s5c > s20c;
        const death = s5p >= s20p && s5c < s20c;
        if (!golden && !death) continue;
        // Draw at the EXACT candle position and the SMA5 value at that index
        const x = xOf(visI);
        const y = yOf(s5c as number);
        ctx.fillStyle = golden ? '#fbbf24' : '#f87171';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0b0e14';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Buy/Sell trade markers
    if (showTrades && safeTrades.length > 0) {
      for (const tr of safeTrades) {
        const tt = new Date(tr.created_at).getTime();
        if (isNaN(tt)) continue;
        let bestIdx = -1;
        let bestDiff = Infinity;
        for (let i = 0; i < safeCandles.length; i++) {
          const diff = Math.abs(safeCandles[i].t - tt);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        if (bestIdx < 0) continue;
        const visI = bestIdx - startIdx;
        if (visI < 0 || visI >= n) continue;
        const c = visible[visI];
        if (!c) continue;
        const x = xOf(visI);
        const sz = 7;
        if (tr.side === 'BUY') {
          const y = yOf(c.l) + sz + 6;
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - sz, y + sz);
          ctx.lineTo(x + sz, y + sz);
          ctx.closePath();
          ctx.fill();
        } else {
          const y = yOf(c.h) - sz - 6;
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - sz, y - sz);
          ctx.lineTo(x + sz, y - sz);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ---- subcharts (volume + macd only) ----
    let subY = subTop;

    // Volume
    if (showVolume) {
      const vh = 56;
      const maxVol = Math.max(...visInd.volume, 1);
      ctx.fillStyle = '#0f1420';
      ctx.fillRect(PAD_L, subY, chartW, vh);
      for (let i = 0; i < n; i++) {
        const v = visInd.volume[i];
        const bh = (v / maxVol) * (vh - 8);
        const up = visible[i].c >= visible[i].o;
        ctx.fillStyle = up ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
        ctx.fillRect(xOf(i) - candleW / 2, subY + vh - bh, candleW, bh);
      }
      ctx.fillStyle = '#475569';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('VOL', PAD_L + 6, subY + 14);
      subY += vh + 4;
    }

    // MACD — histogram only (no macd/signal lines)
    if (showMacd) {
      const mh = 72;
      ctx.fillStyle = '#101620';
      ctx.fillRect(PAD_L, subY, chartW, mh);
      const allH = visInd.hist.filter((v): v is number => v !== null);
      const mLo = Math.min(...allH, 0);
      const mHi = Math.max(...allH, 0);
      const mR = mHi - mLo || 1;
      const mY = (v: number) => subY + ((mHi - v) / mR) * mh;
      // zero line
      ctx.strokeStyle = '#2a3340';
      ctx.beginPath();
      ctx.moveTo(PAD_L, mY(0));
      ctx.lineTo(W - PAD_R, mY(0));
      ctx.stroke();
      // histogram bars
      for (let i = 0; i < n; i++) {
        const h = visInd.hist[i];
        if (h === null) continue;
        const y0 = mY(0);
        const y1 = mY(h);
        ctx.fillStyle = h >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)';
        ctx.fillRect(xOf(i) - candleW / 2, Math.min(y0, y1), candleW, Math.abs(y1 - y0));
      }
      ctx.fillStyle = '#475569';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('MACD (12,26,9)', PAD_L + 6, subY + 14);
    }

    // hover crosshair
    if (hover && hover.idx >= 0 && hover.idx < n) {
      const x = xOf(hover.idx);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, H - padB);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD_L, hover.y);
      ctx.lineTo(W - PAD_R, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [visible, visInd, safeLevels, overlays, showMacd, showVolume, showSR, showCross, showTrades, currentPrice, size, hover, safeTrades, safeInd, startIdx, safeCandles]);

  useEffect(() => {
    draw();
  }, [draw]);

  // auto-scroll to latest when candle count changes
  useEffect(() => {
    if (safeCandles.length > 0) {
      setView((v) => {
        const newOffset = Math.max(0, safeCandles.length - v.bars);
        return v.offset === newOffset ? v : { ...v, offset: newOffset };
      });
    }
  }, [safeCandles.length]);

  const getIdx = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || visible.length === 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const chartW = size.w - PAD_L - PAD_R;
    const barW = chartW / Math.max(1, visible.length);
    return Math.max(0, Math.min(visible.length - 1, Math.floor((x - PAD_L) / barW)));
  };

  const handleMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    setIsOverPriceAxis(localX >= size.w - PAD_R);

    // Drag handling
    if (dragRef.current) {
      if (dragRef.current.type === 'pan') {
        const dx = e.clientX - dragRef.current.startX;
        const chartW = size.w - PAD_L - PAD_R;
        const barW = chartW / Math.max(1, clampedBars);
        const dBars = Math.round(-dx / Math.max(1, barW));
        const newOffset = Math.max(0, Math.min(maxOffset, dragRef.current.startOffset + dBars));
        if (viewRef.current.offset !== newOffset) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            setView((v) => ({ ...v, offset: newOffset }));
          });
        }
      } else if (dragRef.current.type === 'price') {
        const dy = e.clientY - dragRef.current.startY;
        const newZoom = Math.max(0.1, Math.min(10.0, dragRef.current.startZoom * Math.exp(dy * 0.005)));
        if (priceZoomRef.current !== newZoom) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            setPriceZoom(newZoom);
          });
        }
      }
      return;
    }

    // Hover tracking — also rAF-throttled
    if (visible.length === 0) return;
    const mx = e.clientX;
    const my = e.clientY;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const canvas2 = canvasRef.current;
      if (!canvas2) return;
      const rect2 = canvas2.getBoundingClientRect();
      const localX2 = mx - rect2.left;
      const localY2 = my - rect2.top;
      const chartW2 = size.w - PAD_L - PAD_R;
      const barW2 = chartW2 / Math.max(1, visible.length);
      const idx = Math.max(0, Math.min(visible.length - 1, Math.floor((localX2 - PAD_L) / barW2)));
      setHover({ x: localX2, y: localY2, idx });
      setHoverCandle(visible[idx] || null);
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => {
      const nb = Math.max(20, Math.min(safeCandles.length, Math.round(v.bars * (e.deltaY > 0 ? 1.15 : 0.87))));
      return { offset: Math.max(0, Math.min(safeCandles.length - nb, v.offset)), bars: nb };
    });
  };

  const zoom = (f: number) =>
    setView((v) => ({
      offset: Math.max(0, Math.min(safeCandles.length - Math.round(v.bars * f), v.offset)),
      bars: Math.max(20, Math.min(safeCandles.length, Math.round(v.bars * f))),
    }));

  const resetView = () => {
    setView({ offset: Math.max(0, safeCandles.length - 80), bars: 80 });
    setPriceZoom(1.0);
  };
  const toggleOverlay = (key: OverlayKey) => setOverlays((o) => ({ ...o, [key]: !o[key] }));

  // Full-width x-axis scrollbar: track spans from PAD_L to W-PAD_R
  const scrollTrackW = size.w - PAD_L - PAD_R;
  const thumbW = maxBars > 0 ? Math.max(30, (clampedBars / maxBars) * scrollTrackW) : scrollTrackW;
  const thumbLeft = maxBars > 0 ? PAD_L + (startIdx / maxBars) * scrollTrackW : PAD_L;
  const scrollDragRef = useRef<{ startX: number; startOffset: number } | null>(null);

  const onScrollMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrollDragRef.current = { startX: e.clientX, startOffset: view.offset };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!scrollDragRef.current) return;
      const dx = e.clientX - scrollDragRef.current.startX;
      const dBars = Math.round((dx / scrollTrackW) * maxBars);
      const newOffset = Math.max(0, Math.min(maxOffset, scrollDragRef.current.startOffset + dBars));
      setView((v) => ({ ...v, offset: newOffset }));
    };
    const onUp = () => { scrollDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [scrollTrackW, maxBars, maxOffset]);

  // cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] rounded-lg border border-slate-800 overflow-hidden">
      {/* Configurable indicator toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-slate-800 bg-[#0d1117] flex-shrink-0">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Overlays</span>
        {(Object.keys(overlays) as OverlayKey[]).map((key) => (
          <button
            key={key}
            onClick={() => toggleOverlay(key)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              overlays[key] ? 'bg-slate-700/60 text-slate-200' : 'bg-slate-800/40 text-slate-500 hover:text-slate-400'
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: overlays[key] ? OVERLAY_COLORS[key] : '#475569' }} />
            {OVERLAY_LABELS[key]}
          </button>
        ))}
        <div className="w-px h-4 bg-slate-700 mx-1" />
        <ToggleBtn active={showCross} onClick={() => setShowCross((s) => !s)} color="amber">Cross</ToggleBtn>
        <ToggleBtn active={showTrades} onClick={() => setShowTrades((s) => !s)} color="emerald">Sel/Buy</ToggleBtn>
        <div className="w-px h-4 bg-slate-700 mx-1" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Subcharts</span>
        <ToggleBtn active={showMacd} onClick={() => setShowMacd((s) => !s)} color="sky">MACD</ToggleBtn>
        <ToggleBtn active={showVolume} onClick={() => setShowVolume((s) => !s)} color="emerald">Volume</ToggleBtn>
        <div className="w-px h-4 bg-slate-700 mx-1" />
        <ToggleBtn active={showSR} onClick={() => setShowSR((s) => !s)} color="amber">S/R</ToggleBtn>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <IconBtn onClick={() => zoom(0.8)} title="Zoom in"><ZoomIn size={15} /></IconBtn>
          <IconBtn onClick={() => zoom(1.25)} title="Zoom out"><ZoomOut size={15} /></IconBtn>
          <IconBtn onClick={resetView} title="Reset"><RotateCcw size={15} /></IconBtn>
        </div>
      </div>

      {/* Chart canvas */}
      <div ref={containerRef} className="flex-1 relative" style={{ minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onMouseDown={(e) => {
            e.preventDefault();
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const localX = e.clientX - rect.left;
            if (localX >= size.w - PAD_R) {
              dragRef.current = { type: 'price', startY: e.clientY, startZoom: priceZoom };
            } else {
              dragRef.current = { type: 'pan', startX: e.clientX, startOffset: view.offset };
            }
          }}
          onDoubleClick={resetView}
          onMouseMove={handleMove}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; setHover(null); setHoverCandle(null); }}
          style={{
            cursor: dragRef.current
              ? (dragRef.current.type === 'price' ? 'ns-resize' : 'grabbing')
              : (isOverPriceAxis ? 'ns-resize' : 'crosshair'),
            display: 'block',
          }}
        />
        {/* Candle hover tooltip */}
        {hover && hoverCandle && (
          <div
            className="absolute pointer-events-none z-10 bg-[#11171f]/95 border border-slate-700 rounded px-3 py-2 text-xs font-mono shadow-xl"
            style={{ left: Math.min(hover.x + 14, size.w - 190), top: Math.max(hover.y - 90, 4) }}
          >
            <div className="text-slate-400 mb-1">
              {new Date(hoverCandle.t).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-slate-500">Open</span><span className="text-slate-200 text-right">{hoverCandle.o.toFixed(2)}</span>
              <span className="text-slate-500">High</span><span className="text-emerald-400 text-right">{hoverCandle.h.toFixed(2)}</span>
              <span className="text-slate-500">Low</span><span className="text-red-400 text-right">{hoverCandle.l.toFixed(2)}</span>
              <span className="text-slate-500">Close</span>
              <span className={`text-right ${hoverCandle.c >= hoverCandle.o ? 'text-emerald-400' : 'text-red-400'}`}>{hoverCandle.c.toFixed(2)}</span>
              <span className="text-slate-500">Volume</span>
              <span className="text-slate-300 text-right">{hoverCandle.v.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-slate-500">Change</span>
              <span className={`text-right ${hoverCandle.c >= hoverCandle.o ? 'text-emerald-400' : 'text-red-400'}`}>
                {(((hoverCandle.c - hoverCandle.o) / hoverCandle.o) * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* X-axis scrollbar — full width, thin, modern */}
      <div className="flex-shrink-0 border-t border-slate-800 bg-[#0d1117] flex items-center px-0 py-1" style={{ height: 22, paddingLeft: PAD_L, paddingRight: PAD_R }}>
        <div
          className="relative rounded-full"
          style={{ width: scrollTrackW, height: 4, background: 'rgba(51,65,85,0.4)' }}
        >
          <div
            onMouseDown={onScrollMouseDown}
            className="absolute rounded-full cursor-grab active:cursor-grabbing transition-colors hover:bg-sky-400/70"
            style={{
              left: thumbLeft - PAD_L,
              width: thumbW,
              height: 4,
              background: 'rgba(56,189,248,0.6)',
              top: 0,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ToggleBtn({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: string; children: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    sky: 'bg-sky-500/20 text-sky-300',
    emerald: 'bg-emerald-500/20 text-emerald-300',
    amber: 'bg-amber-500/20 text-amber-300',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
        active ? colorMap[color] : 'bg-slate-800/40 text-slate-500'
      }`}
    >
      {active ? <Eye size={12} /> : <EyeOff size={12} />}
      {children}
    </button>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors">
      {children}
    </button>
  );
}
