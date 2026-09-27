'use client';

// hooks/use-body-background.ts
//
// FIX (KRITIČNO — bijela pozadina "probija" kroz tamne kiosk ekrane):
// app/globals.css namjerno postavlja --background UVIJEK na bijelu
// (vidi opširan komentar tamo, uveden da popravi "Light tema uopšte
// nije light" bug na admin panelu). Taj komentar je tvrdio da kiosk
// ekrani (check-in, gate, itd.) ovo ne osjećaju, jer navodno imaju
// sopstvenu, punu tamnu pozadinu koja prekriva body ispod — ta tvrdnja
// je POGREŠNA. Na mobilnom/touchscreen uređaju, "elastic" overscroll
// bounce (dostupan i na kiosku, dovoljan je slučajan dodir/skrol)
// otkriva SIROVU body pozadinu ispod stranice, BEZ OBZIRA koliko dobro
// stranica sama pokriva svoj prostor — jer overscroll privremeno
// pomjera CIJELU stranicu, otkrivajući prostor IZVAN nje, koji je
// uvijek html/body pozadina.
//
// Rješenje: svaka kiosk stranica, dok je aktivna, postavlja PRAVU body
// pozadinu direktno (document.body.style.background) — i vraća staru
// vrijednost pri unmount-u, da ne "procuri" na sledeću stranicu ako se
// klijentski navigira dalje bez punog reload-a.
import { useEffect } from 'react';

export function useBodyBackground(color: string) {
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = color;
    return () => {
      document.body.style.background = previous;
    };
  }, [color]);
}
