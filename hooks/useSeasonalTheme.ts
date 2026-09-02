// hooks/useSeasonalTheme.ts
import { useMemo } from 'react';

export type Theme = 'default' | 'christmas';

export function useSeasonalTheme(): Theme {
  return useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // Sezonski period: 5. decembra - 10. januara
    const seasonStart = new Date(currentYear, 11, 5); // 5. decembar
    const seasonEnd = new Date(currentYear + 1, 0, 10); // 10. januar sledeće godine
    
    // Proverite da li smo u sezonskom periodu
    const isInSeason = today >= seasonStart && today <= seasonEnd;
    
    return isInSeason ? 'christmas' : 'default';
  }, []);
}

// Dodatna funkcija za druge praznike
export function useHolidayTheme(): string {
  return useMemo(() => {
    const today = new Date();
    const month = today.getMonth() + 1;
    const date = today.getDate();
    
    // Novogodišnja sezona: 5.12 - 10.1
    if ((month === 12 && date >= 5) || (month === 1 && date <= 15)) {
      return 'christmas';
    }
    
    // Uskršnja sezona: 1.4 - 30.4
    if (month === 4) {
      return 'easter';
    }
    
    // Letnja sezona: 1.6 - 31.8
    if (month >= 6 && month <= 8) {
      return 'summer';
    }
    
    // Jesenja sezona: 1.9 - 30.11
    if (month >= 9 && month <= 11) {
      return 'autumn';
    }
    
    return 'default';
  }, []);
}