// lib/init-auto-reset.ts

let isInitialized = false;

export async function initAutoReset() {
  if (isInitialized) {
    console.log('⚠️ Auto-reset već inicijalizovan');
    return;
  }
  
  console.log('🚀 Inicijalizacija auto-reset sistema...');
  
  // Provjeri da li smo na serveru
  if (typeof window !== 'undefined') {
    console.log('⏭️ Skipping auto-reset init on client-side');
    return;
  }
  
  try {
    // Pozovi API da pokrene timer
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/admin/flight-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'startTimer' })
    });
    
    if (response.ok) {
      isInitialized = true;
      console.log('✅ Auto-reset timer uspješno pokrenut (non-stop)');
    } else {
      console.error('❌ Greška pri pokretanju timer-a');
    }
  } catch (err) {
    console.error('❌ Greška pri inicijalizaciji auto-reset-a:', err);
  }
}

export function isTimerRunning() {
  // Ova funkcija se ne koristi, ali ostavljamo radi konzistencije
  return false;
}