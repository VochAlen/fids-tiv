// hooks/useAdImages.ts
'use client';

import { useState, useEffect } from 'react';

const FALLBACK_IMAGES = [
  'https://images.pexels.com/photos/346885/pexels-photo-346885.jpeg',
  'https://images.pexels.com/photos/1058277/pexels-photo-1058277.jpeg',
  'https://images.pexels.com/photos/1659438/pexels-photo-1659438.jpeg',
];

const LOCAL_IMAGE_PATHS = [
  '/reklame/ad1.jpg',
  '/reklame/ad2.jpg',
  '/reklame/ad3.jpg',
  '/reklame/ad4.jpg',
  '/reklame/ad5.jpg',
   '/reklame/ad6.jpg',

];

export function useAdImages() {
  const [adImages, setAdImages] = useState<string[]>(FALLBACK_IMAGES);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkLocalImages = async () => {
      try {
        setIsLoading(true);
        const availableImages: string[] = [];

        // Check each local image path
        for (const imagePath of LOCAL_IMAGE_PATHS) {
          try {
            const response = await fetch(imagePath, { method: 'HEAD' });
            if (response.ok) {
              availableImages.push(imagePath);
              console.log(`✅ Found local image: ${imagePath}`);
            }
          } catch (error) {
            console.log(`❌ Local image not found: ${imagePath}`);
          }
        }

        // Use local images if available, otherwise fallback
        if (availableImages.length > 0) {
          console.log(`🎉 Using ${availableImages.length} local ad images`);
          setAdImages(availableImages);
        } else {
          console.log('📁 No local ad images found, using fallback images');
          setAdImages(FALLBACK_IMAGES);
        }
      } catch (error) {
        console.error('❌ Error checking local images:', error);
        setAdImages(FALLBACK_IMAGES);
      } finally {
        setIsLoading(false);
      }
    };

    checkLocalImages();
  }, []);

  return { adImages, isLoading };
}