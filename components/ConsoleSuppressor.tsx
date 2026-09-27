'use client';

import { useEffect } from 'react';

// ── v5: Production console suppression ────────────────────────
// console.log/debug/info se akumuliraju u Chrome memoriji. Na 24/7
// kiosk ekranima sa desecima log poziva po minuti (weather, Ably,
// flight data), to poslije 24h postaje 50-100MB memorije.
//
// VAŽNO: ovo MORA biti zaseban Client Component (sa 'use client' i
// useEffect). app/layout.tsx je Server Component — kod koji se u
// njemu izvršava na top-level-u (čak i uz `typeof window !== 'undefined'`
// provjeru) izvršava se SAMO na serveru, gdje `window` nikad nije
// definisan, pa taj if-blok nikad ne "puca" ni na serveru ni na
// klijentu. Kad je ovaj kod stajao direktno u layout.tsx, suzbijanje
// logova se u praksi nikad nije aktiviralo u browseru.
//
// console.warn i console.error ostaju netaknuti — važni su za
// dijagnostiku (memory pressure warning, Ably reconnect poruke...).
export function ConsoleSuppressor() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      const noop = () => {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any).log = noop;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any).debug = noop;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any).info = noop;
    }
  }, []);

  return null;
}
