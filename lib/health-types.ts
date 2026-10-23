// lib/health-types.ts
//
// Zajednički tipovi za /api/admin/health (server) i /admin/health (stranica).
// Samo tipovi — bez ikakve logike, pa ništa ne ulazi u klijentski bundle.

export type HealthSeverity = 'error' | 'warn' | 'info';

export interface HealthIssue {
  severity: HealthSeverity;
  title: string;
  hint?: string;
}

export interface StaleAssignment {
  type: 'desk' | 'gate';
  resourceId: string;
  flightNumber: string;
  openSinceMinutesAgo: number;
}

export interface OpenAssignment extends StaleAssignment {
  stale: boolean;
}

export interface RedisCheck {
  ok: boolean;
  circuitOpen: boolean;
  recentFailures: number;
  latencyMs: number | null;
  /** Dopunski podaci iz INFO (null ako Redis ne dozvoljava INFO). */
  version: string | null;
  uptimeSec: number | null;
  usedMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  connectedClients: number | null;
  keys: number | null;
  hitRate: number | null;
  evictedKeys: number | null;
}

export interface AblyCheck {
  /** false = ključ nije postavljen ili poziv nije uspio. */
  ok: boolean;
  configured: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface FlightDataCheck {
  ok: boolean;
  source: string;
  isOfflineMode: boolean;
  lastUpdated: string | null;
  /** Starost podataka u minutama (null ako nije poznata). */
  ageMinutes: number | null;
  totalFlights: number;
  departures: number;
  arrivals: number;
  warning: string | null;
}

export interface AssignmentsCheck {
  openDesks: number;
  openGates: number;
  staleAssignments: StaleAssignment[];
  open: OpenAssignment[];
}

export interface LearningKindSummary {
  hitRate: number | null;
  evaluated: number;
  applied: number;
  bySource: Array<{ source: string; rate: number | null; n: number }>;
  /** true = naučeni bazeni su privremeno isključeni zbog slabe tačnosti (lib/learning-gate.ts). */
  distrust: boolean;
}

export interface LearningCheck {
  counterFields: number;
  exampleCount: number;
  desk: LearningKindSummary;
  gate: LearningKindSummary;
}

export interface SystemInfo {
  nodeVersion: string;
  region: string | null;
  environment: string | null;
  commit: string | null;
  commitMessage: string | null;
  uptimeSec: number;
  memoryMb: number;
  airportTime: string;
  isNight: boolean;
  /** Identifikator deploya (lib/build-id.ts). */
  build: string;
}

import type { KioskInfo } from '@/lib/kiosk-health';
export type { KioskInfo };

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  checkedAt: string;
  durationMs: number;
  issues: HealthIssue[];
  checks: {
    redis: RedisCheck;
    ably: AblyCheck;
    flightData: FlightDataCheck;
    assignments: AssignmentsCheck;
    learning: LearningCheck | null;
    kiosks: KioskInfo[];
  };
  system: SystemInfo;
}
