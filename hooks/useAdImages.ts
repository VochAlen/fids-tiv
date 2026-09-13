// hooks/useAdImages.ts
'use client';

import { useState } from 'react';

const LOCAL_IMAGE_PATHS = [
  '/reklame/ad1.avif',
  '/reklame/ad2.avif',
  '/reklame/ad3.avif',
  '/reklame/ad4.avif',
  '/reklame/ad5.avif',
  '/reklame/ad6.avif',
];

export function useAdImages() {
  const [adImages] = useState<string[]>(LOCAL_IMAGE_PATHS);
  return { adImages, isLoading: false };
}