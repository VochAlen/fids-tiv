// lib/plan-document.ts
//
// NOVO (2026-10-11): ŠTAMPANI PLAN dodjela — profesionalni aerodromski dokument
// (A4 uspravno, lijeva margina 2,3 cm) sa onim što je sistem PREDLOŽIO: tabela šaltera, tabela
// gate-ova i raspored zauzetosti po resursima kroz vrijeme.
//
// KAKO RADI (bez ikakvog troška): čista funkcija pravi HTML sa print stilovima,
// a `openPlanForPrint` ga otvara u novom prozoru i pokreće štampanje —
// "Sačuvaj kao PDF" u Chrome-u daje vektorski PDF. Zašto ne PDF biblioteka:
// jsPDF-ov ugrađeni fontovi nemaju č/ć/đ; ovako su dijakritici uvijek tačni,
// nema nove zavisnosti i nema dodatnog JS-a u bundle-u.
//
// Nema mreže, nema Redis-a, nema React-a — samo tekst; zato je lako testirati.

import {
  DESKS, GATES, deskTerminal, formatClockMinutes, parseClockMinutes, getAirlineProfile,
  type Suggestion, type SuggestionFlight,
} from '@/lib/assignment-suggestions';

/** Jedan red dnevnog rasporeda: SVI letovi dana, sa postojećim dodjelama i prijedlogom. */
export interface PlanDayFlight {
  flightNumber: string;
  airlineLabel: string;
  destination: string;
  /** "HH:MM" */
  std: string;
  stdMin: number;
  desks: string[];
  gates: string[];
  /** Šalteri/gate-ovi su PRIJEDLOG (nisu još dodijeljeni). */
  desksSuggested: boolean;
  gatesSuggested: boolean;
  status: string;
}

/**
 * Pravi dnevni raspored iz SVIH letova (ne samo onih za koje ima prijedlog):
 * postojeće dodjele imaju prednost; ako ih nema, uzima se prijedlog sistema.
 */
export function buildDayFlights(
  flights: SuggestionFlight[],
  currentDesks: Record<string, string>,
  currentGates: Record<string, string>,
  suggestions: { desks: Suggestion[]; gates: Suggestion[] },
  nowMin: number,
  summer = false,
): PlanDayFlight[] {
  const idsOf = (m: Record<string, string>, fn: string) =>
    Object.entries(m).filter(([, f]) => f === fn).map(([id]) => id);
  const sg = (list: Suggestion[], fn: string) => list.find(x => x.flightNumber === fn);
  const out: PlanDayFlight[] = [];
  for (const f of flights) {
    const stdMin = parseClockMinutes(f.ScheduledDepartureTime);
    if (stdMin === null || !f.FlightNumber) continue;
    const fn = f.FlightNumber;
    const curD = idsOf(currentDesks, fn), curG = idsOf(currentGates, fn);
    const sd = curD.length ? undefined : sg(suggestions.desks, fn);
    const sgt = curG.length ? undefined : sg(suggestions.gates, fn);
    const st = (f.StatusEN || '').toLowerCase();
    let status = '—';
    if (st.includes('depart') || st.includes('poletio')) status = 'Poletio';
    else if (st.includes('cancel') || st.includes('otkaz')) status = 'Otkazan';
    else if (curD.length || curG.length) status = 'Dodijeljeno';
    else if (sd?.resources.length || sgt?.resources.length) status = 'Prijedlog';
    else if (stdMin - 30 <= nowMin) status = 'Check-in završen';
    out.push({
      flightNumber: fn,
      airlineLabel: f.AirlineName || getAirlineProfile(f, summer).label,
      destination: f.DestinationCityName || f.DestinationAirportCode || '',
      std: formatClockMinutes(stdMin),
      stdMin,
      desks: curD.length ? curD : (sd?.resources ?? []),
      gates: curG.length ? curG : (sgt?.resources ?? []),
      desksSuggested: !curD.length && !!sd?.resources.length,
      gatesSuggested: !curG.length && !!sgt?.resources.length,
      status,
    });
  }
  return out.sort((a, b) => a.stdMin - b.stdMin || a.flightNumber.localeCompare(b.flightNumber));
}

export interface PlanDocumentInput {
  /** Cijeli dnevni raspored (vidi buildDayFlights). */
  dayFlights?: PlanDayFlight[];
  desks: Suggestion[];
  gates: Suggestion[];
  /** npr. "11.10.2026." */
  dateLabel: string;
  /** npr. "10:52" */
  generatedAt: string;
  /** Tekst o stanju modela (iz ModelInfo.text), ako postoji. */
  modelText?: string | null;
  /** Napomene osoblja koje su važile pri izračunu (čipovi). */
  constraints?: string[];
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const clock = (m: number) => formatClockMinutes(m);

/** Boje traka u rasporedu zauzetosti (štampa se dobro i u sivoj skali). */
const PALETTE = ['#1D4E89', '#0E7C66', '#B5541B', '#6B3FA0', '#9A2A4E', '#2B6F8F', '#7A6A12', '#3C5A2A', '#A0522D', '#44506B'];

const SOURCE_TEXT: Record<string, string> = {
  learned: 'naučeno', profile: 'profil', default: 'opšti raspored', note: 'napomena', model: 'model', none: '',
};

const CSS = `
@page { size: A4 portrait; margin: 12mm 10mm 14mm 23mm; } /* lijeva margina 2,3 cm */
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
td { overflow-wrap: anywhere; } th { white-space: nowrap; }
body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #12263F; font-size: 8.4pt; line-height: 1.28;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
.hdr { background: #0B2545; color: #fff; padding: 10px 13px 9px; border-radius: 6px; border-bottom: 4px solid #F2B705; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
.hdr .org { font-size: 8pt; letter-spacing: .22em; text-transform: uppercase; color: #F2B705; font-weight: 700; }
.hdr h1 { margin: 2px 0 0; font-size: 14pt; font-weight: 800; letter-spacing: .01em; }
.hdr .meta { text-align: right; font-size: 8.5pt; color: #C9D6EA; }
.hdr .meta b { display: block; font-size: 13pt; color: #fff; }
.stats { display: flex; gap: 8px; margin: 9px 0 4px; }
.stat { flex: 1; border: 1px solid #D5DEEB; border-radius: 6px; padding: 5px 8px; background: #F5F8FC; }
.stat b { display: block; font-size: 13pt; line-height: 1.1; color: #0B2545; }
.stat span { font-size: 6.6pt; text-transform: uppercase; letter-spacing: .08em; color: #5B6F8C; }
.stat.warn b { color: #B45309; }
.notes { margin: 6px 0 2px; font-size: 8.2pt; color: #3D5170; }
.notes .chip { display: inline-block; border: 1px solid #C9B6E8; background: #F1EAFB; color: #4B2C86; border-radius: 10px; padding: 1px 8px; margin: 0 4px 3px 0; }
h2 { break-after: avoid; page-break-after: avoid; margin: 11px 0 5px; font-size: 9.6pt; text-transform: uppercase; letter-spacing: .09em; color: #0B2545; display: flex; align-items: center; gap: 8px; }
h2::before { content: ""; width: 5px; height: 15px; background: #F2B705; border-radius: 2px; }
h2 small { font-size: 6.8pt; font-weight: 500; letter-spacing: 0; text-transform: none; color: #5B6F8C; }
table { width: 100%; border-collapse: collapse; }
thead th { background: #0B2545; color: #fff; font-size: 6.6pt; letter-spacing: .05em; text-transform: uppercase; text-align: left; padding: 4px 5px; font-weight: 700; }
tbody td { padding: 4px 5px; border-bottom: 1px solid #DCE4EF; vertical-align: middle; }
tbody tr:nth-child(even) td { background: #F5F8FC; }
tr { page-break-inside: avoid; }
thead { display: table-header-group; }
.t { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
.fl { font-weight: 800; font-size: 9pt; letter-spacing: .02em; white-space: nowrap; }
.dim { color: #5B6F8C; } .sm { font-size: 6.8pt; line-height: 1.2; }
.b.sug { border-style: dashed; border-color: #0B2545; }
.st { font-size: 6.8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.st.ok { color: #0E7C66; } .st.sg { color: #1D4E89; } .st.off { color: #8A97AB; } .st.bad { color: #B91C1C; }
.badges { display: flex; gap: 3px; flex-wrap: nowrap; align-items: center; }
.b { flex: none; white-space: nowrap; display: inline-block; min-width: 20px; text-align: center; font-weight: 800; font-size: 9pt; padding: 0 4px; border-radius: 5px; border: 1.5px solid #0B2545; background: #fff; color: #0B2545; }
.b.t1 { background: #FFD43B; border-color: #C79A00; color: #111; }
.b.t2 { background: #C92A2A; border-color: #8F1D1D; color: #fff; }
.tag { flex: none; white-space: nowrap; display: inline-block; font-size: 7pt; font-weight: 800; padding: 0 5px; border-radius: 8px; margin-left: 3px; vertical-align: 1px; }
.tag.t1 { background: #FFD43B; color: #111; } .tag.t2 { background: #C92A2A; color: #fff; }
.note { font-size: 7pt; color: #3D5170; }
.note.wait { color: #1D4E89; font-weight: 600; }
.note.warn { color: #B45309; }
.empty { padding: 10px; color: #5B6F8C; font-style: italic; }
.gantt { border: 1px solid #D5DEEB; border-radius: 6px; overflow: hidden; margin-bottom: 4px; }
.gr { display: flex; align-items: stretch; border-bottom: 1px solid #E6ECF4; height: 19px; }
.gr:last-child { border-bottom: 0; }
.gl { width: 40px; flex: none; font-weight: 800; font-size: 8.5pt; padding: 2px 7px; background: #F5F8FC; border-right: 1px solid #D5DEEB; display: flex; align-items: center; }
.gt { position: relative; flex: 1; }
.gv { position: absolute; top: 0; bottom: 0; width: 1px; background: #E1E8F2; }
.bar { position: absolute; top: 2px; bottom: 2px; border-radius: 3px; color: #fff; font-size: 6.2pt; font-weight: 700; padding: 0 4px; overflow: hidden; white-space: nowrap; display: flex; align-items: center; }
.bar.wait { background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.28) 0 3px, transparent 3px 6px); }
.gh .gl { background: #0B2545; color: #fff; font-size: 7.4pt; letter-spacing: .08em; text-transform: uppercase; }
.gh .gt { background: #0B2545; }
.hr { position: absolute; top: 3px; font-size: 6.6pt; color: #C9D6EA; transform: translateX(-50%); font-weight: 600; }
.hr.first { transform: translateX(3px); } .hr.last { transform: translateX(calc(-100% - 3px)); }
.pg { break-before: page; page-break-before: always; }
.ftr { margin-top: 10px; padding-top: 6px; border-top: 1px solid #D5DEEB; font-size: 6.8pt; color: #5B6F8C; display: flex; justify-content: space-between; gap: 16px; }
`;

function deskBadges(ids: string[]): string {
  if (!ids.length) return '<span class="dim">—</span>';
  const t = deskTerminal(ids[0]);
  return `<div class="badges">${ids.map(id => `<span class="b ${deskTerminal(id) === 'T2' ? 't2' : 't1'}">${esc(id)}</span>`).join('')}<span class="tag ${t === 'T2' ? 't2' : 't1'}">${t}</span></div>`;
}

function notesCell(s: Suggestion): string {
  const parts: string[] = [];
  for (const w of s.waitNotes) parts.push(`<div class="note wait">${esc(w)}</div>`);
  for (const w of s.warnings) parts.push(`<div class="note warn">⚠ ${esc(w)}</div>`);
  const src = SOURCE_TEXT[s.source] ?? '';
  if (!parts.length && src) parts.push(`<div class="note dim">${esc(src)}</div>`);
  return parts.join('') || '<span class="dim">—</span>';
}

function dayTable(list: PlanDayFlight[]): string {
  if (!list.length) return '<div class="empty">Nema letova za prikaz.</div>';
  const cls = (st: string) => (st === 'Dodijeljeno' ? 'ok' : st === 'Prijedlog' ? 'sg' : st === 'Otkazan' ? 'bad' : 'off');
  const dBadges = (f: PlanDayFlight) => f.desks.length
    ? `<div class="badges">${f.desks.map(id => `<span class="b ${deskTerminal(id) === 'T2' ? 't2' : 't1'}${f.desksSuggested ? ' sug' : ''}">${esc(id)}</span>`).join('')}</div>`
    : '<span class="dim">—</span>';
  const gBadges = (f: PlanDayFlight) => f.gates.length
    ? `<div class="badges">${f.gates.map(id => `<span class="b ${deskTerminal(id) === 'T2' ? 't2' : 't1'}${f.gatesSuggested ? ' sug' : ''}">${esc(id)}</span>`).join('')}</div>`
    : '<span class="dim">—</span>';
  const rows = list.map(f => `
    <tr>
      <td class="t">${esc(f.std)}</td>
      <td><span class="fl">${esc(f.flightNumber)}</span></td>
      <td>${esc(f.airlineLabel)}</td>
      <td>${esc(f.destination)}</td>
      <td>${dBadges(f)}</td>
      <td>${gBadges(f)}</td>
      <td><span class="st ${cls(f.status)}">${esc(f.status)}</span></td>
    </tr>`).join('');
  return `<table>
    <thead><tr><th>Polazak</th><th>Let</th><th>Kompanija</th><th>Destinacija</th><th>Šalteri</th><th>Gate</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function flightCell(s: Suggestion): string {
  return `<span class="fl">${esc(s.flightNumber)}</span><div class="dim sm">${esc(s.airlineLabel)}</div>`;
}

function deskTable(list: Suggestion[]): string {
  if (!list.length) return '<div class="empty">Nema predloženih dodjela šaltera.</div>';
  const rows = [...list].sort((a, b) => a.openAt - b.openAt || a.std.localeCompare(b.std)).map(s => `
    <tr>
      <td class="t">${clock(s.openAt)}–${clock(s.closeAt)}</td>
      <td class="t">${esc(s.std)}</td>
      <td>${flightCell(s)}</td>
      <td>${esc(s.destination)}</td>
      <td>${deskBadges(s.resources)}</td>
      <td>${notesCell(s)}</td>
    </tr>`).join('');
  return `<table>
    <colgroup><col style="width:17%"><col style="width:8%"><col style="width:17%"><col style="width:15%"><col style="width:17%"><col></colgroup>
    <thead><tr><th>Check-in</th><th>Polazak</th><th>Let</th><th>Destinacija</th><th>Šalteri</th><th>Napomena</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function gateTable(list: Suggestion[]): string {
  if (!list.length) return '<div class="empty">Nema predloženih dodjela gate-ova.</div>';
  const rows = [...list].sort((a, b) => a.openAt - b.openAt || a.std.localeCompare(b.std)).map(s => `
    <tr>
      <td class="t">${clock(s.openAt)}–${clock(s.closeAt)}</td>
      <td class="t">${esc(s.std)}</td>
      <td>${flightCell(s)}</td>
      <td>${esc(s.destination)}</td>
      <td>${s.resources.length ? `<div class="badges">${s.resources.map(id => `<span class="b ${deskTerminal(id) === 'T2' ? 't2' : 't1'}">${esc(id)}</span>`).join('')}</div>` : '<span class="dim">—</span>'}</td>
      <td>${notesCell(s)}</td>
    </tr>`).join('');
  return `<table>
    <colgroup><col style="width:17%"><col style="width:8%"><col style="width:17%"><col style="width:15%"><col style="width:9%"><col></colgroup>
    <thead><tr><th>Ukrcaj</th><th>Polazak</th><th>Let</th><th>Destinacija</th><th>Gate</th><th>Napomena</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/** Raspored zauzetosti: red po resursu, traka po letu kroz vrijeme. */
function gantt(list: Suggestion[], universe: string[], prefix: string): string {
  const used = universe.filter(id => list.some(s => s.resources.includes(id)));
  if (!used.length) return '<div class="empty">Nema zauzetosti za prikaz.</div>';
  const withRes = list.filter(s => s.resources.length);
  const lo = Math.floor(Math.min(...withRes.map(s => s.openAt)) / 60) * 60;
  let hi = Math.ceil(Math.max(...withRes.map(s => s.closeAt)) / 60) * 60;
  if (hi - lo < 120) hi = lo + 120;
  const span = hi - lo;
  const step = span > 12 * 60 ? 120 : 60;
  const pct = (m: number) => ((m - lo) / span) * 100;

  const colorOf = new Map<string, string>();
  [...new Set(withRes.map(s => s.flightNumber))].forEach((fn, i) => colorOf.set(fn, PALETTE[i % PALETTE.length]));

  const ticks: number[] = [];
  for (let m = lo; m <= hi; m += step) ticks.push(m);
  const head = `<div class="gr gh"><div class="gl">${esc(prefix)}</div><div class="gt">${ticks.map((m, i) => `<span class="hr${i === 0 ? ' first' : i === ticks.length - 1 ? ' last' : ''}" style="left:${pct(m).toFixed(2)}%">${clock(m)}</span>`).join('')}</div></div>`;
  const rows = used.map(id => {
    const bars = withRes.filter(s => s.resources.includes(id)).map(s => {
      const left = pct(s.openAt), width = Math.max(pct(s.closeAt) - left, 0.8);
      return `<div class="bar${s.waitNotes.length ? ' wait' : ''}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${colorOf.get(s.flightNumber)}" title="${esc(s.flightNumber)} ${clock(s.openAt)}–${clock(s.closeAt)}">${esc(s.flightNumber)}</div>`;
    }).join('');
    const grid = ticks.map(m => `<span class="gv" style="left:${pct(m).toFixed(2)}%"></span>`).join('');
    return `<div class="gr"><div class="gl">${esc(id)}</div><div class="gt">${grid}${bars}</div></div>`;
  }).join('');
  return `<div class="gantt">${head}${rows}</div>`;
}

/** Cijeli HTML dokument (jedna datoteka, bez vanjskih resursa). */
export function buildPlanHtml(input: PlanDocumentInput): string {
  const { desks, gates, dateLabel, generatedAt } = input;
  const waiting = desks.filter(s => s.waitNotes.length).length;
  const warnings = [...desks, ...gates].reduce((n, s) => n + s.warnings.length, 0);
  const chips = (input.constraints ?? []).map(c => `<span class="chip">${esc(c)}</span>`).join('');

  return `<!doctype html>
<html lang="bs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan dodjele TIV ${esc(dateLabel)}</title>
<style>${CSS}</style></head>
<body>
  <div class="hdr">
    <div>
      <div class="org">Aerodrom Tivat · TIV / LYTV</div>
      <h1>Plan dodjele check-in šaltera i gate-ova</h1>
    </div>
    <div class="meta"><b>${esc(dateLabel)}</b>Generisano u ${esc(generatedAt)}</div>
  </div>

  <div class="stats">
    <div class="stat"><b>${desks.length}</b><span>Letova — šalteri</span></div>
    <div class="stat"><b>${gates.length}</b><span>Letova — gate-ovi</span></div>
    <div class="stat${waiting ? ' warn' : ''}"><b>${waiting}</b><span>Čeka zatvaranje drugog leta</span></div>
    <div class="stat${warnings ? ' warn' : ''}"><b>${warnings}</b><span>Upozorenja</span></div>
  </div>
  ${chips ? `<div class="notes"><b>Napomene osoblja:</b> ${chips}</div>` : ''}

  ${input.dayFlights ? `<h2>Dnevni raspored letova <small>puni obrub = već dodijeljeno · isprekidani = prijedlog sistema</small></h2>
  ${dayTable(input.dayFlights)}
  <div class="pg"></div>` : ''}

  <h2>Predložene dodjele — check-in šalteri <small>T1: šalteri 1–12, gate-ovi 2–6 (žuto) · T2: šalteri 21–26, gate-ovi 21–31 (crveno)</small></h2>
  ${deskTable(desks)}

  <h2>Predložene dodjele — gate-ovi</h2>
  ${gateTable(gates)}

  <div class="pg"></div>
  <h2>Raspored zauzetosti šaltera <small>samo prijedlozi sistema · šrafirano = čeka zatvaranje prethodnog leta</small></h2>
  ${gantt(desks, DESKS, 'Šalt.')}

  <h2>Raspored zauzetosti gate-ova</h2>
  ${gantt(gates, GATES, 'Gate')}

  <div class="ftr">
    <div>Prijedlog sistema važi samo za letove koji još nemaju dodjelu — nije obavezujući. Konačnu dodjelu potvrđuje osoblje.${input.modelText ? ' ' + esc(input.modelText) : ''}</div>
    <div>Pauza između letova na istom resursu: 1 min</div>
  </div>
</body></html>`;
}

/**
 * Otvara plan u novom prozoru i pokreće štampanje ("Sačuvaj kao PDF").
 * Ako je prozor blokiran, koristi skriveni iframe. Vraća false ako ništa nije uspjelo.
 */
export function openPlanForPrint(html: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => { try { w.print(); } catch { /* korisnik može Ctrl+P */ } }, 400);
      return true;
    }
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    const d = fr.contentDocument;
    if (!d) { fr.remove(); return false; }
    d.open(); d.write(html); d.close();
    setTimeout(() => {
      try { fr.contentWindow?.focus(); fr.contentWindow?.print(); } catch { /* ignoriši */ }
      setTimeout(() => fr.remove(), 60_000);
    }, 400);
    return true;
  } catch {
    return false;
  }
}
