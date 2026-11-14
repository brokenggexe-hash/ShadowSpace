import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Delete, History, Lock, Trash2 } from 'lucide-react';
import { ASSET_IMAGES } from '../utils/validators';

interface HistoryEntry {
  id: string;
  expression: string;
  result: string;
}

interface CalculatorGateProps {
  onEnterShadowSpace: () => void;
}

export function CalculatorGate({ onEnterShadowSpace }: CalculatorGateProps) {
  const [display, setDisplay] = useState('0');
  const [storedValue, setStoredValue] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [resetNext, setResetNext] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const compute = useCallback((a: number, b: number, op: string): number => {
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '×':
        return a * b;
      case '÷':
        return b === 0 ? NaN : a / b;
      default:
        return b;
    }
  }, []);

  const formatNum = (num: number): string => {
    if (!Number.isFinite(num)) return 'Error';
    const rounded = Math.round(num * 1e10) / 1e10;
    return String(rounded).slice(0, 14);
  };

  const handleDigit = useCallback(
    (digit: string) => {
      if (display === 'Error' || resetNext) {
        setDisplay(digit === '.' ? '0.' : digit);
        setResetNext(false);
        return;
      }
      if (digit === '.') {
        if (!display.includes('.')) setDisplay(`${display}.`);
        return;
      }
      setDisplay(display === '0' ? digit : `${display}${digit}`.slice(0, 14));
    },
    [display, resetNext]
  );

  const handleOperator = useCallback(
    (op: string) => {
      const current = parseFloat(display);
      if (Number.isNaN(current)) return;

      if (storedValue !== null && pendingOp && !resetNext) {
        const res = compute(storedValue, current, pendingOp);
        const formatted = formatNum(res);
        setDisplay(formatted);
        setStoredValue(Number.isFinite(res) ? res : null);
      } else {
        setStoredValue(current);
      }
      setPendingOp(op);
      setResetNext(true);
    },
    [compute, display, pendingOp, resetNext, storedValue]
  );

  const handleEquals = useCallback(() => {
    if (storedValue === null || !pendingOp) return;
    const current = parseFloat(display);
    if (Number.isNaN(current)) return;
    const res = compute(storedValue, current, pendingOp);
    const formatted = formatNum(res);

    setHistory((prev) => [
      {
        id: `${Date.now()}_${Math.random()}`,
        expression: `${storedValue} ${pendingOp} ${current}`,
        result: formatted,
      },
      ...prev.slice(0, 29),
    ]);
    setDisplay(formatted);
    setStoredValue(null);
    setPendingOp(null);
    setResetNext(true);
  }, [compute, display, pendingOp, storedValue]);

  const handlePercent = useCallback(() => {
    const current = parseFloat(display);
    if (Number.isNaN(current)) return;
    const val = storedValue !== null ? (storedValue * current) / 100 : current / 100;
    setDisplay(formatNum(val));
    setResetNext(true);
  }, [display, storedValue]);

  const handleToggleSign = useCallback(() => {
    if (display === '0' || display === 'Error') return;
    setDisplay(display.startsWith('-') ? display.slice(1) : `-${display}`);
  }, [display]);

  const handleClear = useCallback(() => {
    setDisplay('0');
    setStoredValue(null);
    setPendingOp(null);
    setResetNext(false);
  }, []);

  const handleBackspace = useCallback(() => {
    if (resetNext || display === 'Error') {
      setDisplay('0');
      setResetNext(false);
      return;
    }
    if (display.length <= 1 || (display.length === 2 && display.startsWith('-'))) {
      setDisplay('0');
    } else {
      setDisplay(display.slice(0, -1));
    }
  }, [display, resetNext]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === '.') {
        handleDigit('.');
      } else if (e.key === '+') {
        handleOperator('+');
      } else if (e.key === '-') {
        handleOperator('-');
      } else if (e.key === '*') {
        handleOperator('×');
      } else if (e.key === '/') {
        e.preventDefault();
        handleOperator('÷');
      } else if (e.key === '%') {
        handlePercent();
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEquals();
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBackspace, handleClear, handleDigit, handleEquals, handleOperator, handlePercent]);

  const buttons = [
    { label: 'AC', action: handleClear, tone: 'muted' },
    { label: '±', action: handleToggleSign, tone: 'muted' },
    { label: '%', action: handlePercent, tone: 'muted' },
    { label: '÷', action: () => handleOperator('÷'), tone: 'op' },
    { label: '7', action: () => handleDigit('7'), tone: 'num' },
    { label: '8', action: () => handleDigit('8'), tone: 'num' },
    { label: '9', action: () => handleDigit('9'), tone: 'num' },
    { label: '×', action: () => handleOperator('×'), tone: 'op' },
    { label: '4', action: () => handleDigit('4'), tone: 'num' },
    { label: '5', action: () => handleDigit('5'), tone: 'num' },
    { label: '6', action: () => handleDigit('6'), tone: 'num' },
    { label: '-', action: () => handleOperator('-'), tone: 'op' },
    { label: '1', action: () => handleDigit('1'), tone: 'num' },
    { label: '2', action: () => handleDigit('2'), tone: 'num' },
    { label: '3', action: () => handleDigit('3'), tone: 'num' },
    { label: '+', action: () => handleOperator('+'), tone: 'op' },
    { label: '0', action: () => handleDigit('0'), tone: 'num', span: 2 },
    { label: '.', action: () => handleDigit('.'), tone: 'num' },
    { label: '=', action: handleEquals, tone: 'eq' },
  ];

  return (
    <div className="min-h-screen bg-[#111214] text-zinc-100 flex flex-col justify-between p-4 sm:p-6">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4 py-2">
        <div className="flex items-center gap-3">
          <img
            src={ASSET_IMAGES.brandEmblem}
            alt="ShadowSpace Emblem"
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-xl object-cover border border-white/[0.08]"
          />
          <div>
            <span className="font-display font-bold tracking-tight text-base text-zinc-100">
              ShadowSpace
            </span>
            <p className="text-xs text-zinc-400">Workspace & Utility Gate</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEnterShadowSpace}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5865f2] hover:bg-[#4752c4] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 shadow-lg shadow-[#5865f2]/20"
        >
          <Lock className="w-4 h-4" />
          Enter ShadowSpace
          <ArrowRight className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center py-6">
        <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <section className="lg:col-span-7 bg-[#1b1c21] border border-white/[0.08] rounded-2xl p-5 sm:p-6 shadow-2xl flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium text-zinc-400">Standard Calculator</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBackspace}
                  aria-label="Delete last digit"
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
                >
                  <Delete className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowHistory((s) => !s)}
                  aria-label="Toggle calculation history"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    showHistory
                      ? 'bg-[#5865f2]/20 text-[#99aaf9] border border-[#5865f2]/40'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  History
                </button>
              </div>
            </div>

            <div className="bg-[#111214] border border-white/[0.07] rounded-xl p-4 mb-5 text-right">
              <div className="h-5 text-xs font-mono text-zinc-500 tabular-nums truncate">
                {storedValue !== null && pendingOp ? `${storedValue} ${pendingOp}` : ''}
              </div>
              <div className="text-4xl sm:text-5xl font-mono font-semibold text-zinc-50 tabular-nums tracking-tight truncate mt-1">
                {display}
              </div>
            </div>

            {showHistory && (
              <div className="mb-4 bg-[#111214] border border-white/[0.07] rounded-xl p-3 max-h-40 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-zinc-400">Calculation History</span>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistory([])}
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-2">No calculations yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {history.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setDisplay(item.result);
                          setResetNext(true);
                        }}
                        className="w-full flex items-center justify-between text-xs font-mono px-2 py-1.5 rounded-lg hover:bg-[#1b1c21] text-left transition-colors"
                      >
                        <span className="text-zinc-400 truncate">{item.expression}</span>
                        <span className="text-[#8ea1e1] font-semibold tabular-nums ml-3">
                          = {item.result}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2.5">
              {buttons.map((btn) => {
                const base =
                  btn.tone === 'eq'
                    ? 'bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold shadow-md shadow-[#5865f2]/25'
                    : btn.tone === 'op'
                      ? 'bg-[#5865f2]/15 hover:bg-[#5865f2]/25 text-[#99aaf9] border border-[#5865f2]/25 font-semibold'
                      : btn.tone === 'muted'
                        ? 'bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 font-medium'
                        : 'bg-[#222328] hover:bg-[#2b2d34] text-zinc-100 border border-white/[0.06] font-medium';
                return (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={btn.action}
                    className={`${btn.span === 2 ? 'col-span-2' : ''} h-14 rounded-xl text-lg font-mono tabular-nums transition-all active:scale-[0.98] ${base}`}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="lg:col-span-5 bg-[#1b1c21] border border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="aspect-video rounded-xl overflow-hidden border border-white/[0.07] bg-[#111214]">
                <img
                  src={ASSET_IMAGES.studioBanner}
                  alt="ShadowSpace Private Lounge"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <h1 className="text-2xl font-display font-bold tracking-tight text-zinc-50 text-balance">
                Your Space. Your Identity. Your Community.
              </h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                ShadowSpace is an independent, completely free social communication platform with real-time channels, private messaging, WebRTC voice rooms, and unrestricted profile customization.
              </p>
              <ul className="space-y-2 text-xs text-zinc-400 border-t border-white/[0.07] pt-4">
                <li>Zero subscriptions, zero paid profile locks</li>
                <li>Independent Firebase accounts & optional Discord OAuth2 link</li>
                <li>Keyboard-ready utility calculator above (0-9, +, -, *, /, %, Enter)</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={onEnterShadowSpace}
              className="mt-6 w-full h-12 rounded-xl bg-[#5865f2] hover:bg-[#4752c4] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors shadow-lg shadow-[#5865f2]/20"
            >
              <Lock className="w-4 h-4" />
              Enter ShadowSpace
              <ArrowRight className="w-4 h-4" />
            </button>
          </aside>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-zinc-500 py-2">
        ShadowSpace · Independent Real-Time Communication Platform
      </footer>
    </div>
  );
}
