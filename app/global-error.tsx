'use client';

// app/global-error.tsx
//
// Next.js App Router konvencija — jedini error boundary koji hvata
// greške u SAMOM ROOT LAYOUT-u (app/layout.tsx), pa MORA definisati
// sopstveni <html>/<body> (zamjenjuje cio root layout kad se aktivira,
// pošto layout koji je pao ne može više da se renderuje). Ovo je
// krajnji, najrjeđi fallback — obično se nikad neće ni aktivirati (sve
// stvarne stranice imaju svoj app/error.tsx koji hvata greške prije
// nego što stignu ovoliko duboko).
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="sr">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0B1220', color: 'white', padding: '2rem', textAlign: 'center',
        }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.75rem' }}>
              Sistem trenutno nije dostupan
            </h1>
            <p style={{ color: '#94A3B8', fontSize: '0.875rem', marginBottom: '2rem' }}>
              Došlo je do ozbiljne greške. Pokušaj ponovo učitati stranicu.
            </p>
            <button
              onClick={reset}
              style={{
                padding: '0.75rem 1.5rem', borderRadius: '0.75rem', border: 'none',
                background: '#0EA5E9', color: 'white', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Pokušaj ponovo
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
