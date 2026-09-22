// app/admin/pa/page.tsx
"use client"

// ============================================================
// Admin stranica za slanje PA (razglas) najava. Objavljuje TEKST
// na Ably preko /api/admin/announcement — sam izgovor NA TERMINALU
// radi app/pa/PaPageClient.tsx (ekran u operativnom centru).
//
// FIX (po zahtjevu — portovano iz glavnog/polling sistema, dva
// dodatka):
//   1. Bilingvalni šabloni (engleski + crnogorski/srpski) — bio je
//      samo engleski.
//   2. "Lokalni pregled" — kad je uključen, admin ČUJE najavu na
//      SVOM uređaju (preko Web Speech API-ja u browseru) u istom
//      trenutku kad je i pošalje na terminal, isti obrazac kao
//      publishAndPreview() u glavnom sistemu. Bira glas ISTOM
//      logikom koju operativni ekran koristi (pickEnglishFemaleVoice/
//      pickLocalVoice, izvezeno iz app/pa/PaPageClient.tsx — vidi
//      tamo za pun kontekst zašto je baš ta logika).
//
// Zaštićeno kroz app/admin/layout.tsx (middleware admin-session
// provjera + idle-logout) — isto kao i /admin/assign-checkin.
// ============================================================

import { useCallback, useEffect, useRef, useState, type JSX } from "react"
import { Radio, Send, CheckCircle2, AlertCircle, Volume2, VolumeX, Languages } from "lucide-react"
import { pickEnglishFemaleVoice, pickLocalVoice } from "@/app/pa/PaPageClient"

type Lang = "en" | "local"

interface Template {
  label: string
  en: string
  local: string
}

// Uobičajene PA fraze — polja u [UGLASTIM ZAGRADAMA] ostaju za
// ručnu izmjenu prije slanja (flight number, gate, itd.). Crnogorski/
// srpski tekst je namjerno na latinici, isti stil kao ostatak sistema
// (npr. lib/pa-announcements.ts local varijante).
const TEMPLATES: Template[] = [
  {
    label: "Final call",
    en: "This is the final call for passengers [FLIGHT NUMBER] to [DESTINATION]. Please proceed immediately to gate [GATE NUMBER].",
    local: "Ovo je poslednji poziv za putnike leta [BROJ LETA] za [DESTINACIJA]. Molimo da se odmah uputite na izlaz [BROJ IZLAZA].",
  },
  {
    label: "Boarding",
    en: "Boarding is now in progress for flight [FLIGHT NUMBER] to [DESTINATION] at gate [GATE NUMBER].",
    local: "Ukrcavanje je u toku za let [BROJ LETA] za [DESTINACIJA] na izlazu [BROJ IZLAZA].",
  },
  {
    label: "Gate change",
    en: "Attention please. The departure gate for flight [FLIGHT NUMBER] to [DESTINATION] has changed to gate [GATE NUMBER].",
    local: "Pažnja, molimo. Izlaz za let [BROJ LETA] za [DESTINACIJA] je promijenjen na izlaz [BROJ IZLAZA].",
  },
  {
    label: "Delay",
    en: "We regret to announce that flight [FLIGHT NUMBER] to [DESTINATION] is delayed. The new estimated departure time is [TIME].",
    local: "Obavještavamo vas da let [BROJ LETA] za [DESTINACIJA] kasni. Novo procijenjeno vrijeme polijetanja je [VRIJEME].",
  },
  {
    label: "Lost passenger",
    en: "Would passenger [NAME] on flight [FLIGHT NUMBER] please proceed to the information desk.",
    local: "Molimo putnika [IME] na letu [BROJ LETA] da se javi na info pult.",
  },
  {
    label: "Security",
    en: "Please do not leave luggage unattended at any time. Unattended items will be removed by security.",
    local: "Molimo vas da ne ostavljate prtljag bez nadzora. Nenadzirani predmeti će biti uklonjeni od strane obezbjeđenja.",
  },
]

const MAX_LEN = 500

export default function AdminPaPage(): JSX.Element {
  const [lang, setLang] = useState<Lang>("en")
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  // ── Lokalni pregled (TTS na admin uređaju) ──────────────────
  const [localPreviewEnabled, setLocalPreviewEnabled] = useState(false)
  const enVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const localVoiceRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    let cancelled = false
    let pollId: ReturnType<typeof setInterval> | null = null

    const tryLoad = () => {
      const voices = window.speechSynthesis?.getVoices() ?? []
      if (voices.length === 0) return false
      if (!cancelled) {
        enVoiceRef.current = pickEnglishFemaleVoice(voices)
        localVoiceRef.current = pickLocalVoice(voices)
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

  // Govori tekst NA OVOM uređaju (admin monitor), NEZAVISNO od slanja
  // na terminal — koristi glas koji odgovara trenutno izabranom jeziku
  // šablona (en → engleski glas, local → crnogorski/srpski glas ako
  // postoji instaliran na ovom računaru, isti fallback kao operativni
  // ekran ako ne postoji).
  const speakLocally = useCallback((value: string) => {
    const synth = window.speechSynthesis
    if (!synth || !value.trim()) return
    synth.cancel() // prekini bilo koji prethodni lokalni pregled u toku
    const utterance = new SpeechSynthesisUtterance(value)
    const voice = lang === "en" ? enVoiceRef.current : (localVoiceRef.current ?? enVoiceRef.current)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || (lang === "en" ? "en-US" : "hr-HR")
    utterance.rate = 0.92
    synth.speak(utterance)
  }, [lang])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed) return

    setSending(true)
    setResult(null)

    // FIX (po zahtjevu — "prije/dok šalje"): lokalni pregled se pušta
    // ISTOVREMENO sa slanjem na terminal, ne poslije — admin ne čeka
    // network round-trip da bi čuo kako najava zvuči.
    if (localPreviewEnabled) {
      speakLocally(trimmed)
    }

    try {
      const res = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        setResult({ ok: true, message: "Najava poslata." })
        setText("")
      } else {
        setResult({ ok: false, message: data?.error || "Slanje nije uspjelo." })
      }
    } catch {
      setResult({ ok: false, message: "Mrežna greška — provjeri konekciju." })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-sky-500/20 rounded-2xl">
              <Radio className="w-8 h-8 text-sky-400" />
            </div>
            <div>
              <h1 className="text-2xl font-black">Razglas — nova najava</h1>
              <p className="text-slate-400 text-sm">
                Tekst se izgovara na ekranu u operativnom centru.
              </p>
            </div>
          </div>

          {/* Jezik šablona */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl p-1">
            <Languages className="w-4 h-4 text-slate-500 ml-2" />
            <button
              onClick={() => setLang("en")}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                lang === "en" ? "bg-sky-500 text-white" : "text-slate-400 hover:text-white"
              }`}
              type="button"
            >
              English
            </button>
            <button
              onClick={() => setLang("local")}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                lang === "local" ? "bg-sky-500 text-white" : "text-slate-400 hover:text-white"
              }`}
              type="button"
            >
              CG / SR
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => setText(lang === "en" ? t.en : t.local)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors"
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          placeholder={lang === "en" ? "Upiši tekst najave na engleskom..." : "Upiši tekst najave na crnogorskom/srpskom..."}
          rows={5}
          className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-lg focus:outline-none focus:border-sky-500 resize-none"
        />

        <div className="flex items-center justify-between mt-2 mb-4">
          <span className="text-sm text-slate-500">{text.length} / {MAX_LEN}</span>
        </div>

        {/* Lokalni pregled — toggle */}
        <button
          onClick={() => setLocalPreviewEnabled((v) => !v)}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 mb-4 rounded-xl text-sm font-semibold border transition-colors ${
            localPreviewEnabled
              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
              : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white"
          }`}
          type="button"
        >
          {localPreviewEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          Lokalni pregled {localPreviewEnabled ? "uključen" : "isključen"}
          <span className="text-xs font-normal opacity-70">
            — {localPreviewEnabled ? "čućeš najavu na ovom uređaju dok šalješ" : "samo šalje na terminal, bez zvuka ovdje"}
          </span>
        </button>

        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-2xl text-lg font-bold transition-colors"
          type="button"
        >
          <Send className="w-5 h-5" />
          {sending ? "Šalje se..." : "Objavi najavu"}
        </button>

        {result && (
          <div className={`mt-4 flex items-center gap-2 p-4 rounded-xl ${
            result.ok ? "bg-emerald-950/50 text-emerald-400" : "bg-red-950/50 text-red-400"
          }`}>
            {result.ok ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span>{result.message}</span>
          </div>
        )}

        <p className="text-slate-500 text-xs mt-8">
          Napomena: ekran u operativnom centru (/pa) mora biti otvoren i
          aktiviran (jedan klik nakon pokretanja) da bi najava bila
          izgovorena na pojačalu. &quot;Lokalni pregled&quot; iznad je
          NEZAVISAN od toga — pušta se odmah na OVOM uređaju, bez obzira
          na stanje terminala.
        </p>
      </div>
    </div>
  )
}
