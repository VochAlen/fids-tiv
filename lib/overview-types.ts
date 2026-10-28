// lib/overview-types.ts — tipovi za /api/admin/overview i /admin/overview (samo tipovi).
import type { KioskInfo } from '@/lib/kiosk-health';
import type { StaleReason } from '@/lib/stale-assignments';

export interface OverviewResource {
  status: 'open' | 'closed';
  flight: string;
  /** Minuta od zadnje promjene (otvaranja/zatvaranja). */
  sinceMin: number;
  /** Dodjela izgleda zaboravljena: let je poletio ili je otvoreno predugo. */
  stale?: StaleReason;
}

export interface OverviewResponse {
  checkedAt: string;
  night: boolean;
  /** false = stanje dodjela nije moglo biti pročitano (Redis) — prikaz je nepotpun. */
  ok: boolean;
  desks: Record<string, OverviewResource>;
  gates: Record<string, OverviewResource>;
  kiosks: KioskInfo[];
}
