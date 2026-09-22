'use client';

// hooks/use-theme.ts
//
// Mali, samostalan tema-hook za javne (ne-kiosk) stranice poput
// landing page-a — čuva izbor u localStorage pod zadatim ključem.
// Isti princip kao tema logika na app/admin/assign-checkin: podrazu-
// mijevano stanje se koristi dok korisnik EKSPLICITNO ne sačuva
// suprotan izbor, bez oslanjanja na OS/browser prefers-color-scheme
// (koje bi moglo tiho odstupiti od namjeravanog podrazumijevanog
// izgleda — vidi opširan komentar u assign-checkin/page.tsx za pun
// kontekst tog bug-a).
import { useState, useEffect, useCallback } from 'react';

export function useTheme(storageKey: string, defaultDark: boolean = false) {
  const [isDark, setIsDark] = useState(defaultDark);

  useEffect(() => {
    // NAPOMENA (react-hooks/set-state-in-effect lint pravilo): ovo je
    // namjerno, bezbjedno korišćenje — sinhronizacija state-a sa
    // localStorage (spoljašnji sistem) pri mount-u, sa PRIMITIVNOM
    // (boolean) vrijednošću gdje React-ov ugrađeni Object.is bail-out
    // već sprečava nepotreban re-render. Alternativa (lazy useState
    // initializer koji čita localStorage direktno) bi izbjegla lint
    // upozorenje, ali unosi hydration mismatch rizik (server nema
    // localStorage, klijent ima) — gori, vidljiviji problem od ovog
    // lint upozorenja. Isti princip primijenjen kroz cijelu aplikaciju
    // (vidi npr. app/admin/assign-checkin/page.tsx tema logiku).
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'dark') setIsDark(true);
      else if (stored === 'light') setIsDark(false);
      // Ništa sačuvano — ostaje na defaultDark parametru.
    } catch {
      // localStorage nedostupan (privatni mod, itd.) — ostaje na defaultDark.
    }
  }, [storageKey]);

  const toggle = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? 'dark' : 'light');
      } catch {
        // Nema uticaja na trenutnu sesiju ako čuvanje padne — samo se
        // izbor neće pamtiti za sledeću posjetu.
      }
      return next;
    });
  }, [storageKey]);

  return { isDark, toggle };
}
