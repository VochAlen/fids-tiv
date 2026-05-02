// lib/init-auto-reset.ts
//
// Pokreće server-side interval koji poziva /api/admin/auto-reset svakih 60s.
// Zamijenjen broken startAutoResetTimer() koji nije radio ništa korisno.

let isInitialized = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const BASE_URL = (() => {
  const raw = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  if (raw.startsWith('http')) return raw.replace(/\/$/, '');
  return `https://${raw.replace(/\/$/, '')}`;
})();

export function initAutoReset() {
  if (isInitialized) {
    console.log('⚠️ Auto-reset već inicijalizovan');
    return;
  }

  if (typeof window !== 'undefined') {
    console.log('⏭️ Skipping auto-reset init on client-side');
    return;
  }

  console.log('🚀 Inicijalizacija auto-reset sistema...');

  const run = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/admin/cleanup-overrides`, {
        method: 'POST',
        cache: 'no-store'
      });
      const data = await res.json();
      if (data.resetCount > 0) {
        console.log(`[init-auto-reset] ✅ Resetovano ${data.resetCount} polja:`,
          data.details?.map((d: any) => `${d.flightNumber}/${d.field}`).join(', '));
      }
    } catch (err) {
      console.error('[init-auto-reset] Greška:', err);
    }
  };

  // Pokreni odmah jednom, zatim svakih 60s
  run();
  intervalHandle = setInterval(run, 60 * 1000);
  isInitialized = true;

  console.log('✅ Auto-reset timer uspješno pokrenut (interval: 60s)');
}

export function stopAutoReset() {
  if (intervalHandle) clearInterval(intervalHandle);
  isInitialized = false;
  intervalHandle = null;
  console.log('🛑 Auto-reset timer zaustavljen');
}