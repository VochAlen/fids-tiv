'use client'

import {
  useState, useEffect, useCallback, useMemo, useRef, memo,
} from 'react'
import type { Flight } from '@/types/flight'
import { fetchFlightData, getUniqueDeparturesWithDeparted } from '@/lib/flight-service'

// ─── Types ────────────────────────────────────────────────────────────────────
interface FlightDataResponse {
  departures: Flight[]
  arrivals: Flight[]
  lastUpdated: string
  source?: string
  error?: string
}

type TabType = 'departures' | 'arrivals'
type StatusTier = 'critical' | 'warning' | 'active' | 'info' | 'neutral'

interface ParsedStatus {
  label: string
  tier: StatusTier
  icon: string
}

// ─── Constants ────────────────────────────────────────────────────────────────
const REFRESH_MS = 60_000
const CACHE_KEY = 'mfids_cache_v1'
const CACHE_TTL = 5 * 60_000
const PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCA0MCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjMUUyQTNBIi8+PHRleHQgeD0iMjAiIHk9IjE1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNDc2MDdBIiBmb250LXNpemU9IjciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiPk5PIExPR088L3RleHQ+PC9zdmc+'

const HIDDEN_PATTERNS = ['ZZZ', 'G00', 'PVT', 'TST']

const CHECKIN_OFFSETS: Record<string, number> = {
  '6H': 180, 'FZ': 180, 'LS': 150, 'LY': 180, 'IZ': 180, 'BA': 150,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseTime(t: string | null | undefined): Date | null {
  if (!t) return null
  const s = t.trim()
  if (!s || s === '-' || s === '--:--') return null
  if (s.includes('T') || (s.includes('-') && s.length > 5)) {
    const d = new Date(s); return isNaN(d.getTime()) ? null : d
  }
  const m = s.match(/^(\d{1,2})[:.](\d{2})$/)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2])
    if (h > 23 || min > 59) return null
    const d = new Date(); d.setHours(h, min, 0, 0)
    if (Date.now() - d.getTime() > 12 * 3600_000) d.setDate(d.getDate() + 1)
    return d
  }
  return null
}

function fmt(t: string | null | undefined): string {
  if (!t) return ''
  const s = t.trim()
  if (/^\d{2}:\d{2}$/.test(s)) return s
  if (s.includes('T')) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  const digits = s.replace(/\D/g, '')
  if (digits.length === 4) {
    const h = parseInt(digits.slice(0, 2)), m = parseInt(digits.slice(2))
    if (h > 23 || m > 59 || (h === 0 && m === 0)) return ''
    return `${digits.slice(0, 2)}:${digits.slice(2)}`
  }
  return ''
}

function isLate(f: Flight): boolean {
  const s = fmt(f.ScheduledDepartureTime)
  const e = fmt(f.EstimatedDepartureTime)
  if (!s || !e || s === e) return false
  const sch = parseTime(f.ScheduledDepartureTime)
  const est = parseTime(f.EstimatedDepartureTime)
  if (!sch || !est) return false
  return (est.getTime() - sch.getTime()) > 10 * 60_000
}

function parseStatus(flight: Flight, isArrival: boolean): ParsedStatus {
  const raw = (flight.StatusEN ?? '').trim()
  const s = raw.toLowerCase()

  if (/(cancelled|canceled|otkazan)/.test(s))
    return { label: 'Cancelled', tier: 'critical', icon: '✕' }
  if (/(diverted|preusmjeren)/.test(s))
    return { label: 'Diverted', tier: 'critical', icon: '↗' }
  if (/^close$/i.test(raw.trim()))
    return { label: 'Gate Closing', tier: 'critical', icon: '⚠' }
  if (/final call/.test(s))
    return { label: 'Final Call', tier: 'critical', icon: '⚡' }
  if (/boarding|gate open/.test(s) && !isArrival)
    return { label: 'Boarding', tier: 'active', icon: '▶' }
  if (/go to gate/.test(s))
    return { label: 'Go to Gate', tier: 'active', icon: '→' }
  if (/(arrived|landed|sletio|sletjelo|stigao)/.test(s) && isArrival) {
    const t = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime
    return { label: `Arrived${t ? ' ' + fmt(t) : ''}`, tier: 'info', icon: '✓' }
  }
  if (/(departed|poletio)/.test(s) && !isArrival)
    return { label: 'Departed', tier: 'info', icon: '↑' }
  if (/(delay|kasni)/.test(s) || isLate(flight))
    return { label: 'Delayed', tier: 'warning', icon: '◔' }
  if (/processing|check.?in/.test(s))
    return { label: 'Check-In Open', tier: 'active', icon: '✓' }
  if (/on time|na vrijeme/.test(s))
    return { label: 'On Time', tier: 'info', icon: '●' }

  if (!raw || raw === '-') {
    const sch = parseTime(flight.ScheduledDepartureTime)
    const ref = parseTime(flight.EstimatedDepartureTime) ?? sch
    if (!sch || !ref) return { label: 'Scheduled', tier: 'neutral', icon: '○' }
    const now = Date.now()
    const minsToRef = (ref.getTime() - now) / 60_000
    const minsToSch = (sch.getTime() - now) / 60_000

    if (isArrival) {
      if (minsToSch > 15) return { label: 'Scheduled', tier: 'neutral', icon: '○' }
      if (minsToSch > -10) return { label: 'Expected', tier: 'info', icon: '◉' }
      return { label: 'Arrived', tier: 'info', icon: '✓' }
    }

    if (minsToRef <= 0)  return { label: 'Departed', tier: 'info', icon: '↑' }
    if (minsToRef <= 5)  return { label: 'Gate Closing', tier: 'critical', icon: '⚠' }
    if (minsToRef <= 10) return { label: 'Final Call', tier: 'critical', icon: '⚡' }
    if (minsToRef <= 30) return { label: 'Go to Gate', tier: 'active', icon: '→' }
    if (minsToSch > 30) {
      const iata = (flight.FlightNumber ?? '').slice(0, 2).toUpperCase()
      const offset = CHECKIN_OFFSETS[iata] ?? 120
      const open = new Date(sch.getTime() - offset * 60_000)
      if (now >= open.getTime()) return { label: 'Check-In Open', tier: 'active', icon: '✓' }
      const hh = String(open.getHours()).padStart(2, '0')
      const mm = String(open.getMinutes()).padStart(2, '0')
      return { label: `Opens ${hh}:${mm}`, tier: 'neutral', icon: '○' }
    }
    return { label: 'Scheduled', tier: 'neutral', icon: '○' }
  }

  return { label: raw, tier: 'neutral', icon: '●' }
}

// ─── Cache ────────────────────────────────────────────────────────────────────
function saveCache(d: FlightDataResponse) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ d, ts: Date.now() })) } catch {}
}
function loadCache(): FlightDataResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { d, ts } = JSON.parse(raw)
    return Date.now() - ts > CACHE_TTL ? null : d
  } catch { return null }
}

// ─── Logo component ───────────────────────────────────────────────────────────
const AirlineLogo = memo(function AirlineLogo({ icao, name }: { icao: string; name: string }) {
  const onErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.dataset.tried === 'png') { img.dataset.tried = 'jpg'; img.src = `/airlines/${icao}.jpg`; return }
    if (img.dataset.tried === 'jpg') {
      img.dataset.tried = 'fw'
      img.src = icao ? `https://www.flightaware.com/images/airline_logos/180px/${icao}.png` : PLACEHOLDER
      return
    }
    img.src = PLACEHOLDER; img.onerror = null
  }, [icao])

  return (
    <div className="mf-logo-wrap">
      <img
        src={`/airlines/${icao}.png`}
        alt={name}
        className="mf-logo-img"
        onError={onErr}
        data-tried="png"
        decoding="async"
        loading="lazy"
      />
    </div>
  )
})

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = memo(function StatusBadge({ status }: { status: ParsedStatus }) {
  return (
    <span className={`mf-badge mf-badge-${status.tier}`}>
      <span className="mf-badge-dot" />
      {status.label}
    </span>
  )
})

// ─── Flight Card ──────────────────────────────────────────────────────────────
const FlightCard = memo(function FlightCard({
  flight, isArrival, tick, highlight,
}: {
  flight: Flight
  isArrival: boolean
  tick: number
  highlight: boolean
}) {
  const icao = flight.AirlineICAO || (flight.FlightNumber ?? '').slice(0, 2).toUpperCase()
  const status = useMemo(() => parseStatus(flight, isArrival), [flight, isArrival, tick])
  const sched = fmt(flight.ScheduledDepartureTime)
  const est = fmt(flight.EstimatedDepartureTime)
  const delayed = est && est !== sched
  const city = flight.DestinationCityName || flight.DestinationAirportName || '—'
  const iata = flight.DestinationAirportCode || ''
  const hasGate = !!(flight.GateNumber && flight.GateNumber !== '-')
  const hasCheckin = !isArrival && !!(flight.CheckInDesk && flight.CheckInDesk !== '-')
  const hasOps = hasGate || hasCheckin

  return (
    <div className={`mf-card ${highlight ? 'mf-card-hl' : ''} mf-tier-${status.tier}`}>
      <div className="mf-card-flight">
        <div className="mf-time-block">
          <span className="mf-time-sched">{sched || '--:--'}</span>
          {delayed && (
            <span className="mf-time-est">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0 }}>
                <path d="M4 1v3M4 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {est}
            </span>
          )}
        </div>

        <div className="mf-route-block">
          {/* 1st Row: Logo + City + IATA */}
          <div className="mf-dest-line">
            <AirlineLogo icao={icao} name={flight.AirlineName || icao} />
            <span className="mf-city">{city}</span>
            {iata && <span className="mf-iata">{iata}</span>}
          </div>
          
          {/* 2nd Row: Flight Number + Codeshare */}
          <div className="mf-meta-line">
            <span className="mf-fnum">{flight.FlightNumber}</span>
            {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
              <span className="mf-codeshare">+{flight.CodeShareFlights.length}</span>
            )}
          </div>
        </div>
      </div>

      <div className="mf-card-ops">
        {hasCheckin && (
          <div className="mf-op-box mf-checkin-box">
            <span className="mf-op-lbl">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 4h12v8H2V4zm1 1v6h10V5H3zm2 2h6v1H5V7z"/>
              </svg>
              Check-in
            </span>
            <span className="mf-op-val">{flight.CheckInDesk}</span>
          </div>
        )}
        {hasGate && (
          <div className={`mf-op-box mf-gate-box ${status.tier === 'critical' || status.tier === 'active' ? 'mf-gate-urgent' : ''}`}>
            <span className="mf-op-lbl">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2h10v12H3V2zm1 1v10h8V3H4zm2 2h4v2H6V5z"/>
              </svg>
              Gate
            </span>
            <span className="mf-op-val">{flight.GateNumber}</span>
          </div>
        )}
        {!hasOps && (
          <div className="mf-op-box mf-op-empty">
            <span className="mf-op-lbl">{isArrival ? 'Arrival' : 'Departure'}</span>
            <span className="mf-op-val mf-op-dash">—</span>
          </div>
        )}
        <div className="mf-status-wrap">
          <StatusBadge status={status} />
        </div>
      </div>
    </div>
  )
})

// ─── Search & filter bar ──────────────────────────────────────────────────────
const SearchBar = memo(function SearchBar({
  value, onChange, count,
}: {
  value: string
  onChange: (v: string) => void
  count: number
}) {
  return (
    <div className="mf-search-wrap">
      <div className="mf-search-inner">
        <svg className="mf-search-icon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/>
          <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <input
          type="search"
          className="mf-search-input"
          placeholder="Search flight, city, airline…"
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {value && (
          <button className="mf-search-clear" onClick={() => onChange('')} type="button">✕</button>
        )}
      </div>
      {value && (
        <div className="mf-search-count">{count} result{count !== 1 ? 's' : ''}</div>
      )}
    </div>
  )
})

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ query }: { query: string }) {
  return (
    <div className="mf-empty">
      <svg className="mf-empty-icon" viewBox="0 0 72 72" fill="none">
        <circle cx="36" cy="36" r="30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.25"/>
        <path d="M28 44L44 28M36 28h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
        <circle cx="36" cy="36" r="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
      </svg>
      {query
        ? <><div className="mf-empty-title">No flights found</div><div className="mf-empty-sub">Try a different search term</div></>
        : <div className="mf-empty-title">No flights scheduled</div>
      }
    </div>
  )
}

// ─── Theme toggle button component ────────────────────────────────────────────
const ThemeToggle = memo(function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="mf-theme-toggle"
      aria-label="Toggle theme"
      type="button"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  )
})

// ─── Main component ───────────────────────────────────────────────────────────
export default function MobileFIDS() {
  const [tab, setTab] = useState<TabType>('departures')
  const [departures, setDepartures] = useState<Flight[]>([])
  const [arrivals, setArrivals] = useState<Flight[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState('')
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // ─── Theme state ────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  
  // ─── FIX: sprječava flicker ikone aviona na prvom load-u ───────────────────
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Force CSS injection BEFORE first render (sprječava FOUC - Flash of Unstyled Content)
  if (typeof window !== 'undefined' && !document.getElementById('mf-styles')) {
    const style = document.createElement('style')
    style.id = 'mf-styles'
    style.textContent = CSS
    document.head.appendChild(style)
    document.documentElement.setAttribute('data-theme', theme)
  }

  // Inject CSS (fallback)
  useEffect(() => {
    if (document.getElementById('mf-styles')) return
    const el = document.createElement('style')
    el.id = 'mf-styles'
    el.textContent = CSS
    document.head.appendChild(el)
    const html = document.documentElement
    const body = document.body
    const prevH = html.style.overflow; const prevHH = html.style.height
    const prevB = body.style.overflow; const prevBH = body.style.height
    html.style.overflow = 'auto'; html.style.height = 'auto'
    body.style.overflow = 'auto'; body.style.height = 'auto'
    return () => {
      document.getElementById('mf-styles')?.remove()
      html.style.overflow = prevH; html.style.height = prevHH
      body.style.overflow = prevB; body.style.height = prevBH
    }
  }, [])

  // Theme initialization
  useEffect(() => {
    const saved = localStorage.getItem('mf_theme') as 'light' | 'dark' | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initial = saved || (prefersDark ? 'dark' : 'light')
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
  }, [])

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('mf_theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }, [theme])

  // Clock
  const [clock, setClock] = useState('')
  useEffect(() => {
    const t = () => setClock(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    t(); const id = setInterval(t, 1000); return () => clearInterval(id)
  }, [])

  // Status tick
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // Hard reset 03:00
  useEffect(() => {
    const now = new Date(); const reset = new Date()
    reset.setHours(3, 0, 0, 0)
    if (reset <= now) reset.setDate(reset.getDate() + 1)
    const id = setTimeout(() => window.location.reload(), reset.getTime() - now.getTime())
    return () => clearTimeout(id)
  }, [])

  // Prepare data
  const prepare = useCallback((data: FlightDataResponse) => {
    const filterFn = (flights: Flight[], isArr: boolean): Flight[] => {
      const now = new Date()
      return flights.filter(f => {
        const fn = (f.FlightNumber || '').toUpperCase()
        if (HIDDEN_PATTERNS.some(p => fn.includes(p))) return false
        const s = (f.StatusEN ?? '').toLowerCase()
        const isArrived = /(arrived|landed|sletio|stigao)/.test(s)
        const isDeparted = !/(delay|kasni)/.test(s) && /(departed|poletio)/.test(s)
        if (!isArrived && !isDeparted) return true
        const tStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime || f.ActualDepartureTime
        const t = parseTime(tStr)
        if (!t) return false
        return Math.floor((now.getTime() - t.getTime()) / 60_000) <= 25
      })
    }
    const deps = getUniqueDeparturesWithDeparted(filterFn(data.departures, false))
    const arrs = filterFn(data.arrivals, true)
    setDepartures(deps)
    setArrivals(arrs)
    setLastUpdate(data.lastUpdated || new Date().toLocaleTimeString('en-GB'))
    
    // FIX: nakon prvog uspješnog prepare, gasimo initial load state
    if (isInitialLoad) {
      setIsInitialLoad(false)
    }
  }, [isInitialLoad])

  // Load
  useEffect(() => {
    mountedRef.current = true
    const cached = loadCache()
    if (cached) { prepare(cached); setLoading(false) }

    const load = async () => {
      if (!mountedRef.current) return
      try {
        const res = await fetch('/api/flights', { headers: { 'Cache-Control': 'no-cache' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: FlightDataResponse = await res.json()
        if (!mountedRef.current) return
        saveCache(data)
        prepare(data)
        setError(null)
      } catch {
        const c = loadCache()
        if (c) { prepare(c); setError('Using cached data') }
        else setError('Unable to load flight data')
      } finally {
        if (mountedRef.current) {
          setLoading(false)
          timerRef.current = setTimeout(load, REFRESH_MS)
        }
      }
    }

    if (!cached) setLoading(true)
    load()

    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [prepare])

  // Filter
  const flights = tab === 'departures' ? departures : arrivals
  const filtered = useMemo(() => {
    if (!query.trim()) return flights
    const q = query.toLowerCase()
    return flights.filter(f =>
      (f.FlightNumber ?? '').toLowerCase().includes(q) ||
      (f.DestinationCityName ?? '').toLowerCase().includes(q) ||
      (f.DestinationAirportName ?? '').toLowerCase().includes(q) ||
      (f.DestinationAirportCode ?? '').toLowerCase().includes(q) ||
      (f.AirlineName ?? '').toLowerCase().includes(q) ||
      (f.AirlineICAO ?? '').toLowerCase().includes(q) ||
      (f.CheckInDesk ?? '').toLowerCase().includes(q) ||
      (f.GateNumber ?? '').toLowerCase().includes(q)
    )
  }, [flights, query])

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) =>
      (a.ScheduledDepartureTime || '99:99').localeCompare(b.ScheduledDepartureTime || '99:99')
    ), [filtered])

  // ─── FIX: Sprječava flicker - potpuno prazan ekran tokom prvog load-a
  if (isInitialLoad) {
    return (
      <div style={{ 
        position: 'fixed', 
        inset: 0, 
        background: theme === 'dark' ? '#050A15' : '#F8FAFF',
        visibility: 'hidden' 
      }} />
    )
  }

  return (
    <div className="mf-root">
      <header className="mf-header">
        <div className="mf-header-row">
          <div className="mf-airport-id">
            <div className="mf-airport-icon">
              <svg viewBox="0 0 28 28" fill="currentColor">
                <path d="M24 18v-2.5l-9-5.6V4.5a1.5 1.5 0 00-3 0v5.4L3 15.5V18l9-2.8V21l-2.5 1.8V24l4-1.2 4 1.2v-1.2L15 21v-5.8z"/>
              </svg>
            </div>
            <div className="mf-airport-text">
              <span className="mf-airport-name">Tivat Airport</span>
              <span className="mf-airport-code">TIV · LYTV</span>
            </div>
          </div>
          <div className="mf-clock-block">
            <span className="mf-clock">{clock}</span>
            <span className="mf-clock-label">LOCAL TIME</span>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>

        <div className="mf-tabs">
          <button
            className={`mf-tab ${tab === 'departures' ? 'mf-tab-active' : ''}`}
            onClick={() => { setTab('departures'); setQuery('') }}
            type="button"
          >
            <svg className="mf-tab-icon" viewBox="0 0 20 20" fill="currentColor">
              <path d="M18 14v-2l-7-5V3.5a1.5 1.5 0 00-3 0V7L1 12v2l7-2.5V17l-2 1.5V20l3.5-1 3.5 1v-1.5L11 17v-5.5z"/>
            </svg>
            Departures
            <span className="mf-tab-cnt">{departures.length}</span>
          </button>
          <button
            className={`mf-tab ${tab === 'arrivals' ? 'mf-tab-active' : ''}`}
            onClick={() => { setTab('arrivals'); setQuery('') }}
            type="button"
          >
            <svg className="mf-tab-icon mf-tab-icon-arr" viewBox="0 0 20 20" fill="currentColor">
              <path d="M18 14v-2l-7-5V3.5a1.5 1.5 0 00-3 0V7L1 12v2l7-2.5V17l-2 1.5V20l3.5-1 3.5 1v-1.5L11 17v-5.5z"/>
            </svg>
            Arrivals
            <span className="mf-tab-cnt">{arrivals.length}</span>
          </button>
        </div>
      </header>

      <div className="mf-search-section">
        <SearchBar value={query} onChange={setQuery} count={sorted.length} />
      </div>

      <div className="mf-status-bar">
        <div className="mf-status-left">
          <span className={`mf-dot ${loading ? 'mf-dot-load' : error ? 'mf-dot-err' : 'mf-dot-ok'}`} />
          <span className="mf-status-txt">
            {loading ? 'Loading…' : error ? error : `Updated ${lastUpdate}`}
          </span>
        </div>
        <span className="mf-fl-count">{sorted.length} flight{sorted.length !== 1 ? 's' : ''}</span>
      </div>

      <main className="mf-list">
        {loading && sorted.length === 0 ? (
          <div className="mf-loading">
            <div className="mf-spinner" />
            <span>Loading flights…</span>
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          sorted.map((flight, i) => (
            <FlightCard
              key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${i}`}
              flight={flight}
              isArrival={tab === 'arrivals'}
              tick={tick}
              highlight={!!query && i === 0}
            />
          ))
        )}
        <div className="mf-footer">
          <span>Auto-refresh every 60s</span>
          <span>Tivat International Airport · TIV/LYTV</span>
        </div>
      </main>
    </div>
  )
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  html, body { overflow: auto !important; height: auto !important; min-height: 100%; }

  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=DM+Mono:wght@400;500&display=swap');

  /* ===== LIGHT THEME (default) ===== */
  :root {
    --bg:        #F8FAFF;
    --bg-2:      #FFFFFF;
    --bg-3:      #F0F4FA;
    --bg-card:   #FFFFFF;
    --bg-card-2: #F8F9FC;
    --border:    rgba(0,0,0,0.06);
    --border-2:  rgba(0,0,0,0.10);
    --text-1:    #1A2C3E;
    --text-2:    #4A627A;
    --text-3:    #7A8EA6;
    --accent:    #0078D7;
    --accent-dim:rgba(0,120,215,0.08);
    --gate:      #0078D7;
    --gate-bg:   rgba(0,120,215,0.06);
    --gate-bdr:  rgba(0,120,215,0.20);
    --checkin:   #E68A00;
    --checkin-bg:rgba(230,138,0,0.06);
    --checkin-bdr:rgba(230,138,0,0.20);
    --critical:  #E53E3E;
    --warning:   #E68A00;
    --active:    #00875A;
    --info:      #3A7BCB;
    --radius:    14px;
    --radius-sm: 8px;
    --font:      'DM Sans', system-ui, -apple-system, sans-serif;
    --mono:      'DM Mono', 'SF Mono', 'Menlo', monospace;
    --safe-top:  env(safe-area-inset-top, 0px);
    --safe-bot:  env(safe-area-inset-bottom, 16px);
  }

  /* ===== DARK THEME ===== */
  [data-theme="dark"] {
    --bg:        #050A15;
    --bg-2:      #0A1120;
    --bg-3:      #0E1628;
    --bg-card:   #0B1222;
    --bg-card-2: #0D1629;
    --border:    rgba(255,255,255,0.05);
    --border-2:  rgba(255,255,255,0.09);
    --text-1:    #F0F5FF;
    --text-2:    #8CA3BE;
    --text-3:    #4A5E75;
    --accent:    #00D4FF;
    --accent-dim:rgba(0,212,255,0.12);
    --gate:      #00E5FF;
    --gate-bg:   rgba(0,229,255,0.07);
    --gate-bdr:  rgba(0,229,255,0.25);
    --checkin:   #FFB800;
    --checkin-bg:rgba(255,184,0,0.07);
    --checkin-bdr:rgba(255,184,0,0.22);
    --critical:  #FF3B3B;
    --warning:   #FFB800;
    --active:    #00D68F;
    --info:      #5BA8FF;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .mf-root {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text-1);
    min-height: 100svh;
    min-height: 100dvh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .mf-header {
    background: var(--bg-2);
    border-bottom: 1px solid var(--border);
    padding-top: calc(var(--safe-top) + 10px);
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
  }

  .mf-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px 12px;
    gap: 12px;
  }

  .mf-airport-id {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
  }

  .mf-airport-icon {
    width: 34px; height: 34px;
    background: linear-gradient(135deg, rgba(0,120,215,0.15), rgba(0,120,215,0.05));
    border: 1px solid rgba(0,120,215,0.2);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    color: var(--accent);
  }

  [data-theme="dark"] .mf-airport-icon {
    background: linear-gradient(135deg, rgba(0,212,255,0.15), rgba(0,212,255,0.05));
    border-color: rgba(0,212,255,0.2);
  }

  .mf-airport-icon svg { width: 18px; height: 18px; }

  .mf-airport-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mf-airport-name {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-1);
    letter-spacing: -0.3px;
    line-height: 1.2;
  }

  .mf-airport-code {
    font-size: 11px;
    color: var(--text-3);
    font-family: var(--mono);
    letter-spacing: 0.8px;
  }

  .mf-clock-block {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0px;
    flex-shrink: 0;
  }

  .mf-clock {
    font-family: var(--mono);
    font-size: 26px;
    font-weight: 500;
    color: var(--text-1);
    letter-spacing: 1.5px;
    line-height: 1;
  }

  .mf-clock-label {
    font-size: 8px;
    color: var(--text-3);
    letter-spacing: 1.5px;
    font-weight: 600;
    margin-top: 2px;
  }

  /* Theme toggle button */
  .mf-theme-toggle {
    background: var(--bg-3);
    border: 1px solid var(--border-2);
    border-radius: 30px;
    width: 38px;
    height: 38px;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    transition: all 0.2s ease;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }

  .mf-theme-toggle:hover {
    background: var(--border-2);
    transform: scale(0.96);
  }

  .mf-tabs {
    display: flex;
    padding: 0 12px;
    gap: 0;
    border-top: 1px solid var(--border);
  }

  .mf-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 12px 8px;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-3);
    background: none;
    border: none;
    border-bottom: 2.5px solid transparent;
    cursor: pointer;
    transition: all 0.25s ease;
    letter-spacing: 0.2px;
    -webkit-tap-highlight-color: transparent;
    position: relative;
  }

  .mf-tab-active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .mf-tab-icon {
    width: 14px; height: 14px;
    flex-shrink: 0;
    transition: transform 0.25s;
  }

  .mf-tab-icon-arr { transform: rotate(180deg); }

  .mf-tab-cnt {
    background: rgba(0,0,0,0.06);
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    padding: 1px 7px;
    border-radius: 20px;
    min-width: 22px;
    text-align: center;
    transition: all 0.25s;
  }

  [data-theme="dark"] .mf-tab-cnt {
    background: rgba(255,255,255,0.06);
  }

  .mf-tab-active .mf-tab-cnt {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .mf-search-section {
    padding: 10px 12px 0;
  }

  .mf-search-wrap { display: flex; flex-direction: column; gap: 5px; }

  .mf-search-inner {
    position: relative;
    display: flex;
    align-items: center;
  }

  .mf-search-icon {
    position: absolute;
    left: 12px;
    width: 16px; height: 16px;
    color: var(--text-3);
    pointer-events: none;
    flex-shrink: 0;
  }

  .mf-search-input {
    width: 100%;
    background: var(--bg-3);
    border: 1px solid var(--border-2);
    border-radius: 12px;
    padding: 11px 40px 11px 38px;
    font-family: var(--font);
    font-size: 14px;
    color: var(--text-1);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    -webkit-appearance: none;
  }

  .mf-search-input::placeholder { color: var(--text-3); }
  .mf-search-input::-webkit-search-cancel-button { display: none; }

  .mf-search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }

  .mf-search-clear {
    position: absolute;
    right: 10px;
    background: rgba(0,0,0,0.08);
    border: none;
    color: var(--text-2);
    width: 24px; height: 24px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  [data-theme="dark"] .mf-search-clear {
    background: rgba(255,255,255,0.08);
  }

  .mf-search-count {
    font-size: 11px;
    color: var(--text-3);
    padding-left: 4px;
  }

  .mf-status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
  }

  .mf-status-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mf-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .mf-dot-ok   { background: var(--active); box-shadow: 0 0 8px rgba(0,214,143,0.5); animation: mf-pulse 2.5s infinite; }
  .mf-dot-load { background: var(--warning); animation: mf-pulse 1s infinite; }
  .mf-dot-err  { background: var(--critical); box-shadow: 0 0 8px rgba(255,59,59,0.4); }

  @keyframes mf-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }

  .mf-status-txt {
    font-size: 11px;
    color: var(--text-3);
  }

  .mf-fl-count {
    font-size: 11px;
    color: var(--text-3);
    font-family: var(--mono);
  }

  .mf-list {
    padding: 8px 10px calc(var(--safe-bot) + 24px);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mf-card {
    background: var(--bg-card);
    border: 1px solid var(--border-2);
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color 0.25s, box-shadow 0.25s;
    -webkit-tap-highlight-color: transparent;
    position: relative;
  }

  .mf-card::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 4px;
    background: var(--border-2);
    transition: background 0.3s;
    z-index: 2;
  }

  .mf-card.mf-tier-critical::before { background: var(--critical); box-shadow: 0 0 12px rgba(255,59,59,0.3); }
  .mf-card.mf-tier-warning::before  { background: var(--warning); }
  .mf-card.mf-tier-active::before   { background: var(--active); }
  .mf-card.mf-tier-info::before     { background: var(--info); }

  .mf-card-hl {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent-dim), 0 4px 20px var(--accent-dim);
  }

  .mf-card-flight {
    display: flex;
    gap: 14px;
    padding: 14px 14px 12px 18px;
    align-items: flex-start;
  }

  .mf-time-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 52px;
    flex-shrink: 0;
    padding-top: 1px;
  }

  .mf-time-sched {
    font-family: var(--mono);
    font-size: 22px;
    font-weight: 500;
    color: var(--text-1);
    letter-spacing: 0.8px;
    line-height: 1;
  }

  .mf-time-est {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--warning);
    letter-spacing: 0.5px;
    line-height: 1;
    display: flex;
    align-items: center;
    gap: 3px;
    background: var(--checkin-bg);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .mf-route-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .mf-dest-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .mf-city {
    font-size: 17px;
    font-weight: 700;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.3px;
    line-height: 1.2;
  }

  .mf-iata {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-3);
    letter-spacing: 0.8px;
    flex-shrink: 0;
    background: rgba(0,0,0,0.04);
    padding: 1px 6px;
    border-radius: 4px;
  }

  [data-theme="dark"] .mf-iata {
    background: rgba(255,255,255,0.04);
  }

  .mf-logo-wrap {
    width: 60px; 
    height: 34px;
    background: white;
    border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
    padding: 2px;
  }

  .mf-logo-img {
    width: 100%; height: 100%;
    object-fit: contain;
    display: block;
  }

  .mf-meta-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .mf-fnum {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 700;
    color: #FFD700;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .mf-codeshare {
    font-size: 10px;
    color: var(--text-3);
    background: rgba(0,0,0,0.04);
    padding: 1px 5px;
    border-radius: 4px;
    white-space: nowrap;
  }

  [data-theme="dark"] .mf-codeshare {
    background: rgba(255,255,255,0.04);
  }

  .mf-card-ops {
    display: flex;
    align-items: stretch;
    gap: 0;
    background: var(--bg-card-2);
    border-top: 1px solid var(--border);
  }

  .mf-op-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px 14px;
    gap: 3px;
    min-width: 80px;
    position: relative;
  }

  .mf-op-box + .mf-op-box::before {
    content: '';
    position: absolute;
    left: 0; top: 8px; bottom: 8px;
    width: 1px;
    background: var(--border-2);
  }

  .mf-op-lbl {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--text-3);
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .mf-op-lbl svg { opacity: 0.5; }

  .mf-op-val {
    font-family: var(--mono);
    font-weight: 600;
    letter-spacing: 0.5px;
    line-height: 1.1;
  }

  .mf-checkin-box {
    background: var(--checkin-bg);
  }

  .mf-checkin-box .mf-op-lbl {
    color: var(--checkin);
    opacity: 0.7;
  }

  .mf-checkin-box .mf-op-val {
    font-size: 16px;
    color: var(--checkin);
    text-shadow: 0 0 20px rgba(230,138,0,0.15);
  }

  [data-theme="dark"] .mf-checkin-box .mf-op-val {
    text-shadow: 0 0 20px rgba(255,184,0,0.15);
  }

  .mf-gate-box {
    background: var(--gate-bg);
  }

  .mf-gate-box .mf-op-lbl {
    color: var(--gate);
    opacity: 0.65;
  }

  .mf-gate-box .mf-op-val {
    font-size: 22px;
    font-weight: 700;
    color: var(--gate);
    text-shadow: 0 0 24px rgba(0,120,215,0.2);
    letter-spacing: 1px;
  }

  [data-theme="dark"] .mf-gate-box .mf-op-val {
    text-shadow: 0 0 24px rgba(0,229,255,0.2);
  }

  .mf-gate-urgent {
    animation: mf-gate-flash 1.8s ease-in-out infinite;
  }

  @keyframes mf-gate-flash {
    0%, 100% { background: var(--gate-bg); }
    50% { background: var(--gate-bdr); }
  }

  .mf-op-empty .mf-op-lbl {
    color: var(--text-3);
  }

  .mf-op-dash {
    font-size: 18px;
    color: var(--text-3);
  }

  .mf-status-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    padding: 8px 14px;
    min-width: 0;
  }

  .mf-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.3px;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .mf-badge-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .mf-badge-critical {
    background: rgba(229,62,62,0.12);
    color: #C53030;
    border-color: rgba(229,62,62,0.25);
  }
  [data-theme="dark"] .mf-badge-critical {
    background: rgba(255,59,59,0.12);
    color: #FFA0A0;
    border-color: rgba(255,59,59,0.25);
  }
  .mf-badge-critical .mf-badge-dot { background: var(--critical); box-shadow: 0 0 6px var(--critical); animation: mf-pulse 1.2s infinite; }

  .mf-badge-warning {
    background: rgba(230,138,0,0.12);
    color: #B45A00;
    border-color: rgba(230,138,0,0.25);
  }
  [data-theme="dark"] .mf-badge-warning {
    background: rgba(255,184,0,0.12);
    color: #FFD666;
    border-color: rgba(255,184,0,0.25);
  }
  .mf-badge-warning .mf-badge-dot { background: var(--warning); }

  .mf-badge-active {
    background: rgba(0,135,90,0.12);
    color: #006644;
    border-color: rgba(0,135,90,0.25);
  }
  [data-theme="dark"] .mf-badge-active {
    background: rgba(0,214,143,0.12);
    color: #6EE7B7;
    border-color: rgba(0,214,143,0.25);
  }
  .mf-badge-active .mf-badge-dot { background: var(--active); animation: mf-pulse 2s infinite; }

  .mf-badge-info {
    background: rgba(58,123,203,0.10);
    color: #2A5A8E;
    border-color: rgba(58,123,203,0.20);
  }
  [data-theme="dark"] .mf-badge-info {
    background: rgba(91,168,255,0.10);
    color: #93C5FD;
    border-color: rgba(91,168,255,0.20);
  }
  .mf-badge-info .mf-badge-dot { background: var(--info); }

  .mf-badge-neutral {
    background: rgba(0,0,0,0.04);
    color: var(--text-3);
    border-color: var(--border);
  }
  [data-theme="dark"] .mf-badge-neutral {
    background: rgba(255,255,255,0.04);
  }
  .mf-badge-neutral .mf-badge-dot { background: var(--text-3); }

  .mf-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 64px 20px;
    color: var(--text-3);
    font-size: 14px;
  }

  .mf-spinner {
    width: 28px; height: 28px;
    border: 2.5px solid var(--border-2);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: mf-spin 0.75s linear infinite;
  }

  @keyframes mf-spin { to { transform: rotate(360deg); } }

  .mf-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 64px 20px;
    text-align: center;
  }

  .mf-empty-icon { width: 56px; height: 56px; color: var(--text-3); opacity: 0.5; }

  .mf-empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-2);
  }

  .mf-empty-sub {
    font-size: 13px;
    color: var(--text-3);
  }

  .mf-footer {
    padding: 28px 0 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: center;
  }

  .mf-footer span {
    font-size: 10px;
    color: var(--text-3);
    text-align: center;
    letter-spacing: 0.3px;
  }

  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 3px; }
`