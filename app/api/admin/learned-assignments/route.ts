// app/api/admin/learned-assignments/route.ts
//
// NOVO (2026-10-08): vraća sve naučene brojače dodjela (jedan Redis HGETALL).
// Poziva ga SAMO admin stranica assign-checkin, jednom pri otvaranju.
// Pregled i parsiranje radi klijent (lib/assignment-learning.ts → parseLearned).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { safeRedisHGetAll } from '@/lib/redis';
import { LEARN_HASH_KEY } from '@/lib/assignment-learning';
import { EXAMPLES_HASH_KEY } from '@/lib/assignment-model';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  // Brojači + primjeri za model: dva HGETALL-a u istom zahtjevu (jednom pri otvaranju stranice).
  const [raw, examples] = await Promise.all([
    safeRedisHGetAll(LEARN_HASH_KEY),
    safeRedisHGetAll(EXAMPLES_HASH_KEY),
  ]);
  return NextResponse.json({ data: raw ?? {}, examples: examples ?? {} }, { headers: { 'Cache-Control': 'private, no-store' } });
}
