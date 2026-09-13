"use client"

// ============================================================
// app/pa/PaPageClient.tsx — RAZGLAS (PA) preko Web Speech API-ja
//
// Prilagođeno iz skeleton-a korisnikove DRUGE (Ably) aplikacije za
// STVARNU arhitekturu ovog FIDS projekta — polling umjesto real-time
// push konekcije. Dvije stvari su zamijenjene:
//
//   1. useRealtimeFlightData('pa') (Ably) → poll /api/flights svakih
//      ~30s (isti endpoint kao svi ostali ekrani, dijeli CDN keš —
//      s-maxage=45 na /api/flights znači da polovina ovih poll-ova
//      pogodi keš umjesto da pokrene Function Invocation).
//   2. announcements:pa Ably kanal → poll /api/pa-announcements svakih
//      ~6s (malen payload, isti Cache-Tag + revalidateTag() obrazac
//      kao gate/desk-status-override — normalno stanje su jeftini CDN
//      cache hit-ovi, revalidateTag() na POST daje skoro trenutnu
//      isporuku bez obzira na TTL).
//
// Sva tekst/vremenska logika je u lib/pa-announcements.ts — ovaj fajl
// samo orkestrira: čita letove, evaluira svaki, stavlja najave u
// lokalni TTS red.
//
// PA NE RADI NOĆU — isNightHours() iz lib/night-hours.ts (Intl
// Europe/Podgorica, ispravno i klijentski i serverski, vidi taj fajl).
//
// TROŠAK NA VERCELU: dva dodatna poll-a po ekranu (flights + pa-announcements)
// pored onoga što FIDS već ima — oba dijele isti jeftin Cache-Tag obrazac
// kao sve ostalo u aplikaciji. Ovaj ekran postoji u JEDNOM primjerku
// (jedan operativni centar), za razliku od 12 gate/18 checkin monitora,
// pa je trošak i inače zanemarljiv čak i bez toga.
// ============================================================

import {
  type JSX,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react"
import { Volume2, VolumeX, Radio, CheckCircle2, Moon, SkipForward, Trash2, AlertTriangle, Globe2, Sun, LogOut } from "lucide-react"
import { isNightHours } from "@/lib/night-hours"
import { useTheme } from "@/hooks/use-theme"
import type { Flight, FlightData } from "@/types/flight"
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
} from "@/lib/pa-announcements"

const HARD_RESET_HOUR = 3
const SECURITY_INTERVAL_MS = 30 * 60 * 1000

// ── Poll intervali (vidi objašnjenje na vrhu fajla) ──
const FLIGHTS_POLL_BASE_MS = 28_000
const FLIGHTS_POLL_JITTER_MS = 6_000
const ANNOUNCEMENTS_POLL_BASE_MS = 5_000
const ANNOUNCEMENTS_POLL_JITTER_MS = 2_000

const PA_DEDUP_STORAGE_KEY = "fids-pa-announced-v1"

function todayLocalDateStamp(): string {
  return new Date().toLocaleDateString("sv-SE")
}

interface PersistedDedup {
  date: string
  announced: Record<string, boolean>
  gateChanges: Record<string, boolean>
  // FIX (refresh usred dana bi ponovo izgovorio STARE ručne najave):
  // Redis lista (app/api/pa-announcements/route.ts) drži do 15
  // POSLEDNJIH ručnih najava sa TTL od 1h — ako se /pa ekran refreshuje
  // (F5, crash-recovery, itd.) unutar tog sata, manualSpokenIdsSetRef
  // je RANIJE bio SAMO u memoriji (prazan nakon refresh-a), pa bi se sve
  // najave koje su i dalje u toj Redis listi (uključujući možda i stariju
  // hitnu poruku!) ponovo dodale u red i izgovorile — iznenađujuće i
  // potencijalno alarmantno za putnike/osoblje. Sad se ID-jevi ručnih
  // najava TAKOĐE pamte ovdje, istim obrascem kao automatska dedup.
  manualIds: string[]
}

function loadPersistedDedup(): PersistedDedup | null {
  try {
    const raw = localStorage.getItem(PA_DEDUP_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedDedup
    if (parsed.date !== todayLocalDateStamp()) return null
    return parsed
  } catch {
    return null
  }
}

interface RemoteAnnouncement {
  id: string
  text: string
  lang?: "en" | "local"
  priority?: "normal" | "emergency"
  publishedAt: string
}

interface QueueItem {
  text: string
  voiceURI: string | null
  lang: "en" | "local"
  origin: "auto" | "manual"
}

interface GateRecord { gate: string }

interface HistoryEntry {
  id: string
  time: string
  text: string
  lang: "en" | "local"
  origin: "auto" | "manual"
}

function pickEnglishFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter(v => v.lang.toLowerCase().startsWith("en"))
  if (en.length === 0) return null
  const isFemale = (v: SpeechSynthesisVoice) => /female/i.test(v.name)
  const isExplicitlyMale = (v: SpeechSynthesisVoice) => /male/i.test(v.name) && !/female/i.test(v.name)
  return en.find(isFemale) ?? en.find(v => !isExplicitlyMale(v)) ?? en[0]
}

function pickLocalVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return voices.find(v =>
    v.lang.toLowerCase().startsWith("hr") ||
    v.lang.toLowerCase().startsWith("sr") ||
    /croatian|serbian/i.test(v.name)
  ) ?? null
}

export default function PaPageClient(): JSX.Element {
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected" | "night-sleep">("connecting")
  const [voiceReady, setVoiceReady] = useState(false)
  const [voiceName, setVoiceName] = useState<string>("")
  const [localVoiceName, setLocalVoiceName] = useState<string>("")
  const [localVoiceIsFallback, setLocalVoiceIsFallback] = useState(false)
  const [activated, setActivated] = useState(false)
  const [lastAnnouncement, setLastAnnouncement] = useState<string>("")
  const [speaking, setSpeaking] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [nightMode, setNightMode] = useState(isNightHours())
  const [activeTab, setActiveTab] = useState<"pa" | "departures" | "arrivals">("pa")
  const [queueLength, setQueueLength] = useState(0)
  const [clock, setClock] = useState("")
  // FIX (po zahtjevu — dark/light prekidač na PA stranici, default
  // LIGHT): odvojen od bilo koje druge stranice (sopstveni localStorage
  // ključ preko hooks/use-theme.ts) — PA stranica ima SVOJ default
  // (light), za razliku od npr. landing stranice (app/HomeClient.tsx),
  // koja default-uje na dark.
  const { isDark, toggle: toggleTheme } = useTheme("theme:pa", false)
  // FIX (po zahtjevu — /pa sad ZAHTIJEVA prijavu preko middleware.ts,
  // vidi app/api/pa/login/route.ts): logout dugme se sad UVIJEK
  // prikazuje (ne uslovno kao ranije preko kozmetičkog "isAdmin" flaga)
  // — sama činjenica da je ova stranica renderovana znači da je
  // pa-authenticated cookie već validan (middleware bi inače
  // redirektovao na /pa/login prije nego što bi ovaj kod uopšte
  // stigao da se izvrši). Klikom se briše PA-specifična sesija
  // (odvojena od opšte admin sesije) i vraća na PA login.
  const handleLogout = useCallback(async () => {
    try { await fetch("/api/pa/logout", { method: "POST" }) } catch {}
    try { localStorage.removeItem("paAuthenticated") } catch {}
    window.location.href = "/pa/login"
  }, [])
  const [liveFlightData, setLiveFlightData] = useState<FlightData | null>(null)
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null)

  const enVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const localVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const allVoicesRef = useRef<SpeechSynthesisVoice[]>([])

  const activatedRef = useRef(false)
  useEffect(() => { activatedRef.current = activated }, [activated])

  // FIX (provjera otpornosti — dva otvorena taba): deklarisano ovdje
  // (uz activatedRef) da bude jasno da processQueue provjerava OBA
  // uslova zajedno. Stvarna detekcija (BroadcastChannel) je niže,
  // grupisana sa ostalim "sigurnosnim mrežama" (bfcache, hard reset).
  const isDuplicateTabRef = useRef(false)
  const [isDuplicateTab, setIsDuplicateTab] = useState(false)

  const queueRef = useRef<QueueItem[]>([])
  const playingRef = useRef(false)
  const processQueueRef = useRef<() => void>(() => {})
  const speakingKeepAliveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const announcedRef = useRef<Record<string, boolean>>({})
  const gateChangeAnnouncedRef = useRef<Record<string, boolean>>({})
  const manualSpokenIdsSetRef = useRef<Set<string>>(new Set())

  const previousGatesRef = useRef<Record<string, GateRecord>>({})

  const dedupLoadedRef = useRef(false)
  if (!dedupLoadedRef.current) {
    dedupLoadedRef.current = true
    const persisted = loadPersistedDedup()
    if (persisted) {
      announcedRef.current = persisted.announced
      gateChangeAnnouncedRef.current = persisted.gateChanges
      // FIX (vidi opširan komentar uz PersistedDedup.manualIds): vrati
      // i ID-jeve ranije izgovorenih RUČNIH najava, da se nakon
      // refresh-a NE ponove stare poruke koje su i dalje u Redis listi
      // (1h TTL).
      if (Array.isArray(persisted.manualIds)) {
        manualSpokenIdsSetRef.current = new Set(persisted.manualIds)
      }
    }
  }

  const persistDedup = useCallback(() => {
    try {
      const payload: PersistedDedup = {
        date: todayLocalDateStamp(),
        announced: announcedRef.current,
        gateChanges: gateChangeAnnouncedRef.current,
        // Set → Array za JSON; ograničeno na zadnjih 200 (isto ograničenje
        // koje je stari, prije-refaktora kod već koristio za ovaj Set —
        // spriječava neograničen rast u toku jednog dugog dana).
        manualIds: Array.from(manualSpokenIdsSetRef.current).slice(-200),
      }
      localStorage.setItem(PA_DEDUP_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // localStorage pun/nedostupan — nije kritično, samo gubimo zaštitu
      // od duplikata nakon eventualnog reload-a usred dana.
    }
  }, [])

  const markAnnounced = useCallback((key: string) => {
    announcedRef.current[key] = true
    persistDedup()
  }, [persistDedup])

  const markGateChange = useCallback((key: string) => {
    gateChangeAnnouncedRef.current[key] = true
    persistDedup()
  }, [persistDedup])

  const pushHistory = useCallback((text: string, lang: "en" | "local", origin: "auto" | "manual") => {
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLastAnnouncement(text)
    setHistory(prev => [{ id: `${Date.now()}-${Math.random()}`, time, text, lang, origin }, ...prev].slice(0, 40))
  }, [])

  useEffect(() => {
    setSpeechSupported(typeof window !== "undefined" && "speechSynthesis" in window)
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
        setLocalVoiceName(local ? local.name : "EN glas (fonetski)")
        setLocalVoiceIsFallback(!local)
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

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB"))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const processQueue = useCallback(() => {
    if (!activatedRef.current) return
    // FIX (dva otvorena taba — vidi BroadcastChannel efekat niže):
    // duplikat tab NIKAD ne smije da govori, čak i ako bi njegov red
    // slučajno imao nešto (npr. stiglo mu je preko poll-a prije nego
    // što je detekcija stigla da ga ućutka).
    if (isDuplicateTabRef.current) return
    if (playingRef.current || queueRef.current.length === 0) return

    playingRef.current = true
    setSpeaking(true)

    const item = queueRef.current.shift()!
    setQueueLength(queueRef.current.length)
    // FIX (po zahtjevu — istorija se nije ažurirala nakon što TTS
    // završi): pushHistory je RANIJE bio pozivan u enqueueEN/enqueueLocal
    // — u trenutku kad se najava STAVI U RED, ne kad se STVARNO
    // izgovori. Ako je red imao nekoliko stavki ispred (npr. gomila
    // rutinskih najava odjednom), stavka bi se pojavila u istoriji
    // ODMAH, davno prije nego što bi je iko stvarno čuo — a onda, kad
    // bi se STVARNO izgovorila par sekundi/minuta kasnije, ništa novo
    // se ne bi desilo u istoriji (već je tamo), pa je djelovalo kao da
    // se "istorija ne ažurira nakon TTS-a". Sad se pushHistory poziva
    // OVDJE — tačno u trenutku kad stavka izlazi iz reda i STVARNO
    // počinje da se izgovara, što je i vizuelno i logički tačan
    // trenutak za "Posljednja najava"/istoriju da se ažurira.
    pushHistory(item.text, item.lang, item.origin)
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
  }, [pushHistory])

  useEffect(() => { processQueueRef.current = processQueue }, [processQueue])

  const enqueueEN = useCallback((text: string, origin: "auto" | "manual" = "auto") => {
    const item: QueueItem = { text, voiceURI: enVoiceRef.current?.voiceURI ?? null, lang: "en", origin }
    if (origin === "manual") queueRef.current.unshift(item)
    else queueRef.current.push(item)
    setQueueLength(queueRef.current.length)
    setTimeout(() => processQueueRef.current(), 0)
  }, [])

  const enqueueLocal = useCallback((text: string, origin: "auto" | "manual" = "auto") => {
    const uri = localVoiceRef.current?.voiceURI ?? enVoiceRef.current?.voiceURI ?? null
    const item: QueueItem = { text, voiceURI: uri, lang: "local", origin }
    if (origin === "manual") queueRef.current.unshift(item)
    else queueRef.current.push(item)
    setQueueLength(queueRef.current.length)
    setTimeout(() => processQueueRef.current(), 0)
  }, [])

  const handleSkipCurrent = useCallback(() => {
    const synth = window.speechSynthesis
    if (synth?.speaking) synth.cancel()
  }, [])

  const handleClearQueue = useCallback(() => {
    queueRef.current = []
    setQueueLength(0)
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
        markAnnounced(key)
        enqueueEN(buildArrivalEN(f))
        enqueueLocal(buildArrivalLocal(f))
      }
    }

    if (statusLower.includes("cancel") || statusLower.includes("otkaz")) {
      const key = getAnnouncementKey(f, "cancelled")
      if (!announcedRef.current[key]) {
        markAnnounced(key)
        enqueueEN(buildCancelledEN(f))
        enqueueLocal(buildCancelledLocal(f))
      }
    }
    if (statusLower.includes("divert") || statusLower.includes("preusmjer")) {
      const key = getAnnouncementKey(f, "diverted")
      if (!announcedRef.current[key]) {
        markAnnounced(key)
        enqueueEN(buildDivertedEN(f))
        enqueueLocal(buildDivertedLocal(f))
      }
    }
    if (statusLower.includes("delay") || statusLower.includes("kasni")) {
      if (shouldAnnounceDelay(f)) {
        const key = getAnnouncementKey(f, "delayed")
        if (!announcedRef.current[key]) {
          markAnnounced(key)
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
            markAnnounced(key)
            enqueueEN(buildDepartureEN(f, win.type))
            enqueueLocal(buildDepartureLocal(f, win.type))
          }
        }
      }
    }
  }, [enqueueEN, enqueueLocal, markAnnounced])

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
            markGateChange(changeKey)
            enqueueEN(buildGateChangeEN(f, prevGate, currentGate))
            enqueueLocal(buildGateChangeLocal(f, prevGate, currentGate))
          }
        }
      }
      previousGatesRef.current[flightKey] = { gate: currentGate }
    }
  }, [enqueueEN, enqueueLocal, markGateChange])

  // ── FLIGHT DATA POLL — zamjena za useRealtimeFlightData('pa') (Ably).
  // Isti /api/flights endpoint kao svi ostali ekrani; dijeli njegov CDN
  // keš (s-maxage=45), pa je stvarni Vercel trošak ovog dodatnog ekrana
  // minimalan. ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const etagRef = { current: null as string | null }

    const poll = async () => {
      try {
        const headers: HeadersInit = {}
        if (etagRef.current) headers["If-None-Match"] = etagRef.current

        // FIX (nema timeout-a na poll pozivima — provjera otpornosti):
        // bez AbortSignal.timeout, mreža koja "zaglavi" (ne vrati ni
        // uspjeh ni grešku) bi ostavila fetch da visi neograničeno —
        // pošto se sledeći poll zakazuje tek u `finally`, cio ciklus
        // osvježavanja bi stao dok se taj JEDAN zahtjev ne razriješi
        // (moglo bi trajati minutama na lošoj mreži). 10s je dovoljno
        // velikodušno za normalan odgovor (i /api/flights sopstveni
        // maxDuration je 60s), a dovoljno kratko da ekran ne "zamrzne"
        // predugo na jednom lošem pokušaju.
        const res = await fetch("/api/flights", { headers, signal: AbortSignal.timeout(10_000) })
        if (cancelled) return

        if (res.status === 304) {
          setConnectionState("connected")
        } else if (res.ok) {
          const etag = res.headers.get("etag")
          if (etag) etagRef.current = etag
          const data: FlightData = await res.json()
          if (cancelled) return
          setLiveFlightData(data)
          setNightMode(!!data.isNightMode)
          setConnectionState(data.isNightMode ? "night-sleep" : "connected")

          if (!data.isNightMode) {
            const all = [...(data.departures || []), ...(data.arrivals || [])]
            detectGateChanges(all)
            all.forEach(evaluateFlight)
          }
        } else {
          setConnectionState("disconnected")
        }
      } catch (err) {
        // FIX: AbortSignal.timeout baca DOMException 'TimeoutError' —
        // hvata se OVDJE (isti catch kao mrežni prekid/malformiran
        // odgovor), ne treba posebna grana — svrha je ista (ne znamo
        // trenutno stanje letova, prikaži "disconnected" i pokušaj
        // ponovo na sledećem poll ciklusu).
        if (!cancelled) {
          console.error("[PA] Greška pri dohvatu letova:", err)
          setConnectionState("disconnected")
        }
      } finally {
        if (!cancelled) {
          const interval = FLIGHTS_POLL_BASE_MS + Math.floor(Math.random() * FLIGHTS_POLL_JITTER_MS)
          timeoutId = setTimeout(poll, interval)
        }
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [detectGateChanges, evaluateFlight])

  // ── RUČNE NAJAVE POLL — zamjena za announcements:pa Ably kanal.
  // Malen payload (do 15 stavki), poll na ~5-7s, s-maxage=30 na ruti —
  // normalno je CDN cache hit, revalidateTag() na POST daje skoro
  // trenutnu isporuku. ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        // FIX (nema timeout-a — isti razlog kao flight poll iznad).
        const res = await fetch("/api/pa-announcements", { signal: AbortSignal.timeout(8_000) })
        if (cancelled) return

        // FIX (istekla PA sesija usred dana se tiho ignorisala): ova
        // ruta je od uvođenja PA login sistema (middleware.ts) zaštićena
        // pa-authenticated cookie-jem. Ranije, PRIJE tog uvođenja, `res.ok`
        // provjera je bila dovoljna — sad, ako 24h sesija istekne dok je
        // ekran uključen (npr. aktiviran ujutro, prođe dan), poll bi
        // počeo dobijati 401 i TIHO prestao da prima ručne najave, bez
        // ijednog traga da se to desilo — operater bi tek slučajno
        // primijetio da hitna poruka nije ni stigla. Sad se 401
        // eksplicitno prepoznaje i preusmjerava na ponovnu prijavu.
        if (res.status === 401) {
          window.location.href = "/pa/login"
          return
        }

        if (res.ok) {
          const data = await res.json()
          const list: RemoteAnnouncement[] = data.announcements || []
          // Najnovije prvo u odgovoru (vidi POST rutu) — obrni da se
          // izgovore hronološkim redom ako ih ima više odjednom.
          for (const ann of [...list].reverse()) {
            if (!ann?.id || !ann?.text) continue
            if (manualSpokenIdsSetRef.current.has(ann.id)) continue
            manualSpokenIdsSetRef.current.add(ann.id)
            // FIX (persist — vidi PersistedDedup.manualIds): bez ovoga,
            // dedup za ručne najave je preživljavao samo dok je tab
            // otvoren, ne kroz refresh.
            persistDedup()

            // FIX (hitne poruke): emergency najava PREKIDA trenutni govor
            // I briše sve što čeka u redu PRIJE nego što se doda — ne
            // čeka čak ni na prioritetni "manual" red (koji bi je stavio
            // na početak, ali IZA eventualnog trenutno-izgovaranog teksta).
            // Prava hitna situacija ne smije čekati da se završi najava o
            // ukrcavanju.
            if (ann.priority === "emergency") {
              const synth = window.speechSynthesis
              if (synth?.speaking) synth.cancel()
              queueRef.current = []
              setQueueLength(0)
            }

            if (ann.lang === "local") enqueueLocal(ann.text, "manual")
            else enqueueEN(ann.text, "manual")
          }
        }
      } catch (err) {
        console.error("[PA] Greška pri dohvatu ručnih najava:", err)
      } finally {
        if (!cancelled) {
          const interval = ANNOUNCEMENTS_POLL_BASE_MS + Math.floor(Math.random() * ANNOUNCEMENTS_POLL_JITTER_MS)
          timeoutId = setTimeout(poll, interval)
        }
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [enqueueEN, persistDedup])

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

  const handleActivate = () => {
    setActivated(true)
    activatedRef.current = true
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
      const perf = performance as any
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

  // FIX (provjera otpornosti — Back/Forward): moderni browseri mogu
  // vratiti stranicu iz bfcache-a (Back-Forward Cache) umjesto svježeg
  // učitavanja — sav JS state (tajmeri, TTS red, WebSpeech konekcija)
  // se "zamrzne" i vrati kako je bio, što za stranicu koja upravlja
  // živim audio-redom i pollinguje na tajmerima nije siguran obrazac
  // (npr. speechSynthesis stanje iz zamrznutog tab-a je nepouzdano na
  // nekim browserima). `event.persisted === true` znači "ovo JESTE
  // bfcache povratak, ne svježe učitavanje" — forsira se čist reload
  // umjesto da se nastavi sa potencijalno zastarjelim stanjem.
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload()
    }
    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [])

  // FIX (provjera otpornosti — dva otvorena taba): ako se /pa slučajno
  // otvori u DVA taba/prozora na istom računaru (lako se desi — npr.
  // operater otvori novi tab da nešto provjeri, zaboravivši da je
  // razglas već otvoren), OBA taba bi nezavisno aktivirala
  // speechSynthesis i pokušala govoriti ISTOVREMENO — dvije preklopljene
  // najave na fizičkom pojačalu, potpuno nerazumljivo. BroadcastChannel
  // (podržan u svim relevantnim browserima — kiosk/operativni računari
  // su Windows+Chrome/Edge) omogućava tabovima da se "vide" bez servera:
  // svaki tab najavi sebe (tabId + vrijeme montiranja), i tab koji je
  // MLAĐI (montiran kasnije) se sam ućutkava i prikazuje upozorenje —
  // stariji tab (koji je vjerovatno bio tamo prvi, cio dan) nastavlja
  // normalno da radi.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel("fids-pa-tabs")
    const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const mountedAt = Date.now()

    const isOtherEarlier = (otherMountedAt: number, otherTabId: string) => {
      if (otherMountedAt !== mountedAt) return otherMountedAt < mountedAt
      return otherTabId < tabId // tiebreaker ako su montirani u istoj milisekundi
    }

    const markDuplicate = () => {
      isDuplicateTabRef.current = true
      setIsDuplicateTab(true)
      const synth = window.speechSynthesis
      if (synth?.speaking) synth.cancel()
      queueRef.current = []
      setQueueLength(0)
    }

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data
      if (!msg || msg.tabId === tabId) return
      if (msg.type === "announce") {
        channel.postMessage({ type: "ack", tabId, mountedAt })
      }
      if ((msg.type === "announce" || msg.type === "ack") && isOtherEarlier(msg.mountedAt, msg.tabId)) {
        markDuplicate()
      }
    }
    channel.addEventListener("message", handleMessage)
    channel.postMessage({ type: "announce", tabId, mountedAt })

    return () => {
      channel.removeEventListener("message", handleMessage)
      channel.close()
    }
  }, [])

  if (nightMode || connectionState === 'night-sleep') {
    return (
      <div className={`min-h-screen ${isDark ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white' : 'bg-gradient-to-br from-slate-100 via-white to-slate-100 text-[#0B2545]'} flex items-center justify-center p-8`}>
        <div className="text-center">
          <Moon className={`w-20 h-20 mx-auto mb-6 opacity-60 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
          <div className={`text-3xl font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Razglas — noćni režim</div>
          <div className={`text-lg mt-3 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Aerodrom trenutno ne radi. Automatski se aktivira ujutro.</div>
          <div className={`text-sm mt-8 font-mono tabular-nums ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{clock}</div>
        </div>
      </div>
    )
  }

  if (speechSupported === false) {
    return (
      <div className={`min-h-screen ${isDark ? 'bg-gradient-to-br from-red-950 via-slate-900 to-slate-950 text-white' : 'bg-gradient-to-br from-red-50 via-white to-slate-50 text-[#0B2545]'} flex items-center justify-center p-8`}>
        <div className="text-center max-w-lg">
          <AlertTriangle className="w-16 h-16 mx-auto mb-6 text-red-400" />
          <h1 className="text-2xl font-black mb-3">Razglas nije podržan na ovom browseru</h1>
          <p className={isDark ? 'text-slate-400' : 'text-slate-500'}>
            Ovaj ekran zahtijeva Web Speech API (ugrađen u Chrome/Edge). Otvori
            ovu stranicu u Google Chrome-u na računaru koji je fizički povezan
            na PA pojačalo.
          </p>
        </div>
      </div>
    )
  }

  if (!activated) {
    return (
      <div className={`min-h-screen ${isDark ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white' : 'bg-gradient-to-br from-white via-slate-50 to-white text-[#0B2545]'} flex items-center justify-center p-8`}>
        <div className="text-center max-w-xl">
          <Radio className={`w-20 h-20 mx-auto mb-6 opacity-80 ${isDark ? 'text-sky-400' : 'text-sky-600'}`} />
          <h1 className="text-4xl font-black mb-2">FIDS TIV — Razglas</h1>
          <div className={`text-sm font-mono tabular-nums mb-6 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{clock}</div>
          <p className={`mb-8 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Klikni jednom da aktiviraš zvuk. Ovo se radi samo pri pokretanju
            ekrana (nakon restarta PC-a ili dnevnog reload-a u 03:00).
          </p>
          <button
            onClick={handleActivate}
            disabled={speechSupported === null}
            className="px-10 py-6 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-wait rounded-2xl text-2xl font-bold shadow-2xl shadow-sky-500/30 transition-colors text-white"
          >
            <Volume2 className="w-8 h-8 inline-block mr-3 -mt-1" />
            Aktiviraj razglas
          </button>
          {!voiceReady && (
            <p className="text-amber-500 text-sm mt-6">
              Učitavanje glasova u toku — klik radi i dok se glas učitava.
            </p>
          )}
        </div>
      </div>
    )
  }

  const flightStatusColor = (status: string): string => {
    const s = (status || "").toLowerCase()
    if (s.includes("arrived") || s.includes("sletio") || s.includes("landed")) return "text-emerald-400"
    if (s.includes("board")) return "text-cyan-400"
    if (s.includes("delay") || s.includes("kasni")) return "text-red-400"
    if (s.includes("cancel") || s.includes("otkaz")) return "text-red-500"
    if (s.includes("divert") || s.includes("preusmjer")) return "text-purple-400"
    if (s.includes("departed") || s.includes("otiš")) return "text-slate-500"
    return "text-amber-400"
  }

  const FlightTable = ({ flights }: { flights: Flight[] }) => {
    const sorted = [...flights].sort((a, b) =>
      (a.ScheduledDepartureTime || "99:99").localeCompare(b.ScheduledDepartureTime || "99:99")
    )
    return (
      <div className={`rounded-2xl border overflow-hidden ${isDark ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200'}`}>
        <div className={`grid grid-cols-[90px_1fr_90px_90px_90px_90px] gap-2 px-5 py-3 border-b text-xs font-bold uppercase tracking-wider ${
          isDark ? 'bg-slate-800/80 border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'
        }`}>
          <span>Let</span><span>Kompanija / Grad</span><span>Plan</span><span>Oček.</span><span>Gate</span><span>Status</span>
        </div>
        <div className={`max-h-[60vh] overflow-y-auto divide-y font-mono text-sm ${isDark ? 'divide-slate-700/40' : 'divide-slate-100'}`}>
          {sorted.length === 0 ? (
            <div className={`p-10 text-center font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Nema letova.</div>
          ) : sorted.map((f) => (
            <div key={`${f.FlightNumber}-${f.ScheduledDepartureTime}`} className={`grid grid-cols-[90px_1fr_90px_90px_90px_90px] gap-2 px-5 py-3 items-center ${isDark ? 'hover:bg-slate-700/20' : 'hover:bg-slate-50'}`}>
              <span className={`font-bold ${isDark ? 'text-white' : 'text-[#0B2545]'}`}>{f.FlightNumber}</span>
              <span className={`font-sans truncate ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{f.AirlineName} · {f.DestinationCityName}</span>
              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>{f.ScheduledDepartureTime || "—"}</span>
              <span className="text-amber-500">{f.EstimatedDepartureTime || "—"}</span>
              <span className={isDark ? 'text-slate-300' : 'text-slate-600'}>{f.GateNumber || f.CheckInDesk || "—"}</span>
              <span className={`font-sans font-semibold ${flightStatusColor(f.StatusEN)}`}>{f.StatusEN || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // FIX (isti globalni overflow:hidden problem kao app/admin/pa/page.tsx
  // — vidi opširan komentar tamo): h-screen (fiksno) + overflow-y-auto
  // na ovom div-u, umjesto min-h-screen bez skrola.
  return (
    <div className={`h-screen overflow-y-auto ${isDark ? 'bg-slate-950 text-white' : 'bg-[#F7F9FC] text-[#0B2545]'}`}>
      <div className={`border-b backdrop-blur px-6 py-4 sticky top-0 z-10 ${isDark ? 'border-slate-800 bg-slate-900/90' : 'border-slate-200 bg-[#F7F9FC]/90'}`}>
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${isDark ? 'bg-sky-500/15 border-sky-500/30' : 'bg-sky-500/10 border-sky-500/25'}`}>
                <Radio className={isDark ? 'w-5 h-5 text-sky-400' : 'w-5 h-5 text-sky-600'} />
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tight leading-none">TIV RAZGLAS</h1>
                <div className={`text-[11px] tracking-wide uppercase mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Sistem za javno obavještavanje</div>
              </div>
            </div>
            <div className={`hidden sm:block h-9 w-px ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />
            <div className={`hidden sm:block font-mono text-lg tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>{clock}</div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold tracking-wide ${
              speaking
                ? "bg-red-500/15 border-red-500/50 text-red-400"
                : isDark ? "bg-white/5 border-white/10 text-slate-500" : "bg-black/5 border-black/10 text-slate-400"
            }`}>
              <span className={`w-2.5 h-2.5 rounded-full ${speaking ? "bg-red-500 animate-pulse" : isDark ? "bg-slate-600" : "bg-slate-300"}`} />
              {speaking ? "NA ZVUČNICIMA" : "SPREMAN"}
            </div>

            <span className="flex items-center gap-1.5 text-sm">
              <span className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-500'}`} />
              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>{connectionState === 'connected' ? 'Povezan' : 'Povezivanje…'}</span>
            </span>

            {queueLength > 0 && (
              <span className="px-2.5 py-1 bg-sky-500/20 text-sky-500 rounded-md text-xs font-bold tabular-nums">
                U redu: {queueLength}
              </span>
            )}

            {/* FIX (po zahtjevu — dark/light prekidač, default light) */}
            <button
              onClick={toggleTheme}
              aria-label="Promijeni temu"
              className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5'}`}
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#0B2545]" />}
            </button>

            {/* FIX (po zahtjevu — logout dugme u header-u): vidi opširan
                komentar uz handleLogout iznad — sad se prikazuje
                bezuslovno, jer pristup ovoj stranici već zahtijeva
                pa-authenticated (middleware.ts). */}
            <button
              onClick={handleLogout}
              aria-label="Odjava"
              title="Odjava"
              className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-black/10 hover:bg-black/5 text-[#0B2545]'}`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="max-w-6xl mx-auto flex items-center justify-between mt-4 flex-wrap gap-3">
          <div className="flex gap-1">
            {[
              { id: "pa" as const, label: "Razglas" },
              { id: "departures" as const, label: `Odlasci (${(liveFlightData?.departures || []).length})` },
              { id: "arrivals" as const, label: `Dolasci (${(liveFlightData?.arrivals || []).length})` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 rounded-t-lg text-sm font-semibold transition-colors ${
                  activeTab === t.id
                    ? (isDark ? "bg-slate-800 text-sky-400" : "bg-white text-sky-600 shadow-sm")
                    : (isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600")
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSkipCurrent}
              disabled={!speaking}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-30 disabled:hover:bg-transparent transition-colors ${
                isDark ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-[#0B2545] hover:bg-black/5'
              }`}
              title="Preskoči trenutnu najavu"
            >
              <SkipForward className="w-3.5 h-3.5" /> Preskoči
            </button>
            <button
              onClick={handleClearQueue}
              disabled={queueLength === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:text-red-500 hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}
              title="Isprazni cijeli red čekanja"
            >
              <Trash2 className="w-3.5 h-3.5" /> Isprazni red
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {isDuplicateTab && (
          <div className="mb-6 flex items-start gap-3 bg-red-500/10 border border-red-500/40 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className={`text-sm ${isDark ? 'text-red-200' : 'text-red-800'}`}>
              <div className="font-bold mb-0.5">Razglas je već aktivan u drugom tabu/prozoru</div>
              <div className={isDark ? 'text-red-300/80' : 'text-red-700/80'}>
                Ovaj tab NEĆE izgovarati najave (spriječava preklapajući, nerazumljiv
                zvuk). Zatvori ga i koristi tab koji je već bio otvoren.
              </div>
            </div>
          </div>
        )}
        {activeTab === "pa" && (
          <div className="space-y-6">
            {localVoiceIsFallback && (
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className={`text-sm flex-1 ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
                  <div className="font-bold mb-0.5">Lokalni glas nije pronađen na ovom sistemu</div>
                  <div className={isDark ? 'text-amber-300/80 mb-3' : 'text-amber-700/80 mb-3'}>
                    Najave na lokalnom jeziku se trenutno čitaju ENGLESKIM glasom,
                    fonetski — mogu zvučati nerazumljivo putnicima. Provjeri
                    "Test lokalnog glasa" ispod i instaliraj hrvatski/srpski glas.
                  </div>
                  {/* FIX (po zahtjevu — link ka podešavanju kad glas nedostaje):
                      ms-settings:regionlanguage i ms-settings:speech su stvarni,
                      dokumentovani Windows URI-ji koji direktno otvaraju
                      odgovarajuća podešavanja. Rade kad se klikne UNUTAR
                      Windows-a (Chrome/Edge mogu jednom tražiti potvrdu "Open
                      Windows Settings?" — očekivano ponašanje, ne greška).
                      Pisano uputstvo je uvijek prikazano I pored linkova, za
                      slučaj da browser/verzija Windows-a odbije URI. */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <a
                      href="ms-settings:regionlanguage"
                      className={`px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-xs font-semibold transition-colors ${isDark ? 'text-amber-200' : 'text-amber-800'}`}
                    >
                      Otvori: Jezik i region →
                    </a>
                    <a
                      href="ms-settings:speech"
                      className={`px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-xs font-semibold transition-colors ${isDark ? 'text-amber-200' : 'text-amber-800'}`}
                    >
                      Otvori: Podešavanja govora →
                    </a>
                  </div>
                  <div className={`text-[11px] leading-relaxed ${isDark ? 'text-amber-300/60' : 'text-amber-700/70'}`}>
                    Ako klik ne otvori ništa: Windows Settings → Time &amp; Language
                    → Language &amp; region → "Add a language" → izaberi Hrvatski
                    ili Srpski → tokom instalacije uključi opciju "Text-to-speech"
                    (Speech). Nakon instalacije, osvježi (F5) ovu stranicu.
                  </div>
                </div>
              </div>
            )}

            {/* FIX (po zahtjevu — trajan panel statusa glasova): do sad se
                UPOZORENJE prikazivalo samo za lokalni glas kad padne na
                fonetski fallback — ako EN glas uopšte NIJE pronađen (rijeđe,
                ali moguće na "golom" Windows instalacijom bez ijednog TTS
                glasa), sistem bi bio potpuno nijem bez ikakvog objašnjenja
                zašto. Ovaj panel je uvijek vidljiv, jasno pokazuje oba glasa. */}
            <div className={`rounded-2xl border p-4 ${isDark ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Status glasova</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  {voiceName ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  )}
                  <div>
                    <div className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Engleski (EN)</div>
                    <div className={`text-sm font-semibold ${voiceName ? (isDark ? "text-white" : "text-[#0B2545]") : "text-red-500"}`}>
                      {voiceName || "Nije pronađen"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!localVoiceIsFallback ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  )}
                  <div>
                    <div className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Lokalni (HR/SR)</div>
                    <div className={`text-sm font-semibold ${!localVoiceIsFallback ? (isDark ? "text-white" : "text-[#0B2545]") : "text-amber-500"}`}>
                      {localVoiceName || "Učitavanje…"}
                    </div>
                  </div>
                </div>
              </div>
              {!voiceName && (
                <div className={`mt-3 pt-3 border-t flex flex-wrap gap-2 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                  <a
                    href="ms-settings:speech"
                    className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-500 text-xs font-semibold transition-colors"
                  >
                    Otvori podešavanja govora →
                  </a>
                  <span className="text-[11px] text-red-500/80 self-center">
                    Bez EN glasa razglas ne može ništa izgovoriti.
                  </span>
                </div>
              )}
            </div>

            {lastAnnouncement && (
              <div className={`rounded-2xl border p-6 ${isDark ? 'bg-sky-950/40 border-sky-800/50' : 'bg-sky-50 border-sky-200'}`}>
                <div className="flex items-center gap-2 text-sky-500 text-sm mb-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Posljednja najava
                </div>
                <div className="text-xl">{lastAnnouncement}</div>
              </div>
            )}

            <div className={`rounded-2xl border overflow-hidden ${isDark ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className={`px-6 py-4 border-b text-sm font-semibold uppercase tracking-wider ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                Istorija (zadnjih {history.length})
              </div>
              <div className={`divide-y max-h-[55vh] overflow-y-auto ${isDark ? 'divide-slate-700/50' : 'divide-slate-100'}`}>
                {history.length === 0 ? (
                  <div className={`p-10 text-center ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Nema najava još.</div>
                ) : (
                  history.map((a) => (
                    <div key={a.id} className="px-6 py-4 flex items-start gap-3">
                      <div className="flex flex-col items-start gap-1 flex-shrink-0 w-24">
                        <span className={`text-xs font-mono tabular-nums ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{a.time}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          a.lang === "en" ? "bg-sky-500/15 text-sky-600" : "bg-emerald-500/15 text-emerald-600"
                        }`}>
                          {a.lang === "en" ? "EN" : "LOKALNI"}
                        </span>
                        {a.origin === "manual" && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">
                            RUČNO
                          </span>
                        )}
                      </div>
                      <div className="flex-1">{a.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => enqueueEN("This is a test announcement.")}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-white border border-slate-200 hover:bg-slate-50 text-[#0B2545]'
                }`}
              >
                <Globe2 className="w-4 h-4" /> Test EN glasa
              </button>
              <button
                onClick={() => enqueueLocal("Ovo je testna najava.")}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-white border border-slate-200 hover:bg-slate-50 text-[#0B2545]'
                }`}
              >
                <Globe2 className="w-4 h-4" /> Test lokalnog glasa
              </button>
              <span className={`text-xs self-center ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                Čujno — koristi samo ručno, van radnog vremena šaltera.
              </span>
            </div>
          </div>
        )}

        {activeTab === "departures" && <FlightTable flights={liveFlightData?.departures || []} />}
        {activeTab === "arrivals" && <FlightTable flights={liveFlightData?.arrivals || []} />}
      </div>
    </div>
  )
}
