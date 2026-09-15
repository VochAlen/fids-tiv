/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  output: 'standalone',

  assetPrefix: '',
  basePath: '',
  trailingSlash: false,

  distDir: '.next',
  generateEtags: true,

  reactStrictMode: true,
  swcMinify: true,

  // FIX (po zahtjevu — ukloni console.log iz produkcije): Next.js-ov
  // ugrađen SWC compiler flag koji BRIŠE console.* pozive iz koda U
  // TRENUTKU BUILD-A (`next build`, ono što Vercel pokreće za deploy),
  // umjesto ručnog traženja/brisanja stotina console.log poziva kroz
  // cijeli projekat — taj pristup bi bio spor I rizičan (lako se
  // propusti neki poziv, ili se greškom obriše nešto drugo istim
  // imenom u ručnom find/replace-u kroz 30.000+ linija).
  //
  // `exclude: ['error']` namjerno ZADRŽAVA console.error (i u browseru
  // i u server logovima) — to su rijetki, namjerni pozivi na stvarne
  // greške (npr. "Redis nedostupan", "Greška pri zatvaranju gate-a"),
  // korisni za dijagnostiku problema uživo (Vercel Function Logs za
  // server-side, DevTools konzola za client-side) čak i u produkciji.
  // Sve ostalo (console.log/warn/info/debug — dnevnik-stil poruke poput
  // "Fetching weather for:", "=== GET ALL FLIGHTS API ===" itd., kojih
  // je ovaj projekat pun) se briše.
  //
  // `process.env.NODE_ENV === 'production'` znači da `npm run dev`
  // ostaje NETAKNUT — svi console.log ostaju vidljivi lokalno dok
  // razvijaš/debug-uješ, brišu se SAMO u `next build` (produkcijskom
  // Vercel deploy-u).
  //
  // NAPOMENA: ovo je globalna, cjelokupna postavka Next.js compiler-a —
  // ne postoji "samo klijent" varijanta u samom Next.js-u. To znači da
  // se console.log briše i iz SERVER-SIDE koda (API rute), ne samo iz
  // onoga što ide u browser. Ovo je NAMJERNO ostavljeno tako (ne
  // ograničeno samo na browser) jer: (1) Next.js nema ugrađen način da
  // razdvoji client/server za ovu opciju, (2) čistiji Vercel Function
  // Logs je čista dobit, ne gubitak — console.error i dalje prolazi
  // svuda za stvarne greške.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error'] }
      : false,
  },

  // ── Dugotrajan browser keš za statične airport/airline slike ──
  // Ove slike se rijetko mijenjaju, a check-in/gate/combined ekrani
  // ih ponovo dohvataju na svaki reload (hard reset na 6h, admin panel,
  // itd.) — immutable header eliminiše ponovni transfer nakon prvog
  // učitavanja i drastično smanjuje Fast Data Transfer.
  async headers() {
    return [
      {
        source: '/airlines/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000 , immutable' },
        ],
      },
      {
        source: '/city-images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/british/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(wallpaper|wallpaper-landscape|dgr-gate).(jpg|png)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;