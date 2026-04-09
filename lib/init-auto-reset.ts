// lib/init-auto-reset.ts
import { startAutoResetTimer } from '@/lib/override-utils';

let isInitialized = false;

export function initAutoReset() {
  if (isInitialized) {
    console.log('⚠️ Auto-reset već inicijalizovan');
    return;
  }
  
  console.log('🚀 Inicijalizacija auto-reset sistema...');
  
  if (typeof window !== 'undefined') {
    console.log('⏭️ Skipping auto-reset init on client-side');
    return;
  }
  
  startAutoResetTimer();
  isInitialized = true;
  console.log('✅ Auto-reset timer uspješno pokrenut (non-stop)');
}