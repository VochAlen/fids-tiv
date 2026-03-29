import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-8">
      <div className="max-w-4xl w-full">
        <h1 className="text-6xl font-bold text-center mb-12 text-yellow-400">
          Flight Information Display System
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/arrivals"
            className="bg-slate-800 hover:bg-slate-700 p-8 rounded-lg text-center text-2xl font-bold transition-colors border-2 border-yellow-400"
          >
            Arrivals
          </Link>

          <Link
            href="/departures"
            className="bg-slate-800 hover:bg-slate-700 p-8 rounded-lg text-center text-2xl font-bold transition-colors border-2 border-yellow-400"
          >
            Departures
          </Link>

          <Link
            href="/combined"
            className="bg-slate-800 hover:bg-slate-700 p-8 rounded-lg text-center text-2xl font-bold transition-colors border-2 border-yellow-400"
          >
            Combined Display
          </Link>

          <Link
            href="/gate/1"
            className="bg-slate-800 hover:bg-slate-700 p-8 rounded-lg text-center text-2xl font-bold transition-colors border-2 border-yellow-400"
          >
            Gate Display (Example)
          </Link>

          <Link
            href="/checkin/1"
            className="bg-slate-800 hover:bg-slate-700 p-8 rounded-lg text-center text-2xl font-bold transition-colors border-2 border-yellow-400"
          >
            Check-In Display (Example)
          </Link>

          <Link
            href="/baggage/1"
            className="bg-slate-800 hover:bg-slate-700 p-8 rounded-lg text-center text-2xl font-bold transition-colors border-2 border-yellow-400"
          >
            Baggage Claim (Example)
          </Link>
        </div>

        <div className="mt-12 text-center text-slate-400">
          <p className="text-lg">
            Data refreshes every 60 seconds from Montenegro Airports
          </p>
          <p className="text-sm mt-2">
            For specific gate/check-in/baggage displays, use the URL pattern with the number
          </p>
        </div>
      </div>
    </div>
  );
}
