'use client';
// Upozorenje "pogrešan sat računara" (uvijek, kad odstupanje > 2 min) + dijagnostika (?debug=1).
import { useEffect, useState } from 'react';
import { debugString } from '@/lib/debug-state';
import { getClockOffsetMs, hasServerClockSample, CLOCK_SKEW_WARN_MS, nowMs } from '@/lib/server-clock';

interface Props { label: string; connectionState?: string; lastSyncAtRef?: { current: number }; extra?: string }

export default function ClockDiagnostics({ label, connectionState, lastSyncAtRef, extra }: Props) {
  const [, tick] = useState(0);
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).has('debug'));
    const id = setInterval(() => tick(n => n + 1), 2_000);
    return () => clearInterval(id);
  }, []);
  const off = getClockOffsetMs();
  const wrong = hasServerClockSample() && Math.abs(off) > CLOCK_SKEW_WARN_MS;
  if (!wrong && !debug) return null;
  const min = Math.round(off / 60_000);
  const age = lastSyncAtRef?.current ? Math.round((Date.now() - lastSyncAtRef.current) / 1000) : null;
  return (
    <div style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 9999, maxWidth: '90vw', pointerEvents: 'none',
      font: '12px/1.4 monospace', color: '#fff', background: wrong ? 'rgba(180,30,30,.9)' : 'rgba(0,0,0,.7)',
      padding: '6px 10px', borderRadius: 6 }}>
      {wrong && <div>⚠ Sat računara {min > 0 ? 'kasni' : 'žuri'} {Math.abs(min)} min — ispravite vrijeme/vremensku zonu (ekran koristi sat servera)</div>}
      {debug && (
        <div>
          {label} · conn={connectionState ?? '?'} · sync={age == null ? 'n/a' : `${age}s`} · offset={Math.round(off / 1000)}s ·
          server={new Date(nowMs()).toISOString().slice(11, 19)}Z {extra ?? ''} · {debugString()}
        </div>
      )}
    </div>
  );
}
