'use client';

// app/security/SecurityPageClient.tsx
//
// Monitor na security checkpointu. Landscape: lijevo najbliža 4 polaska, desno slika "Prije bezbjednosne kontrole".
// Portrait: polasci gore, slika u donjoj polovini (CSS `portrait:` varijanta — bez JS-a za raspored).
// Podaci: isti izvor kao ostali monitori (useRealtimeFlightData + useRealtimeAssignments za gate) — bez ijednog novog API poziva.
// Upozorenja: ≤15 min do polaska = prioritet (žuto), ≤10 min = hitno (crveno). Vidi lib/security-board.ts.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, DoorOpen, Plane, Siren } from 'lucide-react';
import { useRealtimeFlightData } from '@/hooks/useRealtimeFlightData';
import { useRealtimeAssignments } from '@/hooks/useRealtimeAssignments';
import { useKioskSupervisor } from '@/hooks/useKioskSupervisor';
import { useBodyBackground } from '@/hooks/use-body-background';
import { nowMs } from '@/lib/server-clock';
import { formatAirportTime, pickSecurityRows, type SecurityRow } from '@/lib/security-board';

const TICK_MS = 15_000;

const gateSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function Row({ r }: { r: SecurityRow }) {
  const urgent = r.level === 'urgent';
  const hurry = r.level === 'hurry';
  const boarding = r.level === 'boarding';
  const frame = urgent ? 'border-red-500 bg-red-600/25' : hurry ? 'border-amber-400 bg-amber-500/20' : boarding ? 'border-emerald-400/70 bg-emerald-500/10' : 'border-white/15 bg-white/5';
  return (
    <div className={`grid min-h-0 grid-cols-[auto_1fr_auto] items-center gap-[2.2vmin] rounded-[1.6vmin] border-[0.5vmin] px-[2.2vmin] ${frame}`}>
      <div className="text-center leading-none">
        <div className="text-[5.8vmin] font-extrabold tabular-nums text-white">{r.std}</div>
        {r.etd && <div className="mt-[0.6vmin] text-[2.4vmin] font-semibold tabular-nums text-amber-300">ETD {r.etd}</div>}
      </div>

      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-[1.2vmin] text-[4.4vmin] font-bold text-white">
          <Plane className="h-[4vmin] w-[4vmin] shrink-0 text-yellow-300" aria-hidden />
          <span className="truncate">{r.destination}</span>
        </div>
        <div className="mt-[0.6vmin] flex flex-wrap items-center gap-x-[2vmin] text-[2.8vmin] text-white/75">
          <span className="font-semibold tabular-nums text-white/90">{r.flightNumber}</span>
          <span>Boarding / Ukrcavanje <b className="tabular-nums text-white">{r.boarding}</b></span>
        </div>
        {(urgent || hurry) && (
          <div className={`mt-[0.6vmin] flex items-center gap-[1vmin] whitespace-nowrap text-[2.6vmin] font-extrabold uppercase tracking-wide ${urgent ? 'text-red-300' : 'text-amber-300'}`}>
            {urgent ? <Siren className="h-[3.4vmin] w-[3.4vmin] animate-pulse" aria-hidden /> : <AlertTriangle className="h-[3.4vmin] w-[3.4vmin]" aria-hidden />}
            {urgent ? 'Gate now · Odmah na gate' : 'Priority · Prioritet'}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center justify-center rounded-[1.4vmin] bg-black/35 px-[2.4vmin] py-[1.2vmin] text-center leading-none">
        <div className="flex items-center gap-[0.8vmin] text-[2.2vmin] font-semibold uppercase tracking-wider text-white/60">
          <DoorOpen className="h-[2.6vmin] w-[2.6vmin]" aria-hidden /> Gate
        </div>
        <div className={`mt-[0.6vmin] text-[7vmin] font-extrabold tabular-nums ${r.gate ? 'text-yellow-300' : 'text-white/30'}`}>{r.gate || '–'}</div>
      </div>
    </div>
  );
}

export default function SecurityPageClient() {
  useBodyBackground('#071a3d');
  const { data } = useRealtimeFlightData('board');
  const { gateEntries } = useRealtimeAssignments('board');
  const [now, setNow] = useState<number>(() => nowMs());

  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const gatesByFlight = useMemo(() => {
    const sets: Record<string, string[]> = {};
    for (const [gate, e] of Object.entries(gateEntries ?? {})) {
      if (e?.status === 'open' && e.flightNumber) (sets[e.flightNumber] ??= []).push(gate);
    }
    const out: Record<string, string> = {};
    for (const [fn, list] of Object.entries(sets)) out[fn] = list.sort(gateSort).join(', ');
    return out;
  }, [gateEntries]);

  const rows = useMemo(() => pickSecurityRows(data?.departures ?? [], gatesByFlight, now), [data, gatesByFlight, now]);

  useKioskSupervisor({
    id: 'security',
    role: 'board',
    view: data ? 'other' : 'loading',
    flight: '',
    reload: () => window.location.reload(),
  });

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden bg-[#071a3d] text-white portrait:flex-col">
      <section className="flex h-full w-[56%] min-w-0 flex-col gap-[1.6vmin] p-[2.4vmin] portrait:h-1/2 portrait:w-full">
        <header className="flex shrink-0 items-end justify-between">
          <div className="leading-tight">
            <h1 className="text-[4.2vmin] font-extrabold tracking-wide text-yellow-300">NEXT DEPARTURES</h1>
            <div className="text-[2.6vmin] font-semibold uppercase tracking-wider text-white/70">Sljedeći polasci</div>
          </div>
          <div className="text-[5.4vmin] font-extrabold tabular-nums leading-none">{formatAirportTime(now)}</div>
        </header>

        {rows.length > 0 ? (
          <div className="grid min-h-0 flex-1 grid-rows-4 gap-[1.4vmin]">
            {rows.map((r) => <Row key={r.key} r={r} />)}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-[1.6vmin] border-[0.4vmin] border-white/15 text-center text-[3.6vmin] font-semibold text-white/70">
            {data ? 'No upcoming departures / Nema narednih polazaka' : 'Loading… / Učitavanje…'}
          </div>
        )}

        <footer className="shrink-0 text-[2.2vmin] text-white/55">
          Boarding starts 30 min before departure · Ukrcavanje počinje 30 min prije polaska
        </footer>
      </section>

      <section className="flex h-full w-[44%] items-center justify-center bg-[#0b3a7a] portrait:h-1/2 portrait:w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/security/before-security.jpg" alt="Before security screening / Prije bezbjednosne kontrole" className="h-full w-full object-contain" />
      </section>
    </div>
  );
}
