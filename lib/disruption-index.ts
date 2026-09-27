// lib/disruption-index.ts
//
// NOVO (po zahtjevu — automatski testovi za kritičnu logiku): izdvojeno
// iz app/combined/CombinedPageClientV2.tsx (koji sad uvozi ISTI kod)
// da bi bilo testabilno. Vidi opširan komentar uz computeDisruptionIndex
// niže za pun kontekst formule (nije identična Flightradar24-ovoj
// nepoznatoj internoj formuli, samo razumna aproksimacija istih
// faktora).
export type FlightLike = {
  StatusEN: string | null | undefined;
  ScheduledDepartureTime: string | null | undefined;
  EstimatedDepartureTime: string | null | undefined;
};

export function parseFlightTimeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr) return null
  const s = timeStr.trim()
  if (!s || s === "-" || s === "--:--") return null
  try {
    if (s.includes("T") || (s.includes("-") && s.length > 5)) {
      const d = new Date(s); return isNaN(d.getTime()) ? null : d
    }
    const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
    if (ampm) {
      let h = parseInt(ampm[1], 10); const m = parseInt(ampm[2], 10)
      if (ampm[3].toUpperCase() === "PM" && h !== 12) h += 12
      if (ampm[3].toUpperCase() === "AM" && h === 12) h = 0
      const d = new Date(); d.setHours(h, m, 0, 0)
      if (Date.now() - d.getTime() > 12 * 60 * 60_000) d.setDate(d.getDate() + 1)
      return d
    }
    const sep = s.match(/^(\d{1,2})[:.](\d{2})$/)
    if (sep) {
      const h = parseInt(sep[1], 10); const m = parseInt(sep[2], 10)
      if (h > 23 || m > 59) return null
      const d = new Date(); d.setHours(h, m, 0, 0)
      if (Date.now() - d.getTime() > 12 * 60 * 60_000) d.setDate(d.getDate() + 1)
      return d
    }
    const digits = s.replace(/\D/g, "")
    if (digits.length === 4) {
      const h = parseInt(digits.substring(0, 2), 10); const m = parseInt(digits.substring(2, 4), 10)
      if (h > 23 || m > 59) return null
      const d = new Date(); d.setHours(h, m, 0, 0)
      if (Date.now() - d.getTime() > 12 * 60 * 60_000) d.setDate(d.getDate() + 1)
      return d
    }
    return null
  } catch { return null }
}

// NOVO (po zahtjevu — "Disruption Index" po uzoru na Flightradar24):
// FR24 NIJE objavio tačnu internu formulu — samo tri faktora (broj
// otkazanih letova, procenat/broj zakašnjelih letova, prosječno
// trajanje kašnjenja) i skalu 0.0-5.0. Formula ispod je RAZUMNA,
// transparentna aproksimacija tih faktora — NIJE identična FR24-ovoj
// (nepoznatoj) internoj formuli.
// "Zakašnjeo" ovdje ISKLJUČUJE letove bez STVARNE procjene (Estimated
// === Scheduled, samo placeholder) — isti razlog kao popravka
// prosječnog kašnjenja od ranije ove sesije.
export function computeDisruptionIndex(flights: FlightLike[]): { score: number; cancelled: number; delayed: number; total: number } {
  const total = flights.length;
  if (total === 0) return { score: 0, cancelled: 0, delayed: 0, total: 0 };

  let cancelled = 0;
  let delayed = 0;
  let delaySumMin = 0;

  flights.forEach(f => {
    const s = (f.StatusEN || '').toLowerCase();
    if (/(cancelled|canceled|otkazan)/.test(s)) {
      cancelled++;
      return;
    }
    const sch = parseFlightTimeToDate(f.ScheduledDepartureTime);
    const est = parseFlightTimeToDate(f.EstimatedDepartureTime);
    if (sch && est && est.getTime() !== sch.getTime()) {
      const diffMin = (est.getTime() - sch.getTime()) / 60_000;
      if (diffMin > 0) {
        delayed++;
        delaySumMin += diffMin;
      }
    }
  });

  const cancelRatio = cancelled / total;
  const delayRatio = delayed / total;
  const avgDelayOfDelayed = delayed > 0 ? delaySumMin / delayed : 0;

  const score = Math.min(5.0,
    cancelRatio * 100 * 0.05 +
    delayRatio * 100 * 0.02 +
    avgDelayOfDelayed * 0.05
  );

  return { score: Math.round(score * 10) / 10, cancelled, delayed, total };
}

export function disruptionLevel(score: number): { label: string; color: string } {
  // Engleski naziv, tačno prema Flightradar24 skali.
  if (score < 2.0) return { label: 'Good traffic flow', color: 'text-emerald-400' };
  if (score < 3.5) return { label: 'Minor problems', color: 'text-amber-400' };
  return { label: 'Major problems', color: 'text-red-400' };
}
