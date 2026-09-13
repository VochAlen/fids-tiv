'use client';

// hooks/use-theme.ts
//
// Dijeljen dark/light theme hook — koristi ga app/HomeClient.tsx i
// app/pa/PaPageClient.tsx. Pamćenje preferencije je PO STRANICI
// (odvojen localStorage ključ za svaku), ne globalno — po zahtjevu,
// PA stranica ima SVOJ default (light), nezavisno od bilo koje druge
// stranice koja bi kasnije mogla koristiti isti hook sa drugim
// podrazumijevanim stanjem.
//
// NAMJERNO se NE koristi na kiosk ekranima (gate/checkin/departures/
// combined/itd.) — oni imaju svoju fiksnu, već ustaljenu vizuelnu
// temu i ne treba im korisnički prekidač.
import { useState, useEffect, useCallback } from 'react';

export function useTheme(storageKey: string, defaultDark: boolean) {
  const [isDark, setIsDark] = useState(defaultDark);

  // Učitaj sačuvanu preferenciju PRI MOUNT-u (nakon hidratacije, da se
  // izbjegne server/klijent mismatch — prvi render uvijek koristi
  // defaultDark, pa se po potrebi prebaci čim se localStorage pročita).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'dark') setIsDark(true);
      else if (stored === 'light') setIsDark(false);
    } catch {
      // localStorage nedostupan (privatni mod/itd.) — ostani na default-u.
    }
  }, [storageKey]);

  const toggle = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? 'dark' : 'light'); } catch {}
      return next;
    });
  }, [storageKey]);

  return { isDark, toggle };
}
