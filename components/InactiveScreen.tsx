'use client';

// components/InactiveScreen.tsx
//
// Zajednički "inactive" ekran za SVE javne prikaze (odlasci, dolasci, split board, kombinovani,
// prtljag, gate): isti izgled kao neaktivni šalter u CheckInPageClient (pozadina aerodroma +
// zatamnjena kartica). Koristi se umjesto crnog/jednobojnog ekrana dok se stranica učitava poslije
// restarta kioska ili dok se veza obnavlja, tako da posjetilac nikad ne vidi prazan crn ekran.
//
// Namjerno bez next/image i bez mrežnih poziva: običan <img> sa bojom pozadine kao rezervom —
// ako slika ne postoji, ekran je i dalje tamno-plav (ne crn) sa karticom i satom.

import { useEffect, useState } from 'react';
import { Plane } from 'lucide-react';

interface InactiveScreenProps {
  /** Glavni tekst (npr. "Reconnecting…", "Loading…"). */
  message?: string;
  /** Sitniji tekst ispod (npr. tekst greške). */
  detail?: string;
}

export default function InactiveScreen({ message = 'Loading…', detail }: InactiveScreenProps) {
  const [isPortrait, setIsPortrait] = useState(false);
  const [time, setTime] = useState('');

  useEffect(() => {
    const onResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  const wallpaper = isPortrait ? '/wallpaper.jpg' : '/wallpaper-landscape.jpg';

  return (
    <div className="h-screen w-full relative overflow-hidden bg-slate-900 select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={wallpaper} alt="" className="absolute inset-0 w-full h-full object-cover" decoding="async" />
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative z-10 h-full flex items-center justify-center p-4 text-white">
        <div className="text-center bg-slate-800/80 rounded-3xl p-8 sm:p-12 border border-white/20 shadow-2xl w-full max-w-3xl">
          <Plane className="w-16 h-16 sm:w-24 sm:h-24 text-white/60 mx-auto mb-4 sm:mb-6 animate-pulse" />
          <div className="font-black text-orange-400 tabular-nums leading-none mb-3 sm:mb-5" style={{ fontSize: 'clamp(3rem, 9vw, 7rem)' }}>
            {time || '--:--'}
          </div>
          <div className="text-xl sm:text-3xl font-bold text-white/80">{message}</div>
          {detail ? <div className="text-sm sm:text-lg text-white/40 mt-3">{detail}</div> : null}
        </div>
      </div>
    </div>
  );
}
