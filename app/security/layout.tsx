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
    video.addEventListener('canplaythrough', () => {
      console.log('Security video preloaded successfully');
      video.pause(); // Pauziraj nakon učitavanja
    });
    
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