// lib/suggestion-note-parser.ts
//
// NOVO (2026-10-08): čitanje NAPOMENE osoblja bez LLM-a (besplatno, bez mreže,
// radi u pregledaču). Prepoznaje kratke fraze i pretvara ih u ograničenja
// (lib/suggestion-constraints.ts). Što ne prepozna, vraća kao `unparsed`.
//
// PODRŽANE FRAZE (odvajaju se zarezom, tačka-zarezom ili novim redom):
//   "šalter 12 ne radi"            "šalter 12 ne radi do 14:00"
//   "šalteri 10, 11 ne rade od 9:30"   "gate 5 u kvaru"   "šalter 10-12 ne radi"
//   "LY1234 na 10 i 11"            "LY1234 šalter 10, 11"    "TK1085 gate 6"
//   "LY1234 2 šaltera"             "JU681 jedan šalter"
// Ključne riječi za blokadu: ne radi/ne rade, kvar/u kvaru, pokvaren, zatvoren,
// van funkcije, nedostupan, ne koristi.

import { sanitizeConstraints, type SuggestionConstraints } from '@/lib/suggestion-constraints';

export interface NoteParseResult {
  constraints: SuggestionConstraints;
  unparsed: string[];
}

const BLOCK_RE = /\b(ne\s+rad\w*|kvar\w*|u\s+kvaru|pokvaren\w*|zatvoren\w*|van\s+funkcij\w*|nedostup\w*|ne\s+koristi\w*|blokiran\w*)/;
const WORD_NUM: Record<string, number> = { jedan: 1, jedna: 1, dva: 2, dvije: 2, tri: 3, cetiri: 4, pet: 5, sest: 6 };

/** Mala slova + bez dijakritika (š→s, č/ć→c, đ→d, ž→z). */
const fold = (s: string) =>
  s.toLowerCase().replace(/š/g, 's').replace(/[čć]/g, 'c').replace(/đ/g, 'd').replace(/ž/g, 'z');

function clock(h: string, m?: string): string | null {
  const hh = +h, mm = m ? +m : 0;
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : null;
}

export function parseSuggestionNote(text: string, knownFlights: string[] = []): NoteParseResult {
  const known = new Set(knownFlights.map(f => f.toUpperCase().replace(/\s+/g, '')));
  const raw = { blocked: [] as unknown[], pins: [] as unknown[], counts: [] as unknown[] };
  const unparsed: string[] = [];

  const clauses = text
    .split(/[;\n]+|\.\s+|,\s*(?=(?:salter|šalter|desk|gate|gejt|kapij|[a-z0-9]{2}\s?\d{1,4}\b))/i)
    .map(c => c.trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const original of clauses) {
    let c = fold(original);

    // 1) vremena: "od 9:30", "do 14"
    let from: string | null = null, to: string | null = null;
    c = c.replace(/\bod\s+(\d{1,2})(?:[:.h](\d{2}))?(?!\d)/, (_m, h, m) => { from = clock(h, m); return ' '; });
    c = c.replace(/\bdo\s+(\d{1,2})(?:[:.h](\d{2}))?(?!\d)/, (_m, h, m) => { to = clock(h, m); return ' '; });

    // 2) broj leta (samo poznati letovi sa rasporeda)
    let flight: string | null = null;
    c = c.replace(/\b([a-z0-9]{2})\s?(\d{1,4}[a-z]?)\b/g, (m, code: string, num: string) => {
      const cand = `${code}${num}`.toUpperCase();
      if (!flight && /[a-z]/.test(code) && known.has(cand)) { flight = cand; return ' '; }
      return m;
    });

    const type: 'desk' | 'gate' = /\b(gate|gejt|kapij\w*|izlaz\w*)\b/.test(c) ? 'gate' : 'desk';

    // 3) broj šaltera ("2 šaltera", "jedan šalter") — samo uz let
    let count: number | null = null;
    if (flight && type === 'desk') {
      c = c.replace(/\b(\d|jedan|jedna|dva|dvije|tri|cetiri|pet|sest)\s+salter\w*/, (_m, n: string) => {
        count = /^\d$/.test(n) ? +n : WORD_NUM[n] ?? null; return ' ';
      });
    }

    // 4) lista resursa: "10-12", "10, 11 i 12"
    const ids: string[] = [];
    c = c.replace(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/g, (_m, a: string, b: string) => {
      const lo = Math.min(+a, +b), hi = Math.max(+a, +b);
      if (hi - lo <= 12) for (let i = lo; i <= hi; i++) ids.push(String(i));
      return ' ';
    });
    for (const m of c.matchAll(/\b(\d{1,2})\b/g)) ids.push(m[1]);

    const isBlock = BLOCK_RE.test(c);
    let recognized = false;

    if (isBlock && ids.length) {
      for (const id of [...new Set(ids)]) {
        raw.blocked.push({ type, id, from, to });
      }
      recognized = true;
    } else if (flight && count) {
      raw.counts.push({ flight, count });
      recognized = true;
    } else if (flight && ids.length) {
      raw.pins.push({ type, flight, resources: [...new Set(ids)] });
      recognized = true;
    }
    if (!recognized) unparsed.push(original.slice(0, 120));
  }

  // sanitize provjerava resurse (1–12, 21–26 / gate-ove) i letove
  const constraints = sanitizeConstraints(raw, [...known]);
  const total = constraints.blocked.length + constraints.pins.length + constraints.counts.length;
  const rawTotal = raw.blocked.length + raw.pins.length + raw.counts.length;
  if (rawTotal > total && unparsed.length === 0) unparsed.push('neki šalteri/gate-ovi ne postoje i preskočeni su');
  return { constraints, unparsed: unparsed.slice(0, 5) };
}
