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
import { isNightHours } from '@/lib/night-hours';

// ============================================================
// KONSTANTE
// ============================================================
const POLL_INTERVAL = 20_000; // Svako 15s provjerava admin promjene
const AD_SWITCH_INTERVAL = 15_000;
const BLUR_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

  const isBAFlight = (flightNumber: string): boolean =>
  flightNumber.toUpperCase().startsWith('BA');

const BA_IMAGES: Record<string, string> = {
  BUSINESS: '/british/ba1.jpg',
  ECONOMY:  '/british/ba2.jpg',
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
    e.currentTarget.src = '/airlines/placeholder.jpg';
  }, []);

  if (!logoUrl) return null;

  if (portrait) {
    return (
      <div className="relative w-full max-w-[90vw] bg-white rounded-xl shadow-lg mb-3 flex items-center justify-center" style={{ height: 'clamp(120px, 18vh, 280px)' }}>
        <div className="relative w-full h-full">
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
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
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
}: {
  adImages: string[];
  currentIndex: number;
  nextIndex: number;
  isTransitioning: boolean;
  baImageSrc: string | null;
}) {
  // BA let — prikaži statičnu sliku umjesto ads
  if (baImageSrc) {
    return (
      <div className="flex-1 min-h-[400px] rounded-xl overflow-hidden flex items-stretch">
        <div className="relative w-full h-full">
          <Image
            src={baImageSrc}
            alt="British Airways"
            fill
            className="object-fill"
            priority
            quality={90}
            sizes="100vw"
            placeholder="blur"
            blurDataURL={BLUR_DATA_URL}
            decoding="async"
          />
        </div>
      </div>
    );
  }

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
          loading={currentIndex === 0 ? 'eager' : 'lazy'}
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

  const [assignment, setAssignment] = useState<DeskAssignment>(EMPTY_ASSIGNMENT);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [isPortrait, setIsPortrait] = useState(false);

  // Ad state
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [nextAdIndex, setNextAdIndex] = useState(1);
  const [isAdTransitioning, setIsAdTransitioning] = useState(false);

const isMountedRef = useRef(true);
  const orientationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlightNumberRef = useRef<string>('');
  const logoCacheRef = useRef<Map<string, string>>(new Map());

  const { adImages } = useAdImages();
  // BA override za ad banner
const baAdImage = useMemo((): string | null => {
  if (!isBAFlight(assignment.flightNumber)) return null;
  if (assignment.classType === 'BUSINESS') return BA_IMAGES.BUSINESS;
  if (assignment.classType === 'ECONOMY')  return BA_IMAGES.ECONOMY;
  return null;
}, [assignment.flightNumber, assignment.classType]);

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

  // ── Hard reset svakih 6h ───────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), 6 * 60 * 60 * 1000);
    return () => clearTimeout(id);
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
  useEffect(() => {
    if (adImages.length < 2) return;
    const id = setInterval(() => {
      setIsAdTransitioning(true);
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

  // ── Glavni fetch iz desk-status-override ──────────────────
const fetchDeskData = useCallback(async () => {
  if (!isMountedRef.current) return;
  if (isNightHours()) {
    setLoading(false);   // ← dodaj ovo, da ne ostane zaglavljen na spinneru ako se restartuje noću
    return;
  }
  if (!deskNumberParam) return;
  try {
    // NOVO: Dodajemo query parametar da dobijemo samo podatke za ovaj šalter
    const res = await fetch(`/api/test/desk-status-override?deskNumber=${deskNumberParam}`);
    if (!res.ok) throw new Error('Failed to fetch desk status');
    
    // NOVO: Ruta sada vraća direktno entry za taj desk, ne ceo objekat
    const myData = await res.json();

    if (!isMountedRef.current) return;

    setLastUpdate(new Date().toLocaleTimeString('en-GB'));
    setLoading(false);

    // Nema dodjele → instant reset, bez ikakvog dodatnog fetch-a
    if (!myData || !myData.flightNumber || myData.status === null) {
      lastFlightNumberRef.current = '';
      setAssignment(EMPTY_ASSIGNMENT);
      return;
    }

    const classType: string | null = myData.classType ?? null;

    // Isti let kao prošli put → samo status (open/closed) i/ili klasa su se
    // promijenili. Ne radimo ponovo fetch cijelog /api/flights, ne
    // provjeravamo logo sliku — instant update, minimalan trošak.
    if (myData.flightNumber === lastFlightNumberRef.current) {
      setAssignment((prev) => ({
        ...prev,
        status: myData.status as 'open' | 'closed',
        classType,
        setAt: myData.setAt || null,
      }));
      return;
    }

    lastFlightNumberRef.current = myData.flightNumber;

    // Novi let dodijeljen ovom šalteru → tek sada dohvati pune podatke.
    let flightDetails: Record<string, string | string[] | boolean | null> = {};
    try {
      const flightsRes = await fetch('/api/flights');
      const flightsData = await flightsRes.json();
      const allFlights = [
        ...(flightsData.departures || []),
        ...(flightsData.arrivals || []),
      ];
      const match = allFlights.find(
        (f: Record<string, string>) => f.FlightNumber === myData.flightNumber
      );
      if (match) flightDetails = match;
    } catch {
      // Nastavljamo s minimalnim podacima
    }

    // Logo URL — keširaj rezultat provjere po ICAO kodu
    const icao =
      (flightDetails.AirlineICAO as string) ||
      myData.flightNumber.substring(0, 2).toUpperCase();
    let logoUrl = '/airlines/placeholder.jpg';
    if (icao) {
      const cachedLogo = logoCacheRef.current.get(icao);
      if (cachedLogo) {
        logoUrl = cachedLogo;
      } else {
        const checkImg = (src: string): Promise<boolean> =>
          new Promise((resolve) => {
            if (typeof window === 'undefined') return resolve(false);
            const img = new window.Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            setTimeout(() => resolve(false), 1000);
            img.src = src;
          });
        const [hasJpg, hasPng] = await Promise.all([
          checkImg(`/airlines/${icao}.jpg`),
          checkImg(`/airlines/${icao}.png`),
        ]);
        if (hasJpg) logoUrl = `/airlines/${icao}.jpg`;
        else if (hasPng) logoUrl = `/airlines/${icao}.png`;
        else if (flightDetails.AirlineLogoURL)
          logoUrl = flightDetails.AirlineLogoURL as string;

        logoCacheRef.current.set(icao, logoUrl);
      }
    }

    const destCode = (flightDetails.DestinationAirportCode as string) || '';
    const cityUrl = destCode ? `/city-images/${destCode.toLowerCase()}.jpg` : '';

    const statusStr = (flightDetails.StatusEN as string) || '';
    const sl = statusStr.toLowerCase().trim();
    const isCancelled =
      sl.includes('cancelled') || sl.includes('canceled') ||
      sl.includes('annulé') || sl.includes('otkazan');
    const isDiverted =
      sl.includes('diverted') || sl.includes('preusmjeren') || sl.includes('dévié');

    setAssignment({
      status: myData.status as 'open' | 'closed',
      flightNumber: myData.flightNumber,
      airlineName: (flightDetails.AirlineName as string) || '',
      destinationCity: (flightDetails.DestinationCityName as string) || '',
      destinationCode: destCode,
      scheduledTime: (flightDetails.ScheduledDepartureTime as string) || '',
      estimatedTime: (flightDetails.EstimatedDepartureTime as string) || '',
      gateNumber: (flightDetails.GateNumber as string) || '',
      logoUrl,
      cityUrl,
      classType,
      isCancelled,
      isDiverted,
      codeshareFlights: (flightDetails.CodeShareFlights as string[]) || [],
      setAt: myData.setAt || null,
    });
  } catch (err) {
    console.error('fetchDeskData error:', err);
    if (isMountedRef.current) {
      setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      setLoading(false);
    }
  }
}, [deskNumberParam]);

  // ── Polling ────────────────────────────────────────────────
useEffect(() => {
  isMountedRef.current = true;
  
  const poll = () => {
    // NAPOMENA: fetchDeskData() već sama provjerava isNightHours() na
    // početku i tada zove setLoading(false) prije return-a. Raniji vanjski
    // 'if (!isNightHours())' ovdje je sprečavao da se fetchDeskData()
    // uopšte pozove noću — što je značilo da se setLoading(false) nikad
    // nije izvršio, pa je spinner ostajao zaglavljen do jutra.
    void fetchDeskData();
  };
  
  // Prvi poziv
  poll();
  
  // Interval
  const id = setInterval(poll, POLL_INTERVAL);
  
  return () => {
    isMountedRef.current = false;
    clearInterval(id);
  };
}, [fetchDeskData]);

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
      <div className="min-h-screen relative gpu-accelerated">
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
                    className={`rounded-xl px-6 py-3 text-center shadow-lg border-2 ${
                      assignment.classType.toUpperCase().includes('BUSINESS')
                        ? 'bg-gradient-to-r from-red-600 to-red-700 border-red-400'
                        : assignment.classType.toUpperCase().includes('PREMIUM')
                        ? 'bg-gradient-to-r from-purple-600 to-purple-700 border-purple-400'
                        : assignment.classType.toUpperCase().includes('PRIORITY')
                        ? 'bg-gradient-to-r from-green-600 to-green-700 border-green-400'
                        : 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-400'
                    }`}
                  >
                    <h1 className="text-7xl font-black text-white tracking-wider">
                      {assignment.classType.toUpperCase()}
                    </h1>
                  </div>
                </div>
              )}

              {/* Broj leta */}
              <div className="text-center w-full">
                <div className="text-[13rem] font-black leading-tight">
                  {(() => {
                    const iata = assignment.flightNumber.substring(0, 2);
                    const num = assignment.flightNumber.substring(2);
                    return (
                      <>
                        <span
                          className="text-yellow-200 drop-shadow-lg"
                          style={{ marginRight: '0.1em' }}
                        >
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
                Portable chargers: CABIN BAGGAGE ONLY! Not in overhead bins. No charging during flight.
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
/>

          {/* Footer */}
          <div className="flex-shrink-0 flex justify-center items-center space-x-2 text-xs font-inter py-1">
            <Image
              src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAACz0lEQVR4nO2YPWhUQRDHYzSRREHUiILRxspCBIUYC20sxMJSEtTC1lYJfqWwUGOTIGiIYieIiBiEoI1WgoWFoBIRRBD8ACV+gaA5Nf5k4hiGx91l871361K8Hxy8e7s7O/+73Z3ZaWoqKSnJDDAf2AocB24Cz4DPwE/9yPO4tkmfbqB5Lji+BjgLvMXPH2AA6GwE4xuAS0CF7FSAEaCjKOf3Ap+Iz0egN0/HW4DL5M9FmSu28+3AHYrjtswZ85cv0vn/3AVaYwgoYtnUYiSr8/toPD1pnV8PtDNae/6deP4jVs/5usJwmggbI0hV4xjwSFOKUCZdEVvTg7yYPolmAhc5xA57EzNvbHAHagL7ZOibm8vA6KAHUrNLLTOQEouchgOhKESBZm9MkxvdA7wP7evkaImDUa7WKjd0hffFzI0TAeFYBaudKDgKehghxp8o17CzTjRdTwESIAPf5nxi/yjzvAv5EFDBZhICxeslgRgHfc19C+uqA+S5R96Xpvj+DgHe5b2J99VXSEfNuh1lKX4C1eW7i0QgChHvAPPP+gmm7rxHfy9UiApnlYOJa+sK0HXa7D30hArojCvgGrDTt24Apk2F62RwioLna+Z1SgPBApotpHyQdr+ySnE2EVMxipsiHjG3JWp+nEHAqyHmdpNMZD2TfLAZO1Gj/Aay39rcAvx32ZfzKYAE6iZT7YvIQWGDsn3GMPe9yXidYlsOlvt/ybwWeBIyR1HypW4BO0htZgCzLjcb+Ji2/72NPKufNJFKrjMljW3EDTtbpO5TJeVNalFplTE4n7D+q0mfM7pmsItiji/hl77fAhkRguxWlLpoQ0RL5ZJJY0GbsS71InC6y8ZrwZ59uR8auJHf7cnO8St10OGU+Y/kCtHvd6kz/Zs8AAAAASUVORK5CYII="
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
                      className={`inline-block rounded-xl px-6 py-3 text-center shadow-lg border-2 ${
                        assignment.classType.toUpperCase().includes('BUSINESS')
                          ? 'bg-gradient-to-r from-red-600 to-red-700 border-red-400'
                          : assignment.classType.toUpperCase().includes('PREMIUM')
                          ? 'bg-gradient-to-r from-purple-600 to-purple-700 border-purple-400'
                          : assignment.classType.toUpperCase().includes('PRIORITY')
                          ? 'bg-gradient-to-r from-green-600 to-green-700 border-green-400'
                          : 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-400'
                      }`}
                    >
                      <h1 className="text-5xl font-black text-white tracking-wider">
                        {assignment.classType.toUpperCase()}
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