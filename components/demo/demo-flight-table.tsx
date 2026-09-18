// components/demo/demo-flight-table.tsx
//
// Zajednička tabela za /demo/* stranice — vizuelno slična pravim
// board-ovima (tamna tema, kolone let/kompanija-grad/plan/gate/status),
// ali potpuno statična (nikakav fetch, nikakav polling — podaci dolaze
// direktno kao props iz lib/demo-flights.ts).
import { statusToneClasses, type DemoFlight } from '@/lib/demo-flights';

export function DemoFlightTable({
  title, flights, columnLabel,
}: {
  title: string;
  flights: DemoFlight[];
  columnLabel: string;
}) {
  return (
    <div className="bg-slate-800/40 rounded-2xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700 text-lg font-black tracking-tight">
        {title}
      </div>
      <div className="grid grid-cols-[90px_1fr_80px_80px_70px_120px] gap-2 px-6 py-3 bg-slate-800/80 border-b border-slate-700 text-slate-400 text-xs font-bold uppercase tracking-wider">
        <span>Let</span><span>Kompanija / {columnLabel}</span><span>Plan</span><span>Oček.</span><span>Gate</span><span>Status</span>
      </div>
      <div className="divide-y divide-slate-700/40 font-mono text-sm">
        {flights.map((f) => (
          <div key={f.flightNumber} className="grid grid-cols-[90px_1fr_80px_80px_70px_120px] gap-2 px-6 py-3.5 items-center">
            <span className="text-white font-bold">{f.flightNumber}</span>
            <span className="font-sans text-slate-300 truncate">{f.airline} · {f.city}</span>
            <span className="text-slate-400">{f.scheduled}</span>
            <span className="text-amber-300">{f.estimated}</span>
            <span className="text-slate-300">{f.gate}</span>
            <span className={`font-sans font-semibold ${statusToneClasses(f.statusTone)}`}>{f.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
