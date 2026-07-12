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