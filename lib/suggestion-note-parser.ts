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
//   "T1 ne radi" / "radovi u T1" (blokira sve šaltere i gate-ove terminala; i "do 14:00")
//   "T2 radi" / "koristi T2" (ukida zimsko pravilo "prvenstveno T1")
//   "šalter 5 ne radi još 30 min" / "gate 3 kvar 2 sata" / "pola sata" (trajanje od SADA — traži nowMin)
//   "šalter 5 i gate 3 ne rade" (miješani tipovi), "šalter 5 ne radi do 14, 6 ne radi od 15" (različita vremena)
//   Sitne slovne greške u ključnim riječima ("slater", "zatvroen") se ispravljaju (razmak ≤1 slovo).
// Ključne riječi za blokadu: ne radi/ne rade, kvar/u kvaru, pokvaren, zatvoren,
// van funkcije, nedostupan, ne koristi.

import { sanitizeConstraints, type SuggestionConstraints } from '@/lib/suggestion-constraints';
import { DESKS, GATES, deskTerminal } from '@/lib/assignment-suggestions';

export interface NoteParseResult {
  constraints: SuggestionConstraints;
  unparsed: string[];
}

const BLOCK_RE = /\b(ne\s+rad\w*|kvar\w*|u\s+kvaru|pokvaren\w*|zatvoren\w*|van\s+funkcij\w*|nedostup\w*|ne\s+koristi\w*|blokiran\w*)/;
// Riječi zbog kojih parser NE SMIJE pogađati (negacija, izuzetak, "prije/poslije", opisna vremena,
// kašnjenje/otkaz): fraza ide u `unparsed` da je osoblje provjeri, umjesto da tiho uradi suprotno.
const AMBIGUOUS_RE = /\b(ne\s+na|bez|osim|ali|umjesto|prije|poslije|nakon|podne|ponoc|kasni\w*|otkaz\w*)\b/;
const WORD_NUM: Record<string, number> = { jedan: 1, jedna: 1, dva: 2, dvije: 2, tri: 3, cetiri: 4, pet: 5, sest: 6 };

/** Mala slova + bez dijakritika (š→s, č/ć→c, đ→d, ž→z). */
const fold = (s: string) =>
  s.toLowerCase().replace(/š/g, 's').replace(/[čć]/g, 'c').replace(/đ/g, 'd').replace(/ž/g, 'z');

function clock(h: string, m?: string): string | null {
  const hh = +h, mm = m ? +m : 0;
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : null;
}

// Ključne riječi za ispravku slovnih grešaka (razmak 1: zamjena/umetanje/brisanje/zamjena susjednih slova).
const VOCAB = ['salter', 'salteri', 'salteru', 'pokvaren', 'zatvoren', 'nedostupan', 'terminal', 'terminalu', 'radovi', 'funkcije', 'koristi', 'blokiran'];
function near1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = -1, n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (++n > 2) return false; if (diff < 0) diff = i; }
    if (n === 1) return true;
    // zamjena susjednih slova ("slater" → "salter")
    return n === 2 && a[diff] === b[diff + 1] && a[diff + 1] === b[diff];
  }
  const [lo, sh] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < lo.length; i++) if (lo.slice(0, i) + lo.slice(i + 1) === sh) return true;
  return false;
}
function fixTypos(c: string): string {
  return c.replace(/[a-z]{5,}/g, w => (VOCAB.includes(w) ? w : VOCAB.find(v => near1(w, v)) ?? w));
}

const TYPE_WORD = String.raw`(?:salter\w*|desk\w*|gate\w*|gejt\w*|kapij\w*|izlaz\w*)`;
const TYPE_SPLIT_RE = new RegExp(String.raw`(?=\b${TYPE_WORD}\b)`);
const hasTypeWord = (c: string) => new RegExp(String.raw`\b${TYPE_WORD}\b`).test(c);
const isGateWord = (c: string) => /\b(gate\w*|gejt\w*|kapij\w*|izlaz\w*)\b/.test(c);
const isDeskWord = (c: string) => /\b(salter\w*|desk\w*)\b/.test(c);

/**
 * Priprema fraze: (1) "šalter 5, gate 3 ne rade" → spaja fraze koje dijele isto "ne rade",
 * (2) miješani tipovi "šalter 5 i gate 3 ne rade" → posebna fraza za svaki tip,
 * (3) više "ne radi" u jednoj frazi sa različitim vremenima → posebne fraze.
 */
function expandClauses(clauses: string[]): Array<{ original: string; c: string }> {
  const merged: string[] = [];
  for (let i = 0; i < clauses.length; i++) {
    const cur = clauses[i], next = clauses[i + 1];
    if (next !== undefined && !BLOCK_RE.test(fold(cur)) && hasTypeWord(fold(cur)) && BLOCK_RE.test(fold(next)) && hasTypeWord(fold(next))) {
      merged.push(`${cur} i ${next}`); i++;
    } else merged.push(cur);
  }
  const out: Array<{ original: string; c: string }> = [];
  for (const original of merged) {
    const c = fold(original);
    const bm = c.match(BLOCK_RE);
    // (2) miješani tipovi + blokada
    if (bm && isGateWord(c) && isDeskWord(c)) {
      const segs = c.split(TYPE_SPLIT_RE).map(x => x.replace(/\s+i\s*$/, '').trim()).filter(Boolean);
      const last = segs[segs.length - 1];
      const tail = last.slice(last.search(BLOCK_RE) >= 0 ? last.search(BLOCK_RE) : last.length);
      if (segs.length >= 2 && tail) {
        for (const sg of segs) out.push({ original, c: BLOCK_RE.test(sg) ? sg : `${sg} ${tail}` });
        continue;
      }
    }
    // (3) više blokada sa zarezom: "5 ne radi do 14, 6 ne radi od 15"
    if (bm && (c.match(new RegExp(BLOCK_RE.source, 'g')) ?? []).length > 1 && c.includes(',')) {
      const parts = c.split(/,\s*/);
      const groups: string[] = [];
      for (const part of parts) {
        const prev = groups[groups.length - 1];
        if (prev !== undefined && BLOCK_RE.test(prev) && /\d/.test(part)) groups.push(part);
        else groups[groups.length ? groups.length - 1 : 0] = prev === undefined ? part : `${prev}, ${part}`;
      }
      if (groups.length >= 2) {
        // naslijedi vrstu ("šalter"/"gate") iz prethodne grupe ako je nova nema
        let inherited = '';
        for (const g of groups) {
          const w = g.match(new RegExp(TYPE_WORD))?.[0];
          if (w) inherited = w;
          out.push({ original, c: hasTypeWord(g) || !inherited ? g : `${inherited} ${g}` });
        }
        continue;
      }
    }
    out.push({ original, c });
  }
  return out;
}

const LEFTOVER_CLOCK_RE = /\d{1,2}\s*[:.]\s*\d{2}|\b\d{1,2}\s?(?:h|sati|sata|sat)\b|\bu\s+\d{1,2}\b/;

/** `nowMin` (minute od ponoći) omogućava trajanja ("još 30 min", "2 sata", "pola sata"); bez njega takve fraze idu u unparsed. */
export function parseSuggestionNote(text: string, knownFlights: string[] = [], nowMin?: number): NoteParseResult {
  const known = new Set(knownFlights.map(f => f.toUpperCase().replace(/\s+/g, '')));
  const raw = { blocked: [] as unknown[], pins: [] as unknown[], counts: [] as unknown[], t2: false };
  const unparsed: string[] = [];

  const clauses = text
    .split(/[;\n]+|\.\s+|,\s*(?=(?:salter|šalter|desk|gate|gejt|kapij|[a-z0-9]{2}\s?\d{1,4}\b))/i)
    .map(c => c.trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const { original, c: folded } of expandClauses(clauses).slice(0, 20)) {
    let c = fixTypos(folded);

    // 0) nejasne fraze (negacija, "prije/poslije", više letova u jednoj frazi) se ne pogađaju
    const flightsInClause = [...c.matchAll(/\b([a-z0-9]{2})\s?(\d{1,4}[a-z]?)\b/g)]
      .filter(m => /[a-z]/.test(m[1]) && known.has(`${m[1]}${m[2]}`.toUpperCase()));
    if (AMBIGUOUS_RE.test(c) || new Set(flightsInClause.map(m => `${m[1]}${m[2]}`)).size > 1) {
      unparsed.push(original.slice(0, 120));
      continue;
    }

    // 1) vremena: "od 9:30", "do 14"
    let from: string | null = null, to: string | null = null;
    c = c.replace(/\bod\s+(\d{1,2})(?:[:.h](\d{2}))?(?!\d)/, (_m, h, m) => { from = clock(h, m); return ' '; });
    c = c.replace(/\bdo\s+(\d{1,2})(?:[:.h](\d{2}))?(?!\d)/, (_m, h, m) => { to = clock(h, m); return ' '; });

    // 1a) trajanje od sada (samo uz blokadu): "još 30 min", "2 sata", "pola sata"
    let durationMin: number | null = null;
    if (BLOCK_RE.test(c) && to === null) {
      c = c.replace(/\b(?:jos\s+|narednih\s+|sljedecih\s+|slijedecih\s+)?(?:(pola\s+sata)|(\d{1,3})\s*(min\w*)|(\d{1,2})\s*(h|sat\w*))(?=\s|$)/, (_m, half, mn, _u, hr) => {
        durationMin = half ? 30 : mn ? +mn : +hr * 60; return ' ';
      });
      if (durationMin !== null) {
        if (nowMin === undefined || durationMin < 1 || durationMin > 720) { unparsed.push(original.slice(0, 120)); continue; }
        const end = (nowMin + durationMin) % 1440;
        to = clock(String(Math.floor(end / 60)), String(end % 60));
      }
    }

    // 1b) terminal: "T1 ne radi", "radovi u terminalu 1", "T2 radi"
    const tm = c.match(/\b(?:terminal\w*|term|t)\s?([12])\b/);
    if (tm) {
      const term = tm[1] === '1' ? 'T1' : 'T2';
      if (BLOCK_RE.test(c) || /\bradov\w*/.test(c)) {
        for (const id of DESKS.filter(d => deskTerminal(d) === term)) raw.blocked.push({ type: 'desk', id, from, to });
        for (const id of GATES.filter(g => deskTerminal(g) === term)) raw.blocked.push({ type: 'gate', id, from, to });
        continue;
      }
      if (term === 'T2' && /\b(radi|otvoren\w*|koristi\w*|aktivan\w*|u\s+funkcij\w*|u\s+upotrebi)\b/.test(c)) {
        raw.t2 = true;
        continue;
      }
    }

    // 1c) ostalo vrijeme koje nismo razumjeli ("ne radi u 14:00", "14h") → ne pogađaj, pusti osoblju da provjeri
    if (LEFTOVER_CLOCK_RE.test(c.replace(/\b([a-z0-9]{2})\s?(\d{1,4}[a-z]?)\b/g, m => (known.has(m.replace(/\s+/g, '').toUpperCase()) ? ' ' : m)))) {
      unparsed.push(original.slice(0, 120));
      continue;
    }

    // 2) broj leta (samo poznati letovi sa rasporeda)
    let flight: string | null = null;
    c = c.replace(/\b([a-z0-9]{2})\s?(\d{1,4}[a-z]?)\b/g, (m, code: string, num: string) => {
      const cand = `${code}${num}`.toUpperCase();
      if (!flight && /[a-z]/.test(code) && known.has(cand)) { flight = cand; return ' '; }
      return m;
    });

    const type: 'desk' | 'gate' = isGateWord(c) ? 'gate' : 'desk';

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
  const rawTotal = Math.min(raw.blocked.length, 40) + raw.pins.length + raw.counts.length;
  if (rawTotal > total && unparsed.length === 0) unparsed.push('neki šalteri/gate-ovi ne postoje i preskočeni su');
  return { constraints, unparsed: unparsed.slice(0, 5) };
}
