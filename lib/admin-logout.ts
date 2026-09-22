// lib/admin-logout.ts
//
// FIX (po zahtjevu — prijavljeno "ne mogu da se odjavim, traje
// predugo" na app/admin/assign-checkin/page.tsx): sva tri mjesta koja
// rade admin logout (assign-checkin, AdminDashboardClient, layout.tsx
// idle-logout tajmer) su radila `await fetch('/api/admin/logout')`
// BEZ ikakvog timeout-a. Sama /api/admin/logout ruta je trivijalna
// (samo briše cookie, bez mrežnih poziva), ali fetch() sam po sebi
// nema podrazumijevani timeout — ako je konekcija u tom trenutku
// degradirana iz BILO KOG razloga (npr. spora mreža, ili privremena
// nestabilnost povezana sa Ably rekonekcijom u istom tabu), await bi
// čekao NEODREĐENO dugo prije nego što se pokrene redirect, jer je
// redirect bio POSLIJE await-a. Sad: fetch ima tvrd 2s timeout preko
// AbortController-a — ako server ne odgovori na vrijeme, ionako
// odmah radimo redirect (cookie briše i server strana middleware-a,
// ali i sam login-stranica ne oslanja se na to da je stari cookie
// nužno već obrisan — provjerava sopstvenu sesiju iznova).
export function logoutAndRedirect(): void {
  // Očisti lokalno keširane podatke prije redirekta — dobra praksa za
  // admin odjavu, bez obzira na ishod mrežnog poziva ispod.
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    // Privatni/incognito način rada ponekad baca na ovo — nebitno,
    // nastavljamo na redirect svejedno.
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2_000);

  fetch('/api/admin/logout', { method: 'POST', signal: controller.signal })
    .catch(() => {
      // Tiho — bez obzira na ishod (uspjeh, timeout, mrežna greška),
      // redirect ispod se svakako dešava.
    })
    .finally(() => {
      clearTimeout(timeoutId);
      // NAMJERNO window.location umjesto router.push — na auth
      // granicama (login/logout) želimo PUN reload, ne soft
      // (client-side) navigaciju. Next.js App Router Router Cache
      // može vratiti KEŠIRANU instancu admin stranice (sa starim
      // React state-om i realtime hook-ovima zaglavljenim na stanju
      // prije logout-a) ako se korisnik vrati na tu rutu unutar cache
      // prozora — pun reload to izbjegava.
      window.location.href = '/admin/login';
    });
}
