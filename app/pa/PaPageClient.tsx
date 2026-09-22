"use client"

// ============================================================
// app/pa/PaPageClient.tsx — RAZGLAS (PA) preko Web Speech API-ja
//
// v5.9: Dodata AUTOMATSKA evaluacija letova — portovano iz starog
// components/AirportPA.tsx (legacy sistem koji je pollovao
// /api/flights/tv/ svakih 60s sa RawFlightData poljima), prilagođeno
// trenutnom Flight tipu i Ably real-time feedu. Sva tekst/vremenska
// logika je u lib/pa-announcements.ts — ovaj fajl samo orkestrira:
// prima flights:combined preko dijeljenog hooka, evaluira svaki let,
// stavlja najave u lokalni TTS red, i sluša 'announcements:pa' kanal
// za RUČNE (admin-pokrenute) najave — oboje idu u ISTI red da se ne
// preklapaju/prekidaju.
//
// v5.9: PA NE RADI NOĆU. Nema više izuzetka od noćnog Ably sleep-a
// (lib/ably-client.ts) — kad padne noć (isNightHours(), nakon zadnjeg
// leta), konekcija se gasi kao i na svih 41 FIDS ekranu, automatska
// evaluacija prestaje (flights:combined feed se zamrzava), periodične
// bezbjednosne najave su eksplicitno gejtovane sa !isNightHours(), a
// /api/admin/announcement odbija ručne najave noću na izvoru.
//
// TROŠAK NA VERCELU: i dalje nula iznad postojeće Ably infrastrukture
// — automatska evaluacija je 100% klijentska (čita flights:combined
// koji se VEĆ šalje svim ekranima), TTS je Chrome-ov ugrađeni
// speechSynthesis. Nijedan novi server poziv po najavi.
// ============================================================

import {
  type JSX,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react"
import { Volume2, VolumeX, Radio, CheckCircle2, Moon } from "lucide-react"
import type Ably from "ably"
import { getSharedAbly } from "@/lib/ably-client"
import { useRealtimeFlightData } from "@/hooks/useRealtimeFlightData"
import { isNightHours } from "@/lib/night-hours"
import type { Flight } from "@/types/flight"
import {
  DEPARTURE_WINDOWS,
  shouldPlayDepartureWindow,
  shouldAnnounceArrival,
  shouldAnnounceDelay,
  isArrivedStatus,
  getAnnouncementKey,
  buildArrivalEN, buildArrivalLocal,
  buildDepartureEN, buildDepartureLocal,
  buildDelayEN, buildDelayLocal,
  buildCancelledEN, buildCancelledLocal,
  buildDivertedEN, buildDivertedLocal,
  buildGateChangeEN, buildGateChangeLocal,
  SECURITY_MESSAGES_EN, SECURITY_MESSAGES_LOCAL,
  computeDelayMinutes,
} from "@/lib/pa-announcements"

const HARD_RESET_HOUR = 3
const SECURITY_INTERVAL_MS = 30 * 60 * 1000
// NOVO (proširena PA automatika): koliko minuta VEĆE kašnjenje mora
// postati (u odnosu na poslednju najavu za taj let) da bi se ponovo
// najavilo — vidi opširan komentar uz lastAnnouncedDelayRef niže.
const RE_ANNOUNCE_DELAY_THRESHOLD_MIN = 30

interface IncomingAnnouncement {
  id: string
  text: string
  publishedAt: string
  publishedBy?: string
}

interface QueueItem {
  text: string
  voiceURI: string | null
}

interface GateRecord { gate: string }

// FIX (po zahtjevu — portovano/izvezeno radi lokalnog pregleda na
// admin PA stranici, app/admin/pa/page.tsx): obje funkcije su čiste,
// bez zavisnosti od stanja ove komponente — bezbjedno izvezene, bez
// ikakve izmjene ponašanja za postojeću upotrebu ovdje ispod.
export function pickEnglishFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter(v => v.lang.toLowerCase().startsWith("en"))
  if (en.length === 0) return null
  const isFemale = (v: SpeechSynthesisVoice) => /female/i.test(v.name)
  const isExplicitlyMale = (v: SpeechSynthesisVoice) => /male/i.test(v.name) && !/female/i.test(v.name)
  return en.find(isFemale) ?? en.find(v => !isExplicitlyMale(v)) ?? en[0]
}

export function pickLocalVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return voices.find(v =>
    v.lang.toLowerCase().startsWith("hr") ||
    v.lang.toLowerCase().startsWith("sr") ||
    /croatian|serbian/i.test(v.name)
  ) ?? null
}

// FIX (KRITIČNO — pravi React bug, otkriven kroz React Compiler
// "react-hooks/static-components" pravilo, ne samo stilski problem):
// flightStatusColor i FlightTable su RANIJE bile definisane UNUTAR
// tijela PaPageClient komponente — što znači da su se OBJE PONOVO
// KREIRALE na SVAKOM render-u roditelja. Za FlightTable, ovo je
// OZBILJNO: React tretira SVAKI PONOVO KREIRAN komponentni tip kao
// POTPUNO RAZLIČIT od prethodnog, pa je UNIŠTAVAO i PONOVO PRAVIO
// cio DOM podstablo tabele letova na SVAKOM render-u (svaka nova
// Ably poruka, svaka promjena stanja) — gubitak scroll pozicije,
// nepotreban rad za browser, na budžetskim kiosk uređajima mjerljivo.
// Obje funkcije su ČISTE (zavise samo od svojih parametara, bez
// pristupa state-u/props-ima roditelja) — bezbjedno izvučene ovdje,
// na modulski nivo, definisane TAČNO JEDNOM.
function flightStatusColor(status: string): string {
  const s = (status || "").toLowerCase()
  if (s.includes("arrived") || s.includes("sletio") || s.includes("landed")) return "text-emerald-400"
  if (s.includes("board")) return "text-cyan-400"
  if (s.includes("delay") || s.includes("kasni")) return "text-red-400"
  if (s.includes("cancel") || s.includes("otkaz")) return "text-red-500"
  if (s.includes("divert") || s.includes("preusmjer")) return "text-purple-400"
  if (s.includes("departed") || s.includes("otiš")) return "text-slate-500"
  return "text-amber-400"
}

function FlightTable({ flights }: { flights: Flight[] }) {
  const sorted = [...flights].sort((a, b) =>
    (a.ScheduledDepartureTime || "99:99").localeCompare(b.ScheduledDepartureTime || "99:99")
  )
  return (
    <div className="bg-slate-800/40 rounded-2xl border border-slate-700 overflow-hidden">
      <div className="grid grid-cols-[90px_1fr_90px_90px_90px_90px] gap-2 px-5 py-3 bg-slate-800/80 border-b border-slate-700 text-slate-400 text-xs font-bold uppercase tracking-wider">
        <span>Let</span><span>Kompanija / Grad</span><span>Plan</span><span>Oček.</span><span>Gate</span><span>Status</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-700/40 font-mono text-sm">
        {sorted.length === 0 ? (
          <div className="p-10 text-center text-slate-500 font-sans">Nema letova.</div>
        ) : sorted.map((f) => (
          <div key={`${f.FlightNumber}-${f.ScheduledDepartureTime}`} className="grid grid-cols-[90px_1fr_90px_90px_90px_90px] gap-2 px-5 py-3 items-center hover:bg-slate-700/20">
            <span className="text-white font-bold">{f.FlightNumber}</span>
            <span className="font-sans text-slate-300 truncate">{f.AirlineName} · {f.DestinationCityName}</span>
            <span className="text-slate-400">{f.ScheduledDepartureTime || "—"}</span>
            <span className="text-amber-300">{f.EstimatedDepartureTime || "—"}</span>
            <span className="text-slate-300">{f.GateNumber || f.CheckInDesk || "—"}</span>
            <span className={`font-sans font-semibold ${flightStatusColor(f.StatusEN)}`}>{f.StatusEN || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PaPageClient(): JSX.Element {
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected" | "night-sleep">("connecting")
  const [voiceReady, setVoiceReady] = useState(false)
  const [voiceName, setVoiceName] = useState<string>("")
  const [localVoiceName, setLocalVoiceName] = useState<string>("")
  const [activated, setActivated] = useState(false)
  const [lastAnnouncement, setLastAnnouncement] = useState<string>("")
  const [speaking, setSpeaking] = useState(false)
  const [history, setHistory] = useState<{ id: string; time: string; text: string }[]>([])
  const [nightMode, setNightMode] = useState(isNightHours())
  const [activeTab, setActiveTab] = useState<"pa" | "departures" | "arrivals">("pa")
  const [queueLength, setQueueLength] = useState(0)

  const enVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const localVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const allVoicesRef = useRef<SpeechSynthesisVoice[]>([])

  const activatedRef = useRef(false)
  useEffect(() => { activatedRef.current = activated }, [activated])

  const queueRef = useRef<QueueItem[]>([])
  const playingRef = useRef(false)
  const processQueueRef = useRef<() => void>(() => {})
  const speakingKeepAliveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const announcedRef = useRef<Record<string, boolean>>({})
  // NOVO (FIDS Innovation Harness — "proširena PA automatika"): prati
  // POSLEDNJI NAJAVLJENI iznos kašnjenja po letu (ne samo da/ne kao
  // announcedRef iznad). Bez ovoga, let koji kasni 15 min dobije JEDNU
  // najavu zauvijek — ako kašnjenje kasnije naraste na npr. 90 min,
  // putnici to nikad ne čuju, jer dedup ključ (getAnnouncementKey) ne
  // uključuje iznos kašnjenja, samo broj leta+vrijeme+"delayed". Prag
  // od 30 min (RE_ANNOUNCE_DELAY_THRESHOLD ispod) sprečava "treperenje"
  // — sitne oscilacije procijenjenog vremena (par minuta tamo-amo pri
  // svakom osvježenju podatka) ne izazivaju ponovnu najavu, samo
  // stvarno, značajno pogoršanje.
  const lastAnnouncedDelayRef = useRef<Record<string, number>>({})
  const manualSpokenIdsRef = useRef<string[]>([])
  const manualSpokenIdsSetRef = useRef<Set<string>>(new Set())

  const previousGatesRef = useRef<Record<string, GateRecord>>({})
  const gateChangeAnnouncedRef = useRef<Record<string, boolean>>({})

  const pushHistory = useCallback((text: string) => {
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    setLastAnnouncement(text)
    setHistory(prev => [{ id: `${Date.now()}-${Math.random()}`, time, text }, ...prev].slice(0, 30))
  }, [])

  useEffect(() => {
    let cancelled = false
    let pollId: ReturnType<typeof setInterval> | null = null

    const tryLoad = () => {
      const voices = window.speechSynthesis?.getVoices() ?? []
      if (voices.length === 0) return false
      allVoicesRef.current = voices
      const en = pickEnglishFemaleVoice(voices)
      const local = pickLocalVoice(voices)
      if (!cancelled) {
        if (en) { enVoiceRef.current = en; setVoiceName(en.name) }
        localVoiceRef.current = local
        setLocalVoiceName(local ? local.name : "(fonetski preko EN glasa)")
        setVoiceReady(true)
      }
      return true
    }

    if (!tryLoad()) {
      window.speechSynthesis?.addEventListener("voiceschanged", tryLoad)
      pollId = setInterval(() => {
        if (tryLoad() && pollId) { clearInterval(pollId); pollId = null }
      }, 1000)
    }

    return () => {
      cancelled = true
      window.speechSynthesis?.removeEventListener("voiceschanged", tryLoad)
      if (pollId) clearInterval(pollId)
    }
  }, [])

  const processQueue = useCallback(() => {
    if (!activatedRef.current) return
    if (playingRef.current || queueRef.current.length === 0) return

    playingRef.current = true
    setSpeaking(true)

    const item = queueRef.current.shift()!
    setQueueLength(queueRef.current.length)
    const synth = window.speechSynthesis
    if (!synth) { playingRef.current = false; setSpeaking(false); return }

    const voice = item.voiceURI ? allVoicesRef.current.find(v => v.voiceURI === item.voiceURI) : null
    const utterance = new SpeechSynthesisUtterance(item.text)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || "en-US"
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.volume = 1

    const onDone = () => {
      playingRef.current = false
      setSpeaking(false)
      setTimeout(() => processQueueRef.current(), 900)
    }
    utterance.onend = onDone
    utterance.onerror = (e) => {
      console.error("[PA] speechSynthesis greška:", e.error)
      onDone()
    }

    synth.speak(utterance)

    const keepAlive = () => {
      if (!synth.speaking) { speakingKeepAliveRef.current = null; return }
      synth.pause(); synth.resume()
      speakingKeepAliveRef.current = setTimeout(keepAlive, 5000)
    }
    if (speakingKeepAliveRef.current) clearTimeout(speakingKeepAliveRef.current)
    speakingKeepAliveRef.current = setTimeout(keepAlive, 5000)
  }, [])

  useEffect(() => { processQueueRef.current = processQueue }, [processQueue])

  const enqueueEN = useCallback((text: string) => {
    queueRef.current.push({ text, voiceURI: enVoiceRef.current?.voiceURI ?? null })
    setQueueLength(queueRef.current.length)
    pushHistory(text)
    setTimeout(() => processQueueRef.current(), 0)
  }, [pushHistory])

  const enqueueLocal = useCallback((text: string) => {
    const uri = localVoiceRef.current?.voiceURI ?? enVoiceRef.current?.voiceURI ?? null
    queueRef.current.push({ text, voiceURI: uri })
    setQueueLength(queueRef.current.length)
    setTimeout(() => processQueueRef.current(), 0)
  }, [])

  const evaluateFlight = useCallback((f: Flight) => {
    if (isNightHours()) return

    const status = f.StatusEN || ""
    const statusLower = status.toLowerCase()
    const isTerminal =
      statusLower.includes("cancel") || statusLower.includes("otkaz") ||
      statusLower.includes("divert") || statusLower.includes("preusmjer") ||
      statusLower.includes("departed") || isArrivedStatus(status)

    if (f.FlightType === "arrival" && isArrivedStatus(status) && shouldAnnounceArrival(f)) {
      const key = getAnnouncementKey(f, "arrived")
      if (!announcedRef.current[key]) {
        announcedRef.current[key] = true
        enqueueEN(buildArrivalEN(f))
        enqueueLocal(buildArrivalLocal(f))
      }
    }

    if (statusLower.includes("cancel") || statusLower.includes("otkaz")) {
      const key = getAnnouncementKey(f, "cancelled")
      if (!announcedRef.current[key]) {
        announcedRef.current[key] = true
        enqueueEN(buildCancelledEN(f))
        enqueueLocal(buildCancelledLocal(f))
      }
    }
    if (statusLower.includes("divert") || statusLower.includes("preusmjer")) {
      const key = getAnnouncementKey(f, "diverted")
      if (!announcedRef.current[key]) {
        announcedRef.current[key] = true
        enqueueEN(buildDivertedEN(f))
        enqueueLocal(buildDivertedLocal(f))
      }
    }
    if (statusLower.includes("delay") || statusLower.includes("kasni")) {
      if (shouldAnnounceDelay(f)) {
        // FIX (proširena PA automatika — vidi opširan komentar uz
        // lastAnnouncedDelayRef): stari obrazac je najavljivao SAMO
        // jednom po letu (announcedRef dedup, bez obzira na iznos
        // kašnjenja). Sad se PONOVO najavljuje ako je TRENUTNO
        // kašnjenje bar RE_ANNOUNCE_DELAY_THRESHOLD minuta VEĆE od
        // poslednjeg najavljenog iznosa za taj let — hvata slučaj
        // "kasnio 15 min, sad kasni 90 min", ne samo prvi put kad je
        // kašnjenje primijećeno.
        const key = getAnnouncementKey(f, "delayed")
        const currentDelay = computeDelayMinutes(f)
        const lastAnnounced = lastAnnouncedDelayRef.current[key] ?? null
        const isFirstTime = !announcedRef.current[key]
        const isSignificantIncrease =
          currentDelay !== null &&
          lastAnnounced !== null &&
          currentDelay - lastAnnounced >= RE_ANNOUNCE_DELAY_THRESHOLD_MIN

        if (isFirstTime || isSignificantIncrease) {
          announcedRef.current[key] = true
          if (currentDelay !== null) lastAnnouncedDelayRef.current[key] = currentDelay
          enqueueEN(buildDelayEN(f))
          enqueueLocal(buildDelayLocal(f))
        }
      }
    }

    if (f.FlightType === "departure" && !isTerminal) {
      for (const win of DEPARTURE_WINDOWS) {
        if (shouldPlayDepartureWindow(f, win)) {
          const key = getAnnouncementKey(f, win.type)
          if (!announcedRef.current[key]) {
            announcedRef.current[key] = true
            enqueueEN(buildDepartureEN(f, win.type))
            enqueueLocal(buildDepartureLocal(f, win.type))
          }
        }
      }
    }
  }, [enqueueEN, enqueueLocal])

  const detectGateChanges = useCallback((allFlights: Flight[]) => {
    if (isNightHours()) return

    for (const f of allFlights) {
      const flightKey = `${f.FlightNumber}_${f.ScheduledDepartureTime}`
      const currentGate = f.GateNumber?.trim() || ""

      if (!currentGate) {
        previousGatesRef.current[flightKey] = { gate: currentGate }
        continue
      }

      const previous = previousGatesRef.current[flightKey]
      if (previous) {
        const prevGate = previous.gate?.trim() || ""
        const statusLower = (f.StatusEN || "").toLowerCase()
        const departed = statusLower.includes("departed") || statusLower.includes("otiš")
        if (prevGate && prevGate !== currentGate && f.FlightType === "departure" && !departed) {
          const changeKey = `${flightKey}_gate_${prevGate}_to_${currentGate}`
          if (!gateChangeAnnouncedRef.current[changeKey]) {
            gateChangeAnnouncedRef.current[changeKey] = true
            enqueueEN(buildGateChangeEN(f, prevGate, currentGate))
            enqueueLocal(buildGateChangeLocal(f, prevGate, currentGate))
          }
        }
      }
      previousGatesRef.current[flightKey] = { gate: currentGate }
    }
  }, [enqueueEN, enqueueLocal])

  const { data: liveFlightData } = useRealtimeFlightData('pa')

  useEffect(() => {
    if (!liveFlightData) return
    setNightMode(!!liveFlightData.isNightMode)
    if (liveFlightData.isNightMode) return

    const all = [...(liveFlightData.departures || []), ...(liveFlightData.arrivals || [])]
    detectGateChanges(all)
    all.forEach(evaluateFlight)
  }, [liveFlightData, detectGateChanges, evaluateFlight])

  const securityIdxRef = useRef(0)
  useEffect(() => {
    function trySecurityAnnouncement() {
      if (isNightHours()) return
      const idx = securityIdxRef.current % SECURITY_MESSAGES_EN.length
      securityIdxRef.current++
      enqueueEN(SECURITY_MESSAGES_EN[idx])
      enqueueLocal(SECURITY_MESSAGES_LOCAL[idx])
    }
    function msToNextHalfHour(): number {
      const now = new Date()
      const mins = now.getMinutes(), secs = now.getSeconds(), ms = now.getMilliseconds()
      const next = mins < 30 ? 30 : 60
      return ((next - mins) * 60 - secs) * 1000 - ms
    }
    let intervalId: ReturnType<typeof setInterval> | null = null
    const timeoutId = setTimeout(() => {
      trySecurityAnnouncement()
      intervalId = setInterval(trySecurityAnnouncement, SECURITY_INTERVAL_MS)
    }, msToNextHalfHour())
    return () => {
      clearTimeout(timeoutId)
      if (intervalId) clearInterval(intervalId)
    }
  }, [enqueueEN, enqueueLocal])

  useEffect(() => {
    const ably = getSharedAbly('pa')
    const channel = ably.channels.get('announcements:pa')

    const handler = (msg: Ably.Message) => {
      const ann = msg.data as IncomingAnnouncement
      if (!ann?.id || !ann?.text) return
      if (manualSpokenIdsSetRef.current.has(ann.id)) return
      manualSpokenIdsSetRef.current.add(ann.id)
      manualSpokenIdsRef.current.push(ann.id)
      if (manualSpokenIdsRef.current.length > 200) {
        const removed = manualSpokenIdsRef.current.shift()
        if (removed) manualSpokenIdsSetRef.current.delete(removed)
      }
      enqueueEN(ann.text)
    }
    channel.subscribe('announce', handler)

    const onConnected = () => setConnectionState('connected')
    const onDisconnected = () => setConnectionState('disconnected')
    const onSuspended = () => setConnectionState('disconnected')
    const onClosed = () => setConnectionState(isNightHours() ? 'night-sleep' : 'disconnected')

    ably.connection.on('connected', onConnected)
    ably.connection.on('disconnected', onDisconnected)
    ably.connection.on('suspended', onSuspended)
    ably.connection.on('closed', onClosed)

    if (ably.connection.state === 'connected') {
      setConnectionState('connected')
    } else if (
      (ably.connection.state === 'closed' || ably.connection.state === 'initialized') &&
      isNightHours()
    ) {
      setConnectionState('night-sleep')
    }

    return () => {
      channel.unsubscribe('announce', handler)
      ably.connection.off('connected', onConnected)
      ably.connection.off('disconnected', onDisconnected)
      ably.connection.off('suspended', onSuspended)
      ably.connection.off('closed', onClosed)
    }
  }, [enqueueEN])

  const handleActivate = () => {
    setActivated(true)
    activatedRef.current = true
    // ── v5.10 FIX: NEMA više izgovorenog "Public address system
    // activated" — putnici to ne treba da čuju. Umjesto toga, "tihi"
    // primer-utterance (volume 0, jedan razmak) samo pokreće Chrome-ov
    // TTS mehanizam radi zadovoljavanja eventualnog gesture-zahtjeva,
    // potpuno bešuman. Ne ide kroz red niti u istoriju.
    const synth = window.speechSynthesis
    if (synth) {
      const primer = new SpeechSynthesisUtterance(" ")
      primer.volume = 0
      synth.speak(primer)
    }
  }

  const waitThenReload = useCallback((reason: string) => {
    let waited = 0
    const tryReload = () => {
      if (!window.speechSynthesis?.speaking || waited >= 30_000) {
        console.warn(`[PA] Reload (${reason})`)
        window.location.reload()
        return
      }
      waited += 1000
      setTimeout(tryReload, 1000)
    }
    tryReload()
  }, [])

  useEffect(() => {
    const checkMemory = () => {
      const perf = performance;
      if (perf?.memory) {
        const pct = perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit
        if (pct > 0.85) waitThenReload(`memory ${Math.round(pct * 100)}%`)
      }
    }
    const id = setInterval(checkMemory, 60_000)
    return () => clearInterval(id)
  }, [waitThenReload])

  useEffect(() => {
    const now = new Date(), reset = new Date()
    reset.setHours(HARD_RESET_HOUR, 0, 0, 0)
    if (reset <= now) reset.setDate(reset.getDate() + 1)
    const id = setTimeout(() => waitThenReload('hard reset 03:00'), reset.getTime() - now.getTime())
    return () => clearTimeout(id)
  }, [waitThenReload])

  useEffect(() => {
    const p = (e: Event) => e.preventDefault()
    document.addEventListener("contextmenu", p)
    document.addEventListener("selectstart", p)
    return () => {
      document.removeEventListener("contextmenu", p)
      document.removeEventListener("selectstart", p)
    }
  }, [])

  if (nightMode || connectionState === 'night-sleep') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center p-8">
        <div className="text-center">
          <Moon className="w-20 h-20 mx-auto mb-6 text-slate-500 opacity-60" />
          <div className="text-3xl font-bold text-slate-300">Razglas — noćni režim</div>
          <div className="text-lg text-slate-500 mt-3">Aerodrom trenutno ne radi. Automatski se aktivira ujutro.</div>
        </div>
      </div>
    )
  }

  if (!activated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-center p-8">
        <div className="text-center max-w-xl">
          <Radio className="w-20 h-20 mx-auto mb-6 text-sky-400 opacity-80" />
          <h1 className="text-4xl font-black mb-4">FIDS TIV — Razglas</h1>
          <p className="text-slate-400 mb-8">
            Klikni jednom da aktiviraš zvuk. Ovo se radi samo pri pokretanju
            ekrana (nakon restarta PC-a ili dnevnog reload-a u 03:00).
          </p>
          <button
            onClick={handleActivate}
            className="px-10 py-6 bg-sky-500 hover:bg-sky-400 rounded-2xl text-2xl font-bold shadow-2xl shadow-sky-500/30 transition-colors"
          >
            <Volume2 className="w-8 h-8 inline-block mr-3 -mt-1" />
            Aktiviraj razglas
          </button>
          {!voiceReady && (
            <p className="text-amber-400 text-sm mt-6">
              Učitavanje glasova u toku — klik radi i dok se glas učitava.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── Kompaktna status traka — sve bitno na jedan pogled, bez
          skrolovanja, konzistentno vidljivo na svim tabovima. ────────── */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Radio className="w-7 h-7 text-sky-400" />
            <h1 className="text-xl font-black tracking-tight">FIDS TIV — Razglas</h1>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-500'}`} />
              <span className="text-slate-400">{connectionState === 'connected' ? 'Povezan' : 'Povezivanje...'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              {speaking ? (
                <><Volume2 className="w-4 h-4 text-emerald-400 animate-pulse" /><span className="text-emerald-400 font-semibold">Govori</span></>
              ) : (
                <><VolumeX className="w-4 h-4 text-slate-500" /><span className="text-slate-500">Tiho</span></>
              )}
            </span>
            {queueLength > 0 && (
              <span className="px-2 py-0.5 bg-sky-500/20 text-sky-300 rounded-md text-xs font-bold">
                U redu: {queueLength}
              </span>
            )}
            <span className="text-slate-500 text-xs">EN: {voiceName || "..."} · Lokalni: {localVoiceName || "..."}</span>
          </div>
        </div>

        {/* Tabovi */}
        <div className="max-w-6xl mx-auto flex gap-1 mt-4">
          {[
            { id: "pa" as const, label: "Razglas" },
            { id: "departures" as const, label: `Odlasci (${(liveFlightData?.departures || []).length})` },
            { id: "arrivals" as const, label: `Dolasci (${(liveFlightData?.arrivals || []).length})` },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-t-lg text-sm font-semibold transition-colors ${
                activeTab === t.id ? "bg-slate-800 text-sky-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {activeTab === "pa" && (
          <div>
            {lastAnnouncement && (
              <div className="bg-sky-950/40 border border-sky-800/50 rounded-2xl p-6 mb-6">
                <div className="flex items-center gap-2 text-sky-400 text-sm mb-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Posljednja najava
                </div>
                <div className="text-xl">{lastAnnouncement}</div>
              </div>
            )}

            <div className="bg-slate-800/40 rounded-2xl border border-slate-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-700 text-slate-400 text-sm font-semibold uppercase tracking-wider">
                Istorija (zadnjih {history.length})
              </div>
              <div className="divide-y divide-slate-700/50 max-h-[55vh] overflow-y-auto">
                {history.length === 0 ? (
                  <div className="p-10 text-center text-slate-500">Nema najava još.</div>
                ) : (
                  history.map((a) => (
                    <div key={a.id} className="px-6 py-4">
                      <div className="text-sm text-slate-500 mb-1 font-mono">{a.time}</div>
                      <div>{a.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <button
              onClick={() => enqueueEN("This is a test announcement.")}
              className="mt-6 px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-semibold transition-colors"
            >
              Test glasa (čujno — koristi samo ručno, van radnog vremena šaltera)
            </button>
          </div>
        )}

        {activeTab === "departures" && <FlightTable flights={liveFlightData?.departures || []} />}
        {activeTab === "arrivals" && <FlightTable flights={liveFlightData?.arrivals || []} />}
      </div>
    </div>
  )
}
