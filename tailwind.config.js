// tailwind.config.js
//
// NOVO (downgrade sa v4 na v3, vidi opširan komentar u
// postcss.config.js za pun kontekst): v3, za razliku od v4, ZAHTIJEVA
// eksplicitnu listu content putanja da zna koje fajlove da skenira za
// klase — v4 je ovo radio automatski.
//
// theme.extend ovdje odgovara ranijem app/globals.css @theme inline
// bloku (--color-background/--color-foreground/--font-sans/--font-mono)
// — isti custom vrijednosti, samo prebačene iz CSS-based (v4) u
// JS-based (v3) konfiguraciju.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './hooks/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)'],
        mono: ['var(--font-geist-mono)'],
      },
    },
  },
  plugins: [],
};
