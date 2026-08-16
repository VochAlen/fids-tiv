// app/baggage/[beltNumber]/BaggagePageClient.tsx
"use client"

import type React from "react"
import { useEffect, useState, useRef, useMemo } from "react"
import { useParams } from "next/navigation"
import type { Flight } from "@/types/flight"
import { fetchFlightData, getFlightsByBaggage } from "@/lib/flight-service"
import { isNightHours } from '@/lib/night-hours'
import { Plane, Luggage, MapPin, Clock, Users } from "lucide-react"

// ============================================================
// KONSTANTE — isti koncept kao CombinedPageClient
// ============================================================
const REFRESH_INTERVAL_MS = 150_000
const CACHE_KEY = "baggage_board_cache_v1"
const CACHE_DURATION = 5 * 60_000
const EMERGENCY_CACHE_KEY = "baggage_board_emergency_v1"


interface FlightDataResponse {
  departures: Flight[]
  arrivals: Flight[]
  lastUpdated: string
}

const saveToCache = (data: FlightDataResponse) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })) }
  catch { /* quota exceeded — ništa */ }
}
const loadFromCache = (): FlightDataResponse | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    return Date.now() - timestamp > CACHE_DURATION ? null : data
  } catch { return null }
}
const saveEmergencyCache = (data: FlightDataResponse) => {
  try { localStorage.setItem(EMERGENCY_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })) }
  catch { /* quota exceeded — ništa */ }
}
const loadEmergencyCache = (): FlightDataResponse | null => {
  try {
    const raw = localStorage.getItem(EMERGENCY_CACHE_KEY)
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    return Date.now() - timestamp > 60 * 60_000 ? null : data
  } catch { return null }
}

const fetchWithTimeout = (url: string, timeout: number, headers?: HeadersInit): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  return fetch(url, { signal: controller.signal, headers })
    .finally(() => clearTimeout(timeoutId))
}

// ============================================================
// Pomocne funkcije — NEPROMIJENJENO
// ============================================================
const parseTime = (timeStr: string, baseDate: Date): Date | null => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;
  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

const normalizeBelt = (belt: string | undefined): string => {
  return belt ? belt.toString().replace(/^0+/, '') : '';
};

const getStatusColor = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes("arrived") || s.includes("sletio") || s.includes("landed")) return "text-emerald-400";
  if (s.includes("approach") || s.includes("final")) return "text-cyan-400";
  if (s.includes("delay")) return "text-red-400";
  if (s.includes("air") || s.includes("flying")) return "text-blue-400";
  if (s.includes("scheduled")) return "text-amber-400";
  if (s.includes("cancelled") || s.includes("otkazan")) return "text-red-400";
  return "text-gray-400";
}

export default function BaggagePageClient() {
  const params = useParams()
  const beltNumber = params.beltNumber as string

  const [allArrivals, setAllArrivals] = useState<Flight[]>([])
  const [lastUpdate, setLastUpdate] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)
  const [nightMode, setNightMode] = useState(false)

  const etagRef = useRef<string | null>(null)
  // unutar BaggagePageClient komponente, sa ostalim refs:
const lastKnownHashRef = useRef<string | null>(null)

// i onda svuda gdje se koristi lastKnownHash, koristi lastKnownHashRef.current
  const isMountedRef = useRef(true)

  // ── Inicijalni keš load — brz prvi prikaz, bez čekanja mreže ──
  useEffect(() => {
    const cached = loadFromCache()
    if (!cached) return
    setAllArrivals(cached.arrivals || [])
    setLastUpdate(cached.lastUpdated || new Date().toLocaleTimeString("en-GB"))
    setIsLoading(false)
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    let tid: ReturnType<typeof setTimeout>

    const loadFlights = async () => {
      if (!isMountedRef.current) return

      // ── NOĆNI REŽIM — nikakav network poziv dok aerodrom ne radi ──
      if (isNightHours()) {
        if (isMountedRef.current) { setNightMode(true); setIsLoading(false) }
        tid = setTimeout(loadFlights, REFRESH_INTERVAL_MS)
        return
      }
      if (isMountedRef.current) setNightMode(false)

      try {
        let hashChanged = true
        const headers: HeadersInit = {}
        if (etagRef.current) headers["If-None-Match"] = etagRef.current

        try {
          const statusRes = await fetchWithTimeout("/api/flights/status", 5_000, headers)
          if (statusRes.status === 304) {
            setLastUpdate(new Date().toLocaleTimeString("en-GB"))
            tid = setTimeout(loadFlights, REFRESH_INTERVAL_MS)
            setIsLoading(false)
            return
          }
          if (statusRes.ok) {
            const data = await statusRes.json()
            const newEtag = statusRes.headers.get('ETag')
            if (newEtag) etagRef.current = newEtag
           if (data.hash !== null && data.hash === lastKnownHashRef.current) {
  hashChanged = false
} else if (data.hash !== null) {
  lastKnownHashRef.current = data.hash
}
// ako je data.hash === null, ne diraj lastKnownHash — zadrži zadnju poznatu vrijednost
          }
        } catch { /* nastavi na pun fetch */ }

        if (!hashChanged) {
          setLastUpdate(new Date().toLocaleTimeString("en-GB"))
          tid = setTimeout(loadFlights, REFRESH_INTERVAL_MS)
          setIsLoading(false)
          return
        }

        // ── PUN FETCH — samo ako se hash promijenio ──
        try {
          const data = await fetchFlightData()
          if (isMountedRef.current) {
            setAllArrivals(data.arrivals || [])
            setLastUpdate(new Date().toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
            saveToCache(data)
            saveEmergencyCache(data)
          }
        } catch (error) {
          console.error("Failed to load arrivals:", error)
          // ── Fallback lanac: obični keš → emergency keš → zadrži staro ──
          const cached = loadFromCache()
          if (cached) {
            setAllArrivals(cached.arrivals || [])
          } else {
            const emergency = loadEmergencyCache()
            if (emergency) setAllArrivals(emergency.arrivals || [])
            // ako ni to ne postoji, ostaje trenutno stanje (ne prazni ekran)
          }
        }
      } finally {
        if (isMountedRef.current) setIsLoading(false)
        tid = setTimeout(loadFlights, REFRESH_INTERVAL_MS)
      }
    }

    loadFlights()
    return () => { isMountedRef.current = false; clearTimeout(tid) }
  }, [])

  // ── MAGIJA: Kompletna logika filtriranja u useMemo. NEPROMIJENJENO ──
  const displayFlights = useMemo(() => {
    const now = new Date()
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000)
    const targetBelt = normalizeBelt(beltNumber)

    let matched = getFlightsByBaggage(allArrivals, beltNumber)
    if (matched.length === 0) {
      matched = allArrivals.filter(f => normalizeBelt(f.BaggageReclaim) === targetBelt)
    }

    const active = matched.filter(flight => {
      const s = flight.StatusEN?.toLowerCase() || ""
      const isArrived = s.includes("arrived") || s.includes("sletio") || s.includes("landed")
      if (isArrived) {
        const flightTime = parseTime(flight.EstimatedDepartureTime || flight.ScheduledDepartureTime, now)
        if (!flightTime) return false
        return flightTime.getTime() >= thirtyMinutesAgo.getTime()
      }
      return true
    })

    active.sort((a, b) => {
      const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime || "99:99"
      const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime || "99:99"
      return timeA.localeCompare(timeB)
    })

    return active.slice(0, 5)
  }, [allArrivals, beltNumber])

  const isRecentArrived = (flight: Flight): boolean => {
    const s = flight.StatusEN?.toLowerCase() || ""
    if (!(s.includes("arrived") || s.includes("sletio") || s.includes("landed"))) return false
    const now = new Date()
    const flightTime = parseTime(flight.EstimatedDepartureTime || flight.ScheduledDepartureTime, now)
    if (!flightTime) return true
    return flightTime.getTime() >= new Date(now.getTime() - 30 * 60 * 1000).getTime()
  }

  const isCancelled = (flight: Flight): boolean => {
    const s = flight.StatusEN?.toLowerCase() || ""
    return s.includes("cancelled") || s.includes("otkazan")
  }

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.src = "https://via.placeholder.com/180x120?text=No+Logo"
  }

  // ── Noćni mod: jednostavan prikaz umjesto pune table (dizajn ostaje minimalan) ──
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

  // ── DIZAJN OD OVDJE PA NA DOLJE — POTPUNO NEPROMIJENJEN ──
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
                const arrived = isRecentArrived(flight)
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
                          src={flight.AirlineLogoURL || "/placeholder.svg"}
                          alt={flight.AirlineName}
                          className="w-16 h-16 object-contain bg-white rounded-xl p-2 shadow-lg"
                          onError={handleImageError}
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
                  <div className="text-lg text-green-300">Shows active + arrived within 30 minutes • Code by alen.vocanec@apm.co.me</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl text-green-300 font-semibold">Auto Refresh</div>
                <div className="text-3xl font-mono font-black text-green-400">
                  {lastUpdate.split(':').slice(0, 2).join(':')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[95%] mx-auto mt-8 text-center text-xl text-purple-400 font-semibold">
        <div className="flex items-center justify-center gap-6 mb-2">
          <span>Arrivals Only</span><span>•</span><span>Active + Recent Arrived (30 min)</span><span>•</span><span>Auto Refresh Every Minute</span>
        </div>
        <div>Showing up to 5 arrivals • Updates every minute</div>
      </div>
    </div>
  )
}