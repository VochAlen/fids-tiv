// app/demo/split-board/page.tsx
// FIX (isti razlog kao app/demo/departures/page.tsx — vidi opširan
// komentar tamo): potpuno statična, izmišljeni podaci, force-static.
//
// Split-board na pravom ekranu prikazuje odlaske/dolaske jedno pored
// drugog u istoj širini ekrana (za velike terminalne panoe) — ovdje
// vizuelno predstavljeno kao dvije jednake kolone jedna pored druge,
// bez razdvojnog auto-scroll mehanizma koji prava stranica koristi
// (nepotrebno za statičan demo sa svega par letova po tabeli).
import { DemoNoticeBanner } from '@/components/demo/demo-notice-banner';
import { DemoHeader } from '@/components/demo/demo-header';
import { DemoFlightTable } from '@/components/demo/demo-flight-table';
import { DEMO_DEPARTURES, DEMO_ARRIVALS } from '@/lib/demo-flights';

export const dynamic = 'force-static';

export default function DemoSplitBoardPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <DemoNoticeBanner />
      <DemoHeader title="Split Board" />
      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x md:divide-slate-800">
        <div className="md:pr-6">
          <DemoFlightTable title="Odlasci" flights={DEMO_DEPARTURES} columnLabel="Destinacija" />
        </div>
        <div className="md:pl-6 mt-6 md:mt-0">
          <DemoFlightTable title="Dolasci" flights={DEMO_ARRIVALS} columnLabel="Porijeklo" />
        </div>
      </div>
    </div>
  );
}
