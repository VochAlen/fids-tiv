// lib/radar-callsigns.ts
//
// Ručno potvrđeni callsign-ovi koji NE liče na broj leta (npr. Air Serbia: ASL80X = JU686).
// Dopisuj nove redove po potrebi: 'CALLSIGN': 'BROJ LETA'. Ovo ima prednost nad svim procjenama.
export const KNOWN_CALLSIGNS: Record<string, string> = {
  ASL80X: 'JU686',
  ASL33T: 'JU682',
};
