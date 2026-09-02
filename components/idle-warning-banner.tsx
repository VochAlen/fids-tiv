// components/idle-warning-banner.tsx
// Prikazuje se 30s prije automatske odjave zbog neaktivnosti (vidi
// hooks/use-idle-logout.ts). Bilo koja aktivnost (miš, dodir, skrol,
// tastatura) odmah uklanja banner i restartuje 3-minutni tajmer — ovo je
// samo vizuelna najava, ne blokira rad.
export function IdleWarningBanner({ secondsLeft }: { secondsLeft: number | null }) {
  if (secondsLeft === null) return null;
  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[200] bg-yellow-600 text-white text-center py-2 text-sm font-medium shadow-lg animate-pulse"
    >
      Sesija se automatski zatvara za {secondsLeft}s zbog neaktivnosti — pomjerite miš ili dodirnite ekran da ostanete prijavljeni.
    </div>
  );
}
