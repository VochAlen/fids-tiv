'use client';

import {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
  memo,
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useParams } from 'next/navigation';
import type { Flight } from '@/types/flight';
import {
  fetchFlightData,
  getCheckInClassType,
  debugCheckInClassType,
  type EnhancedFlight,
} from '@/lib/flight-service';
import {
  getEnhancedCheckInStatus,
  type CheckInStatus,
  shouldDisplayCheckIn,
} from '@/lib/check-in-service';
import { getLogoURLWithFallback } from '@/lib/flight-api-helpers';
import {
  CheckCircle,
  Clock,
  MapPin,
  Users,
  AlertCircle,
  Info,
  Bug,
  XCircle,
  Plane,
} from 'lucide-react';
import Image from 'next/image';
import { useAdImages } from '@/hooks/useAdImages';
import { useSeasonalTheme } from '@/hooks/useSeasonalTheme';
import ChristmasInactiveScreen from '@/components/ChristmasInactiveScreen';

// ============================================================
// KONSTANTE
// ============================================================
const INTERVAL_ACTIVE = 60_000;
const INTERVAL_INACTIVE = 60_000;
const AD_SWITCH_INTERVAL = 15_000;
const CACHE_CLEANUP_INTERVAL = 4 * 60 * 60 * 1_000; // 4h
const CHECKIN_REFRESH_INTERVAL = 60_000;
const COUNTDOWN_REFRESH_INTERVAL = 60_000;
const DEVELOPMENT = process.env.NODE_ENV === 'development';

// ============================================================
// CSS ANIMACIJE — minimalne, GPU-only, prefers-reduced-motion
// ============================================================
const CSS_ANIMATIONS = `
  .gpu-accelerated{transform:translateZ(0);backface-visibility:hidden;will-change:opacity,transform}.ad-image-container,.aspect-ratio-box{position:relative;overflow:hidden}.ad-image,.aspect-ratio-box>div{position:absolute;inset:0}.aspect-ratio-box::before{content:'';display:block;padding-bottom:62.5%}.ad-image{width:100%;height:100%;transition:opacity .5s ease-in-out;will-change:opacity}.ad-image.active{opacity:1;z-index:2}.ad-image.inactive{opacity:0;z-index:1}.flight-number-transition{transition:.3s cubic-bezier(.4, 0, .2, 1);will-change:contents}.city-name-transition{transition:.4s cubic-bezier(.4, 0, .2, 1);will-change:contents}.logo-transition{transition:opacity .3s ease-in-out;will-change:opacity}.transition-guard{pointer-events:none;opacity:.95}@media (prefers-reduced-motion:reduce){.ad-image,.animate-pulse,.animate-spin,.city-name-transition,.flight-number-transition,.gpu-accelerated,.logo-transition{transition:none!important;animation:none!important;will-change:auto!important;opacity:1!important}}
`;

// ============================================================
// BLUR DATA URL
// ============================================================
const BLUR_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

// ============================================================
// LRU CACHE
// ============================================================
class LRUCache {
  private cache: Map<string, { value: boolean; timestamp: number }>;
  private maxSize: number;
  private maxAgeMs: number;

  constructor(maxSize = 50, maxAgeMs = CACHE_CLEANUP_INTERVAL) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.maxAgeMs = maxAgeMs;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.maxAgeMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  set(key: string, value: boolean): void {
    if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.delete(key);
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  get size(): number { return this.cache.size; }
  clear(): void { this.cache.clear(); }
}

// Globalni cache — van komponente, živi cijelo session
const preloadedImages = new LRUCache(50);
const pendingPreloads = new Map<string, Promise<void>>();

// ============================================================
// HELPER: preload slike
// ============================================================
const preloadImage = (src: string): Promise<void> =>
  new Promise((resolve) => {
    if (!src || typeof window === 'undefined') return resolve();
    const img = new window.Image();
    img.src = src;
    img.onload = () => resolve();
    img.onerror = () => resolve();
    setTimeout(resolve, 2_000);
  });

// ============================================================
// HELPER: checkFlightStatus — van komponente, čista funkcija
// ============================================================
const checkFlightStatus = (status: string): { isCancelled: boolean; isDiverted: boolean } => {
  const s = (status || '').toLowerCase().trim();
  return {
    isCancelled:
      s.includes('cancelled') || s.includes('canceled') ||
      s.includes('annulé') || s.includes('otkazan'),
    isDiverted:
      s.includes('diverted') || s.includes('preusmjeren') || s.includes('dévié'),
  };
};

// ============================================================
// HELPER: formatiranje preostalog vremena
// ============================================================
const formatTimeRemaining = (minutes: number): string => {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0
      ? `Check-in opens in ${h} ${h === 1 ? 'hour' : 'hours'}`
      : `Check-in opens in ${h}h ${m}m`;
  }
  return `Check-in opens in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

const formatClosingTime = (minutes: number): string => {
  if (minutes <= 0) return 'Check-in closed';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0
      ? `Check-in closes in ${h} ${h === 1 ? 'hour' : 'hours'}`
      : `Check-in closes in ${h}h ${m}m`;
  }
  return `Check-in closes in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

// ============================================================
// TIPOVI
// ============================================================
interface FlightDisplayState {
  flight: EnhancedFlight | null;
  logoUrl: string;
  cityUrl: string;
  classType: string | null;
  manualDeskStatus: string | null; // Popravljeno za TypeScript
  airlineName: string;
  destinationCity: string;
  flightNumber: string;
  destinationCode: string;
  scheduledTime: string;
  estimatedTime: string;
  gateNumber: string;
  checkInStatus: CheckInStatus;
  isCancelled: boolean;
  isDiverted: boolean;
  flightStatus: string;
}

const EMPTY_DISPLAY: FlightDisplayState = {
  flight: null,
  logoUrl: '',
  cityUrl: '',
  classType: null,
    manualDeskStatus: null, // DODANO
  airlineName: '',
  destinationCity: '',
  flightNumber: '',
  destinationCode: '',
  scheduledTime: '',
  estimatedTime: '',
  gateNumber: '',
  checkInStatus: {
    shouldBeOpen: false,
    status: 'scheduled',
    reason: 'No flight assigned',
    minutesBeforeDeparture: 0,
    isAutoOpened: false,
    checkInOpenTime: null,
    checkInCloseTime: null,
  },
  isCancelled: false,
  isDiverted: false,
  flightStatus: '',
};

// ============================================================
// ERROR BOUNDARY — sprječava bijeli ekran pri runtime grešci
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
          <div className="text-lg opacity-30">{this.state.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// DEBUG PANEL — van render funkcije, memorizovan
// ============================================================
const DebugPanel = memo(function DebugPanel({
  flightDisplay,
  isTransitioning,
  timeUntilCheckIn,
  timeUntilClose,
  queueLength,
  isProcessing,
  guardActive,
  onClose,
}: {
  flightDisplay: FlightDisplayState;
  isTransitioning: boolean;
  timeUntilCheckIn: number | null;
  timeUntilClose: number | null;
  queueLength: number;
  isProcessing: boolean;
  guardActive: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed bottom-4 left-4 bg-black/90 text-white p-4 rounded-lg text-xs z-50 max-w-md border border-yellow-500/50">
      <div className="flex justify-between items-center mb-2">
        <div className="font-bold flex items-center gap-2">
          <Bug className="w-4 h-4" /> Debug Panel (Alt+D)
        </div>
        <button
          onClick={onClose}
          className="text-xs bg-red-500/50 hover:bg-red-500 px-2 py-1 rounded"
          type="button"
        >
          ✕
        </button>
      </div>
      <div className="mb-2">
        <div className="text-yellow-400 font-semibold">Flight Status:</div>
        <div>Flight: {flightDisplay.flightNumber}</div>
        <div>Status: {flightDisplay.flightStatus}</div>
        <div>Cancelled: {flightDisplay.isCancelled ? 'Yes' : 'No'}</div>
        <div>Diverted: {flightDisplay.isDiverted ? 'Yes' : 'No'}</div>
      </div>
      <div className="mb-2">
        <div className="text-yellow-400 font-semibold">Check-in Status:</div>
        <div>Open: {flightDisplay.checkInStatus.shouldBeOpen ? 'Yes' : 'No'}</div>
        <div>Status: {flightDisplay.checkInStatus.status}</div>
        <div>Reason: {flightDisplay.checkInStatus.reason}</div>
        <div>Mins before dep: {flightDisplay.checkInStatus.minutesBeforeDeparture}</div>
        <div>Auto opened: {flightDisplay.checkInStatus.isAutoOpened ? 'Yes' : 'No'}</div>
        <div>Opens: {flightDisplay.checkInStatus.checkInOpenTime?.toLocaleTimeString() ?? 'N/A'}</div>
        <div>Closes: {flightDisplay.checkInStatus.checkInCloseTime?.toLocaleTimeString() ?? 'N/A'}</div>
        <div>UI transitioning: {isTransitioning ? 'Yes' : 'No'}</div>
      </div>
      <div className="mb-2">
        <div className="text-yellow-400 font-semibold">Countdown:</div>
        <div>Until open: {timeUntilCheckIn != null ? `${timeUntilCheckIn}m` : 'N/A'}</div>
        <div>Until close: {timeUntilClose != null ? `${timeUntilClose}m` : 'N/A'}</div>
      </div>
      <div className="mb-2">
        <div className="text-yellow-400 font-semibold">Queue:</div>
        <div>Length: {queueLength}</div>
        <div>Processing: {isProcessing ? 'Yes' : 'No'}</div>
        <div>Guard: {guardActive ? 'Active' : 'Inactive'}</div>
      </div>
      <div>
        <div className="text-yellow-400 font-semibold">Cache:</div>
        <div>Preloaded: {preloadedImages.size}</div>
        <div>Pending: {pendingPreloads.size}</div>
      </div>
    </div>
  );
});

// ============================================================
// AIRLINE LOGO — memorizovan, decoding async
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
    e.currentTarget.src = '/airlines/placeholder.jpg';
  }, []);

  if (!logoUrl) return null;

  if (portrait) {
    return (
      <div className="relative w-full max-w-[90vw] h-[220px] bg-white rounded-xl shadow-lg mb-3">
        <Image
          src={logoUrl}
          alt={airlineName}
          fill
          sizes="(max-width: 768px) 90vw, 800px"
          className="object-contain p-4"
          priority
          fetchPriority="high"
          loading="eager"
          decoding="async"
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
        className="object-contain"
        priority
        decoding="async"
        onError={handleError}
      />
    </div>
  );
});

// ============================================================
// CITY IMAGE — memorizovan
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
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
    </div>
  );
});

// ============================================================
// AD BANNER — memorizovan crossfade
// ============================================================
const AdBanner = memo(function AdBanner({
  adImages,
  currentIndex,
  nextIndex,
  isTransitioning,
}: {
  adImages: string[];
  currentIndex: number;
  nextIndex: number;
  isTransitioning: boolean;
}) {
  if (!adImages.length) return null;

  return (
    <div className="flex-1 min-h-[400px] bg-slate-800 rounded-xl overflow-hidden flex items-stretch ad-image-container">
      <div className={`ad-image ${isTransitioning ? 'inactive' : 'active'}`}>
        <Image
          src={adImages[currentIndex]}
          alt="Advertisement"
          fill
          className="object-fill"
          priority={currentIndex === 0}
          loading={currentIndex === 0 ? "eager" : "lazy"}
          quality={80}
          sizes="100vw"
          placeholder="blur"
          blurDataURL={BLUR_DATA_URL}
          decoding="async"
        />
      </div>
      <div className={`ad-image ${isTransitioning ? 'active' : 'inactive'}`}>
        <Image
          src={adImages[nextIndex]}
          alt="Advertisement"
          fill
          className="object-fill"
          quality={80}
          sizes="100vw"
          placeholder="blur"
          blurDataURL={BLUR_DATA_URL}
          decoding="async"
        />
      </div>
    </div>
  );
});

// ============================================================
// CLOSING TIME WARNING — memorizovan
// ============================================================
const ClosingWarning = memo(function ClosingWarning({
  timeUntilClose,
  portrait,
}: {
  timeUntilClose: number | null;
  portrait: boolean;
}) {
  if (timeUntilClose == null || timeUntilClose > 15) return null;

  return (
    <div className="bg-red-500/20 border border-red-400/40 rounded-xl px-4 py-3 mt-4">
      <div
        className={`text-center font-bold text-red-300 animate-pulse ${
          portrait ? 'text-2xl' : 'text-3xl'
        }`}
      >
        ⚠️ CHECK-IN CLOSES IN {timeUntilClose} MINUTES
      </div>
    </div>
  );
});

// ============================================================
// GLAVNA KOMPONENTA (export wrapper s ErrorBoundary)
// ============================================================
export default function CheckInPage() {
  return (
    <CheckInErrorBoundary>
      <CheckInDisplay />
    </CheckInErrorBoundary>
  );
}

// ============================================================
// INNER DISPLAY KOMPONENTA
// ============================================================
function CheckInDisplay() {
  const params = useParams();
  const deskNumberParam = params.deskNumber as string;

  const [flightDisplay, setFlightDisplay] = useState<FlightDisplayState>(EMPTY_DISPLAY);
  const [timeUntilCheckIn, setTimeUntilCheckIn] = useState<number | null>(null);
  const [timeUntilClose, setTimeUntilClose] = useState<number | null>(null);
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [nextAdIndex, setNextAdIndex] = useState(1);
  const [isAdTransitioning, setIsAdTransitioning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [isPortrait, setIsPortrait] = useState(false);
  const [nextScheduledFlight, setNextScheduledFlight] = useState<Flight | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Refs
  const isMountedRef = useRef(true);
  const currentFlightRef = useRef<EnhancedFlight | null>(null);
  const orientationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoCacheRef = useRef<Map<string, string>>(new Map());
  const cityImageCacheRef = useRef<Map<string, string>>(new Map());
  const transitionQueueRef = useRef<(EnhancedFlight | null)[]>([]);
  const isProcessingQueueRef = useRef(false);
  const transitionGuardRef = useRef(false);
  const queueLenRef = useRef(0);

  const { adImages } = useAdImages();
  const currentTheme = useSeasonalTheme();

    // ── Helper: dohvati ručno zadanu klasu saltera ─────────────
  const fetchDeskClassOverride = useCallback(async (desk: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/desk-class/${desk}`);
      const data = await res.json();
      return data.classType;
    } catch {
      return null;
    }
  }, []);

    // ── Helper: dohvati ručni status saltera (Open/Close) ──────
  const fetchDeskStatusOverride = useCallback(async (desk: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/desk-status/${desk}`);
      const data = await res.json();
      return data.status;
    } catch {
      return null;
    }
  }, []);

  // ── Sync currentFlightRef s aktualnim state-om ──────────────
  useEffect(() => {
    currentFlightRef.current = flightDisplay.flight;
  }, [flightDisplay.flight]);

  // ── ✅ #4: Kiosk Hard Reset (6h) ──────────────────────────
  useEffect(() => {
    const id = setTimeout(() => {
      console.log("🔄 Check-in kiosk scheduled hard reset (6h)...");
      window.location.reload();
    }, 6 * 60 * 60 * 1000);
    return () => clearTimeout(id);
  }, []);

  // ── CSS injection ───────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById('checkin-animations')) return;
    const el = document.createElement('style');
    el.id = 'checkin-animations';
    el.textContent = CSS_ANIMATIONS;
    document.head.appendChild(el);
    return () => { document.getElementById('checkin-animations')?.remove(); };
  }, []);

  // ── Cache cleanup svaka 4h ──────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      preloadedImages.clear();
      pendingPreloads.clear();
      logoCacheRef.current.clear();
      cityImageCacheRef.current.clear();
      if (DEVELOPMENT) console.log('🧹 Image cache cleared');
    }, CACHE_CLEANUP_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // ── Kiosk mode: blokira kontekstni meni, selekciju, drag ───
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

  // ── Debounced orientation ───────────────────────────────────
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

  // ── Alt+D debug toggle ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.altKey && e.key === 'd') setShowDebug((p) => !p); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Helper: airline logo sa cache-om ───────────────────────
  // ── Helper: airline logo sa cache-om (Lokalni > FlightAware) ───────────────────────
  const getAirlineLogoUrl = useCallback(async (flight: EnhancedFlight | null): Promise<string> => {
    if (!flight) return '/airlines/placeholder.jpg';
    const icao = flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || '';
    if (!icao) return '/airlines/placeholder.jpg';
    
    // Ako je već u cache-u za ovu sesiju, vrati odmah (sprečava ponovno provjeravanje)
    if (logoCacheRef.current.has(icao)) return logoCacheRef.current.get(icao)!;
    
    // Pomoćna funkcija koja simulira "file_exists" preko browsera
    const checkLocalImage = (src: string): Promise<boolean> =>
      new Promise((resolve) => {
        if (typeof window === 'undefined') return resolve(false);
        const img = new window.Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        // Timeout od 1s: ako Next.js dev server sporo vraća 404, ne blokiramo dalje
        setTimeout(() => resolve(false), 1000);
        img.src = src;
      });

    try {
      // Provjeravamo .jpg i .png ISTOVREMENO da ne gubimo vrijeme
      const [hasJpg, hasPng] = await Promise.all([
        checkLocalImage(`/airlines/${icao}.jpg`),
        checkLocalImage(`/airlines/${icao}.png`),
      ]);

      // Ako pronađe lokalnu, zapiši u cache i vrati
      if (hasJpg) {
        logoCacheRef.current.set(icao, `/airlines/${icao}.jpg`);
        return `/airlines/${icao}.jpg`;
      }
      if (hasPng) {
        logoCacheRef.current.set(icao, `/airlines/${icao}.png`);
        return `/airlines/${icao}.png`;
      }

      // Ako nema lokalno, fallback na FlightAware preko tvog postojećeg helpera
      const url = await getLogoURLWithFallback(icao, flight.AirlineLogoURL);
      logoCacheRef.current.set(icao, url);
      return url;
    } catch {
      return '/airlines/placeholder.jpg';
    }
  }, []);

  // ── Helper: city image URL sa cache-om ─────────────────────
  const getCityImageUrl = useCallback((flight: EnhancedFlight | null): string => {
    if (!flight?.DestinationAirportCode) return '';
    const key = flight.DestinationAirportCode.toLowerCase();
    if (cityImageCacheRef.current.has(key)) return cityImageCacheRef.current.get(key)!;
    const url = `/city-images/${key}.jpg`;
    cityImageCacheRef.current.set(key, url);
    return url;
  }, []);

  // ── Helper: preload slika za let ───────────────────────────
  const preloadFlightImages = useCallback(
    async (flight: EnhancedFlight): Promise<{ logoUrl: string; cityUrl: string }> => {
      const [logoUrl] = await Promise.all([
        getAirlineLogoUrl(flight),
      ]);
      const cityUrl = getCityImageUrl(flight);

      const loads: Promise<void>[] = [];
      for (const [prefix, url] of [['logo', logoUrl], ['city', cityUrl]] as const) {
        if (!url) continue;
        const ck = `${prefix}:${url}`;
        if (preloadedImages.has(ck) || pendingPreloads.has(ck)) continue;
        const p = preloadImage(url).then(() => {
          preloadedImages.set(ck, true);
          pendingPreloads.delete(ck);
        });
        pendingPreloads.set(ck, p);
        loads.push(p);
      }
      await Promise.all(loads);
      return { logoUrl, cityUrl };
    },
    [getAirlineLogoUrl, getCityImageUrl]
  );

  // ── Countdown ───────────────────────────────────────────────
  const updateCountdowns = useCallback((status: CheckInStatus) => {
    const now = new Date();
    if (status.status === 'scheduled' && status.checkInOpenTime) {
      setTimeUntilCheckIn(
        Math.max(0, Math.floor((status.checkInOpenTime.getTime() - now.getTime()) / 60_000))
      );
    } else {
      setTimeUntilCheckIn(null);
    }
    if (status.shouldBeOpen && status.checkInCloseTime) {
      setTimeUntilClose(
        Math.max(0, Math.floor((status.checkInCloseTime.getTime() - now.getTime()) / 60_000))
      );
    } else {
      setTimeUntilClose(null);
    }
  }, []);

  // ── Transition queue processor ──────────────────────────────
  const processTransitionQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || transitionGuardRef.current) return;
    if (transitionQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;
    transitionGuardRef.current = true;
    setIsTransitioning(true);

    const releaseLocks = () => {
      isProcessingQueueRef.current = false;
      transitionGuardRef.current = false;
      setIsTransitioning(false);
      queueLenRef.current = transitionQueueRef.current.length;
    };

    try {
      const nextFlight = transitionQueueRef.current.shift();
      queueLenRef.current = transitionQueueRef.current.length;

      if (!nextFlight) {
        setFlightDisplay(EMPTY_DISPLAY);
        setTimeUntilCheckIn(null);
        setTimeUntilClose(null);
        return;
      }

const [{ logoUrl, cityUrl }, fallbackClass, overrideClass, overrideStatus, checkInStatus] = await Promise.all([
        preloadFlightImages(nextFlight),
        getCheckInClassType(nextFlight, deskNumberParam).catch(() => null),
        fetchDeskClassOverride(deskNumberParam),
        fetchDeskStatusOverride(deskNumberParam), 
        getEnhancedCheckInStatus(
          nextFlight.FlightNumber,
          nextFlight.ScheduledDepartureTime || '',
          nextFlight.StatusEN || ''
        ),
      ]);

      // Admin override ima apsolutni prioritet nad automatskom klasom
      const finalClassType = overrideClass || fallbackClass;

      const { isCancelled, isDiverted } = checkFlightStatus(nextFlight.StatusEN || '');

      if (!isMountedRef.current) return;

      setFlightDisplay({
        flight: nextFlight,
        logoUrl,
        cityUrl,
        classType: finalClassType,
        manualDeskStatus: overrideStatus, 
        airlineName: nextFlight.AirlineName || '',
        destinationCity: nextFlight.DestinationCityName || '',
        flightNumber: nextFlight.FlightNumber || '',
        destinationCode: nextFlight.DestinationAirportCode || '',
        scheduledTime: nextFlight.ScheduledDepartureTime || '',
        estimatedTime: nextFlight.EstimatedDepartureTime || '',
        gateNumber: nextFlight.GateNumber || '',
        checkInStatus: checkInStatus || EMPTY_DISPLAY.checkInStatus, // Sigurnosni fallback protiv null
        isCancelled,
        isDiverted,
        flightStatus: nextFlight.StatusEN || '',
      });

      updateCountdowns(checkInStatus);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error('Error processing transition queue:', err);
    } finally {
      setTimeout(() => {
        releaseLocks();
        if (transitionQueueRef.current.length > 0) {
          setTimeout(() => void processTransitionQueue(), 100);
        }
      }, 500);
    }
  }, [deskNumberParam, preloadFlightImages, updateCountdowns]);

  // ── Queue novog flighta ─────────────────────────────────────
  const queueFlightTransition = useCallback(
    async (newFlight: EnhancedFlight | null) => {
      if (!newFlight) {
        setFlightDisplay(EMPTY_DISPLAY);
        setTimeUntilCheckIn(null);
        setTimeUntilClose(null);
        return;
      }
      transitionQueueRef.current.push(newFlight);
      queueLenRef.current = transitionQueueRef.current.length;
      if (!isProcessingQueueRef.current && !transitionGuardRef.current) {
        void processTransitionQueue();
      }
    },
    [processTransitionQueue]
  );

  // ── loadFlights ─────────────────────────────────────────────
  const loadFlights = useCallback(async () => {
    if (!isMountedRef.current || transitionGuardRef.current) return;

    try {
      const data = await fetchFlightData();
      const now = new Date();
      const today = now.toDateString();

      const allForDesk = data.departures.filter((f) => {
        if (!f.CheckInDesk) return false;
        const desks = f.CheckInDesk.split(',').map((d: string) => d.trim());
        return (
          desks.includes(deskNumberParam) ||
          desks.includes(deskNumberParam.replace(/^0+/, '')) ||
          desks.includes(deskNumberParam.padStart(2, '0'))
        );
      });

      const withTime = allForDesk
        .map((flight) => {
          let departureTime: Date | null = null;
          let isToday = true;
          if (flight.ScheduledDepartureTime) {
            if (flight.ScheduledDepartureTime.includes('T')) {
              departureTime = new Date(flight.ScheduledDepartureTime);
              isToday = departureTime.toDateString() === today;
            } else {
              const [h, m] = flight.ScheduledDepartureTime.split(':').map(Number);
              departureTime = new Date(now);
              departureTime.setHours(h, m, 0, 0);
              
              // ✅ #1: Midnight Rollover Fix
              if (departureTime.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
                departureTime.setDate(departureTime.getDate() + 1);
              }
              
              if ((now.getTime() - departureTime.getTime()) / 60_000 > 30) isToday = false;
            }
          }
          return { ...flight, departureTime, isToday };
        })
        .filter((f) => f.departureTime !== null) as (EnhancedFlight & {
          departureTime: Date;
          isToday: boolean;
        })[];

      const sorted = withTime.sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());
      const future = sorted.filter(
        (f) =>
          f.isToday &&
          f.departureTime > now &&
          !f.StatusEN?.toLowerCase().includes('cancelled')
      );

      const currentFlight: EnhancedFlight | null = future[0] ?? null;

      if (!isMountedRef.current) return;

      setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      setLoading(false);

      const prevFlight = currentFlightRef.current;
      const changed =
        !prevFlight ||
        prevFlight.FlightNumber !== currentFlight?.FlightNumber ||
        prevFlight.ScheduledDepartureTime !== currentFlight?.ScheduledDepartureTime;

      if (changed) await queueFlightTransition(currentFlight);

      const idx = future.findIndex((f) => f.FlightNumber === currentFlight?.FlightNumber);
      const next = idx >= 0 && idx < future.length - 1 ? future[idx + 1] : null;
      if (isMountedRef.current) setNextScheduledFlight(next);
    } catch (err) {
      if (DEVELOPMENT) console.error('❌ loadFlights error:', err);
      if (isMountedRef.current) {
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
        setLoading(false);
      }
    }
  }, [deskNumberParam, queueFlightTransition]);

  // ── shouldShowCheckIn ───────────────────────────────────────
  // ── shouldShowCheckIn ───────────────────────────────────────
  const shouldShowCheckIn = useMemo(() => {
    // 1. RUČNI OVERRIDE IMA APSOLUTNI PRIORITET
    if (flightDisplay.manualDeskStatus === 'open') return true;
    if (flightDisplay.manualDeskStatus === 'closed') return false;
    
    // 2. Otkazani/Preusmjereni letovi su uvijek zatvoreni
    if (flightDisplay.isCancelled || flightDisplay.isDiverted) return false;
    
    // 3. Ako nema ručnog overridea, koristi automatsku logiku
    return shouldDisplayCheckIn(flightDisplay.checkInStatus);
  }, [flightDisplay.manualDeskStatus, flightDisplay.checkInStatus, flightDisplay.isCancelled, flightDisplay.isDiverted]);

  // ── Main data load interval ─────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    void loadFlights();

    const intervalMs = shouldShowCheckIn ? INTERVAL_ACTIVE : INTERVAL_INACTIVE;
    const id = setInterval(() => { void loadFlights(); }, intervalMs);

    return () => {
      isMountedRef.current = false;
      clearInterval(id);
    };
  }, [loadFlights, shouldShowCheckIn]);

    // ── Class Override refresh (Dohvata admin promjene uživo) ──
  // ── Manual Status Override refresh (Dohvata admin promjene uživo) ──
  useEffect(() => {
    if (!flightDisplay.flight) return;
    
    const refreshStatus = async () => {
      try {
        const newStatus = await fetchDeskStatusOverride(deskNumberParam);
        setFlightDisplay((prev) => {
          if (prev.manualDeskStatus === newStatus) return prev;
          return { ...prev, manualDeskStatus: newStatus };
        });
      } catch (err) {
        console.error('Status override refresh error:', err);
      }
    };
    
    refreshStatus();
    const id = setInterval(refreshStatus, 30_000); // Proverava svakih 30s
    return () => clearInterval(id);
  }, [flightDisplay.flight, deskNumberParam, fetchDeskStatusOverride]);


  // ── Check-in status refresh svaku minutu ───────────────────
  useEffect(() => {
    if (!flightDisplay.flight) return;
    const refresh = async () => {
      try {
        const s = await getEnhancedCheckInStatus(
          flightDisplay.flight!.FlightNumber,
          flightDisplay.flight!.ScheduledDepartureTime || '',
          flightDisplay.flight!.StatusEN || ''
        );
        setFlightDisplay((p) => ({ ...p, checkInStatus: s }));
        updateCountdowns(s);
      } catch (e) {
        console.error('Check-in refresh error:', e);
      }
    };
    refresh();
    const id = setInterval(refresh, CHECKIN_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [flightDisplay.flight, updateCountdowns]);

  // ── Countdown refresh svaku minutu ─────────────────────────
  useEffect(() => {
    if (!flightDisplay.flight) return;
    const id = setInterval(() => updateCountdowns(flightDisplay.checkInStatus), COUNTDOWN_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [flightDisplay.checkInStatus, flightDisplay.flight, updateCountdowns]);

  // ── checkin-status-updated event ───────────────────────────
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (flightDisplay.flight?.FlightNumber === e.detail?.flightNumber) void loadFlights();
    };
    window.addEventListener('checkin-status-updated', handler as EventListener);
    return () => window.removeEventListener('checkin-status-updated', handler as EventListener);
  }, [flightDisplay.flight?.FlightNumber, loadFlights]);

  // ── Ad crossfade ────────────────────────────────────────────
  useEffect(() => {
    if (adImages.length < 2) return;
    const id = setInterval(() => {
      setIsAdTransitioning(true);
      const next = (currentAdIndex + 2) % adImages.length;
      if (adImages[next]) void preloadImage(adImages[next]);
      setTimeout(() => {
        setNextAdIndex((currentAdIndex + 1) % adImages.length);
        setTimeout(() => {
          setCurrentAdIndex((p) => (p + 1) % adImages.length);
          setIsAdTransitioning(false);
        }, 300);
      }, 100);
    }, AD_SWITCH_INTERVAL);
    return () => clearInterval(id);
  }, [adImages, currentAdIndex]);

  // ── Debug info update ───────────────────────────────────────
  useEffect(() => {
    if (flightDisplay.flight && DEVELOPMENT) {
      debugCheckInClassType(flightDisplay.flight, deskNumberParam);
    }
  }, [flightDisplay.flight, deskNumberParam]);

  const debugCloseHandler = useCallback(() => setShowDebug(false), []);

  // ============================================================
  // RENDER: Loading
  // ============================================================
  if (loading && !flightDisplay.flight && !nextScheduledFlight) {
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
  // RENDER: Christmas inactive
  // ============================================================
  if ((!shouldShowCheckIn || flightDisplay.isCancelled || flightDisplay.isDiverted) && currentTheme === 'christmas') {
    return (
      <ChristmasInactiveScreen
        deskNumberParam={deskNumberParam}
        nextFlight={nextScheduledFlight}
        lastUpdate={lastUpdate}
        loading={loading}
        isPortrait={isPortrait}
        displayFlight={flightDisplay.flight}
      />
    );
  }

  // ============================================================
  // RENDER: Inactive (cancelled / diverted / check-in closed)
  // ============================================================
  if (!shouldShowCheckIn || flightDisplay.isCancelled || flightDisplay.isDiverted) {
    const wallpaperSrc = isPortrait ? '/wallpaper.jpg' : '/wallpaper-landscape.jpg';

    return (
      <div className={`min-h-screen relative gpu-accelerated ${isTransitioning ? 'transition-guard' : ''}`}>
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
          />
          <div className="absolute inset-0 bg-black/50" />
        </div>

        <div className="relative z-10 min-h-screen flex items-center justify-center p-4 text-white">
          <div
            className={`text-center bg-slate-800/80 rounded-3xl p-12 border border-white/20 shadow-2xl ${
              isPortrait ? 'max-w-4xl' : 'max-w-6xl'
            } mx-auto`}
          >
            {flightDisplay.isCancelled ? (
              <XCircle className="w-32 h-32 text-red-500 mx-auto mb-8" />
            ) : flightDisplay.isDiverted ? (
              <Plane className="w-32 h-32 text-orange-500 mx-auto mb-8" />
            ) : (
              <CheckCircle className="w-32 h-32 text-white/60 mx-auto mb-8" />
            )}

            <div className="text-center mb-8">
              <div className={`font-bold text-white/80 mb-4 ${isPortrait ? 'text-[6rem]' : 'text-[4rem]'}`}>
                Check-in
              </div>
              <div className={`font-black text-orange-400 leading-none drop-shadow-2xl ${isPortrait ? 'text-[20rem]' : 'text-[15rem]'}`}>
                {deskNumberParam}
              </div>
            </div>

            {flightDisplay.isCancelled ? (
              <div className={`text-red-500 mb-6 font-semibold ${isPortrait ? 'text-4xl' : 'text-3xl'}`}>
                ✈️ Flight {flightDisplay.flightNumber} CANCELLED
              </div>
            ) : flightDisplay.isDiverted ? (
              <div className={`text-orange-500 mb-6 font-semibold ${isPortrait ? 'text-4xl' : 'text-3xl'}`}>
                ✈️ Flight {flightDisplay.flightNumber} DIVERTED
              </div>
            ) : (
              <div className={`text-white/90 mb-6 font-semibold ${isPortrait ? 'text-4xl' : 'text-3xl'}`}>
                {flightDisplay.flight ? 'Check-in not available' : 'No flights currently checking in here'}
              </div>
            )}

            {nextScheduledFlight && !nextScheduledFlight.StatusEN?.toLowerCase().includes('cancelled') ? (
              <div className={`text-orange-300 mb-6 font-medium bg-black/30 py-3 px-6 rounded-2xl ${isPortrait ? 'text-3xl' : 'text-2xl'}`}>
                <div>Next flight: {nextScheduledFlight.FlightNumber} to {nextScheduledFlight.DestinationCityName}</div>
                <div className="text-xl mt-2">Scheduled: {nextScheduledFlight.ScheduledDepartureTime}</div>
                {timeUntilCheckIn != null && flightDisplay.checkInStatus.status === 'scheduled' && (
                  <div className="text-xl font-semibold mt-2">{formatTimeRemaining(timeUntilCheckIn)}</div>
                )}
              </div>
            ) : flightDisplay.flight && !flightDisplay.isCancelled && !flightDisplay.isDiverted ? (
              <div className={`text-white/80 mb-6 ${isPortrait ? 'text-2xl' : 'text-xl'}`}>
                <div>Current flight: {flightDisplay.flightNumber} to {flightDisplay.destinationCity}</div>
                <br />
                <span className="text-yellow-300">Scheduled: {flightDisplay.scheduledTime}</span>
                <div className="text-sm text-white/50 mt-2">(Check-in closed, waiting for departure)</div>
              </div>
            ) : null}

            {flightDisplay.flight && !flightDisplay.isCancelled && !flightDisplay.isDiverted && (
              <div className={`text-white/80 mb-6 ${isPortrait ? 'text-2xl' : 'text-xl'}`}>
                {flightDisplay.checkInStatus.status === 'scheduled' && timeUntilCheckIn != null
                  ? formatTimeRemaining(timeUntilCheckIn)
                  : `Status: ${flightDisplay.checkInStatus.reason}`}
              </div>
            )}

            <div className={`text-white/70 mb-4 ${isPortrait ? 'text-xl' : 'text-lg'}`}>
              Updated at: {lastUpdate || 'Never'}
            </div>
            {loading && (
              <div className={`text-white/60 mt-4 ${isPortrait ? 'text-lg' : 'text-base'}`}>
                Checking for updates...
              </div>
            )}
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
      <div
        className={`h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white overflow-hidden flex flex-col ${
          isTransitioning ? 'transition-guard' : ''
        }`}
      >
        {DEVELOPMENT && !showDebug && (
          <button
            onClick={() => setShowDebug(true)}
            className="fixed top-4 left-4 bg-black/70 hover:bg-black text-white p-2 rounded-full z-50"
            title="Show Debug (Alt+D)"
            type="button"
          >
            <Bug className="w-5 h-5" />
          </button>
        )}
        {DEVELOPMENT && showDebug && (
          <DebugPanel
            flightDisplay={flightDisplay}
            isTransitioning={isTransitioning}
            timeUntilCheckIn={timeUntilCheckIn}
            timeUntilClose={timeUntilClose}
            queueLength={queueLenRef.current}
            isProcessing={isProcessingQueueRef.current}
            guardActive={transitionGuardRef.current}
            onClose={debugCloseHandler}
          />
        )}

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
              {loading && <div className="text-xs text-slate-500 mt-0.5">Updating...</div>}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col px-2 py-1 min-h-0">
          <div className="mb-2 bg-slate-800/80 rounded-xl border border-white/10 p-4 gpu-accelerated">
            <div className="flex flex-col items-center mb-4">
              <AirlineLogo logoUrl={flightDisplay.logoUrl} airlineName={flightDisplay.airlineName} portrait />

                    {flightDisplay.classType && (
                <div className="w-full max-w-[90vw] mb-3">
                  <div
                    className={`rounded-xl px-6 py-3 text-center shadow-lg border-2 ${
                      flightDisplay.classType.toUpperCase().includes('BUSINESS')
                        ? 'bg-gradient-to-r from-red-600 to-red-700 border-red-400'
                        : flightDisplay.classType.toUpperCase().includes('PREMIUM')
                        ? 'bg-gradient-to-r from-purple-600 to-purple-700 border-purple-400'
                        : flightDisplay.classType.toUpperCase().includes('PRIORITY')
                        ? 'bg-gradient-to-r from-green-600 to-green-700 border-green-400'
                        : 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-400'
                    }`}
                  >
                    <h1 className="text-7xl font-black text-white tracking-wider">
                      {flightDisplay.classType.toUpperCase()}
                    </h1>
                  </div>
                </div>
              )}

              <div className="text-center w-full">
                <div className="text-[13rem] font-black text-yellow-500 leading-tight flight-number-transition">
                  {flightDisplay.flightNumber}
                </div>
              </div>
            </div>

            <ClosingWarning timeUntilClose={timeUntilClose} portrait />

            {flightDisplay.flight?.CodeShareFlights && flightDisplay.flight.CodeShareFlights.length > 0 && (
              <div className="flex items-center gap-3 bg-blue-500/20 px-4 py-2 rounded-xl border border-blue-500/30 mb-3">
                <Users className="w-5 h-5 text-blue-400" />
                <div className="text-sm text-blue-300">
                  Also: {flightDisplay.flight.CodeShareFlights.join(', ')}
                </div>
              </div>
            )}

            <div className="flex items-end gap-4 mb-3">
              <CityImage
                cityUrl={flightDisplay.cityUrl}
                destinationCity={flightDisplay.destinationCity}
                portrait
              />
  <div className="flex-1 text-right min-w-0 overflow-hidden">
  <div
    className="font-bold text-white mb-1 leading-tight city-name-transition break-words"
    style={{
      fontSize:
        flightDisplay.destinationCity.length > 14
          ? '4.5rem'
          : flightDisplay.destinationCity.length > 11
          ? '6rem'
          : flightDisplay.destinationCity.length > 8
          ? '7.5rem'
          : '9rem',
    }}
  >
    {flightDisplay.destinationCity}
  </div>
<div className="text-6xl font-bold text-cyan-400 flex items-center justify-end gap-3 mb-2">
                  <span className="text-[1.25rem] bg-orange-500 text-white px-3 py-1 rounded-full font-semibold">
                    Airport IATA code:
                  </span>
                  {flightDisplay.destinationCode}
                </div>
              </div>
              <MapPin className="w-10 h-10 text-cyan-400 flex-shrink-0 mb-3" />
            </div>

            {flightDisplay.checkInStatus.isAutoOpened && (
              <div className="flex items-center justify-center gap-2 mt-1 bg-green-500/20 border border-green-400/40 rounded-xl px-4 py-2 mx-auto w-fit mb-2">
                <Info className="w-6 h-6 text-green-400 flex-shrink-0" />
                <div className="text-[1.2rem] font-bold text-green-300 text-center">
                  ✅ Auto-check-in: {flightDisplay.checkInStatus.reason}
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 mt-1 bg-yellow-500/20 border border-yellow-400/40 rounded-xl px-4 py-2 mx-auto w-fit">
              <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
              <div className="text-[1.36rem] font-bold text-yellow-300 text-center">
                Portable chargers: CABIN BAGGAGE ONLY! Not in overhead bins. No charging during flight.
              </div>
            </div>
          </div>

          <div className="mb-2 bg-slate-800/80 rounded-xl border border-white/10 p-4 gpu-accelerated">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-slate-400" />
                  <div className="text-sm text-slate-400">Scheduled</div>
                </div>
                <div className="text-8xl font-mono font-bold text-white">{flightDisplay.scheduledTime}</div>
              </div>

              {flightDisplay.estimatedTime && flightDisplay.estimatedTime !== flightDisplay.scheduledTime && (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-yellow-400" />
                    <div className="text-sm text-yellow-400">Expected</div>
                  </div>
                  <div className="text-8xl font-mono font-bold text-yellow-400 animate-pulse">
                    {flightDisplay.estimatedTime}
                  </div>
                </div>
              )}

              {flightDisplay.gateNumber && (
                <div className="col-span-2 text-center mt-2">
                  <div className="text-3xl text-slate-400 mb-0">Gate Information</div>
                  <div className="text-5xl font-bold text-white">Gate {flightDisplay.gateNumber}</div>
                  <div className="flex items-center justify-center gap-1 text-3xl text-slate-300 mt-0">
                    <Info className="w-5 h-5 text-yellow-400" />
                    <span>After check-in please proceed to gate {flightDisplay.gateNumber}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <AdBanner
            adImages={adImages}
            currentIndex={currentAdIndex}
            nextIndex={nextAdIndex}
            isTransitioning={isAdTransitioning}
          />

          <div className="flex-shrink-0 flex justify-center items-center space-x-2 text-xs font-inter py-1">
            <Image
              src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAACz0lEQVR4nO2YPWhUQRDHYzSRREHUiILRxspCBIUYC20sxMJSEtTC1lYJfqWwUGOTIGiIYieIiBiEoI1WgoWFoBIRRBD8ACV+gaA5Nf5k4hiGx91l571971K8Hxy8e7s7O/+73Z3ZaWoqKSnJDDAf2AocB24Cz4DPwE/9yPO4tkmfbqB5Lji+BjgLvMXPH2AA6GwE4xuAS0CF7FSAEaCjKOf3Ap+Iz0egN0/HW4DL5M9FmSu28+3AHYrjtswZ85cv0vn/3AVaYwgoYtnUYiSr8/toPD1pnV8PtDNae/6deP4jVs/5usJwmggbI0hV4xjwSFOKUCZdEVvTg7yYPolmAhc5xA57EzNvbHAHagL7ZOibm8vA6KAHUrNLLTOQEouchgOhKESBZm9MkxvdA7wP7evkaImDUa7WKjd0hffFzI0TAeFYBaudKDgKehghxp8o17CzTjRdTwESIAPf5nxi/yjzvAv5EFDBZhICxeslgRgHfc19C+uqA+S5R96Xpvj+DgHe5b2J99VXSEfNuh1lKX4C1eW7i0QgChHvAPPP+gmm7rxHfy9UiApnlYOJa+sK0HXa7D30hArojCvgGrDTt24Apk2F62RwioLna+Z1SgPBApotpHyQdr+ySnE2EVMxipsiHjG3JWp+nEHAqyHmdpNMZD2TfLAZO1Gj/Aay39rcAvx32ZfzKYAE6iZT7YvIQWGDsn3GMPe9yXidYlsOlvt/ybwWeBIyR1HypW4BO0htZgCzLjcb+Ji2/72NPKufNJFKrjMljW3EDTtbpO5TJeVNalFplTE4n7D+q0mfM7pmsItiji/hl77fAhkRguxWlLpoQ0RL5ZJJY0GbsS71InC6y8ZrwZ59uR8auJHf7cnO8St10OGU+Y/kCtHvd6kz/Zs8AAAAASUVORK5CYII="
              alt="nextjs"
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
    <div
      className={`w-[99vw] h-[100vh] mx-auto rounded-3xl border-2 border-white/10 shadow-2xl overflow-hidden gpu-accelerated ${
        isTransitioning ? 'transition-guard' : ''
      }`}
    >
      {DEVELOPMENT && !showDebug && (
        <button
          onClick={() => setShowDebug(true)}
          className="fixed top-4 left-4 bg-black/70 hover:bg-black text-white p-2 rounded-full z-50"
          title="Show Debug (Alt+D)"
          type="button"
        >
          <Bug className="w-5 h-5" />
        </button>
      )}
      {DEVELOPMENT && showDebug && (
        <DebugPanel
          flightDisplay={flightDisplay}
          isTransitioning={isTransitioning}
          timeUntilCheckIn={timeUntilCheckIn}
          timeUntilClose={timeUntilClose}
          queueLength={queueLenRef.current}
          isProcessing={isProcessingQueueRef.current}
          guardActive={transitionGuardRef.current}
          onClose={debugCloseHandler}
        />
      )}

      <div className="h-full grid grid-cols-12 gap-8 p-3 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">

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
            <ClosingWarning timeUntilClose={timeUntilClose} portrait={false} />
          </div>

          <div className="space-y-8 flex-1">
            <div className="flex items-center gap-8 mb-10">
              <AirlineLogo
                logoUrl={flightDisplay.logoUrl}
                airlineName={flightDisplay.airlineName}
                portrait={false}
              />
              <div className="flex-1">
                
                {/* DODATO: Klasa saltera za Landscape rezim */}
                {flightDisplay.classType && (
                  <div className="mb-4">
                    <div
                      className={`inline-block rounded-xl px-6 py-3 text-center shadow-lg border-2 ${
                        flightDisplay.classType.toUpperCase().includes('BUSINESS')
                          ? 'bg-gradient-to-r from-red-600 to-red-700 border-red-400'
                          : flightDisplay.classType.toUpperCase().includes('PREMIUM')
                          ? 'bg-gradient-to-r from-purple-600 to-purple-700 border-purple-400'
                          : flightDisplay.classType.toUpperCase().includes('PRIORITY')
                          ? 'bg-gradient-to-r from-green-600 to-green-700 border-green-400'
                          : 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-400'
                      }`}
                    >
                      <h1 className="text-5xl font-black text-white tracking-wider">
                        {flightDisplay.classType.toUpperCase()}
                      </h1>
                    </div>
                  </div>
                )}

                <div className="text-[12rem] font-black text-yellow-500 mb-2 flight-number-transition leading-none">
                  {flightDisplay.flightNumber}
                </div>
                <div className="text-lg text-slate-400">{flightDisplay.airlineName}</div>
              </div>
            </div>

            {flightDisplay.flight?.CodeShareFlights && flightDisplay.flight.CodeShareFlights.length > 0 && (
              <div className="flex items-center gap-4 bg-blue-500/20 px-6 py-3 rounded-3xl border border-blue-500/30">
                <Users className="w-8 h-8 text-blue-400" />
                <div className="text-2xl text-blue-300">
                  Also: {flightDisplay.flight.CodeShareFlights.join(', ')}
                </div>
              </div>
            )}

            <div className="flex items-center gap-8">
              <CityImage
                cityUrl={flightDisplay.cityUrl}
                destinationCity={flightDisplay.destinationCity}
                portrait={false}
              />
              <div className="flex-1">
                <div className="text-8xl font-bold text-white mb-2 city-name-transition">
                  {flightDisplay.destinationCity}
                </div>
                <div className="text-8xl font-bold text-cyan-400">{flightDisplay.destinationCode}</div>

                {flightDisplay.checkInStatus.isAutoOpened && (
                  <div className="flex items-center gap-2 mt-4 bg-green-500/20 border border-green-400/40 rounded-xl px-4 py-2">
                    <Info className="w-6 h-6 text-green-400 flex-shrink-0" />
                    <div className="text-lg font-semibold text-green-300">
                      ✅ Auto-check-in: {flightDisplay.checkInStatus.reason}
                    </div>
                  </div>
                )}

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
            {loading && <div className="text-sm text-slate-500 mt-1">Updating data...</div>}
          </div>
        </div>

        <div className="col-span-5 flex flex-col justify-between border-l-2 border-white/10 pl-8">
          <div className="space-y-8">
            <div className="text-right">
              <div className="flex items-center justify-end gap-4 mb-4">
                <Clock className="w-10 h-10 text-slate-400" />
                <div className="text-2xl text-slate-400">Scheduled Departure</div>
              </div>
              <div className="text-7xl font-mono font-bold text-white leading-tight">
                {flightDisplay.scheduledTime}
              </div>
            </div>

            {flightDisplay.estimatedTime && flightDisplay.estimatedTime !== flightDisplay.scheduledTime && (
              <div className="text-right">
                <div className="flex items-center justify-end gap-4 mb-4">
                  <AlertCircle className="w-10 h-10 text-yellow-400" />
                  <div className="text-2xl text-yellow-400">Expected Departure</div>
                </div>
                <div className="text-6xl font-mono font-bold text-yellow-400 animate-pulse leading-tight">
                  {flightDisplay.estimatedTime}
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
              {timeUntilClose != null && (
                <div className="text-2xl text-orange-400 mt-2">{formatClosingTime(timeUntilClose)}</div>
              )}
            </div>

            {flightDisplay.gateNumber && (
              <div className="bg-slate-700/80 rounded-2xl p-6 border border-white/10">
                <div className="text-2xl text-slate-400 mb-3">Gate Information</div>
                <div className="text-4xl font-bold text-white">Gate {flightDisplay.gateNumber}</div>
                <div className="flex items-center justify-end gap-2 text-xl text-slate-300 mt-2">
                  <Info className="w-6 h-6 text-yellow-400" />
                  <span>After check-in please proceed to gate {flightDisplay.gateNumber}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}