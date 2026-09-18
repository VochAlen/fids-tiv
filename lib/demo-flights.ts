// lib/demo-flights.ts
//
// STATIČNI, IZMIŠLJENI podaci o letovima — koriste ih ISKLJUČIVO
// /demo/* stranice (vidi opširan kontekst u app/demo/*/page.tsx).
// Namjerno: (1) izmišljene avio kompanije ("Demo Air", "Test Airways"
// — NE prave kompanije, da se izbjegne bilo kakva zabuna ili
// nenamjerno predstavljanje stvarne kompanije), (2) izmišljeni brojevi
// leta (DM/TS prefiksi koji ne postoje u pravom sistemu), (3) stvarni
// gradovi (radi realističnog izgleda) — u kombinaciji sa upadljivim
// trojezičnim upozorenjem na svakoj stranici, nema rizika od zabune.
export interface DemoFlight {
  flightNumber: string;
  airline: string;
  city: string;
  scheduled: string;
  estimated: string;
  gate: string;
  status: string;
  statusTone: 'normal' | 'boarding' | 'delayed' | 'cancelled' | 'final';
}

export const DEMO_DEPARTURES: DemoFlight[] = [
  { flightNumber: 'DM101', airline: 'Demo Air',      city: 'Beograd',    scheduled: '08:15', estimated: '08:15', gate: '2',  status: 'Boarding',    statusTone: 'boarding' },
  { flightNumber: 'TS204', airline: 'Test Airways',  city: 'London',     scheduled: '09:40', estimated: '09:55', gate: '4',  status: 'Delayed',     statusTone: 'delayed' },
  { flightNumber: 'DM315', airline: 'Demo Air',      city: 'Beč',        scheduled: '10:05', estimated: '10:05', gate: '1',  status: 'Final Call',  statusTone: 'final' },
  { flightNumber: 'SP450', airline: 'Sample Wings',  city: 'Milano',     scheduled: '11:20', estimated: '11:20', gate: '3',  status: 'Scheduled',   statusTone: 'normal' },
  { flightNumber: 'TS512', airline: 'Test Airways',  city: 'Frankfurt',  scheduled: '12:50', estimated: '12:50', gate: '5',  status: 'Scheduled',   statusTone: 'normal' },
  { flightNumber: 'DM627', airline: 'Demo Air',      city: 'Rim',        scheduled: '14:10', estimated: '14:10', gate: '2',  status: 'Scheduled',   statusTone: 'normal' },
  { flightNumber: 'SP731', airline: 'Sample Wings',  city: 'Istanbul',   scheduled: '15:35', estimated: '15:35', gate: '—',  status: 'Cancelled',   statusTone: 'cancelled' },
  { flightNumber: 'DM842', airline: 'Demo Air',      city: 'Cirih',      scheduled: '17:00', estimated: '17:00', gate: '4',  status: 'Scheduled',   statusTone: 'normal' },
];

export const DEMO_ARRIVALS: DemoFlight[] = [
  { flightNumber: 'TS118', airline: 'Test Airways',  city: 'Beograd',    scheduled: '07:50', estimated: '07:50', gate: '—',  status: 'Landed',      statusTone: 'normal' },
  { flightNumber: 'DM222', airline: 'Demo Air',      city: 'Moskva',     scheduled: '09:10', estimated: '09:25', gate: '—',  status: 'Delayed',     statusTone: 'delayed' },
  { flightNumber: 'SP336', airline: 'Sample Wings',  city: 'Pariz',      scheduled: '10:45', estimated: '10:45', gate: '—',  status: 'Landed',      statusTone: 'normal' },
  { flightNumber: 'DM447', airline: 'Demo Air',      city: 'Amsterdam',  scheduled: '12:00', estimated: '12:00', gate: '—',  status: 'Scheduled',   statusTone: 'normal' },
  { flightNumber: 'TS559', airline: 'Test Airways',  city: 'Berlin',     scheduled: '13:30', estimated: '13:30', gate: '—',  status: 'Scheduled',   statusTone: 'normal' },
  { flightNumber: 'SP664', airline: 'Sample Wings',  city: 'Madrid',     scheduled: '15:15', estimated: '15:15', gate: '—',  status: 'Scheduled',   statusTone: 'normal' },
];

export function statusToneClasses(tone: DemoFlight['statusTone']): string {
  switch (tone) {
    case 'boarding':  return 'text-cyan-400';
    case 'delayed':   return 'text-red-400';
    case 'cancelled': return 'text-red-500';
    case 'final':     return 'text-amber-400';
    default:          return 'text-emerald-400';
  }
}
