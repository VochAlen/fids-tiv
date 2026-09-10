'use client';

// app/error.tsx
//
// FIX (2026 UI/UX prolaz — praznina u production-readiness): do sad NI
// JEDNA ruta u aplikaciji nije imala error.tsx — svaki neuhvaćen JS
// error tokom renderovanja (npr. neočekivan oblik podataka sa API-ja)
// je prikazivao Next.js-ov generički error overlay (u dev-u) ili prazan
// bijeli ekran (u produkciji). Ovo je Next.js App Router konvencija —
// automatski hvata greške na SVAKOJ ruti bez ikakvog dodatnog koda na
// pojedinačnim stranicama.
//
// VAŽNA ODLUKA — različito ponašanje za kiosk vs. admin/PA rute: kiosk
// ekrani (gate/checkin/departures/combined/itd.) rade BEZ NADZORA 24/7
// — generičko "Pokušaj ponovo" dugme bi tu bilo beskorisno (niko nije
// fizički prisutan da ga klikne, ekran bi ostao zaglavljen na grešci
// dovijeka). Za te rute, ovaj boundary se SAM automatski reload-uje
// nakon kratke pauze. Za admin/PA rute (gdje JE čovjek prisutan), radi
// standardno — ručno dugme "Pokušaj ponovo".
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, RotateCw } from 'lucide-react';

const KIOSK_PATH_PREFIXES = [
  '/gate', '/checkin', '/departures', '/arrivals', '/combined',
  '/border', '/baggage', '/split-board', '/security', '/ver2', '/pa',
];

const AUTO_RELOAD_DELAY_MS = 5000;

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const isKiosk = KIOSK_PATH_PREFIXES.some(p => pathname?.startsWith(p));

  useEffect(() => {
    // Ide u Vercel Function Logs (server-side dio) i browser konzolu —
    // jedini trag ove greške pošto kiosk ekrani nemaju nikog da gleda
    // ekran u trenutku pada.
    console.error('[error.tsx] Uhvaćena greška na ruti', pathname, error);
  }, [error, pathname]);

  useEffect(() => {
    if (!isKiosk) return;
    const id = setTimeout(() => window.location.reload(), AUTO_RELOAD_DELAY_MS);
    return () => clearTimeout(id);
  }, [isKiosk]);

  if (isKiosk) {
    // Namjerno minimalističan, tamna tema (usklađeno sa kiosk ekranima)
    // — ovo se NE očekuje da iko vidi uživo, samo kratak tranzitni
    // ekran prije automatskog reload-a.
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
        <div className="text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4 opacity-70" />
          <div className="text-slate-400 text-sm">Ponovno učitavanje ekrana...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1220] text-white flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold mb-3">Nešto je pošlo po zlu</h1>
        <p className="text-slate-400 text-sm mb-8">
          Došlo je do neočekivane greške. Pokušaj ponovo — ako se greška
          ponavlja, obavijesti tehničku podršku.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold transition-colors"
        >
          <RotateCw className="w-4 h-4" /> Pokušaj ponovo
        </button>
      </div>
    </div>
  );
}
