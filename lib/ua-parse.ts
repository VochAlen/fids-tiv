// lib/ua-parse.ts — mali parser User-Agent stringa (bez biblioteke): operativni sistem, pregledač, tip uređaja.
// Chrome "zamrzava" verzije u UA (Windows 10 i 11 su oba "NT 10.0", macOS je uvijek 10_15_7), pa se to ne razlikuje.
export interface UaInfo { os: string; browser: string; device: 'mobile' | 'desktop' }

const WIN_NT: Record<string, string> = { '10.0': 'Windows 10/11', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7', '6.0': 'Windows Vista', '5.1': 'Windows XP' };

export function parseUserAgent(ua: string | null | undefined, platformHint?: string | null): UaInfo {
  const s = (ua ?? '').slice(0, 300);
  let os = 'Nepoznat';
  const win = /Windows NT (\d+\.\d+)/.exec(s);
  if (win) os = WIN_NT[win[1]] ?? `Windows (NT ${win[1]})`;
  else if (/Android (\d+(?:\.\d+)?)/.test(s)) os = `Android ${/Android (\d+(?:\.\d+)?)/.exec(s)![1]}`;
  else if (/(iPhone|iPad|iPod)/.test(s)) { const m = /OS (\d+)[_.](\d+)/.exec(s); os = m ? `iOS ${m[1]}.${m[2]}` : 'iOS'; }
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';
  else if (platformHint) os = platformHint.replace(/"/g, '');

  let browser = 'Nepoznat';
  const ver = (re: RegExp) => { const m = re.exec(s); return m ? m[1].split('.')[0] : ''; };
  if (/Electron\//.test(s)) browser = `Electron ${ver(/Electron\/([\d.]+)/)}`.trim();
  else if (/Edg(?:e|A|iOS)?\//.test(s)) browser = `Edge ${ver(/Edg(?:e|A|iOS)?\/([\d.]+)/)}`.trim();
  else if (/OPR\//.test(s)) browser = `Opera ${ver(/OPR\/([\d.]+)/)}`.trim();
  else if (/(Firefox|FxiOS)\//.test(s)) browser = `Firefox ${ver(/(?:Firefox|FxiOS)\/([\d.]+)/)}`.trim();
  else if (/(Chrome|CriOS)\//.test(s)) browser = `Chrome ${ver(/(?:Chrome|CriOS)\/([\d.]+)/)}`.trim();
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = `Safari ${ver(/Version\/([\d.]+)/)}`.trim();

  return { os, browser, device: /(Mobile|Android|iPhone|iPad|iPod)/.test(s) ? 'mobile' : 'desktop' };
}
