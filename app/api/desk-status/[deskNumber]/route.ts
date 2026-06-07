// app/api/desk-status/[deskNumber]/route.ts
//
// IZMJENA: Dodat POST handler koji upisuje { status, flightNumber, setAt } u Redis.
// GET ostaje nepromijenjen — već parsira JSON i vraća flightNumber.

import { NextResponse } from 'next/server';
import { getRedisClient, safeRedisSet, safeRedisDel } from '@/lib/redis';
// getRedisClient ostaje jer ga GET koristi direktno

const TTL_SECONDS = 8 * 60 * 60; // 8h — auto-expire, safety net

export async function GET(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const { deskNumber } = params;
    const client = getRedisClient();
    const redisKey = `desk-status:${deskNumber}`;

    const value = await client.get(redisKey);

    if (!value) {
      return NextResponse.json({ status: null });
    }

    // Pokušaj parsirati JSON (novi format)
    try {
      const data = JSON.parse(value);
      return NextResponse.json({
        status: data.status,
        flightNumber: data.flightNumber ?? null,
        setAt: data.setAt,
      });
    } catch {
      // Stari format (samo string "open" / "closed")
      return NextResponse.json({ status: value, flightNumber: null });
    }
  } catch (error) {
    console.error('[desk-status GET] Redis error:', error);
    return NextResponse.json({ status: null, flightNumber: null });
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Body: { status: 'open' | 'closed' | null; flightNumber?: string | null }
//
// Primjeri poziva:
//   { status: 'open',   flightNumber: 'BA456' }  → otvori šalter za konkretan let (early-open)
//   { status: 'open',   flightNumber: null    }  → otvori šalter bez specific leta (staro ponašanje)
//   { status: 'closed'                        }  → zatvori šalter
//   { status: null                            }  → briši override (vrati na auto)
export async function POST(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const { deskNumber } = params;
    const client = getRedisClient();
    const redisKey = `desk-status:${deskNumber}`;

    const body = await request.json();
    const { status, flightNumber = null } = body as {
      status: 'open' | 'closed' | null;
      flightNumber?: string | null;
    };

    // null status = clear override
// null status = clear override
    if (status === null) {
      await safeRedisDel(redisKey);
      return NextResponse.json({ ok: true, action: 'cleared' });
    }
    if (status !== 'open' && status !== 'closed') {
      return NextResponse.json({ error: 'status must be open, closed, or null' }, { status: 400 });
    }

const payload = JSON.stringify({
  status,
  flightNumber: flightNumber ?? null,
  setAt: new Date().toISOString(),
});

await safeRedisSet(redisKey, payload, TTL_SECONDS);

    return NextResponse.json({
      ok: true,
      action: status,
      flightNumber: flightNumber ?? null,
    });
  } catch (error) {
    console.error('[desk-status POST] Redis error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}