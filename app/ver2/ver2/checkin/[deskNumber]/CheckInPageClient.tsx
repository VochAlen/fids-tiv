'use client';

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  memo, useMemo,
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useParams } from 'next/navigation';
import {
  CheckCircle,
  Clock,
  MapPin,
  Users,
  AlertCircle,
  Info,
  XCircle,
  Plane,
} from 'lucide-react';
import Image from 'next/image';
import { useAdImages } from '@/hooks/useAdImages';
// FIX (portovano iz glavnog/polling sistema — potrebno za praznične
// kampanje ispod, koje su datum-zasnovane, ne noćni-režim-zasnovane):
// getPodgoricaDateString je jedino što nam treba odavde — isNightHours
// namjerno OSTAJE van upotrebe u ovom Ably sistemu (drugačiji model
// troška, ne treba polling-skip logika).
import { getPodgoricaDateString } from '@/lib/night-hours';
import { getInitialAirlineLogoSrc } from '@/lib/airline-logo';
import { useRealtimeFlightData } from '@/hooks/useRealtimeFlightData';
import { useRealtimeAssignments } from '@/hooks/useRealtimeAssignments';
import { useBodyBackground } from '@/hooks/use-body-background';
import { Flight } from '@/types/flight';

// ============================================================
// KONSTANTE
// ============================================================
const POLL_INTERVAL = 25_000; // Svako 15s provjerava admin promjene
const AD_SWITCH_INTERVAL = 15_000;
// ── NOVO: jitter da se izbjegne sinhronizacija svih check-in ekrana ──
const getIntervalWithJitter = () => POLL_INTERVAL + Math.floor(Math.random() * 5_000);


const BLUR_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

  const isBAFlight = (flightNumber: string): boolean =>
  flightNumber.toUpperCase().startsWith('BA');

  const EASYJET_PREFIXES = ['U2', 'EZY']; // U2 = IATA kod, EZY = ICAO (za svaki slučaj)

const isEasyJetFlight = (flightNumber: string, airlineName?: string): boolean => {
  const name = (airlineName || '').toLowerCase().replace(/\s+/g, '');
  if (name.includes('easyjet')) return true;
  const fn = flightNumber.toUpperCase();
  return EASYJET_PREFIXES.some(prefix => fn.startsWith(prefix));
};

const EASYJET_IMAGES: Record<string, string> = {
  PLUS: '/easyjet/easyjet_plus.avif',
};

// FIX (portovano iz glavnog/polling sistema — kompletan set praznik/
// avio-kompanija kampanja koje su tamo dodate poslije ove Ably grane):
// Lufthansa Group, Sundor/El Al, Israir, Arkia, i fiksni nacionalni
// praznici. Sva logika je identična; jedina prilagodba je stil
// prikaza (ovaj fajl koristi goli <img>, ne next/image <Image>, u
// AdBanner-u — vidi ispod).

// ── Lufthansa Group (Lufthansa + Austrian) — bez classType uslova,
// SVAKI LH/OS let dobija fiksnu grupnu sliku ──
const LUFTHANSA_GROUP_PREFIXES = ['LH', 'OS'];

const isLufthansaGroupFlight = (flightNumber: string, airlineName?: string): boolean => {
  const name = (airlineName || '').toLowerCase().replace(/\s+/g, '');
  if (name.includes('lufthansa') || name.includes('austrian')) return true;
  const fn = flightNumber.toUpperCase();
  return LUFTHANSA_GROUP_PREFIXES.some(prefix => fn.startsWith(prefix));
};

const LUFTHANSA_GROUP_IMAGE = '/lufthansa/LH_group.avif';

// ── Sundor holiday kampanja (El Al grupa) — vremenski ograničena,
// prati POKRETNI hebrejski kalendar (nije fiksan svake godine). Vidi
// opširan komentar u glavnom/polling sistemu za pun kontekst —
// identično prenesen ovdje bez izmjena. 2026 red je POTVRĐEN, 2027/2028
// su PROCJENA — provjeriti prije tih godina.
interface SundorHolidayWindow { start: string; end: string }
const SUNDOR_HOLIDAY_WINDOWS: SundorHolidayWindow[] = [
  { start: '2026-09-11', end: '2026-10-03' }, // POTVRĐENO — Roš Hašana → Šemini Aceret 5787
  { start: '2027-10-01', end: '2027-10-23' }, // PROCJENA — provjeriti prije 2027
  { start: '2028-09-20', end: '2028-10-12' }, // PROCJENA — provjeriti prije 2028
];

function isWithinSundorHolidayWindow(): boolean {
  const today = getPodgoricaDateString();
  return SUNDOR_HOLIDAY_WINDOWS.some(w => today >= w.start && today <= w.end);
}

const isElAlFlight = (flightNumber: string, airlineName?: string): boolean => {
  const name = (airlineName || '').toLowerCase().replace(/[\s-]+/g, '');
  if (name.includes('elal')) return true;
  return flightNumber.toUpperCase().startsWith('LY');
};

// Israir (6H/ISR) i Arkia (IZ/AIZ) — ista kampanja, ista vremenska
// prozora kao El Al/Sundor.
const isIsrairFlight = (flightNumber: string, airlineName?: string): boolean => {
  const name = (airlineName || '').toLowerCase().replace(/[\s-]+/g, '');
  if (name.includes('israir')) return true;
  return flightNumber.toUpperCase().startsWith('6H');
};

const isArkiaFlight = (flightNumber: string, airlineName?: string): boolean => {
  const name = (airlineName || '').toLowerCase().replace(/[\s-]+/g, '');
  if (name.includes('arkia')) return true;
  return flightNumber.toUpperCase().startsWith('IZ');
};

const ISRAIR_HOLIDAY_IMAGE = '/israir/israir-holiday.avif';
const ARKIA_HOLIDAY_IMAGE  = '/arkia/arkia-holiday.avif';

// FIX (po zahtjevu — stvaran fajl u projektu je .avif, ne .jpg):
// pojednostavljeno na isti, direktan obrazac kao Israir/Arkia iznad
// (bez jpg→avif onError fallback komplikacije, koja je ranije postojala
// jer nismo znali unaprijed koji tačno fajl postoji na serveru).
const SUNDOR_HOLIDAY_IMAGE = '/sundor/sundor-holiday.avif';

// ── Fiksni nacionalni/aerodromski praznici — FIKSNI gregorijanski
// datumi koji se ponavljaju svake godine, ne zavise od avio kompanije.
interface FixedHolidayImage {
  image: string;
  startMonth: number; startDay: number;
  endMonth: number;   endDay: number;
}

const FIXED_HOLIDAY_IMAGES: FixedHolidayImage[] = [
  { image: '/praznici/21maj.avif',          startMonth: 5,  startDay: 20, endMonth: 5,  endDay: 22 },
  { image: '/praznici/13jul.avif',          startMonth: 7,  startDay: 13, endMonth: 7,  endDay: 14 },
  { image: '/praznici/newyear.avif',        startMonth: 12, startDay: 23, endMonth: 1,  endDay: 14 }, // wraparound preko Nove godine
  { image: '/praznici/civil-aviation.avif', startMonth: 12, startDay: 7,  endMonth: 12, endDay: 7  },
];

function isWithinFixedHolidayWindow(h: FixedHolidayImage, month: number, day: number): boolean {
  const mmdd = month * 100 + day;
  const startMmdd = h.startMonth * 100 + h.startDay;
  const endMmdd = h.endMonth * 100 + h.endDay;
  if (startMmdd <= endMmdd) return mmdd >= startMmdd && mmdd <= endMmdd;
  return mmdd >= startMmdd || mmdd <= endMmdd; // wraparound
}

function getFixedHolidayImage(): string | null {
  const dateStr = getPodgoricaDateString(); // "YYYY-MM-DD"
  const month = parseInt(dateStr.slice(5, 7), 10);
  const day = parseInt(dateStr.slice(8, 10), 10);
  const match = FIXED_HOLIDAY_IMAGES.find(h => isWithinFixedHolidayWindow(h, month, day));
  return match ? match.image : null;
}



const BA_IMAGES: Record<string, string> = {
  BUSINESS: '/british/ba1.avif',
  ECONOMY:  '/british/ba2.avif',
};
const CSS_ANIMATIONS = `
  .gpu-accelerated{transform:translateZ(0);backface-visibility:hidden;will-change:opacity,transform}.ad-image-container,.aspect-ratio-box{position:relative;overflow:hidden}.ad-image,.aspect-ratio-box>div{position:absolute;inset:0}.aspect-ratio-box::before{content:'';display:block;padding-bottom:62.5%}.ad-image{width:100%;height:100%;transition:opacity .5s ease-in-out;will-change:opacity}.ad-image.active{opacity:1;z-index:2}.ad-image.inactive{opacity:0;z-index:1}@media (prefers-reduced-motion:reduce){.ad-image,.animate-pulse,.animate-spin,.gpu-accelerated{transition:none!important;animation:none!important;will-change:auto!important;opacity:1!important}}
`;

// ============================================================
// TIPOVI
// ============================================================
interface DeskAssignment {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  airlineName: string;
  destinationCity: string;
  destinationCode: string;
  scheduledTime: string;
  estimatedTime: string;
  gateNumber: string;
  logoUrl: string;
  cityUrl: string;
  classType: string | null;
  isCancelled: boolean;
  isDiverted: boolean;
  codeshareFlights: string[];
  setAt: number | null;
}

const EMPTY_ASSIGNMENT: DeskAssignment = {
  status: null,
  flightNumber: '',
  airlineName: '',
  destinationCity: '',
  destinationCode: '',
  scheduledTime: '',
  estimatedTime: '',
  gateNumber: '',
  logoUrl: '',
  cityUrl: '',
  classType: null,
  isCancelled: false,
  isDiverted: false,
  codeshareFlights: [],
  setAt: null,
};

// ============================================================
// ERROR BOUNDARY
// ============================================================
class CheckInErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('🚨 CheckIn ErrorBoundary:', error, info);
    setTimeout(() => this.setState({ hasError: false, message: '' }), 10_000);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white gap-6">
          <CheckCircle className="w-24 h-24 text-green-400 opacity-30 animate-pulse" />
          <div className="text-4xl font-bold opacity-60">Reconnecting...</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// AIRLINE LOGO
// ============================================================
const AirlineLogo = memo(function AirlineLogo({
  logoUrl,
  airlineName,
  portrait,
}: {
  logoUrl: string;
  airlineName: string;
  portrait: boolean;
}) {
const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  if (img.dataset.fallback === 'true') return; // već smo probali fallback, stop
  img.dataset.fallback = 'true';
  img.src = '/airlines/placeholder.avif';
}, []);

  if (!logoUrl) return null;

// AirlineLogo komponenta - portrait verzija
if (portrait) {
  return (
    <div className="relative w-full max-w-[90vw] bg-white rounded-xl shadow-lg mb-3 flex items-center justify-center" style={{ height: 'clamp(120px, 18vh, 280px)' }}>
      <Image
        src={logoUrl}
        alt={airlineName}
        width={800}
        height={400}
        className="object-contain p-4 w-full h-full"
        priority
        fetchPriority="high"
        loading="eager"
        decoding="async"
        unoptimized
        onError={handleError}
      />
    </div>
  );
}

return (
    <div className="w-72 h-36 bg-white rounded-2xl p-3 shadow-lg flex items-center justify-center flex-shrink-0">
      <Image
        src={logoUrl}
        alt={airlineName}
        width={360}
        height={120}
        className="object-contain w-full h-full"
        priority
        decoding="async"
        unoptimized
        onError={handleError}
      />
    </div>
  );
});

// ============================================================
// CITY IMAGE
// ============================================================
const CityImage = memo(function CityImage({
  cityUrl,
  destinationCity,
  portrait,
}: {
  cityUrl: string;
  destinationCity: string;
  portrait: boolean;
}) {
  if (!cityUrl) return null;
  const sizeClass = portrait ? 'w-56 h-56' : 'w-80 h-80';
  return (
    <div
      className={`relative ${sizeClass} rounded-3xl overflow-hidden border-4 border-white/30 shadow-2xl flex-shrink-0 aspect-ratio-box`}
    >
      <Image
        src={cityUrl}
        alt={destinationCity}
        fill
        className="object-cover"
        priority
        quality={90}
        sizes={portrait ? '224px' : '320px'}
        placeholder="blur"
        blurDataURL={BLUR_DATA_URL}
        decoding="async"
        unoptimized
      />
      <div className="absolute inset-0 bg-linear-to-t from-black/50 to-transparent" />
    </div>
  );
});

// ============================================================
// AD BANNER
// ============================================================
const AdBanner = memo(function AdBanner({
  adImages,
  currentIndex,
  nextIndex,
  isTransitioning,
  baImageSrc,
  overrideImageSrc, // ← NOVO — generički override (easyJet, ili bilo šta ubuduće)
  lufthansaImageSrc,
  sundorHolidayImageSrc,
  israirHolidayImageSrc,
  arkiaHolidayImageSrc,
  fixedHolidayImageSrc,
}: {
  adImages: string[];
  currentIndex: number;
  nextIndex: number;
  isTransitioning: boolean;
  baImageSrc: string | null;
  overrideImageSrc?: string | null; // ← NOVO
  lufthansaImageSrc?: string | null;
  sundorHolidayImageSrc?: string | null;
  israirHolidayImageSrc?: string | null;
  arkiaHolidayImageSrc?: string | null;
  fixedHolidayImageSrc?: string | null;
}) {
  // FIX (po zahtjevu — stvaran fajl je .avif, pojednostavljeno na isti
  // direktan obrazac kao Israir/Arkia ispod, umjesto posebne
  // SundorHolidayBanner komponente sa jpg→avif fallback logikom koja
  // više nije potrebna): Sundor/El Al je i dalje NAMJERNO prva
  // provjera, prije BA/easyJet/Lufthansa — vremenski ograničena
  // promotivna kampanja treba prioritet.
  if (sundorHolidayImageSrc) {
    return (
      <div
        style={{ flex: '1 1 0%', minHeight: '200px' }}
        className="rounded-xl overflow-hidden relative"
      >
        <img
          src={sundorHolidayImageSrc}
          alt="Sundor Holiday"
          className="absolute inset-0 w-full h-full object-fill"
          decoding="async"
        />
      </div>
    );
  }

  // Israir/Arkia — ista prioritetska grupa kao Sundor/El Al iznad.
  if (israirHolidayImageSrc) {
    return (
      <div
        style={{ flex: '1 1 0%', minHeight: '200px' }}
        className="rounded-xl overflow-hidden relative"
      >
        <img
          src={israirHolidayImageSrc}
          alt="Israir Holiday"
          className="absolute inset-0 w-full h-full object-fill"
          decoding="async"
        />
      </div>
    );
  }

  if (arkiaHolidayImageSrc) {
    return (
      <div
        style={{ flex: '1 1 0%', minHeight: '200px' }}
        className="rounded-xl overflow-hidden relative"
      >
        <img
          src={arkiaHolidayImageSrc}
          alt="Arkia Holiday"
          className="absolute inset-0 w-full h-full object-fill"
          decoding="async"
        />
      </div>
    );
  }

  if (baImageSrc) {
    return (
      <div
        style={{ flex: '1 1 0%', minHeight: '200px' }}
        className="rounded-xl overflow-hidden relative"
      >
        <img
          src={baImageSrc}
          alt="British Airways"
          className="absolute inset-0 w-full h-full object-fill"
          decoding="async"
        />
      </div>
    );
  }

  // ── NOVO: generički override (npr. easyJet Plus) ──
  if (overrideImageSrc) {
    return (
      <div
        style={{ flex: '1 1 0%', minHeight: '200px' }}
        className="rounded-xl overflow-hidden relative"
      >
        <img
          src={overrideImageSrc}
          alt="easyJet Plus"
          className="absolute inset-0 w-full h-full object-fill"
          decoding="async"
        />
      </div>
    );
  }

  // ── Lufthansa Group (LH/OS) override ──
  if (lufthansaImageSrc) {
    return (
      <div
        style={{ flex: '1 1 0%', minHeight: '200px' }}
        className="rounded-xl overflow-hidden relative"
      >
        <img
          src={lufthansaImageSrc}
          alt="Lufthansa Group"
          className="absolute inset-0 w-full h-full object-fill"
          decoding="async"
        />
      </div>
    );
  }

  // ── Fiksni nacionalni/aerodromski praznici — NAMJERNO poslije svih
  // avio-kompanija-specifičnih override-a, ali PRIJE generičke
  // rotacije reklama ispod (isti redosled kao glavni sistem). ──
  if (fixedHolidayImageSrc) {
    return (
      <div
        style={{ flex: '1 1 0%', minHeight: '200px' }}
        className="rounded-xl overflow-hidden relative"
      >
        <img
          src={fixedHolidayImageSrc}
          alt="Holiday"
          className="absolute inset-0 w-full h-full object-fill"
          decoding="async"
        />
      </div>
    );
  }

  if (!adImages.length) return null;
  return (
    <div
      style={{ flex: '1 1 0%', minHeight: '200px' }}
      className="bg-slate-800 rounded-xl overflow-hidden relative"
    >
      <img
        src={adImages[currentIndex]}
        alt="Advertisement"
        className={`absolute inset-0 w-full h-full object-fill ad-image ${isTransitioning ? 'inactive' : 'active'}`}
        decoding="async"
      />
      <img
        src={adImages[nextIndex]}
        alt="Advertisement"
        className={`absolute inset-0 w-full h-full object-fill ad-image ${isTransitioning ? 'active' : 'inactive'}`}
        decoding="async"
      />
    </div>
  );
});
// ============================================================
// GLAVNA KOMPONENTA — klijentska logika (nepromijenjena)
// ============================================================
export default function CheckInPageClient() {
  return (
    <CheckInErrorBoundary>
      <CheckInDisplay />
    </CheckInErrorBoundary>
  );
}

function CheckInDisplay() {
  const params = useParams();
  const deskNumberParam = params.deskNumber as string;

  // FIX (po zahtjevu — bijela pozadina "probija" kroz ekran): vidi
  // opširan komentar u hooks/use-body-background.ts za pun kontekst.
  // Postavlja PRAVU tamnu body pozadinu dok je ova kiosk stranica
  // aktivna, sprečavajući bijeli "bljesak" pri elastic overscroll-u.
  useBodyBackground('#0f172a');

  const [assignment, setAssignment] = useState<DeskAssignment>(EMPTY_ASSIGNMENT);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [isPortrait, setIsPortrait] = useState(false);
  const { data: liveFlightData } = useRealtimeFlightData('checkin');
const { deskEntries } = useRealtimeAssignments('checkin');

  // Ad state
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [nextAdIndex, setNextAdIndex] = useState(1);
  const [isAdTransitioning, setIsAdTransitioning] = useState(false);

const isMountedRef = useRef(true);
  const orientationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlightNumberRef = useRef<string>('');
  const logoCacheRef = useRef<Map<string, string>>(new Map());
  // Dodaj pored ostalih refova:
const detailsLoadedRef = useRef<boolean>(false);


  const { adImages } = useAdImages();
  // BA override za ad banner
const baAdImage = useMemo((): string | null => {
  if (!isBAFlight(assignment.flightNumber)) return null;
  if (assignment.classType === 'BUSINESS') return BA_IMAGES.BUSINESS;
  if (assignment.classType === 'ECONOMY')  return BA_IMAGES.ECONOMY;
  return null;
}, [assignment.flightNumber, assignment.classType]);
// easyJet Plus override za ad banner
const easyJetOverrideImage = useMemo((): string | null => {
  if (!isEasyJetFlight(assignment.flightNumber, assignment.airlineName)) return null;
  if (assignment.classType === 'EASYJET_PLUS') return EASYJET_IMAGES.PLUS;
  return null;
}, [assignment.flightNumber, assignment.airlineName, assignment.classType]);

// FIX (portovano iz glavnog/polling sistema): Lufthansa Group — bez
// classType uslova, svaki LH/OS let dobija fiksnu grupnu sliku.
const lufthansaGroupImage = useMemo((): string | null => {
  if (!isLufthansaGroupFlight(assignment.flightNumber, assignment.airlineName)) return null;
  return LUFTHANSA_GROUP_IMAGE;
}, [assignment.flightNumber, assignment.airlineName]);

// Sundor holiday kampanja (El Al grupa) — vremenski ograničena. Provjera
// datuma NIJE u dependency nizu — namjerno, isti razlog kao glavni
// sistem (datum se mijenja jednom dnevno, rijedak prelaz se pokupi na
// sledeći put kad se ekran ionako osvježi/re-renderuje preko realtime
// podataka).
const showSundorHoliday = useMemo((): boolean => {
  if (!isElAlFlight(assignment.flightNumber, assignment.airlineName)) return false;
  return isWithinSundorHolidayWindow();
}, [assignment.flightNumber, assignment.airlineName]);

// Ista kampanja, Israir i Arkia — identičan obrazac kao showSundorHoliday.
const showIsrairHoliday = useMemo((): boolean => {
  if (!isIsrairFlight(assignment.flightNumber, assignment.airlineName)) return false;
  return isWithinSundorHolidayWindow();
}, [assignment.flightNumber, assignment.airlineName]);

const showArkiaHoliday = useMemo((): boolean => {
  if (!isArkiaFlight(assignment.flightNumber, assignment.airlineName)) return false;
  return isWithinSundorHolidayWindow();
}, [assignment.flightNumber, assignment.airlineName]);

// Fiksni nacionalni/aerodromski praznici — NAMJERNO BEZ useMemo (isti
// razlog kao glavni sistem): zavisi ISKLJUČIVO od današnjeg datuma, ne
// od trenutnog leta, pa mora da se provjeri na svakom renderu da bi se
// primijetio prelaz preko ponoći (npr. 23.12. kad treba da se upali
// novogodišnja slika). Jeftina provjera (par brojeva, 4 stavke).
const fixedHolidayImage = getFixedHolidayImage();

  // ── CSS injection ──────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById('checkin-animations')) return;
    const el = document.createElement('style');
    el.id = 'checkin-animations';
    el.textContent = CSS_ANIMATIONS;
    document.head.appendChild(el);
    return () => { document.getElementById('checkin-animations')?.remove(); };
  }, []);

  // ── Kiosk mode ─────────────────────────────────────────────
  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', preventDefault);
    document.addEventListener('selectstart', preventDefault);
    document.addEventListener('dragstart', preventDefault);
    return () => {
      document.removeEventListener('contextmenu', preventDefault);
      document.removeEventListener('selectstart', preventDefault);
      document.removeEventListener('dragstart', preventDefault);
    };
  }, []);

  
  // ── v5: Memory pressure auto-reload ──────────────────────
  // Chrome na 24/7 kiosk ekranima polako curi memoriju (Ably
  // poruke, image cache, DOM čvorovi). Kad usedJSHeapSize pređe
  // 85% jsHeapSizeLimit (~2GB po tabu), radimo auto-reload prije
  // nego kiosk postane vidljivo spor/nezgledan.
  useEffect(() => {
    const checkMemory = () => {
      const perf = performance;
      if (perf?.memory) {
        const used = perf.memory.usedJSHeapSize;
        const limit = perf.memory.jsHeapSizeLimit;
        const pct = used / limit;
        if (pct > 0.85) {
          console.warn(`Memory pressure ${Math.round(pct * 100)}% — auto reload`);
          window.location.reload();
        }
      }
    };
    const id = setInterval(checkMemory, 60_000);
    return () => clearInterval(id);
  }, []);


  // ── v5.3: Network disconnection auto-recovery ────────────
  // Kad aerodromski WiFi/Ethernet padne, Ably pokušava reconnect
  // (svake 2s), a fallback polling pada. Kad se mreža vrati,
  // radimo full reload da sinhronizujemo React state sa serverom.
  useEffect(() => {
    const handleOnline = () => {
      console.warn('Network restored — reloading to resync state');
      window.location.reload();
    };
    const handleOffline = () => {
      console.warn('Network lost — Ably will retry, showing cached data');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── v5.3: Visibilitychange — auto-focus kiosk tab ────────
  // Ako neko otvori drugi prozor preko kiosk taba (Windows update
  // dialog, notifikacija), kiosk tab ode u pozadinu. Chrome ga
  // može throttlovati. Ovo vraća fokus, ili radi reload ako ne može.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        console.warn('Kiosk tab lost focus — attempting to refocus');
        window.focus();
        setTimeout(() => {
          if (document.hidden) {
            window.location.reload();
          }
        }, 2_000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);
// ── Hard reset svakih ~6h (sa jitterom da se izbjegne sinhroni
  // reload svih desk ekrana u istoj sekundi) ──────────────────
  useEffect(() => {
    const jitteredResetMs = 6 * 60 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000); // +0 do 30 min
    const id = setTimeout(() => window.location.reload(), jitteredResetMs);
    return () => clearTimeout(id);
  }, []);

  // ── v4 FIX: isMountedRef cleanup ────────────────────────────
  // Ranije je isMountedRef.current bio true zauvijek — provjere
  // `if (!isMountedRef.current) return` su bile mrtav kod.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (orientationTimeoutRef.current) {
        clearTimeout(orientationTimeoutRef.current);
        orientationTimeoutRef.current = null;
      }
    };
  }, []);

  // ── Reset praćenja leta pri promjeni šaltera ────────────────
  useEffect(() => {
    lastFlightNumberRef.current = '';
  }, [deskNumberParam]);

  // ── Debounced orientation ──────────────────────────────────
  useEffect(() => {
    const check = () => setIsPortrait(window.innerHeight > window.innerWidth);
    check();
    const debounced = () => {
      if (orientationTimeoutRef.current) clearTimeout(orientationTimeoutRef.current);
      orientationTimeoutRef.current = setTimeout(check, 200);
    };
    window.addEventListener('resize', debounced, { passive: true });
    return () => {
      window.removeEventListener('resize', debounced);
      if (orientationTimeoutRef.current) clearTimeout(orientationTimeoutRef.current);
    };
  }, []);

  // ── Ad crossfade ───────────────────────────────────────────
  // v4 FIX: ugniježđeni setTimeout-ovi (100ms, 300ms) se čiste
  // na unmount-u da ne pozovu setState na unmount-ovanoj komponenti.
  useEffect(() => {
    if (adImages.length < 2) return;
    let inner1: ReturnType<typeof setTimeout> | null = null;
    let inner2: ReturnType<typeof setTimeout> | null = null;
    const id = setInterval(() => {
      setIsAdTransitioning(true);
      inner1 = setTimeout(() => {
        setNextAdIndex((currentAdIndex + 1) % adImages.length);
        inner2 = setTimeout(() => {
          setCurrentAdIndex((p) => (p + 1) % adImages.length);
          setIsAdTransitioning(false);
        }, 300);
      }, 100);
    }, AD_SWITCH_INTERVAL);
    return () => {
      clearInterval(id);
      if (inner1) clearTimeout(inner1);
      if (inner2) clearTimeout(inner2);
    };
  }, [adImages, currentAdIndex]);

//polling
const computeAssignment = useCallback(async () => {
  if (!isMountedRef.current) return;
  if (!deskNumberParam) return;

  const myData = deskEntries[deskNumberParam] ?? { status: null, flightNumber: '', classType: null, setAt: null };

  setLastUpdate(new Date().toLocaleTimeString('en-GB'));
  setLoading(false);

if (!myData.flightNumber || myData.status === null) {
  lastFlightNumberRef.current = '';
  detailsLoadedRef.current = false; // ← NOVO
  setAssignment(EMPTY_ASSIGNMENT);
  return;
}

const classType: string | null = myData.classType ?? null;

// Isti let – samo ako su detalji već uspješno učitani ranije
if (myData.flightNumber === lastFlightNumberRef.current && detailsLoadedRef.current) {
  setAssignment(prev => ({
    ...prev,
    status: myData.status as 'open' | 'closed',
    classType,
    setAt: myData.setAt || null,
  }));
  return;
}

lastFlightNumberRef.current = myData.flightNumber;

let flightDetails: Partial<Flight> = {};
if (liveFlightData) {
  const allFlights: Flight[] = [
    ...(liveFlightData.departures || []),
    ...(liveFlightData.arrivals || []),
  ];
  const match = allFlights.find((f: Flight) => f.FlightNumber === myData.flightNumber);
  if (match) {
    flightDetails = match;
    detailsLoadedRef.current = true;   // ← NOVO — uspjeh, ubuduće koristi brzu granu
  } else {
    detailsLoadedRef.current = false;  // ← NOVO — probaj ponovo idući put
  }
} else {
  detailsLoadedRef.current = false;    // ← NOVO — liveFlightData još nije stigao, probaj ponovo
}

const icao = flightDetails.AirlineICAO || myData.flightNumber.substring(0, 2).toUpperCase();
let logoUrl = '/airlines/placeholder.jpg';
if (icao) {
  const cachedLogo = logoCacheRef.current.get(icao);
  if (cachedLogo) {
    logoUrl = cachedLogo;
  } else {
    logoUrl = getInitialAirlineLogoSrc(icao, '/airlines/placeholder.jpg');
    logoCacheRef.current.set(icao, logoUrl);
  }
}

const destCode = flightDetails.DestinationAirportCode || '';
const cityUrl = destCode ? `/city-images/${destCode.toLowerCase()}.jpg` : '';
const statusStr = flightDetails.StatusEN || '';
const sl = statusStr.toLowerCase().trim();
const isCancelled = sl.includes('cancelled') || sl.includes('canceled') || sl.includes('annulé') || sl.includes('otkazan');
const isDiverted = sl.includes('diverted') || sl.includes('preusmjeren') || sl.includes('dévié');

setAssignment({
  status: myData.status as 'open' | 'closed',
  flightNumber: myData.flightNumber,
  airlineName: flightDetails.AirlineName || '',
  destinationCity: flightDetails.DestinationCityName || '',
  destinationCode: destCode,
  scheduledTime: flightDetails.ScheduledDepartureTime || '',
  estimatedTime: flightDetails.EstimatedDepartureTime || '',
  gateNumber: flightDetails.GateNumber || '',
  logoUrl, cityUrl, classType, isCancelled, isDiverted,
  codeshareFlights: flightDetails.CodeShareFlights || [],
  setAt: myData.setAt || null,
});
}, [deskNumberParam, deskEntries, liveFlightData]);

useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  computeAssignment();
}, [computeAssignment]);

  // ── Stanje za render ───────────────────────────────────────
  const isOpen = assignment.status === 'open' && !assignment.isCancelled && !assignment.isDiverted;
  const hasFlight = !!assignment.flightNumber;

  // ============================================================
  // RENDER: Loading
  // ============================================================
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-green-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-2xl text-slate-300">Loading check-in information...</div>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: Inactive (nema dodjele / zatvoreno / otkazano)
  // ============================================================
  if (!isOpen) {
    const wallpaperSrc = isPortrait ? '/wallpaper.jpg' : '/wallpaper-landscape.jpg';

    return (
      <div className="min-h-screen relative gpu-accelerated bg-slate-900">
        <div className="absolute inset-0 z-0">
          <Image
            src={wallpaperSrc}
            alt="Airport Wallpaper"
            fill
            className="object-cover"
            priority
            quality={90}
            placeholder="blur"
            blurDataURL={BLUR_DATA_URL}
            sizes="100vw"
            decoding="async"
            unoptimized
          />
          <div className="absolute inset-0 bg-black/50" />
        </div>

        <div className="relative z-10 min-h-screen flex items-center justify-center p-4 text-white">
          <div
            className={`text-center bg-slate-800/80 rounded-3xl p-12 border border-white/20 shadow-2xl ${
              isPortrait ? 'max-w-4xl' : 'max-w-6xl'
            } mx-auto`}
          >
            {assignment.isCancelled ? (
              <XCircle className="w-32 h-32 text-red-500 mx-auto mb-8" />
            ) : assignment.isDiverted ? (
              <Plane className="w-32 h-32 text-orange-500 mx-auto mb-8" />
            ) : (
              <CheckCircle className="w-32 h-32 text-white/60 mx-auto mb-8" />
            )}

            <div className="text-center mb-8">
              <div
                className={`font-bold text-white/80 mb-4 ${
                  isPortrait ? 'text-[6rem]' : 'text-[4rem]'
                }`}
              >
                Check-in
              </div>
              <div
                className={`font-black text-orange-400 leading-none drop-shadow-2xl ${
                  isPortrait ? 'text-[20rem]' : 'text-[15rem]'
                }`}
              >
                {deskNumberParam}
              </div>
            </div>

            {assignment.isCancelled ? (
              <div
                className={`text-red-500 mb-6 font-semibold ${
                  isPortrait ? 'text-4xl' : 'text-3xl'
                }`}
              >
                ✈️ Flight {assignment.flightNumber} CANCELLED
              </div>
            ) : assignment.isDiverted ? (
              <div
                className={`text-orange-500 mb-6 font-semibold ${
                  isPortrait ? 'text-4xl' : 'text-3xl'
                }`}
              >
                ✈️ Flight {assignment.flightNumber} DIVERTED
              </div>
            ) : (
              <div
                className={`text-white/90 mb-6 font-semibold ${
                  isPortrait ? 'text-4xl' : 'text-3xl'
                }`}
              >
                {hasFlight
                  ? 'Check-in is currently closed'
                  : 'No flights currently checking in here'}
              </div>
            )}

            {hasFlight && !assignment.isCancelled && !assignment.isDiverted && (
              <div
                className={`text-orange-300 mb-6 font-medium bg-black/30 py-3 px-6 rounded-2xl ${
                  isPortrait ? 'text-3xl' : 'text-2xl'
                }`}
              >
                <div>
                  Flight: {assignment.flightNumber} → {assignment.destinationCity}
                </div>
                {assignment.scheduledTime && (
                  <div className="text-xl mt-2">
                    Scheduled: {assignment.scheduledTime}
                  </div>
                )}
              </div>
            )}

            <div
              className={`text-white/70 mb-4 ${isPortrait ? 'text-xl' : 'text-lg'}`}
            >
              Updated at: {lastUpdate || 'Never'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: Portrait — aktivan check-in
  // ============================================================
  if (isPortrait) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-2 bg-slate-800/80 border-b border-white/10 mt-[0.3cm] gpu-accelerated">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/10 rounded-xl border border-white/20">
                <CheckCircle className="w-6 h-6 text-green-400" />
              </div>
              <h1 className="text-[4rem] font-black bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent leading-tight">
                CHECK-IN {deskNumberParam}
              </h1>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Updated</div>
              <div className="text-sm font-mono text-slate-300">{lastUpdate}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col px-2 py-1 min-h-0">
          {/* Flight info card */}
          <div className="mb-2 bg-slate-800/80 rounded-xl border border-white/10 p-4 gpu-accelerated">
            <div className="flex flex-col items-center mb-4">
              <AirlineLogo
                logoUrl={assignment.logoUrl}
                airlineName={assignment.airlineName}
                portrait
              />

{assignment.classType && (
  <div className="w-full max-w-[90vw] mb-3">
    <div
      className="rounded-xl px-6 py-3 text-center shadow-lg border-2"
      style={
        assignment.classType.toUpperCase() === 'EASYJET_PLUS'
          ? { background: 'linear-gradient(to right, #f97316, #ea580c)', borderColor: '#fb923c' }
          : assignment.classType.toUpperCase().includes('BUSINESS')
          ? { background: 'linear-gradient(to right, #dc2626, #b91c1c)', borderColor: '#f87171' }
          : assignment.classType.toUpperCase().includes('PREMIUM')
          ? { background: 'linear-gradient(to right, #9333ea, #7e22ce)', borderColor: '#c084fc' }
          : assignment.classType.toUpperCase().includes('PRIORITY')
          ? { background: 'linear-gradient(to right, #16a34a, #15803d)', borderColor: '#4ade80' }
          : { background: 'linear-gradient(to right, #2563eb, #1d4ed8)', borderColor: '#60a5fa' }
      }
    >
      <h1 className="text-5xl font-black text-white tracking-wider">
        {assignment.classType.toUpperCase() === 'EASYJET_PLUS' ? 'easyJet Plus class' : assignment.classType.toUpperCase()}
      </h1>
    </div>
  </div>
)}

              {/* Broj leta */}
      <div className="text-center w-full">
  <div
    className="font-black leading-tight"
    style={{ fontSize: 'clamp(3rem, 11vh, 13rem)' }}
  >
    {(() => {
      const iata = assignment.flightNumber.substring(0, 2);
      const num = assignment.flightNumber.substring(2);
      return (
        <>
          <span className="text-yellow-200 drop-shadow-lg" style={{ marginRight: '0.1em' }}>
            {iata}
          </span>
          <span className="text-yellow-500">{num}</span>
        </>
      );
    })()}
  </div>
</div>
            </div>

            {/* Codeshare */}
            {assignment.codeshareFlights.length > 0 && (
              <div className="flex items-center gap-3 bg-blue-500/20 px-4 py-2 rounded-xl border border-blue-500/30 mb-3">
                <Users className="w-5 h-5 text-blue-400" />
                <div className="text-sm text-blue-300">
                  Also: {assignment.codeshareFlights.join(', ')}
                </div>
              </div>
            )}

            {/* Grad + slika */}
            <div className="flex items-end gap-4 mb-3">
              <CityImage
                cityUrl={assignment.cityUrl}
                destinationCity={assignment.destinationCity}
                portrait
              />
              <div className="flex-1 text-right min-w-0">
                <div
                  className="font-bold text-white mb-1 leading-tight"
                  style={{
                    fontSize:
                      assignment.destinationCity.length > 14
                        ? '4rem'
                        : assignment.destinationCity.length > 11
                        ? '5.5rem'
                        : assignment.destinationCity.length > 8
                        ? '7rem'
                        : '8.5rem',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    hyphens: 'auto',
                  }}
                >
                  {assignment.destinationCity}
                </div>
                <div className="text-6xl font-bold text-cyan-400 flex items-center justify-end gap-3 mb-2">
                  <span className="text-[1.25rem] bg-orange-500 text-white px-3 py-1 rounded-full font-semibold">
                    Airport IATA code:
                  </span>
                  {assignment.destinationCode}
                </div>
              </div>
              <MapPin className="w-10 h-10 text-cyan-400 flex-shrink-0 mb-3" />
            </div>

            {/* Portable chargers upozorenje */}
            <div className="flex items-center justify-center gap-2 mt-1 bg-yellow-500/20 border border-yellow-400/40 rounded-xl px-4 py-2 mx-auto w-fit">
              <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
    <div className="text-[1.36rem] font-bold text-yellow-300 text-center">
  Power banks: CARRY-ON ONLY, max 2 per person. No charging (of or with) during flight. Terminals must be protected.
</div>
            </div>
          </div>

          {/* Vremena + gate */}
          <div className="mb-2 bg-slate-800/80 rounded-xl border border-white/10 p-4 gpu-accelerated">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-slate-400" />
                  <div className="text-sm text-slate-400">Scheduled</div>
                </div>
                <div className="text-8xl font-mono font-bold text-white">
                  {assignment.scheduledTime}
                </div>
              </div>

              {assignment.estimatedTime &&
                assignment.estimatedTime !== assignment.scheduledTime && (
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-yellow-400" />
                      <div className="text-sm text-yellow-400">Expected</div>
                    </div>
                    <div className="text-8xl font-mono font-bold text-yellow-400 animate-pulse">
                      {assignment.estimatedTime}
                    </div>
                  </div>
                )}

              {assignment.gateNumber && (
                <div className="col-span-2 text-center mt-2">
                  <div className="text-3xl text-slate-400 mb-0">Gate Information</div>
                  <div className="text-5xl font-bold text-white">
                    Gate {assignment.gateNumber}
                  </div>
                  <div className="flex items-center justify-center gap-1 text-3xl text-slate-300 mt-0">
                    <Info className="w-5 h-5 text-yellow-400" />
                    <span>
                      After check-in please proceed to gate {assignment.gateNumber}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Reklame */}
<AdBanner
  adImages={adImages}
  currentIndex={currentAdIndex}
  nextIndex={nextAdIndex}
  isTransitioning={isAdTransitioning}
  baImageSrc={baAdImage}
  overrideImageSrc={easyJetOverrideImage}
  lufthansaImageSrc={lufthansaGroupImage}
  sundorHolidayImageSrc={showSundorHoliday ? SUNDOR_HOLIDAY_IMAGE : null}
  israirHolidayImageSrc={showIsrairHoliday ? ISRAIR_HOLIDAY_IMAGE : null}
  arkiaHolidayImageSrc={showArkiaHoliday ? ARKIA_HOLIDAY_IMAGE : null}
  fixedHolidayImageSrc={fixedHolidayImage}
/>

          {/* Footer */}
          <div className="flex-shrink-0 flex justify-center items-center space-x-2 text-xs font-inter py-1">
            <Image
  src="/icons8-next.js-96.png"              alt="nextjs"
              width={20}
              height={20}
              unoptimized
              className="inline-block"
            />
            <a
              href="mailto:alen.vocanec@apm.co.me"
              className="bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent hover:underline"
            >
              code by Tivat Airport, 2025
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: Landscape — aktivan check-in
  // ============================================================
  return (
    <div className="w-[99vw] h-[100vh] mx-auto rounded-3xl border-2 border-white/10 shadow-2xl overflow-hidden gpu-accelerated">
      <div className="h-full grid grid-cols-12 gap-8 p-3 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">

        {/* Lijeva kolona */}
        <div className="col-span-7 flex flex-col justify-between">
          <div className="mb-8">
            <div className="flex items-center gap-6 mb-6">
              <div className="p-5 bg-slate-700/80 rounded-2xl border border-white/20">
                <CheckCircle className="w-12 h-12 text-green-400" />
              </div>
              <h1 className="text-8xl font-black bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent leading-tight">
                CHECK-IN {deskNumberParam}
              </h1>
            </div>
          </div>

          <div className="space-y-8 flex-1">
            {/* Logo + broj leta */}
            <div className="flex items-center gap-8 mb-10">
              <AirlineLogo
                logoUrl={assignment.logoUrl}
                airlineName={assignment.airlineName}
                portrait={false}
              />
              <div className="flex-1">
  {assignment.classType && (
  <div className="mb-4">
    <div
      className="inline-block rounded-xl px-6 py-3 text-center shadow-lg border-2"
      style={
        assignment.classType.toUpperCase() === 'EASYJET_PLUS'
          ? { background: 'linear-gradient(to right, #f97316, #ea580c)', borderColor: '#fb923c' }
          : assignment.classType.toUpperCase().includes('BUSINESS')
          ? { background: 'linear-gradient(to right, #dc2626, #b91c1c)', borderColor: '#f87171' }
          : assignment.classType.toUpperCase().includes('PREMIUM')
          ? { background: 'linear-gradient(to right, #9333ea, #7e22ce)', borderColor: '#c084fc' }
          : assignment.classType.toUpperCase().includes('PRIORITY')
          ? { background: 'linear-gradient(to right, #16a34a, #15803d)', borderColor: '#4ade80' }
          : { background: 'linear-gradient(to right, #2563eb, #1d4ed8)', borderColor: '#60a5fa' }
      }
    >
      <h1 className="text-5xl font-black text-white tracking-wider">
        {assignment.classType.toUpperCase() === 'EASYJET_PLUS' ? 'easyJet Plus class' : assignment.classType.toUpperCase()}
      </h1>
    </div>
  </div>
)}
                <div className="text-[12rem] font-black text-yellow-500 mb-2 leading-none">
                  {assignment.flightNumber}
                </div>
                <div className="text-lg text-slate-400">{assignment.airlineName}</div>
              </div>
            </div>

            {/* Codeshare */}
            {assignment.codeshareFlights.length > 0 && (
              <div className="flex items-center gap-4 bg-blue-500/20 px-6 py-3 rounded-3xl border border-blue-500/30">
                <Users className="w-8 h-8 text-blue-400" />
                <div className="text-2xl text-blue-300">
                  Also: {assignment.codeshareFlights.join(', ')}
                </div>
              </div>
            )}

            {/* Grad + slika */}
            <div className="flex items-center gap-8">
              <CityImage
                cityUrl={assignment.cityUrl}
                destinationCity={assignment.destinationCity}
                portrait={false}
              />
              <div className="flex-1">
                <div className="text-8xl font-bold text-white mb-2">
                  {assignment.destinationCity}
                </div>
                <div className="text-8xl font-bold text-cyan-400">
                  {assignment.destinationCode}
                </div>
                <div className="flex items-center gap-2 mt-4 bg-yellow-500/20 border border-yellow-400/40 rounded-xl px-4 py-2">
                  <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
                  <div className="text-lg font-semibold text-yellow-300">
                    Portable chargers: CABIN BAGGAGE ONLY! Not in overhead bins. No charging during flight.
                  </div>
                </div>
              </div>
              <MapPin className="w-12 h-12 text-cyan-400" />
            </div>
          </div>

          <div className="mt-8">
            <div className="text-xl text-slate-400">Last Updated</div>
            <div className="text-2xl font-mono text-slate-300">{lastUpdate}</div>
          </div>
        </div>

        {/* Desna kolona */}
        <div className="col-span-5 flex flex-col justify-between border-l-2 border-white/10 pl-8">
          <div className="space-y-8">
            <div className="text-right">
              <div className="flex items-center justify-end gap-4 mb-4">
                <Clock className="w-10 h-10 text-slate-400" />
                <div className="text-2xl text-slate-400">Scheduled Departure</div>
              </div>
              <div className="text-7xl font-mono font-bold text-white leading-tight">
                {assignment.scheduledTime}
              </div>
            </div>

            {assignment.estimatedTime &&
              assignment.estimatedTime !== assignment.scheduledTime && (
                <div className="text-right">
                  <div className="flex items-center justify-end gap-4 mb-4">
                    <AlertCircle className="w-10 h-10 text-yellow-400" />
                    <div className="text-2xl text-yellow-400">Expected Departure</div>
                  </div>
                  <div className="text-6xl font-mono font-bold text-yellow-400 animate-pulse leading-tight">
                    {assignment.estimatedTime}
                  </div>
                </div>
              )}
          </div>

          <div className="text-right space-y-6">
            <div>
              <div className="text-6xl font-bold text-green-400 leading-tight animate-pulse">
                CHECK-IN OPEN
              </div>
              <div className="text-4xl text-green-400 mt-2">Please proceed to check-in</div>
            </div>

            {assignment.gateNumber && (
              <div className="bg-slate-700/80 rounded-2xl p-6 border border-white/10">
                <div className="text-2xl text-slate-400 mb-3">Gate Information</div>
                <div className="text-4xl font-bold text-white">
                  Gate {assignment.gateNumber}
                </div>
                <div className="flex items-center justify-end gap-2 text-xl text-slate-300 mt-2">
                  <Info className="w-6 h-6 text-yellow-400" />
                  <span>
                    After check-in please proceed to gate {assignment.gateNumber}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}