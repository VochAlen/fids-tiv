// lib/get-client-ip.ts
//
// FIX (KRITIČNO — bezbjednosni detalj, isti razlog kao
// middleware.ts-ova getClientIp, sad izdvojen ovdje da ga i login
// rate limiter može koristiti bez duplirane logike): Vercel-ova
// ivična mreža DODAJE stvarnu IP adresu klijenta kao POSLEDNJI unos u
// x-forwarded-for — sve PRIJE toga je ono što je KLIJENT SAM poslao
// (može biti lažirano). Uzimanje PRVOG unosa (čest, naivan propust)
// bi omogućilo napadaču da sam postavi header sa lažnom IP adresom.
export function getClientIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for');
  if (!xff) return null;
  const parts = xff.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}
