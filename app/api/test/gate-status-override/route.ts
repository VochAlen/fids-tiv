// app/api/test/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 sati
const TTL_SECONDS = 21_600;            // 6h
const ALL_KEY = 'test:gate-status:all';

// ── KEŠ SA "STALE-WHILE-REVALIDATE" ──────────────────────
let cachedAll: Record<string, GateEntry> | null = null;
let cachedAllExpiry = 0;
let cacheRefreshing = false; // ← NOVO: sprečava duple refresh-e
const CACHE_TTL_MS = 10_000; // 10s

type GateEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
};

async function readAll(): Promise<Record<string, GateEntry>> {
  const client = getRedisClient();
  const raw = await client.get(ALL_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, GateEntry>): Promise<void> {
  const client = getRedisClient();
  await client.set(ALL_KEY, JSON.stringify(data), 'EX', TTL_SECONDS);
}

// ── NOVA: readAllCached sa zaštitom od duplih refresh-ova ──
async function readAllCached(): Promise<Record<string, GateEntry>> {
  const now = Date.now();
  
  // 1. Ako keš važi → vrati ga odmah
  if (cachedAll && now < cachedAllExpiry) {
    return cachedAll;
  }
  
  // 2. Ako keš ne važi, ali se već osvežava → vrati staru verziju (stale)
  if (cacheRefreshing && cachedAll) {
    return cachedAll;
  }
  
  // 3. Osveži keš (samo jedan zahtev će ući ovde)
  cacheRefreshing = true;
  try {
    const fresh = await readAll();
    cachedAll = fresh;
    cachedAllExpiry = now + CACHE_TTL_MS;
    return fresh;
  } finally {
    cacheRefreshing = false;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gateNumber = searchParams.get('gateNumber');
  const now = Date.now();

  const all = await readAllCached();

  // Očisti stare zapise u memoriji
  let changed = false;
  let cleanedCount = 0;
  for (const key of Object.keys(all)) {
    const entry = all[key];
    if (entry.setAt && now - entry.setAt > MAX_AGE_MS) {
      delete all[key];
      changed = true;
      cleanedCount++;
    }
  }
  if (changed) {
    await writeAll(all);
    // Ažuriraj keš nakon čišćenja
    cachedAll = all;
    cachedAllExpiry = now + CACHE_TTL_MS;
    console.log(`[gate-cleanup] Total cleaned: ${cleanedCount} old gate-status keys`);
  }

  if (gateNumber) {
    const entry = all[gateNumber] ?? { status: null, flightNumber: null, classType: null, setAt: null };
    return NextResponse.json(entry, { 
      headers: { 
        'Cache-Control': 'no-store',
        'X-Cache': cacheRefreshing ? 'stale' : 'fresh',
      } 
    });
  }

  return NextResponse.json(all, {
    headers: { 
      'Cache-Control': 'public, s-maxage=25, stale-while-revalidate=30',
      'X-Cache': cacheRefreshing ? 'stale' : 'fresh',
    },
  });
}

export async function POST(request: Request) {
  const { gateNumber, action, flightNumber, classType } = await request.json();

  if (!gateNumber) {
    return NextResponse.json({ error: 'gateNumber required' }, { status: 400 });
  }

  const all = await readAll();
  const existing = all[gateNumber];

  if (action === 'open' && flightNumber) {
    all[gateNumber] = {
      status: 'open',
      flightNumber,
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
  } else if (action === 'closed') {
    all[gateNumber] = {
      status: 'closed',
      flightNumber: flightNumber || '',
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
  } else if (action === 'clear') {
    delete all[gateNumber];
  } else if (action === 'setClass') {
    if (!existing) {
      return NextResponse.json({ error: 'No active assignment' }, { status: 400 });
    }
    all[gateNumber] = { ...existing, classType: classType ?? null };
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  await writeAll(all);
  
  // Invalida keš nakon pisanja
  cachedAll = all;
  cachedAllExpiry = Date.now() + CACHE_TTL_MS;
  
  const ttl = action === 'clear' ? undefined : TTL_SECONDS;
  return NextResponse.json({ success: true, ...(ttl ? { ttl } : {}) });
}