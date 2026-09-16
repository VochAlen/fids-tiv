'use client';

// app/admin/pa/page.tsx
//
// Admin kontrolni panel za razglas (PA). Četiri cjeline:
//   1. HITNA PORUKA — dupla potvrda, prekida sve ostalo na PA ekranu.
//   2. Poziv putnika — ime + let + gdje da se javi (gate/info/šalter).
//   3. Slobodan tekst — improvizovana poruka (postojalo od ranije).
//   4. Brze akcije po letu — tabela letova sa dugmadima za svaki tip
//      poziva (registracija/boarding/final call/zatvori let/preusmjeren/
//      kasni/otkazan) — koristi ISTE tekst-builder funkcije kao
//      automatski sistem (lib/pa-announcements.ts), samo ručno okinute.
//
// VAŽNO — vidi banner ispod: ovaj panel je za OSOBLJE OPERATIVNOG
// CENTRA (dispečeri koji prate razglas i imaju uvid u cio raspored),
// NE za stjuardese/ground handling — oni imaju svoje kanale (radio,
// interfon na gate-u) za direktnu komunikaciju sa posadom/putnicima na
// samom gate-u. Miješanje ta dva kanala (npr. stjuardesa slučajno
// pošalje "final call" na CIJELI terminal umjesto da kaže putniku
// lično na gate-u) bi bilo zbunjujuće i kontraproduktivno.
//
// FIX (po zahtjevu — "TTS ne radi na ovoj stranici"): OVA stranica
// NIKAD nije izgovarala zvuk sama — ona samo ŠALJE poruke (preko
// /api/admin/pa-announcement u Redis), a STVARNO ih izgovara /pa
// stranica (app/pa/PaPageClient.tsx), fizički drugi ekran/računar
// povezan na pojačalo terminala. Ako /pa nije otvorena negdje dok se
// testira ovdje, ništa se ne čuje — poruka stigne, ali niko je ne
// "pokupi" da izgovori (to je namjerna arhitektura, ne greška).
//
// Dodat je LOKALNI TTS pregled (vidi previewLocally/publishAndPreview
// ispod) — kad je uključen (podrazumijevano jeste), svaka poslata
// poruka se ODMAH izgovori i OVDJE, kao potvrda "šta sam upravo
// poslao", nezavisno od toga da li je /pa otvorena igdje. Ovo NE
// zamjenjuje pravi razglas (i dalje se šalje normalno preko API-ja) —
// samo daje osoblju trenutnu zvučnu potvrdu na istom ekranu.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useIdleLogout } from '@/hooks/use-idle-logout';
import { IdleWarningBanner } from '@/components/idle-warning-banner';
import { ToastStack, nextToastId, type ToastMessage, type ToastType } from '@/components/toast';
import {
  Radio, Send, Clock, AlertTriangle, UserSearch, MessageSquare,
  PlaneTakeoff, PlaneLanding, Info, ShieldAlert, X, Check, LogOut, Volume2, VolumeX,
} from 'lucide-react';
import type { Flight } from '@/types/flight';
import {
  buildDepartureEN, buildDepartureLocal,
  buildArrivalEN, buildArrivalLocal,
  buildCancelledEN, buildCancelledLocal,
  buildDivertedToEN, buildDivertedToLocal,
  buildDelayNoticeEN, buildDelayNoticeLocal,
  buildPassengerPageEN, buildPassengerPageLocal,
  type PageLocationType,
} from '@/lib/pa-announcements';

const MAX_LENGTH = 500;

interface SentAnnouncement {
  id: string;
  text: string;
  publishedAt: string;
}

async function publishAnnouncement(
  text: string,
  lang: 'en' | 'local' = 'en',
  priority: 'normal' | 'emergency' = 'normal'
): Promise<{ ok: true; announcement: SentAnnouncement } | { ok: false; error: string; status: number }> {
  try {
    // FIX (provjera otpornosti — nema timeout-a): bez ovoga, ako mreža
    // "zaglavi" (ne vrati ni uspjeh ni grešku), dugme ostaje zauvijek na
    // "Šalje se…" — za HITNU poruku ovo je posebno loš scenario: operater
    // ne zna da li je poruka stvarno otišla, i nema način da pokuša ponovo
    // dok se taj jedan zahtjev ne razriješi (moglo bi trajati minutama).
    // 8s je dovoljno velikodušno za normalan odgovor.
    const res = await fetch('/api/admin/pa-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang, priority }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || 'Greška pri slanju', status: res.status };
    return { ok: true, announcement: data.announcement };
  } catch (err) {
    // AbortSignal.timeout baca DOMException 'TimeoutError' — hvata se
    // ovdje istom granom kao mrežni prekid/malformiran JSON odgovor.
    return { ok: false, error: 'Greška pri slanju — provjeri konekciju', status: 0 };
  }
}

// FIX (istekla PA sesija usred rada se tiho prikazivala kao generičko
// "Unauthorized"): sa uvođenjem PA login sistema (middleware.ts),
// /api/admin/pa-announcement sad vraća 401 ako pa-authenticated cookie
// istekne (24h sesija) — osoblje bi vidjelo nejasnu poruku umjesto
// jasnog puta nazad na prijavu. Ova funkcija centralizuje prikaz greške
// za svih 5 mjesta koja zovu publishAnnouncement (slobodan tekst, hitna
// poruka, poziv putnika, brze akcije po letu, preusmjeravanje) — bez
// nje bi ista if/else grana bila ponovljena 5 puta.
function showAnnouncementError(
  result: { error: string; status: number },
  showToast: (message: string, type: ToastType) => void,
) {
  if (result.status === 401) {
    showToast('Sesija je istekla — preusmjeravam na prijavu…', 'warning');
    setTimeout(() => { window.location.href = '/pa/login?next=admin'; }, 1500);
    return;
  }
  if (result.status === 423) {
    showToast('Razglas ne radi noću.', 'warning');
    return;
  }
  showToast(result.error, 'error');
}

// FIX (po zahtjevu — razdvojeni setovi dugmadi za odlaske i dolaske):
// "preusmjeren" je izbačen iz generičkih akcija u OBJE liste — ima
// svoju posebnu UI (inline unos "preusmjeren u ___", vidi
// DivertInlineForm niže), jer zahtijeva tekst koji operater kuca
// (gdje je let stvarno preusmjeren), ne fiksnu poruku.
type DepartureActionKey =
  | 'checkin' | 'boarding' | 'final_call' | 'close'
  | 'delay30' | 'delay60' | 'cancelled';

type ArrivalActionKey = 'arrived' | 'delay60' | 'cancelled';

const DEPARTURE_ACTIONS: { key: DepartureActionKey; label: string; className: string }[] = [
  { key: 'checkin',    label: '🛎 Registracija',   className: 'bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border-sky-600/40' },
  { key: 'boarding',   label: '✈️ Boarding',        className: 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-600/40' },
  { key: 'final_call', label: '⏰ Final Call',      className: 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-600/40' },
  { key: 'close',      label: '🚪 Zatvori let',     className: 'bg-red-600/20 hover:bg-red-600/30 text-red-300 border-red-600/40' },
  { key: 'delay30',    label: '⏱ Kasni +30min',    className: 'bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border-orange-600/40' },
  { key: 'delay60',    label: '⏱ Kasni +1h',       className: 'bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border-orange-600/40' },
  { key: 'cancelled',  label: '❌ Otkazan',         className: 'bg-red-700/20 hover:bg-red-700/30 text-red-400 border-red-700/40' },
];

// FIX (po zahtjevu — dolasci imaju SVOJ, manji set dugmadi): sletio,
// kasni (info za 60 min), otkazan — plus preusmjeren (odvojeno, ispod).
// Registracija/boarding/final call/zatvori let nemaju smisla za let
// koji DOLAZI na ovaj aerodrom.
const ARRIVAL_ACTIONS: { key: ArrivalActionKey; label: string; className: string }[] = [
  { key: 'arrived',   label: '🛬 Sletio',              className: 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-600/40' },
  { key: 'delay60',   label: '⏱ Kasni — info za 1h',  className: 'bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border-orange-600/40' },
  { key: 'cancelled', label: '❌ Otkazan',              className: 'bg-red-700/20 hover:bg-red-700/30 text-red-400 border-red-700/40' },
];

function buildDepartureActionTexts(f: Flight, action: DepartureActionKey): { en: string; local: string } {
  switch (action) {
    case 'checkin':    return { en: buildDepartureEN(f, 'checkin_120'), local: buildDepartureLocal(f, 'checkin_120') };
    case 'boarding':   return { en: buildDepartureEN(f, 'boarding'),    local: buildDepartureLocal(f, 'boarding') };
    case 'final_call': return { en: buildDepartureEN(f, 'final_call'),  local: buildDepartureLocal(f, 'final_call') };
    case 'close':      return { en: buildDepartureEN(f, 'last_call'),   local: buildDepartureLocal(f, 'last_call') };
    case 'delay30':    return { en: buildDelayNoticeEN(f, 30),          local: buildDelayNoticeLocal(f, 30) };
    case 'delay60':    return { en: buildDelayNoticeEN(f, 60),          local: buildDelayNoticeLocal(f, 60) };
    case 'cancelled':  return { en: buildCancelledEN(f),                local: buildCancelledLocal(f) };
  }
}

function buildArrivalActionTexts(f: Flight, action: ArrivalActionKey): { en: string; local: string } {
  switch (action) {
    case 'arrived':   return { en: buildArrivalEN(f),        local: buildArrivalLocal(f) };
    case 'delay60':   return { en: buildDelayNoticeEN(f, 60), local: buildDelayNoticeLocal(f, 60) };
    case 'cancelled': return { en: buildCancelledEN(f),       local: buildCancelledLocal(f) };
  }
}

function flightRowKey(f: Flight): string {
  return `${f.FlightNumber}-${f.ScheduledDepartureTime}`;
}

// Inline forma za "preusmjeren u ___" — namjerno NIJE modal (za razliku
// od hitne poruke, koja MORA da prekine tok pažnje zbog ozbiljnosti) —
// ovo je rutinska akcija, dovoljno je da se otvori odmah ispod reda tog
// leta, bez skidanja fokusa sa cijele tabele.
function DivertInlineForm({
  value, onChange, onConfirm, onCancel, busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 bg-purple-500/10 border border-purple-500/30 rounded-lg p-2">
      <span className="text-xs text-purple-300 font-semibold flex-shrink-0 pl-1">Preusmjeren u:</span>
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
        placeholder="npr. Podgorica"
        className="flex-1 min-w-[120px] rounded-md bg-white/5 border border-white/15 text-white placeholder-white/30 px-2 py-1.5 text-sm outline-none focus:border-purple-400/60"
      />
      <button
        onClick={onConfirm}
        disabled={busy || !value.trim()}
        className="p-1.5 rounded-md bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 disabled:opacity-40 transition-colors"
        title="Pošalji"
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        onClick={onCancel}
        className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        title="Otkaži"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// FIX (lokalni TTS pregled — ista, provjerena logika kao app/pa/
// PaPageClient.tsx, ne izmišljena iznova): bira žensku engleski glas i
// lokalni (hr/sr) glas ako postoji, sa istim fallback ponašanjem.
function pickEnglishFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter(v => v.lang.toLowerCase().startsWith('en'));
  if (en.length === 0) return null;
  const isFemale = (v: SpeechSynthesisVoice) => /female/i.test(v.name);
  const isExplicitlyMale = (v: SpeechSynthesisVoice) => /male/i.test(v.name) && !/female/i.test(v.name);
  return en.find(isFemale) ?? en.find(v => !isExplicitlyMale(v)) ?? en[0];
}

function pickLocalVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return voices.find(v =>
    v.lang.toLowerCase().startsWith('hr') ||
    v.lang.toLowerCase().startsWith('sr') ||
    /croatian|serbian/i.test(v.name)
  ) ?? null;
}

export default function AdminPaPage() {
  // FIX (po zahtjevu — PA sistem ima sopstvenu, odvojenu sesiju): ova
  // stranica je sad zaštićena pa-authenticated cookie-jem (vidi
  // middleware.ts), NE opštim admin-authenticated — idle logout mora
  // da odjavljuje/redirektuje na PA-specifičnu login stranicu, ne
  // opšti /admin/login (koji ne bi ni radio ovdje, pošto ovaj cookie
  // nije taj koji ova stranica provjerava).
  const { secondsLeft: idleWarningSeconds } = useIdleLogout({
    logoutUrl: '/api/pa/logout',
    redirectUrl: '/pa/login?next=admin&reason=idle',
  });

  const handlePaLogout = useCallback(async () => {
    try { await fetch('/api/pa/logout', { method: 'POST' }) } catch {}
    try { localStorage.removeItem('paAuthenticated') } catch {}
    window.location.href = '/pa/login?next=admin';
  }, []);

  // ── Lokalni TTS pregled ───────────────────────────────────
  // FIX (po zahtjevu — "TTS ne radi na ovoj stranici"): jednostavan,
  // samostalan red za izgovor — NAMJERNO manje sofisticiran od pravog
  // razglasa (app/pa/PaPageClient.tsx, koji ima prioritete/hitne
  // prekide/dedup) jer je ovo SAMO lokalna potvrda "šta sam poslao",
  // ne pravi sistem za emitovanje.
  const [voiceReady, setVoiceReady] = useState(false);
  const [enVoiceName, setEnVoiceName] = useState('');
  const [localVoiceName, setLocalVoiceName] = useState('');
  const [localPreviewEnabled, setLocalPreviewEnabled] = useState(true);
  const enVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const localVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const allVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const previewQueueRef = useRef<{ text: string; voiceURI: string | null }[]>([]);
  const previewPlayingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const tryLoad = () => {
      const voices = window.speechSynthesis?.getVoices() ?? [];
      if (voices.length === 0) return false;
      allVoicesRef.current = voices;
      const en = pickEnglishFemaleVoice(voices);
      const local = pickLocalVoice(voices);
      if (!cancelled) {
        if (en) { enVoiceRef.current = en; setEnVoiceName(en.name); }
        localVoiceRef.current = local;
        setLocalVoiceName(local ? local.name : 'EN glas (fonetski)');
        setVoiceReady(true);
      }
      return true;
    };

    if (!tryLoad()) {
      window.speechSynthesis?.addEventListener('voiceschanged', tryLoad);
      pollId = setInterval(() => { if (tryLoad() && pollId) { clearInterval(pollId); pollId = null; } }, 1000);
    }
    return () => {
      cancelled = true;
      window.speechSynthesis?.removeEventListener('voiceschanged', tryLoad);
      if (pollId) clearInterval(pollId);
    };
  }, []);

  const processPreviewQueue = useCallback(() => {
    if (previewPlayingRef.current || previewQueueRef.current.length === 0) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    previewPlayingRef.current = true;
    const item = previewQueueRef.current.shift()!;
    const voice = item.voiceURI ? allVoicesRef.current.find(v => v.voiceURI === item.voiceURI) : null;
    const utterance = new SpeechSynthesisUtterance(item.text);
    if (voice) utterance.voice = voice;
    utterance.rate = 0.92;
    const onDone = () => { previewPlayingRef.current = false; setTimeout(processPreviewQueue, 400); };
    utterance.onend = onDone;
    utterance.onerror = onDone;
    synth.speak(utterance);
  }, []);

  const previewLocally = useCallback((text: string, lang: 'en' | 'local') => {
    if (!localPreviewEnabled) return;
    const voiceURI = lang === 'local'
      ? (localVoiceRef.current?.voiceURI ?? enVoiceRef.current?.voiceURI ?? null)
      : (enVoiceRef.current?.voiceURI ?? null);
    previewQueueRef.current.push({ text, voiceURI });
    processPreviewQueue();
  }, [localPreviewEnabled, processPreviewQueue]);

  // Zamjena za sve pozive publishAndPreview(...) u ostatku komponente
  // — šalje NA ISTI način kao ranije (pravi razglas i dalje dobija
  // poruku normalno preko API-ja), i DODATNO je izgovori ovdje, ako je
  // lokalni pregled uključen.
  const publishAndPreview = useCallback(async (
    text: string,
    lang: 'en' | 'local' = 'en',
    priority: 'normal' | 'emergency' = 'normal',
  ) => {
    previewLocally(text, lang);
    return publishAnnouncement(text, lang, priority);
  }, [previewLocally]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showToast = useCallback((message: string, type: ToastType) => {
    setToasts(prev => [...prev, { id: nextToastId(), message, type }]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Slobodan tekst ──────────────────────────────────────────
  const [text, setText] = useState('');
  const [sendingText, setSendingText] = useState(false);
  const [recentlySent, setRecentlySent] = useState<SentAnnouncement[]>([]);

  const handleSendText = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSendingText(true);
    const result = await publishAndPreview(trimmed, 'en', 'normal');
    setSendingText(false);
    if (!result.ok) {
      showAnnouncementError(result, showToast);
      return;
    }
    setRecentlySent(prev => [result.announcement, ...prev].slice(0, 10));
    setText('');
    showToast('Najava poslata na razglas.', 'success');
  }, [text, showToast]);

  // ── HITNA PORUKA (dupla potvrda) ─────────────────────────────
  const [emergencyText, setEmergencyText] = useState('');
  // FIX (po zahtjevu — operater mora vidjeti na kom jeziku kuca):
  // slanje je do sad bilo TVRDO 'en' bez obzira šta je operater
  // stvarno otkucao — ako bi neko pod stresom otkucao poruku na
  // crnogorskom, sistem bi je pročitao ENGLESKIM glasom, fonetski,
  // potencijalno nerazumljivo baš u trenutku kad razumljivost
  // najviše znači. Sad operater EKSPLICITNO bira jezik PRIJE kucanja
  // (vidi prekidač u JSX-u ispod) — nema nagađanja.
  const [emergencyLang, setEmergencyLang] = useState<'en' | 'local'>('en');
  const [emergencyConfirming, setEmergencyConfirming] = useState(false);
  const [sendingEmergency, setSendingEmergency] = useState(false);

  const handleConfirmEmergency = useCallback(async () => {
    const trimmed = emergencyText.trim();
    if (!trimmed) return;
    setSendingEmergency(true);
    const result = await publishAndPreview(trimmed, emergencyLang, 'emergency');
    setSendingEmergency(false);
    setEmergencyConfirming(false);
    if (!result.ok) {
      showToast(result.error, 'error');
      return;
    }
    setEmergencyText('');
    showToast('HITNA PORUKA poslata — prekida sve ostalo na razglasu.', 'success');
  }, [emergencyText, emergencyLang, showToast]);

  // ── Poziv putnika ─────────────────────────────────────────
  const [passengerName, setPassengerName] = useState('');
  const [pageFlightNumber, setPageFlightNumber] = useState('');
  const [pageDestination, setPageDestination] = useState('');
  const [pageLocationType, setPageLocationType] = useState<PageLocationType>('gate');
  const [pageLocationNumber, setPageLocationNumber] = useState('');
  const [sendingPage, setSendingPage] = useState(false);

  const handleSendPage = useCallback(async () => {
    const name = passengerName.trim(), flightNum = pageFlightNumber.trim(), dest = pageDestination.trim();
    if (!name || !flightNum || !dest) {
      showToast('Popuni ime putnika, broj leta i destinaciju.', 'warning');
      return;
    }
    setSendingPage(true);
    const en = buildPassengerPageEN(name, flightNum, dest, pageLocationType, pageLocationNumber);
    const local = buildPassengerPageLocal(name, flightNum, dest, pageLocationType, pageLocationNumber);
    const [r1, r2] = await Promise.all([
      publishAndPreview(en, 'en', 'normal'),
      publishAndPreview(local, 'local', 'normal'),
    ]);
    setSendingPage(false);
    if (!r1.ok || !r2.ok) {
      const err = (!r1.ok ? r1 : r2 as any);
      showAnnouncementError(err, showToast);
      return;
    }
    showToast(`Poziv za ${name} poslat na razglas.`, 'success');
    setPassengerName('');
  }, [passengerName, pageFlightNumber, pageDestination, pageLocationType, pageLocationNumber, showToast]);

  // ── Brze akcije po letu ───────────────────────────────────
  const [departures, setDepartures] = useState<Flight[]>([]);
  const [arrivals, setArrivals] = useState<Flight[]>([]);
  const [loadingFlights, setLoadingFlights] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null); // `${flightNumber}:${action}`

  // FIX (po zahtjevu — "preusmjeren u XXXX" sa unosom teksta): koje
  // dugme je trenutno otvorilo inline formu za unos lokacije
  // preusmjerenja. Odvojeno od busyAction jer je ovo UI-only stanje
  // (forma otvorena/zatvorena), ne mrežni poziv u toku.
  const [divertingKey, setDivertingKey] = useState<string | null>(null);
  const [divertToText, setDivertToText] = useState('');

  const sortByScheduled = (list: Flight[]) =>
    [...list].sort((a, b) => (a.ScheduledDepartureTime || '99:99').localeCompare(b.ScheduledDepartureTime || '99:99'));

  const loadFlights = useCallback(async () => {
    try {
      // FIX (dosljednost — timeout i ovdje): manje kritično nego slanje
      // najave (ovo je samo osvježavanje prikaza, ne akcija koja čeka
      // potvrdu), ali bez ovoga bi zaglavljena mreža ostavila
      // "Učitavanje letova…" da visi neograničeno.
      const res = await fetch('/api/flights', { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const data = await res.json();
        const notDeparted = (data.departures || []).filter((f: Flight) => {
          const s = (f.StatusEN || '').toLowerCase();
          return !s.includes('departed') && !s.includes('otiš');
        });
        const notArrived = (data.arrivals || []).filter((f: Flight) => {
          const s = (f.StatusEN || '').toLowerCase();
          return !s.includes('arrived') && !s.includes('landed') && !s.includes('sletio') && !s.includes('sletjel');
        });
        setDepartures(sortByScheduled(notDeparted));
        setArrivals(sortByScheduled(notArrived));
      }
    } catch (err) {
      console.error('Greška pri učitavanju letova:', err);
    } finally {
      setLoadingFlights(false);
    }
  }, []);

  useEffect(() => {
    loadFlights();
    // FIX (po zahtjevu — 4 min): ovo je tabela koju osoblje koristi za
    // RUČNE akcije (klik na dugme), ne live prikaz — 4 minuta je
    // dovoljno svježe za taj kontekst (raspored/status se ionako sporo
    // mijenja u odnosu na taj interval), i dodatno smanjuje Vercel
    // trošak u odnosu na prethodnih 60s.
    const id = setInterval(loadFlights, 4 * 60_000);
    return () => clearInterval(id);
  }, [loadFlights]);

  const handleDepartureAction = useCallback(async (f: Flight, action: DepartureActionKey) => {
    const busyKey = `${f.FlightNumber}:${action}`;
    setBusyAction(busyKey);
    const { en, local } = buildDepartureActionTexts(f, action);
    const [r1, r2] = await Promise.all([
      publishAndPreview(en, 'en', 'normal'),
      publishAndPreview(local, 'local', 'normal'),
    ]);
    setBusyAction(null);
    if (!r1.ok || !r2.ok) {
      const err = (!r1.ok ? r1 : r2 as any);
      showAnnouncementError(err, showToast);
      return;
    }
    showToast(`Poslato: ${f.FlightNumber}`, 'success');
  }, [showToast]);

  const handleArrivalAction = useCallback(async (f: Flight, action: ArrivalActionKey) => {
    const busyKey = `${f.FlightNumber}:${action}`;
    setBusyAction(busyKey);
    const { en, local } = buildArrivalActionTexts(f, action);
    const [r1, r2] = await Promise.all([
      publishAndPreview(en, 'en', 'normal'),
      publishAndPreview(local, 'local', 'normal'),
    ]);
    setBusyAction(null);
    if (!r1.ok || !r2.ok) {
      const err = (!r1.ok ? r1 : r2 as any);
      showAnnouncementError(err, showToast);
      return;
    }
    showToast(`Poslato: ${f.FlightNumber}`, 'success');
  }, [showToast]);

  // FIX (po zahtjevu — dugme "preusmjeren u XXXX", radi za OBA tipa
  // leta): otvara inline formu (vidi renderFlightRow niže) umjesto da
  // odmah šalje — mora se prvo otkucati GDJE je let preusmjeren.
  const handleOpenDivert = useCallback((f: Flight) => {
    setDivertingKey(flightRowKey(f));
    setDivertToText('');
  }, []);

  const handleCancelDivert = useCallback(() => {
    setDivertingKey(null);
    setDivertToText('');
  }, []);

  const handleConfirmDivert = useCallback(async (f: Flight) => {
    const dest = divertToText.trim();
    if (!dest) return;
    const busyKey = `${f.FlightNumber}:diverted`;
    setBusyAction(busyKey);
    const en = buildDivertedToEN(f, dest);
    const local = buildDivertedToLocal(f, dest);
    const [r1, r2] = await Promise.all([
      publishAndPreview(en, 'en', 'normal'),
      publishAndPreview(local, 'local', 'normal'),
    ]);
    setBusyAction(null);
    if (!r1.ok || !r2.ok) {
      const err = (!r1.ok ? r1 : r2 as any);
      showAnnouncementError(err, showToast);
      return;
    }
    showToast(`Poslato: ${f.FlightNumber} preusmjeren u ${dest}`, 'success');
    setDivertingKey(null);
    setDivertToText('');
  }, [divertToText, showToast]);

  const remaining = MAX_LENGTH - text.length;
  const emergencyRemaining = MAX_LENGTH - emergencyText.length;

  // FIX (stranica se nije mogla skrolovati): app/globals.css ima
  // globalno pravilo `html, body, #__next { height: 100vh; overflow:
  // hidden !important; }` — namijenjeno kiosk ekranima (gate/checkin/
  // combined) koji NE smiju skrolovati/bounce-ovati. Problem: to
  // pravilo je globalno, pa je pogađalo i ovu (admin) stranicu, čiji
  // sadržaj (notice + hitna poruka + dvije tabele letova + poziv
  // putnika + slobodan tekst + log) je mnogo viši od jednog ekrana.
  // `min-h-screen` (min-height, može rasti) NIJE dovoljno — roditelj
  // (body) je i dalje fiksiran na 100vh sa overflow:hidden, pa se sve
  // preko te granice jednostavno siječe, bez obzira šta ovaj div ima
  // na sebi. Rješenje (isti obrazac kao app/admin/assign-checkin/
  // page.tsx): `h-screen` (FIKSNA visina = tačno 100vh, ne min) +
  // `overflow-y-auto` NA OVOM div-u — sad je OVAJ div taj koji nikad
  // ne prelazi 100vh (nema šta roditelj da siječe), a njegov VLASTITI
  // sadržaj se skroluje unutra.
  return (
    <div className="h-screen overflow-y-auto bg-slate-950 text-white">
      <IdleWarningBanner secondsLeft={idleWarningSeconds} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
              <Radio className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight leading-none">Razglas — kontrolni panel</h1>
              <div className="text-[11px] text-slate-500 tracking-wide uppercase mt-0.5">TIV PA sistem</div>
            </div>
          </div>
          {/* FIX (po zahtjevu — "TTS ne radi na ovoj stranici"): prekidač
              za lokalni pregled — kad je uključen, svaka poslata poruka
              se ODMAH izgovori i OVDJE (potvrda "šta sam poslao"),
              nezavisno od toga da li je /pa otvorena negdje drugo. */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLocalPreviewEnabled(v => !v)}
              title={voiceReady ? `EN: ${enVoiceName} · Lokalni: ${localVoiceName}` : 'Učitavanje glasova…'}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                localPreviewEnabled
                  ? 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {localPreviewEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              Lokalni pregled {localPreviewEnabled ? 'uključen' : 'isključen'}
            </button>
            {/* FIX (po zahtjevu — PA ima sopstvenu sesiju): odjava ovdje
                briše PA-specifičnu sesiju (/api/pa/logout), ne opštu admin
                sesiju — ova stranica se od sad prijavljuje odvojeno. */}
            <button
              onClick={handlePaLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Odjava
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* FIX (po zahtjevu — obavještenje o namjeni panela): /admin je
            dijeljeni login za više funkcija (dodjela gate-ova/šaltera,
            business class konfiguracija, i sad razglas). Ovaj panel je
            NAMJENSKI za osoblje Operativnog centra koje prati cio
            raspored i ima uvid u situaciju na cijelom terminalu — NE za
            stjuardese/ground handling osoblje na samom gate-u, koji
            imaju svoje direktne kanale (radio, interfon) za komunikaciju
            sa putnicima/posadom na licu mjesta. */}
        <div className="flex items-start gap-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4">
          <Info className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-indigo-200">
            <div className="font-bold mb-0.5">Ovaj panel je namijenjen ISKLJUČIVO osoblju Operativnog centra</div>
            <div className="text-indigo-300/80">
              Ne za stjuardese ili ostalo ground handling osoblje na gate-u/šalterima —
              njihova komunikacija sa putnicima i posadom ide preko uobičajenih
              kanala (radio, interfon na gate-u), ne preko razglasa cijelog terminala.
            </div>
            {/* FIX (po zahtjevu — pojašnjenje arhitekture, vidljivo na
                samoj stranici, ne samo u komentaru koda): ovo je bio
                izvor zabune — stranica NE emituje zvuk sama, samo šalje. */}
            <div className="text-indigo-300/60 text-xs mt-2 pt-2 border-t border-indigo-500/20">
              Ova stranica <span className="font-semibold text-indigo-200">šalje</span> poruke —
              stvarno ih <span className="font-semibold text-indigo-200">izgovara</span> odvojen
              ekran (razglas terminala, na drugom uređaju). Uključi &ldquo;Lokalni pregled&rdquo; gore
              desno da odmah čuješ i ovdje šta si poslao.
            </div>
          </div>
        </div>

        {/* ── HITNA PORUKA ────────────────────────────────────────── */}
        <div className="bg-red-950/30 border-2 border-red-700/50 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-red-300 font-black uppercase tracking-wide text-sm">
            <ShieldAlert className="w-5 h-5" /> Hitna poruka
          </div>
          <p className="text-xs text-red-300/70">
            Prekida SVE što se trenutno govori i briše red čekanja — koristi
            samo za stvarne hitne situacije. Radi i noću (jedini tip poruke
            koji zaobilazi noćni režim).
          </p>
          {/* FIX (po zahtjevu — operater mora vidjeti na kom jeziku kuca):
              eksplicitan prekidač PRIJE textarea-e, ne pretpostavka. Boja
              teksta u textarea-i (ispod) se takođe mijenja prema izboru,
              kao dodatna vizuelna potvrda dok se kuca. */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-300/70 font-semibold">Jezik poruke:</span>
            <div className="flex rounded-lg border border-red-700/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setEmergencyLang('en')}
                className={`px-3 py-1 text-xs font-bold transition-colors ${
                  emergencyLang === 'en' ? 'bg-red-600 text-white' : 'bg-red-950/40 text-red-300/60 hover:text-red-200'
                }`}
              >
                🇬🇧 English
              </button>
              <button
                type="button"
                onClick={() => setEmergencyLang('local')}
                className={`px-3 py-1 text-xs font-bold transition-colors ${
                  emergencyLang === 'local' ? 'bg-red-600 text-white' : 'bg-red-950/40 text-red-300/60 hover:text-red-200'
                }`}
              >
                🇲🇪 Crnogorski
              </button>
            </div>
          </div>
          <textarea
            value={emergencyText}
            onChange={e => setEmergencyText(e.target.value.slice(0, MAX_LENGTH))}
            rows={2}
            placeholder={emergencyLang === 'en'
              ? 'Npr: Please evacuate the terminal building immediately via the nearest exit.'
              : 'Npr: Molimo da odmah napustite zgradu terminala kroz najbliži izlaz.'}
            className="w-full rounded-xl bg-red-950/40 border border-red-700/40 text-white placeholder-red-300/30 p-3 text-base outline-none focus:border-red-500 transition-all resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-red-300/60">{emergencyRemaining} karaktera preostalo</span>
            <button
              onClick={() => setEmergencyConfirming(true)}
              disabled={!emergencyText.trim() || sendingEmergency}
              className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-bold transition-colors"
            >
              <AlertTriangle className="w-4 h-4" /> Pošalji hitnu poruku
            </button>
          </div>
        </div>

        {/* ── Odlasci — tabela sortirana po planiranom vremenu ─────── */}
        <div className="bg-slate-800/40 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <PlaneTakeoff className="w-4 h-4" /> Odlasci
            <span className="text-xs text-slate-500 font-normal">({departures.length})</span>
          </div>
          {!loadingFlights && departures.length > 0 && (
            <div className="grid grid-cols-[70px_1fr_60px_1fr] gap-2 px-5 py-2 bg-slate-800/60 border-b border-slate-700 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
              <span>Vrijeme</span><span>Let / Destinacija</span><span>Status</span><span>Akcije</span>
            </div>
          )}
          <div className="divide-y divide-slate-700/50 max-h-[55vh] overflow-y-auto">
            {loadingFlights ? (
              <div className="p-8 text-center text-slate-500 text-sm">Učitavanje letova…</div>
            ) : departures.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Nema aktivnih letova.</div>
            ) : (
              departures.map(f => {
                const rowKey = flightRowKey(f);
                const isDiverting = divertingKey === rowKey;
                return (
                  <div key={rowKey} className="px-5 py-3">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-sm font-mono text-slate-400 w-14 flex-shrink-0 pt-1">{f.ScheduledDepartureTime || '—'}</span>
                      <div className="flex-1 min-w-[160px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-white">{f.FlightNumber}</span>
                          <span className="text-sm text-slate-400">{f.DestinationCityName}</span>
                          {f.GateNumber && <span className="text-xs text-slate-500">gate {f.GateNumber}</span>}
                          {f.CheckInDesk && <span className="text-xs text-slate-500">šalter {f.CheckInDesk}</span>}
                        </div>
                        <span className="text-xs text-slate-500">{f.StatusEN}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 flex-1 justify-end">
                        {DEPARTURE_ACTIONS.map(action => (
                          <button
                            key={action.key}
                            onClick={() => handleDepartureAction(f, action.key)}
                            disabled={busyAction === `${f.FlightNumber}:${action.key}`}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-40 transition-colors ${action.className}`}
                          >
                            {action.label}
                          </button>
                        ))}
                        <button
                          onClick={() => handleOpenDivert(f)}
                          disabled={isDiverting}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border-purple-600/40 disabled:opacity-40 transition-colors"
                        >
                          🔀 Preusmjeren
                        </button>
                      </div>
                    </div>
                    {isDiverting && (
                      <DivertInlineForm
                        value={divertToText}
                        onChange={setDivertToText}
                        onConfirm={() => handleConfirmDivert(f)}
                        onCancel={handleCancelDivert}
                        busy={busyAction === `${f.FlightNumber}:diverted`}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Dolasci — tabela sortirana po planiranom vremenu ─────── */}
        <div className="bg-slate-800/40 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <PlaneLanding className="w-4 h-4" /> Dolasci
            <span className="text-xs text-slate-500 font-normal">({arrivals.length})</span>
          </div>
          {!loadingFlights && arrivals.length > 0 && (
            <div className="grid grid-cols-[70px_1fr_60px_1fr] gap-2 px-5 py-2 bg-slate-800/60 border-b border-slate-700 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
              <span>Vrijeme</span><span>Let / Porijeklo</span><span>Status</span><span>Akcije</span>
            </div>
          )}
          <div className="divide-y divide-slate-700/50 max-h-[55vh] overflow-y-auto">
            {loadingFlights ? (
              <div className="p-8 text-center text-slate-500 text-sm">Učitavanje letova…</div>
            ) : arrivals.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Nema aktivnih letova.</div>
            ) : (
              arrivals.map(f => {
                const rowKey = flightRowKey(f);
                const isDiverting = divertingKey === rowKey;
                return (
                  <div key={rowKey} className="px-5 py-3">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-sm font-mono text-slate-400 w-14 flex-shrink-0 pt-1">{f.ScheduledDepartureTime || '—'}</span>
                      <div className="flex-1 min-w-[160px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-white">{f.FlightNumber}</span>
                          <span className="text-sm text-slate-400">{f.DestinationCityName}</span>
                        </div>
                        <span className="text-xs text-slate-500">{f.StatusEN}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 flex-1 justify-end">
                        {ARRIVAL_ACTIONS.map(action => (
                          <button
                            key={action.key}
                            onClick={() => handleArrivalAction(f, action.key)}
                            disabled={busyAction === `${f.FlightNumber}:${action.key}`}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-40 transition-colors ${action.className}`}
                          >
                            {action.label}
                          </button>
                        ))}
                        <button
                          onClick={() => handleOpenDivert(f)}
                          disabled={isDiverting}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border-purple-600/40 disabled:opacity-40 transition-colors"
                        >
                          🔀 Preusmjeren
                        </button>
                      </div>
                    </div>
                    {isDiverting && (
                      <DivertInlineForm
                        value={divertToText}
                        onChange={setDivertToText}
                        onConfirm={() => handleConfirmDivert(f)}
                        onCancel={handleCancelDivert}
                        busy={busyAction === `${f.FlightNumber}:diverted`}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Poziv putnika ───────────────────────────────────────── */}
        <div className="bg-slate-800/40 rounded-2xl border border-slate-700 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <UserSearch className="w-4 h-4" /> Poziv putnika
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={passengerName}
              onChange={e => setPassengerName(e.target.value)}
              placeholder="Ime i prezime putnika"
              className="rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 p-3 text-sm outline-none focus:border-sky-400/60"
            />
            <input
              value={pageFlightNumber}
              onChange={e => setPageFlightNumber(e.target.value.toUpperCase())}
              placeholder="Broj leta (npr. JU683)"
              className="rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 p-3 text-sm outline-none focus:border-sky-400/60"
            />
            <input
              value={pageDestination}
              onChange={e => setPageDestination(e.target.value)}
              placeholder="Destinacija (npr. Beograd)"
              className="rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 p-3 text-sm outline-none focus:border-sky-400/60"
            />
            <div className="flex gap-2">
              <select
                value={pageLocationType}
                onChange={e => setPageLocationType(e.target.value as PageLocationType)}
                className="flex-1 rounded-xl bg-white/5 border border-white/15 text-white p-3 text-sm outline-none focus:border-sky-400/60"
              >
                <option value="gate" className="bg-slate-800">Gate</option>
                <option value="checkin" className="bg-slate-800">Check-in šalter</option>
                <option value="info" className="bg-slate-800">Info pult</option>
              </select>
              {pageLocationType !== 'info' && (
                <input
                  value={pageLocationNumber}
                  onChange={e => setPageLocationNumber(e.target.value)}
                  placeholder="Broj"
                  className="w-20 rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 p-3 text-sm outline-none focus:border-sky-400/60"
                />
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSendPage}
              disabled={sendingPage}
              className="flex items-center gap-2 px-6 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 rounded-xl text-sm font-bold transition-colors"
            >
              <Send className="w-4 h-4" /> {sendingPage ? 'Šalje se…' : 'Pozovi putnika'}
            </button>
          </div>
        </div>

        {/* ── Slobodan tekst ──────────────────────────────────────── */}
        <div className="bg-slate-800/40 rounded-2xl border border-slate-700 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <MessageSquare className="w-4 h-4" /> Slobodan tekst <span className="text-xs text-slate-500 font-normal">(izgovara se na engleskom)</span>
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value.slice(0, MAX_LENGTH))}
            rows={3}
            placeholder="Npr: Would passenger John Smith please proceed to the information desk."
            className="w-full rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 p-3 text-base outline-none focus:border-sky-400/60 focus:bg-white/10 transition-all resize-none"
          />
          <div className="flex items-center justify-between">
            <span className={`text-xs ${remaining < 50 ? 'text-amber-400' : 'text-slate-500'}`}>{remaining} karaktera preostalo</span>
            <button
              onClick={handleSendText}
              disabled={sendingText || !text.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-xl text-sm font-bold transition-colors"
            >
              <Send className="w-4 h-4" /> {sendingText ? 'Šalje se…' : 'Objavi'}
            </button>
          </div>
        </div>

        <div className="bg-slate-800/40 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700 text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Poslato u ovoj sesiji (slobodan tekst)
          </div>
          <div className="divide-y divide-slate-700/50 max-h-[30vh] overflow-y-auto">
            {recentlySent.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Još ništa poslato.</div>
            ) : (
              recentlySent.map(a => (
                <div key={a.id} className="px-5 py-3">
                  <div className="text-xs text-slate-500 font-mono mb-1">
                    {new Date(a.publishedAt).toLocaleTimeString('en-GB')}
                  </div>
                  <div className="text-sm">{a.text}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Dupla potvrda za hitnu poruku — namjerno modalni overlay,
          ne samo drugi klik na isto dugme, da se stvarno mora
          eksplicitno POTVRDITI namjera (sprječava slučajan klik). ── */}
      {emergencyConfirming && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 z-[200]">
          <div className="bg-slate-900 border-2 border-red-600 rounded-2xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center gap-2 text-red-400 font-black uppercase tracking-wide">
              <ShieldAlert className="w-6 h-6" /> Da li ste sigurni?
            </div>
            <p className="text-sm text-slate-300">
              Ova poruka će ODMAH prekinuti sve što se trenutno govori na
              razglasu i obrisati red čekanja. Radi i noću.
            </p>
            <div className="bg-red-950/40 border border-red-700/40 rounded-xl p-3 text-sm text-white">
              <div className="text-[10px] font-bold text-red-400 uppercase tracking-wide mb-1">
                {emergencyLang === 'en' ? '🇬🇧 Čita se na engleskom' : '🇲🇪 Čita se na crnogorskom'}
              </div>
              {emergencyText}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEmergencyConfirming(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-semibold transition-colors"
              >
                <X className="w-4 h-4" /> Otkaži
              </button>
              <button
                onClick={handleConfirmEmergency}
                disabled={sendingEmergency}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-colors"
              >
                <AlertTriangle className="w-4 h-4" /> {sendingEmergency ? 'Šalje se…' : 'Da, pošalji hitnu poruku'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
