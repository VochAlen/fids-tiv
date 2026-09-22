// app/baggage/[beltNumber]/BaggagePageClient.tsx
"use client"

// ============================================================
// v6: MIGRACIJA NA ABLY — ova stranica je ranije bila JEDINA na
// cijeloj tabli koja nije prošla kroz prelazak sa direktnog
// pollinga (/api/flights svakih 150s) na dijeljeni Ably real-time
// feed. Sad koristi ISTI useRealtimeFlightData('arrivals') hook
// kao border stranica (arrivals-only uloga — vidi ROLE_CAPABILITIES
// u app/api/ably-token/route.ts, ne treba nikakva nova dozvola).
//
// Šta je to konkretno promijenilo:
//  - Nema više sopstvenog fetch/cache/ETag/lastKnownHash koda — sve
//    to sad radi useRealtimeFlightData (dijeljena Ably konekcija +
//    /api/flights/snapshot na mount + emergency cache u localStorage),
//    isto što koriste i border/departures/combined/split-board.
//  - Noćni prikaz se sad pokreće preko liveFlightData.isNightMode
//    (stiže sa servera kroz isti feed), a ne preko klijentskog
//    isNightHours() poziva — jedan izvor istine umjesto dva.
//  - Dodat error boundary + memory-pressure auto-reload (85%) +
//    hard reset u 03:00 + blokiranje kontekst menija — isti "24/7
//    bez nadzora" paket koji imaju svi ostali kiosk ekrani.
//
// v5.8 NAPOMENA: pošto stranica koristi dijeljeni useRealtimeFlightData
// hook, automatski nasljeđuje i noćni Ably sleep-mode (lib/ably-client.ts)
// dodat u prethodnoj rundi — nema potrebe ni za kakvom dodatnom izmjenom
// da bi i ova stranica dobila istu Edge Requests uštedu noću.
// ============================================================

import type React from "react"
import {
  type JSX,
  useEffect,
  useState,
  useMemo,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react"
import { useParams } from "next/navigation"
import type { Flight } from "@/types/flight"
import { getFlightsByBaggage } from "@/lib/flight-service"
import { Plane, Luggage, MapPin, Clock, Users } from "lucide-react"
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from "@/lib/airline-logo"
import { useRealtimeFlightData } from "@/hooks/useRealtimeFlightData"

const HARD_RESET_HOUR = 3
const MAX_FLIGHTS_DISPLAY = 5
const ARRIVED_SHOW_MINUTES = 30

// ============================================================
// ERROR BOUNDARY — isti obrazac kao na svim ostalim kiosk
// stranicama (border/combined/departures/gate/checkin). Ranije je
// baggage stranica bila jedina bez ovoga — bilo koja render greška
// je značila trajan bijeli ekran dok neko fizički ne restartuje kiosk.
// ============================================================
interface BaggageEBState { hasError: boolean; message: string }
class BaggageErrorBoundary extends Component<{ children: ReactNode }, BaggageEBState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, message: "" }
  }
  static getDerivedStateFromError(e: Error): BaggageEBState { return { hasError: true, message: e.message } }
  componentDidCatch(e: Error, i: ErrorInfo) {
    console.error("🚨 Baggage ErrorBoundary:", e, i)
    setTimeout(() => this.setState({ hasError: false, message: "" }), 10_000)
  }
  render() {
    if (this.state.hasError) return (
      <div className="h-screen bg-[#0f172a] flex flex-col items-center justify-center text-white gap-6">
        <Luggage className="w-24 h-24 opacity-30 animate-pulse" />
        <div className="text-3xl font-bold opacity-70">Reconnecting…</div>
        <div className="text-lg opacity-50">{this.state.message}</div>
      </div>
    )
    return this.props.children
  }
}

export default function BaggagePageClient(): JSX.Element {
  return (
    <BaggageErrorBoundary>
      <BaggageDisplay />
    </BaggageErrorBoundary>
  )
}

// ============================================================
// HELPERS — čiste funkcije, bez mreže, nepromijenjene iz stare
// verzije osim parseTime (preuzet direktno iz border/page.tsx —
// robusniji: sam računa "danas", i ispravno prebacuje na sutra
// ako je vrijeme >12h u prošlosti, umjesto da zahtijeva eksplicitan
// baseDate argument kao stara verzija).
// ============================================================
function parseTime(t: string | null | undefined): Date | null {
  if (!t) return null
  const s = t.trim()
  if (!s || s === "-" || s === "--:--") return null
  try {
    if (s.includes("T") || (s.includes("-") && s.length > 5)) {
      const d = new Date(s); return isNaN(d.getTime()) ? null : d
    }
    const m = s.match(/^(\d{1,2})[:.](\d{2})$/)
    if (m) {
      const h = +m[1], min = +m[2]
      if (h > 23 || min > 59) return null
      const d = new Date(); d.setHours(h, min, 0, 0)
      if (Date.now() - d.getTime() > 12 * 3600_000) d.setDate(d.getDate() + 1)
      return d
    }
    return null
  } catch { return null }
}

const normalizeBelt = (belt: string | undefined): string =>
  belt ? belt.toString().replace(/^0+/, '') : ''

const getStatusColor = (status: string): string => {
  const s = status.toLowerCase()
  if (s.includes("arrived") || s.includes("sletio") || s.includes("landed")) return "text-emerald-400"
  if (s.includes("approach") || s.includes("final")) return "text-cyan-400"
  if (s.includes("delay")) return "text-red-400"
  if (s.includes("air") || s.includes("flying")) return "text-blue-400"
  if (s.includes("scheduled")) return "text-amber-400"
  if (s.includes("cancelled") || s.includes("otkazan")) return "text-red-400"
  return "text-gray-400"
}

function BaggageDisplay(): JSX.Element {
  const params = useParams()
  const beltNumber = params.beltNumber as string

  const [nightMode, setNightMode] = useState(false)

  // ── v5: Memory pressure auto-reload (85%) — identično svim ──
  // ostalim kiosk stranicama.
  useEffect(() => {
    const checkMemory = () => {
      const perf = performance;
      if (perf?.memory) {
        const used = perf.memory.usedJSHeapSize
        const limit = perf.memory.jsHeapSizeLimit
        const pct = used / limit
        if (pct > 0.85) {
          console.warn(`Memory pressure ${Math.round(pct * 100)}% — auto reload`)
          window.location.reload()
        }
      }
    }
    const id = setInterval(checkMemory, 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Hard reset u 03:00 — isto vrijeme kad se i podaci resetuju ──
  useEffect(() => {
    const now = new Date(), reset = new Date()
    reset.setHours(HARD_RESET_HOUR, 0, 0, 0)
    if (reset <= now) reset.setDate(reset.getDate() + 1)
    const id = setTimeout(() => window.location.reload(), reset.getTime() - now.getTime())
    return () => clearTimeout(id)
  }, [])

  // ── Kiosk — bez kontekst menija ──
  useEffect(() => {
    const p = (e: Event) => e.preventDefault()
    document.addEventListener("contextmenu", p)
    document.addEventListener("selectstart", p)
    return () => {
      document.removeEventListener("contextmenu", p)
      document.removeEventListener("selectstart", p)
    }
  }, [])

  // ── Realtime podaci — dijeljena Ably konekcija, uloga 'arrivals' ──
  // (baggage claim ne treba gate/desk assignments kanale, isto kao border)
  const { data: liveFlightData } = useRealtimeFlightData('arrivals')

  useEffect(() => {
    if (!liveFlightData) return
    setNightMode(!!liveFlightData.isNightMode)
  }, [liveFlightData])

  const isLoading = liveFlightData === null

  const lastUpdate = useMemo(() => {
    if (!liveFlightData?.lastUpdated) return ""
    const d = new Date(liveFlightData.lastUpdated)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }, [liveFlightData?.lastUpdated])

  // FIX (KRITIČNO — pravi bug, otkriven kroz React Compiler
  // "react-hooks/purity" pravilo: "Cannot call impure function during
  // render"): Date.now()/new Date() su se ranije pozivali DIREKTNO
  // unutar render tijela (isRecentArrived) i unutar displayFlights
  // useMemo-a — rezultat je zavisio od TRENUTKA IZVRŠAVANJA, ne samo
  // od props/state. Praktična posljedica: "stigao prije manje od 30
  // min" provjera se NIJE ponovo računala sama od sebe protokom
  // vremena — SAMO kad bi liveFlightData/beltNumber promijenili
  // referencu (nova Ably poruka). U MIRNOM periodu (bez novih
  // Ably poruka za taj kacenj/gate), let bi mogao ostati prikazan na
  // baggage ekranu DUŽE nego što ARRIVED_SHOW_MINUTES nalaže.
  //
  // Pravo rješenje: "trenutno vrijeme" postaje STATE, AŽURIRAN
  // ISKLJUČIVO unutar useEffect-a (jedino mjesto gdje je "nečist"
  // poziv poput Date.now() potpuno legitiman — useEffect se izvršava
  // POSLIJE commit-a, van render faze). Početna vrijednost je 0 (čist
  // broj, bez ijednog Date poziva) — isRecentArrived ispod eksplicitno
  // tretira 0 kao "vrijeme još nepoznato, prikaži let normalno" dok
  // efekat ne postavi pravu vrijednost (traje mikrosekunde pri mount-u,
  // prije prvog stvarnog prikaza).
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    setNowMs(Date.now())
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const displayFlights = useMemo(() => {
    if (!liveFlightData?.arrivals) return []
    // nowMs === 0 znači da useEffect iznad JOŠ NIJE postavio pravo
    // vrijeme (traje mikrosekunde pri mount-u) — u tom RIJETKOM,
    // KRATKOTRAJNOM prozoru, "nedavno stigao" filter se privremeno
    // preskače (svi "arrived" letovi ostaju vidljivi), umjesto da se
    // pozove Date.now() ovdje (što bi ponovo bio isti purity problem).
    const thirtyMinutesAgo = nowMs > 0 ? nowMs - ARRIVED_SHOW_MINUTES * 60_000 : null
    const targetBelt = normalizeBelt(beltNumber)

    let matched = getFlightsByBaggage(liveFlightData.arrivals, beltNumber)
    if (matched.length === 0) {
      matched = liveFlightData.arrivals.filter(f => normalizeBelt(f.BaggageReclaim) === targetBelt)
    }

    const active = matched.filter(flight => {
      const s = flight.StatusEN?.toLowerCase() || ""
      const isArrived = s.includes("arrived") || s.includes("sletio") || s.includes("landed")
      if (isArrived && thirtyMinutesAgo !== null) {
        const flightTime = parseTime(flight.EstimatedDepartureTime || flight.ScheduledDepartureTime)
        if (!flightTime) return false
        return flightTime.getTime() >= thirtyMinutesAgo
      }
      return true
    })

    active.sort((a, b) => {
      const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime || "99:99"
      const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime || "99:99"
      return timeA.localeCompare(timeB)
    })

    return active.slice(0, MAX_FLIGHTS_DISPLAY)
  }, [liveFlightData, beltNumber, nowMs])

  const isRecentArrived = (flight: Flight, referenceMs: number): boolean => {
    if (referenceMs === 0) return false // vidi napomenu uz nowMs iznad
    const s = flight.StatusEN?.toLowerCase() || ""
    if (!(s.includes("arrived") || s.includes("sletio") || s.includes("landed"))) return false
    const flightTime = parseTime(flight.EstimatedDepartureTime || flight.ScheduledDepartureTime)
    if (!flightTime) return true
    return flightTime.getTime() >= referenceMs - ARRIVED_SHOW_MINUTES * 60_000
  }

  const isCancelled = (flight: Flight): boolean => {
    const s = flight.StatusEN?.toLowerCase() || ""
    return s.includes("cancelled") || s.includes("otkazan")
  }

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const icao = img.dataset.icao || ''
    if (img.dataset.tried === 'local') {
      img.dataset.tried = 'fw'
      const fw = icao ? `https://www.flightaware.com/images/airline_logos/180px/${icao}.png` : ''
      if (fw) { img.src = fw; return }
    }
    img.src = "https://via.placeholder.com/180x120?text=No+Logo"
    img.onerror = null
  }

  // ── Noćni mod ──
  if (nightMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a0b2e] via-[#2d1b4e] to-[#1a0b2e] text-white flex items-center justify-center">
        <div className="text-center">
          <Luggage className="w-24 h-24 mx-auto mb-6 text-purple-400 opacity-50" />
          <div className="text-4xl font-bold text-purple-300">Baggage Claim — Belt {beltNumber}</div>
          <div className="text-2xl text-purple-400 mt-4">Aerodrom trenutno ne radi</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a0b2e] via-[#2d1b4e] to-[#1a0b2e] text-white p-8">
      <div className="max-w-[95%] mx-auto mb-8">
        <div className="flex justify-between items-center bg-gradient-to-r from-purple-900/40 to-indigo-900/40 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30 p-8 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="p-4 bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl shadow-2xl">
              <Luggage className="w-20 h-20 text-white drop-shadow-lg" />
            </div>
            <div>
              <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400 drop-shadow-[0_4px_12px_rgba(251,191,36,0.5)]">
                BAGGAGE CLAIM
              </h1>
              <p className="text-xl text-purple-300 font-semibold mt-2">
                Arrivals Only • Active + Recent Arrived • Belt {beltNumber}
              </p>
            </div>
          </div>
          <div className="text-center bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl p-8 shadow-2xl border-4 border-amber-300">
            <div className="text-[70px] font-black text-white leading-none drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]">
              {beltNumber}
            </div>
            <div className="text-3xl font-black text-white mt-2">BELT</div>
            {lastUpdate && (
              <div className="text-lg text-amber-100 mt-2 font-semibold">
                Updated: {lastUpdate}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[95%] mx-auto">
        {isLoading ? (
          <div className="text-center p-16 bg-purple-900/20 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30">
            <div className="inline-flex items-center gap-4">
              <div className="w-16 h-16 border-8 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-4xl text-purple-200 font-bold">
                Loading arrivals for Belt {beltNumber}...
              </span>
            </div>
          </div>
        ) : displayFlights.length === 0 ? (
          <div className="text-center p-16 bg-purple-900/20 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30">
            <div className="flex flex-col items-center">
              <Plane className="w-32 h-32 mx-auto mb-6 text-purple-400 opacity-80 rotate-180" />
              <div className="text-5xl text-purple-300 mb-4 font-bold">No Active Arrivals</div>
              <div className="text-3xl text-purple-400 mb-6">Currently no active arrivals for Belt {beltNumber}</div>
              <div className="text-xl text-purple-300 bg-purple-800/50 p-4 rounded-xl">
                <div className="font-bold mb-2">Baggage claim shows:</div>
                <ul className="list-disc list-inside text-left space-y-1">
                  <li>Only arrival flights (not departures)</li>
                  <li>Active flights + arrived within last 30 minutes</li>
                  <li>Flights assigned to belt {beltNumber}</li>
                  <li>Next 5 upcoming arrivals</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-purple-900/20 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30 shadow-2xl overflow-hidden">
            <div className="grid grid-cols-12 gap-6 p-6 bg-gradient-to-r from-purple-600 to-indigo-600 border-b-4 border-purple-500/50 font-black text-white text-2xl uppercase tracking-wider">
              <div className="col-span-2 flex items-center gap-2"><Plane className="w-8 h-8" /><span>Flight</span></div>
              <div className="col-span-3 flex items-center gap-2"><MapPin className="w-8 h-8" /><span>Destination</span></div>
              <div className="col-span-2 flex items-center gap-2"><Clock className="w-8 h-8" /><span>Time</span></div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Details</div>
              <div className="col-span-1 flex items-center gap-2"><Luggage className="w-8 h-8" /><span>Belt</span></div>
            </div>

            <div className="divide-y-2 divide-purple-500/20">
              {displayFlights.map((flight) => {
                const arrived = isRecentArrived(flight, nowMs)
                const cancelled = isCancelled(flight)

                return (
                  <div
                    key={`${flight.FlightNumber}-${flight.EstimatedDepartureTime || flight.ScheduledDepartureTime}`}
                    className={`grid grid-cols-12 gap-6 p-6 items-center transition-all duration-300 hover:bg-purple-500/10 ${
                      arrived ? 'bg-emerald-900/20' : cancelled ? 'bg-red-900/20' : ''
                    }`}
                  >
                    <div className="col-span-2">
                      <div className="flex items-center gap-3">
                        <img
                          src={getInitialAirlineLogoSrc(
                            flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || '',
                            "/placeholder.svg"
                          )}
                          alt={flight.AirlineName}
                          className="w-16 h-16 object-contain bg-white rounded-xl p-2 shadow-lg"
                          onError={handleImageError}
                          data-icao={flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || ''}
                          data-tried={isKnownLocalLogo(flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || '') ? 'local' : 'fw'}
                        />
                        <div>
                          <div className="text-5xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">{flight.FlightNumber}</div>
                          <div className="text-xl text-purple-300 font-semibold">{flight.AirlineName}</div>
                        </div>
                      </div>
                    </div>

                    <div className="col-span-3">
                      <div className="text-6xl font-black text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                        {flight.DestinationCityName || flight.DestinationAirportName || "Unknown"}
                      </div>
                      <div className="text-3xl font-black text-cyan-400 drop-shadow-[0_2px_8px_rgba(6,182,212,0.5)]">
                        {flight.DestinationAirportCode || "N/A"}
                      </div>
                    </div>

                    <div className="col-span-2">
                      <div className="text-6xl font-black text-amber-400 drop-shadow-[0_4px_12px_rgba(251,191,36,0.5)]">
                        {flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || "N/A"}
                      </div>
                      {flight.EstimatedDepartureTime && flight.EstimatedDepartureTime !== flight.ScheduledDepartureTime && (
                        <div className="text-2xl text-purple-400 line-through font-semibold">{flight.ScheduledDepartureTime}</div>
                      )}
                    </div>

                    <div className="col-span-2">
                      <div className={`text-5xl font-black ${getStatusColor(flight.StatusEN)} drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]`}>
                        {flight.StatusEN}
                      </div>
                      {arrived && <div className="text-lg text-emerald-300 mt-1">(Recent - within 30 min)</div>}
                    </div>

                    <div className="col-span-2">
                      <div className="flex flex-col gap-2">
                        {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
                          <div className="flex items-center gap-2 bg-cyan-500/30 px-4 py-2 rounded-xl border-2 border-cyan-400/50">
                            <Users className="w-6 h-6 text-cyan-300" />
                            <span className="text-2xl font-bold text-cyan-200">+{flight.CodeShareFlights.length}</span>
                          </div>
                        )}
                        {flight.Terminal && (
                          <div className="bg-orange-500/30 px-4 py-2 rounded-xl border-2 border-orange-400/50">
                            <div className="text-4xl font-black text-orange-300">
                              T{flight.Terminal.replace("T0", "").replace("T", "")}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="col-span-1 text-center">
                      <div className="text-5xl font-black text-white bg-gradient-to-br from-amber-400 to-orange-500 py-4 rounded-2xl shadow-[0_0_30px_rgba(251,191,36,0.5)] border-2 border-amber-300">
                        {flight.BaggageReclaim || beltNumber}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {displayFlights.length > 0 && (
        <div className="max-w-[95%] mx-auto mt-8">
          <div className="bg-gradient-to-r from-green-500/30 to-emerald-500/30 backdrop-blur-xl rounded-3xl border-4 border-green-400/50 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Plane className="w-12 h-12 text-green-400 animate-pulse drop-shadow-[0_0_20px_rgba(52,211,153,0.8)] rotate-180" />
                <div>
                  <div className="text-4xl font-black text-green-300 drop-shadow-[0_2px_8px_rgba(52,211,153,0.5)]">Baggage Claim Monitor</div>
                  <div className="text-2xl text-green-200 font-semibold">
                    {displayFlights.length} flight{displayFlights.length > 1 ? 's' : ''} active • Belt {beltNumber}
                  </div>
                  <div className="text-lg text-green-300">Shows active + arrived within 30 minutes</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl text-green-300 font-semibold">Live via Ably</div>
                <div className="text-3xl font-mono font-black text-green-400">
                  {lastUpdate}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[95%] mx-auto mt-8 text-center text-xl text-purple-400 font-semibold">
        <div className="flex items-center justify-center gap-6 mb-2">
          <span>Arrivals Only</span><span>•</span><span>Active + Recent Arrived (30 min)</span><span>•</span><span>Real-time via Ably</span>
        </div>
        <div>Showing up to 5 arrivals</div>
      </div>
    </div>
  )
}
