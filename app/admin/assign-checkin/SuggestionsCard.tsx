// app/admin/assign-checkin/SuggestionsCard.tsx
//
// NOVO (2026-10-07): "AI sugestija" card za assign-checkin stranicu (faza 1).
// Čisto prikazna komponenta — algoritam je u lib/assignment-suggestions.ts,
// primjena dodjela (assignFlightToResource) ostaje u page.tsx. Prijedlog se
// NIKAD ne primjenjuje sam: svaki red ima svoje dugme "Primijeni", plus
// "Primijeni sve na redu" (uz potvrdu).
'use client';

import { memo, useMemo, useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, AlertTriangle, Check, X } from 'lucide-react';
import { formatClockMinutes, type Suggestion } from '@/lib/assignment-suggestions';
import type { AccuracySummary, AccuracySource } from '@/lib/assignment-learning';
const NOTE_MAX_CHARS = 400;

/** Koliko unaprijed (min) prijedlog smatramo "uskoro na redu". */
const SOON_MIN = 15;
/** Zadano prikazujemo samo prijedloge koji se otvaraju u narednih toliko minuta. */
const DEFAULT_HORIZON_MIN = 180;

interface Props {
  type: 'desk' | 'gate';
  suggestions: Suggestion[];
  nowMin: number | null;
  isDark: boolean;
  /** Ključ prijedloga koji se trenutno primjenjuje (`${type}:${flightNumber}`) ili null. */
  applyingKey: string | null;
  onApply: (s: Suggestion) => void;
  onApplyDue: (list: Suggestion[]) => void;
  /** Tačnost prijedloga (zadnje sedmice) za ovaj tip, ili null dok se ne učita. */
  accuracy: AccuracySummary | null;
  /** Pročitana ograničenja iz napomena (čipovi) + dijelovi teksta koji nisu pretvoreni. */
  chips: Array<{ key: string; text: string }>;
  unparsed: string[];
  noteError: string | null;
  onSubmitNote: (text: string) => void;
  onClearConstraints: () => void;
}

const SOURCE_LABEL: Record<AccuracySource, string> = {
  learned: 'naučeno', profile: 'profil', default: 'opšti raspored', note: 'napomena', none: 'bez prijedloga',
};

function SuggestionsCardImpl({
  type, suggestions, nowMin, isDark, applyingKey, onApply, onApplyDue,
  accuracy, chips, unparsed, noteError, onSubmitNote, onClearConstraints,
}: Props) {
  const [note, setNote] = useState('');
  // Zatvoren po zadanom — korisnik ga otvara klikom (po zahtjevu).
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(
    () => [...suggestions].sort((a, b) => a.openAt - b.openAt),
    [suggestions],
  );

  const visible = useMemo(() => {
    if (showAll || nowMin === null) return sorted;
    return sorted.filter(s => s.openAt <= nowMin + DEFAULT_HORIZON_MIN);
  }, [sorted, showAll, nowMin]);

  const due = useMemo(
    () => (nowMin === null ? [] : sorted.filter(s => s.resources.length > 0 && s.openAt <= nowMin)),
    [sorted, nowMin],
  );

  const accent = type === 'desk' ? 'text-sky-400' : 'text-emerald-400';
  const label = type === 'desk' ? 'šaltera' : 'gate-ova';
  const busy = applyingKey !== null;

  return (
    <div className={`mb-5 rounded-2xl border ${isDark ? 'bg-violet-500/5 border-violet-400/25' : 'bg-violet-50 border-violet-200'}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Sparkles size={18} className={isDark ? 'text-violet-300' : 'text-violet-600'} />
          <span className={`font-bold text-sm ${isDark ? 'text-violet-200' : 'text-violet-800'}`}>AI sugestija</span>
          <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
            prijedlog {label} ({sorted.length})
          </span>
          {due.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500">
              {due.length} na redu
            </span>
          )}
        </span>
        {open ? <ChevronUp size={16} className="opacity-50" /> : <ChevronDown size={16} className="opacity-50" />}
      </button>

      {open && (
        <div className="px-4 pb-4">
          <p className={`text-xs mb-3 ${isDark ? 'text-white/35' : 'text-gray-500'}`}>
            Prijedlog se računa iz navika kompanija, vremena otvaranja i trenutnih dodjela. Ništa se ne
            primjenjuje samo — potvrđuješ ti. Postojeće dodjele se ne mijenjaju.
          </p>

          {/* Napomena osoblja → ograničenja (jedan AI poziv po kliku) */}
          <div className="mb-3">
            <div className="flex gap-2">
              <input
                value={note}
                maxLength={NOTE_MAX_CHARS}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { onSubmitNote(note); setNote(''); } }}
                placeholder='Napomena, npr. "šalter 12 ne radi do 14:00"'
                className={`flex-1 min-w-0 px-3 py-2 rounded-xl text-xs border outline-none ${
                  isDark ? 'bg-white/5 border-white/15 text-white placeholder:text-white/30' : 'bg-white border-gray-300 text-gray-800'
                }`}
              />
              <button
                type="button"
                disabled={!note.trim()}
                onClick={() => { onSubmitNote(note); setNote(''); }}
                className="px-3 py-2 rounded-xl border border-violet-400/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 text-xs font-semibold disabled:opacity-40 transition-all active:scale-95"
              >
                Primijeni napomenu
              </button>
            </div>
            {noteError && <div className="text-[11px] mt-1.5 text-amber-500">{noteError}</div>}
            {(chips.length > 0 || unparsed.length > 0) && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                {chips.map(c => (
                  <span key={c.key} className={`px-2 py-0.5 rounded-full text-[11px] border ${
                    isDark ? 'bg-violet-500/15 border-violet-400/30 text-violet-200' : 'bg-violet-100 border-violet-300 text-violet-800'
                  }`}>{c.text}</span>
                ))}
                {unparsed.map(u => (
                  <span key={u} className="px-2 py-0.5 rounded-full text-[11px] border border-amber-400/40 text-amber-500" title="Nije pretvoreno u pravilo">
                    ? {u}
                  </span>
                ))}
                <button type="button" onClick={onClearConstraints} className={`flex items-center gap-1 text-[11px] ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                  <X size={12} /> poništi napomene
                </button>
              </div>
            )}
            <p className={`text-[10px] mt-1 ${isDark ? 'text-white/25' : 'text-gray-400'}`}>
              Napomene važe dok ne osvježiš stranicu. Primjeri: „šalter 12 ne radi do 14:00“, „gate 5 u kvaru“, „LY1234 na 10 i 11“, „LY1234 2 šaltera“.
            </p>
          </div>

          {due.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onApplyDue(due)}
              className="mb-3 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-semibold transition-all active:scale-95"
            >
              <Check size={14} /> Primijeni sve na redu ({due.length})
            </button>
          )}

          {visible.length === 0 ? (
            <div className={`text-center py-6 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
              Nema prijedloga — svi letovi imaju dodjelu ili se još ne otvaraju.
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map(s => {
                const key = `${s.type}:${s.flightNumber}`;
                const isDue = nowMin !== null && s.openAt <= nowMin;
                const isSoon = nowMin !== null && !isDue && s.openAt <= nowMin + SOON_MIN;
                const applying = applyingKey === key;
                return (
                  <div
                    key={key}
                    className={`rounded-xl border px-3 py-2.5 ${
                      isDue
                        ? isDark ? 'bg-amber-500/10 border-amber-400/40' : 'bg-amber-50 border-amber-300'
                        : isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold">{s.flightNumber}</span>
                          <span className={`text-sm truncate ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                            → {s.destination || '—'}
                          </span>
                          <span className={`text-xs ${isDark ? 'text-white/35' : 'text-gray-400'}`}>
                            polazak {s.std}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1.5">
                          {s.resources.length > 0 ? (
                            s.resources.map(id => (
                              <span
                                key={id}
                                className={`px-2.5 py-0.5 rounded-lg text-sm font-bold border ${
                                  isDark ? 'bg-white/10 border-white/15' : 'bg-gray-100 border-gray-200'
                                } ${accent}`}
                              >
                                {id}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-amber-500 font-semibold">bez slobodnog resursa</span>
                          )}
                          <span className={`text-xs ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                            otvori {formatClockMinutes(s.openAt)} · zatvori {formatClockMinutes(s.closeAt)}
                          </span>
                          {isDue && <span className="text-xs font-bold text-amber-500">sada</span>}
                          {isSoon && <span className="text-xs font-semibold text-violet-400">uskoro</span>}
                        </div>
                        <div className={`text-[11px] mt-1 ${isDark ? 'text-white/30' : 'text-gray-400'}`}>{s.reason}</div>
                        {s.warnings.map(w => (
                          <div key={w} className="flex items-start gap-1 text-[11px] mt-1 text-amber-500">
                            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> <span>{w}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={busy || s.resources.length === 0}
                        onClick={() => onApply(s)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-400/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 text-xs font-semibold disabled:opacity-40 transition-all active:scale-95"
                      >
                        {applying ? 'Primjenjujem…' : 'Primijeni'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {accuracy && (
            <div className={`mt-4 pt-3 border-t text-[11px] ${isDark ? 'border-white/10 text-white/40' : 'border-gray-200 text-gray-500'}`}>
              {accuracy.evaluated > 0 ? (
                <>
                  Tačnost zadnje 4 sedmice: prijedlog je pogodio{' '}
                  <b>{Math.round((accuracy.hitRate ?? 0) * 100)}%</b> od {accuracy.evaluated} ručnih dodjela
                  {accuracy.total.none > 0 && <> · {accuracy.total.none} bez prijedloga</>}
                  {accuracy.total.applied > 0 && <> · {accuracy.total.applied} primijenjeno</>}
                  <div className="mt-0.5">
                    {(Object.entries(accuracy.bySource) as Array<[AccuracySource, NonNullable<AccuracySummary['bySource'][AccuracySource]>]>)
                      .filter(([src, b]) => src !== 'none' && b.hit + b.miss > 0)
                      .map(([src, b]) => `${SOURCE_LABEL[src]}: ${Math.round((b.hit / (b.hit + b.miss)) * 100)}% (${b.hit + b.miss})`)
                      .join(' · ')}
                  </div>
                </>
              ) : (
                <>Tačnost: još nema ručnih dodjela sa prijedlogom u zadnje 4 sedmice.</>
              )}
            </div>
          )}

          {sorted.length > visible.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className={`mt-3 text-xs font-semibold ${isDark ? 'text-violet-300' : 'text-violet-700'}`}
            >
              Prikaži sve ({sorted.length})
            </button>
          )}
          {showAll && sorted.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className={`mt-3 ml-3 text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}
            >
              Prikaži samo narednih 3 h
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const SuggestionsCard = memo(SuggestionsCardImpl);
