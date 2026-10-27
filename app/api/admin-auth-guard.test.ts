import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Svaki exportovan handler u ovim rutama MORA pozvati requireAdmin() prije ikakvog rada.
const GUARDED: Record<string, string[]> = {
  'test/desk-status-override/route.ts': ['POST'],
  'test/gate-status-override/route.ts': ['POST'],
  'test/stats/route.ts': ['GET', 'POST'],
  'admin/airlines/route.ts': ['GET', 'POST'],
  'admin/airlines/[iataCode]/route.ts': ['GET', 'PUT', 'DELETE'],
  'admin/destinations/route.ts': ['GET', 'POST'],
  'admin/destinations/[destinationCode]/[airlineIata]/route.ts': ['GET', 'PUT', 'DELETE'],
  'admin/specific-flights/route.ts': ['GET', 'POST', 'PUT', 'DELETE'],
  'admin/specific-flights/[flightNumber]/route.ts': ['GET', 'PUT', 'DELETE'],
  'admin/init/route.ts': ['POST'],
  'admin/stats/route.ts': ['GET'],
  'admin/health/route.ts': ['GET'],
  'admin/kiosk-command/route.ts': ['POST', 'DELETE'],
  'admin/history/route.ts': ['GET'],
  'admin/history/pdf/route.ts': ['GET'],
  'admin/overview/route.ts': ['GET'],
  'admin/events/route.ts': ['GET', 'POST'],
};

describe('admin/assignment rute traže admin sesiju (statička provjera)', () => {
  for (const [file, methods] of Object.entries(GUARDED)) {
    for (const m of methods) {
      it(`${file} ${m}`, () => {
        const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
        const start = src.search(new RegExp(`export async function ${m}\\s*\\(`));
        expect(start, 'handler postoji').toBeGreaterThanOrEqual(0);
        const bodyOpen = src.indexOf('{', src.indexOf(')', start));
        expect(src.slice(bodyOpen, bodyOpen + 200)).toContain('await requireAdmin(');
      });
    }
  }
});

const requireAdmin = vi.fn();
const dbSelect = vi.fn();
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
vi.mock('@/lib/db', () => ({ db: { select: (...a: unknown[]) => dbSelect(...a) } }));
vi.mock('@/lib/db/schema', () => ({ airlinesTable: {} }));

describe('runtime: admin/airlines GET', () => {
  beforeEach(() => { requireAdmin.mockReset(); dbSelect.mockReset(); });

  it('bez sesije → 401 i baza se ne dira', async () => {
    const { NextResponse } = await import('next/server');
    requireAdmin.mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    const { GET } = await import('./admin/airlines/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it('sa sesijom → prolazi do baze', async () => {
    requireAdmin.mockResolvedValue({ session: { username: 'a' }, error: null });
    dbSelect.mockReturnValue({ from: () => Promise.resolve([{ iataCode: 'JU' }]) });
    const { GET } = await import('./admin/airlines/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(dbSelect).toHaveBeenCalled();
  });
});
