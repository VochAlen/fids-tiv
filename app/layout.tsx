import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { initAutoReset } from '@/lib/init-auto-reset';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TIVAT FIDS',
  description: 'Real-time flight information for Tivat Airport',
};

// ═══════════════════════════════════════════════════════════════
// INICIJALIZACIJA AUTO-RESET SISTEMA (pokreće se jednom pri startu)
// ═══════════════════════════════════════════════════════════════
// Ovo se izvršava na serveru pri startu aplikacije
// Timer će raditi non-stop, nezavisno od admin login-a

// Provjeri da smo na serveru (ne u browseru)
if (typeof window === 'undefined') {
  // Mali delay da se osigura da je sve učitano
  setTimeout(() => {
    initAutoReset();
  }, 2000);
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}