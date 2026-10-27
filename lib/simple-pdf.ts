// lib/simple-pdf.ts
//
// Minimalni PDF generator bez ikakvih zavisnosti (nema nove biblioteke u package.json): A4, ugrađeni fontovi Helvetica /
// Helvetica-Bold, naslov + tabele sa automatskim prelomom na nove stranice. Ugrađeni PDF fontovi nemaju č/ć/đ, pa se tekst
// prevodi u ASCII (č→c, ć→c, đ→dj, š→s, ž→z).

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 40;

export function toAscii(s: string): string {
  return s
    .replace(/đ/g, 'dj').replace(/Đ/g, 'Dj')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[–—]/g, '-').replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');
}
const esc = (s: string) => toAscii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const num = (n: number) => n.toFixed(2);

export interface PdfColumn { title: string; width: number }

export interface PdfSection {
  heading: string;
  columns: PdfColumn[];
  rows: string[][];
  emptyText?: string;
}

export interface PdfDoc { title: string; subtitle?: string; sections: PdfSection[]; footer?: string }

export function buildPdf(doc: PdfDoc): Uint8Array {
  const pages: string[][] = [];
  let cur: string[] = [];
  let y = PAGE_H - MARGIN;
  const newPage = () => { cur = []; pages.push(cur); y = PAGE_H - MARGIN; };
  const text = (x: number, yy: number, s: string, size: number, bold = false) => {
    cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${num(x)} ${num(yy)} Td (${esc(s)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, gray = 0.75) => {
    cur.push(`${gray} G 0.5 w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  };
  const fit = (s: string, width: number, size: number) => {
    const max = Math.max(1, Math.floor(width / (size * 0.5)));   // gruba procjena prosječne širine znaka Helvetice
    const a = toAscii(s);
    return a.length > max ? a.slice(0, Math.max(1, max - 1)) + '.' : a;
  };

  newPage();
  text(MARGIN, y - 16, doc.title, 16, true); y -= 24;
  if (doc.subtitle) { text(MARGIN, y - 10, doc.subtitle, 10); y -= 18; }
  y -= 6;

  for (const sec of doc.sections) {
    if (y < MARGIN + 70) newPage();
    text(MARGIN, y - 12, sec.heading, 12, true); y -= 20;
    const header = () => {
      let x = MARGIN;
      for (const c of sec.columns) { text(x, y - 9, c.title, 9, true); x += c.width; }
      y -= 13; line(MARGIN, y, PAGE_W - MARGIN, y, 0.3); y -= 3;
    };
    header();
    if (sec.rows.length === 0) { text(MARGIN, y - 10, sec.emptyText ?? '-', 9); y -= 16; }
    for (const row of sec.rows) {
      if (y < MARGIN + 30) { newPage(); header(); }
      let x = MARGIN;
      sec.columns.forEach((c, i) => { text(x, y - 9, fit(row[i] ?? '', c.width - 4, 9), 9); x += c.width; });
      y -= 13; line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2, 0.9);
    }
    y -= 12;
  }

  const total = pages.length;
  pages.forEach((p, i) => {
    cur = p;
    text(MARGIN, 24, doc.footer ?? '', 8);
    text(PAGE_W - MARGIN - 60, 24, `Strana ${i + 1}/${total}`, 8);
  });

  // ── slaganje PDF objekata ──
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  const catalogId = add('');                       // 1 — popunjava se poslije
  const pagesId = add('');                         // 2
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const p of pages) {
    const stream = p.join('\n');
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // sav sadržaj je ASCII (esc/toAscii), pa je 1 znak = 1 bajt
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
