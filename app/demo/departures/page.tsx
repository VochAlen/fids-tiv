// app/demo/departures/page.tsx
//
// FIX (po zahtjevu — javni link sa home stranice ne smije voditi na
// pravu, polling-tešku kiosk stranicu): javna landing stranica
// (app/HomeClient.tsx) je ranije linkovala direktno na /departures
// (stvarnu uživo tablu koja poll-uje /api/flights). Bilo ko ko posjeti
// javni sajt je mogao kliknuti i time pokrenuti stvaran, ponavljan
// mrežni saobraćaj na produkcijski sistem — potencijalna zloupotreba
// (npr. automatizovan bot koji stalno otvara stranicu) bi mogla
// neopravdano povećati Vercel trošak.
//
// Ova stranica je potpuno STATIČNA — bez 'use client', bez fetch-a, bez
// pollinga — vizuelno podsjeća na pravu tablu odlazaka, ali prikazuje
// ISKLJUČIVO izmišljene podatke iz lib/demo-flights.ts. force-static
// znači da se servira sa CDN-a, sa praktično nula Vercel troška bez
// obzira koliko puta se posjeti.
import { DemoNoticeBanner } from '@/components/demo/demo-notice-banner';
import { DemoHeader } from '@/components/demo/demo-header';
import { DemoFlightTable } from '@/components/demo/demo-flight-table';
import { DEMO_DEPARTURES } from '@/lib/demo-flights';

export const dynamic = 'force-static';

export default function DemoDeparturesPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <DemoNoticeBanner />
      <DemoHeader title="Odlasci — Departures" />
      <div className="max-w-5xl mx-auto p-6">
        <DemoFlightTable title="Odlasci" flights={DEMO_DEPARTURES} columnLabel="Destinacija" />
      </div>
    </div>
  );
}
