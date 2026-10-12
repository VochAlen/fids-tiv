// lib/assignment-sync.sim.test.ts
//
// SIMULACIJA sinhronizacije kiosk ↔ server (2026-10-12). Prijavljeni bugovi tipa "šalter ostane
// inactive iako je otvoren" nastaju iz PREPLITANJA događaja (Ably poruka vs. zakasnjeli REST
// snapshot, izgubljene/duplirane/zakasnjele poruke), što običan unit test jednog poziva ne hvata.
// Ovdje se nasumično generišu stotine takvih preplitanja i provjerava jedno svojstvo:
//
//   EVENTUAL CONSISTENCY — kad se nakon BILO KAKVE istorije dogodi jedan običan snapshot, ekran
//   mora pokazivati TAČNO ono što server ima (otvoren ↔ aktivan, zatvoren/prazan ↔ inactive).
//
// Model koristi ISTE funkcije kao hook (mergeNewer / mergeOne / protectedKeysSince).

import { describe, it, expect } from 'vitest';
import { mergeNewer, mergeOne, protectedKeysSince, type AssignmentEntry } from './assignment-merge';

function rng(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

type Map_ = Record<string, AssignmentEntry>;
const KEYS = ['1', '2', '3'];
const norm = (e?: AssignmentEntry) => (e && e.status === 'open' ? `open:${e.flightNumber}` : 'inactive');

interface Pending { kind: 'ably' | 'snap'; key?: string; entry?: AssignmentEntry; snap?: Map_; startedAt?: number; due: number }

function simulate(seed: number, opts: { lossRate: number; withProtection: boolean }) {
  const r = rng(seed);
  let t = 0;                       // logički sat
  let seq = 0;                     // globalni server brojač (kao Redis INCR)
  const server: Map_ = {};         // stvarno stanje (ključ nedostaje = prazno)
  let client: Map_ = {};
  const touched = new Map<string, number>();
  const pending: Pending[] = [];

  const serverAct = () => {
    const key = KEYS[Math.floor(r() * KEYS.length)];
    const roll = r();
    seq += 1;
    let entry: AssignmentEntry;
    if (roll < 0.5) {
      entry = { status: 'open', flightNumber: `FL${Math.floor(r() * 5)}`, classType: null, setAt: t, seq };
      server[key] = entry;
    } else if (roll < 0.8) {
      entry = { status: 'closed', flightNumber: '', classType: null, setAt: t, seq };
      server[key] = entry;
    } else {
      entry = { status: null, flightNumber: '', classType: null, setAt: t, seq };
      delete server[key]; // obrisano (cleanup) — ključ nestaje, ali se objavljuje poruka
    }
    // Ably: može se izgubiti, zakasniti, ili stići dvaput
    if (r() >= opts.lossRate) pending.push({ kind: 'ably', key, entry, due: t + Math.floor(r() * 6) });
    if (r() < 0.1) pending.push({ kind: 'ably', key, entry, due: t + 2 + Math.floor(r() * 10) });
  };

  const startSnapshot = () => {
    // Kao u hooku (inFlightRef): dok je jedan snapshot u letu, drugi se ne pokreće — snapshot-i
    // zato uvijek stižu redom kojim su krenuli.
    if (pending.some(p => p.kind === 'snap')) return;
    // serverski snapshot se čita SADA, ali stiže tek poslije kašnjenja mreže
    pending.push({ kind: 'snap', snap: structuredClone(server), startedAt: t, due: t + 1 + Math.floor(r() * 8) });
  };

  const deliver = (p: Pending) => {
    if (p.kind === 'ably') {
      touched.set(p.key!, t);
      client = mergeOne(client, p.key!, p.entry!);
    } else {
      const prot = opts.withProtection ? protectedKeysSince(touched, p.startedAt!) : undefined;
      client = mergeNewer(client, p.snap!, prot);
    }
  };

  const steps = 40 + Math.floor(r() * 60);
  for (let i = 0; i < steps; i++) {
    t += 1;
    const roll = r();
    if (roll < 0.35) serverAct();
    else if (roll < 0.6) startSnapshot();
    // isporuka svega što je dospjelo (redoslijed po due, pa po redu nastanka)
    const due = pending.filter(p => p.due <= t).sort((a, b) => a.due - b.due);
    for (const p of due) { deliver(p); pending.splice(pending.indexOf(p), 1); }
  }
  // sve što je još u letu stiže (proizvoljnim redom po due)
  for (const p of [...pending].sort((a, b) => a.due - b.due)) deliver(p);

  // jedan običan, trenutan snapshot (bez preplitanja) — tipično sljedeći poll/reconcile
  t += 1;
  deliver({ kind: 'snap', snap: structuredClone(server), startedAt: t, due: t });

  return KEYS.filter(k => norm(client[k]) !== norm(server[k]))
    .map(k => `seed ${seed} key ${k}: klijent=${norm(client[k])} server=${norm(server[k])}`);
}

describe('sinhronizacija: eventual consistency pod preplitanjem događaja', () => {
  it('SA zaštitom: 3000 nasumičnih preplitanja (uz gubitak 30% Ably poruka) — ekran uvijek završi tačno', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 3000; seed++) bad.push(...simulate(seed, { lossRate: 0.3, withProtection: true }));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('SA zaštitom, bez gubitka poruka', () => {
    const bad: string[] = [];
    for (let seed = 5000; seed < 7000; seed++) bad.push(...simulate(seed, { lossRate: 0, withProtection: true }));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('BEZ zaštite simulacija pronalazi zaglavljen ekran (dokaz da test hvata prijavljeni bug)', () => {
    let stuck = 0;
    for (let seed = 1; seed <= 3000; seed++) if (simulate(seed, { lossRate: 0.3, withProtection: false }).length) stuck++;
    expect(stuck).toBeGreaterThan(0);
  });
});
