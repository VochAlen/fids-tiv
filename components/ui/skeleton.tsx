// components/ui/skeleton.tsx
//
// FIX (po zahtjevu — portovano iz glavnog sistema, dodato jer ovaj
// Ably projekat do sad nije imao components/ui/ folder uopšte): minimalna,
// samostalna verzija — bez ikakve nove zavisnosti (nema shadcn/ui CLI,
// nema clsx/tailwind-merge), samo goli Tailwind. Koristi se u
// AdminDashboardClient.tsx kao placeholder dok se statistika letova
// učitava.
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-white/10 ${className}`}
      aria-hidden="true"
    />
  );
}
