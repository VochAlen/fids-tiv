// app/not-found.tsx
//
// FIX (2026 UI/UX prolaz — praznina u production-readiness): do sad
// nije postojao ni jedan custom not-found.tsx u cijeloj aplikaciji —
// pogrešan URL (npr. otkucana greška u admin URL-u, ili neko ko
// pokuša /gate/999) je prikazivao Next.js-ov generički, brendirano-
// prazan 404 ekran. Ovo je server komponenta (nema potrebe za 'use
// client' — čisto statičan sadržaj) koja se automatski prikazuje na
// SVAKOJ ruti u aplikaciji kad ništa ne odgovara (Next.js App Router
// konvencija), bez ikakvog dodatnog koda na pojedinačnim stranicama.
import Link from 'next/link';
import { Plane, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0B1220] text-white flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-sky-500/15 flex items-center justify-center mx-auto mb-6">
          <Plane className="w-8 h-8 text-sky-400" />
        </div>
        <div className="text-6xl font-black tracking-tight mb-3 text-sky-400">404</div>
        <h1 className="text-xl font-bold mb-3">Stranica nije pronađena</h1>
        <p className="text-slate-400 text-sm mb-8">
          Traženi let... odnosno stranica, ne postoji ili je premještena.
          Page not found.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold transition-colors"
        >
          <Home className="w-4 h-4" /> Nazad na početnu
        </Link>
      </div>
    </div>
  );
}
