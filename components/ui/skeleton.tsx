// components/ui/skeleton.tsx
//
// Reusable skeleton-loading komponenta — standardan 2026 UX obrazac
// (prikazuje OBLIK sadržaja koji dolazi, umjesto generičkog spinnera
// koji ne govori ništa o tome ŠTA se učitava). Namjerno malen,
// samostalan fajl (bez ijedne eksterne zavisnosti) — NIJE isto što i
// obrisani components/ui/ shadcn scaffold iz ranijeg čišćenja bundle-a
// (taj je bio 31 neiskorišćen fajl vezan za 26 Radix paketa; ovaj je
// jedna, stvarno korišćena, ~10-linijska komponenta bez ijedne nove
// zavisnosti — nula uticaja na bundle veličinu).
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-400/25 ${className}`}
      aria-hidden="true"
    />
  );
}
