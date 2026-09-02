import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

const HISTORY_TTL = 24 * 60 * 60; // 24h
const MAX_ENTRIES = 50;

export interface DeskHistoryEntry {
  ts: string;          // ISO timestamp
  event: 'force-open' | 'force-close+done' | 'done-next' | 'reset-auto';
  flightNumber: string | null;
  desk: string;
}

export async function GET(
  _req: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const client = getRedisClient();
    const key = `desk-history:${params.deskNumber}`;
    const raw = await client.get(key);
    const entries: DeskHistoryEntry[] = raw ? JSON.parse(raw) : [];
    return NextResponse.json(entries, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const client = getRedisClient();
    const key = `desk-history:${params.deskNumber}`;
    const body = await req.json() as Omit<DeskHistoryEntry, 'desk'>;

    const raw = await client.get(key);
    const entries: DeskHistoryEntry[] = raw ? JSON.parse(raw) : [];

    // Prepend novi entry, max 50
    entries.unshift({ ...body, desk: params.deskNumber });
    if (entries.length > MAX_ENTRIES) entries.splice(MAX_ENTRIES);

    await client.setex(key, HISTORY_TTL, JSON.stringify(entries));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}