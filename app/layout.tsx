import '../app/globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

// FIX (2026 UI/UX prolaz — nedostajala kompletna metadata): do sad je
// postojao samo title/description — bez favicon veze (Next.js app/icon.svg
// se AUTOMATSKI podiže, ne treba ovdje ništa dodatno za to), bez Open
// Graph/Twitter kartica (link ka sajtu dijeljen na Slack-u/WhatsApp-u/
// itd. bi izgledao kao goli tekst, ne kao karta sa naslovom/opisom), i
// bez manifest veze (app/manifest.ts se takođe automatski otkriva po
// Next.js konvenciji, ali metadataBase je bitan da relativni OG URL-ovi
// ispravno rade kad se render-uju kao apsolutni).
export const metadata: Metadata = {
  metadataBase: new URL('https://fids-tiv.vercel.app'),
  title: {
    default: 'TIV FIDS — Aerodrom Tivat',
    template: '%s · TIV FIDS',
  },
  description: 'Sistem informisanja o letovima za Aerodrom Tivat — uživo raspored letova, gate-ovi, check-in šalteri i automatski razglas terminala.',
  applicationName: 'TIV FIDS',
  keywords: ['Tivat', 'aerodrom', 'FIDS', 'letovi', 'raspored letova', 'Crna Gora', 'airport'],
  openGraph: {
    title: 'TIV FIDS — Aerodrom Tivat',
    description: 'Sistem informisanja o letovima za Aerodrom Tivat — uživo raspored letova, gate-ovi, check-in šalteri i automatski razglas terminala.',
    siteName: 'TIV FIDS',
    locale: 'sr_ME',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'TIV FIDS — Aerodrom Tivat',
    description: 'Sistem informisanja o letovima za Aerodrom Tivat.',
  },
};

// FIX: `viewport` je od Next.js 14 IZDVOJEN iz `metadata` u poseban
// export (upozorenje u build logu ako ostane unutar metadata) —
// themeColor ovdje boji browser UI traku na mobilnim uređajima (Android
// Chrome adresna traka, iOS status bar) u boju brenda.
export const viewport: Viewport = {
  themeColor: '#0B2545',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sr" data-theme="light">
      <body className={inter.className}>{children}</body>
    </html>
  );
}