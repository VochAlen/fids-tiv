'use client';

import { useEffect, useRef } from 'react';

export default function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const videoPreloadRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    // Preload video u pozadini
    const video = document.createElement('video');
    video.preload = 'auto';
    video.src = '/security.mp4';
    video.muted = true;
    video.playsInline = true;
    
    // Počni učitavati video odmah
    video.load();
    
    // Sačuvaj referencu
    videoPreloadRef.current = video;
    
    // Opciono: kada se video učita, možete ga zaustaviti
    // FIX (memory leak): { once: true } garantuje da browser SAM ukloni
    // listener nakon prvog okidanja — ranije je listener bio trajno
    // zakačen na anonimnu funkciju, bez čuvane reference za ručno
    // uklanjanje. Za jedan <video> element po mount-u ovo je mala stvar,
    // ali kod dugotrajnog rada (dani/nedelje bez restarta) i mogućih
    // re-mount-ova (npr. Fast Refresh tokom razvoja, ili ako se layout
    // ikad ponovo montira), bilo je nepotrebno gomilanje listenera na
    // svaki novo-kreirani <video> element.
    video.addEventListener('canplaythrough', () => {
      console.log('Security video preloaded successfully');
      video.pause(); // Pauziraj nakon učitavanja
    }, { once: true });
    
    return () => {
      // Cleanup
      if (videoPreloadRef.current) {
        videoPreloadRef.current.src = '';
        videoPreloadRef.current = null;
      }
    };
  }, []);

  return <>{children}</>;
}