// components/demo/demo-header.tsx
//
// Zajednički header za /demo/* stranice — statičan (nema uživo sat sa
// tick-om, da stranica ostane 100% statična bez ijedne 'use client'
// direktive/JS interakcije — sat koji otkucava bi zahtijevao klijentski
// JS koji ovdje nije vrijedan svog troška za demo stranicu).
export function DemoHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center text-sky-400 font-black text-sm">
            TIV
          </div>
          <div>
            <div className="font-black tracking-tight leading-none">{title}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Aerodrom Tivat</div>
          </div>
        </div>
        <a href="/" className="text-xs text-slate-400 hover:text-white transition-colors">
          ← Nazad na početnu
        </a>
      </div>
    </div>
  );
}
