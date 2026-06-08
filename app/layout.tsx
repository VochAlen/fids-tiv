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
if (typeof window === 'undefined') {
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
    <html lang="en" data-theme="light">  {/* ← DODATO data-theme */}
      <body className={inter.className}>{children}</body>
    </html>
  );
}