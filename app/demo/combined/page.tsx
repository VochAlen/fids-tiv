// app/demo/combined/page.tsx
// FIX (isti razlog kao app/demo/departures/page.tsx — vidi opširan
// komentar tamo): potpuno statična, izmišljeni podaci, force-static.
import { DemoNoticeBanner } from '@/components/demo/demo-notice-banner';
import { DemoHeader } from '@/components/demo/demo-header';
import { DemoFlightTable } from '@/components/demo/demo-flight-table';
import { DEMO_DEPARTURES, DEMO_ARRIVALS } from '@/lib/demo-flights';

export const dynamic = 'force-static';

export default function DemoCombinedPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <DemoNoticeBanner />
      <DemoHeader title="Kombinovani prikaz — Combined" />
      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DemoFlightTable title="Odlasci" flights={DEMO_DEPARTURES} columnLabel="Destinacija" />
        <DemoFlightTable title="Dolasci" flights={DEMO_ARRIVALS} columnLabel="Porijeklo" />
      </div>
    </div>
  );
}
