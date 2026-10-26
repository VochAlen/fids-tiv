// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    qualities: [75, 80, 90],
    formats: ['image/webp'],
    minimumCacheTTL: 86400,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
  },

  // 2026-10-18 (smanjenje Edge Requests): statički resursi iz public/ po defaultu idu sa
  // "max-age=0, must-revalidate" → browser kioska pri svakom učitavanju šalje provjeru (304) koja se
  // broji kao Edge Request. Ovdje ih keširamo 24 h (izmjena loga/slike kasni do 24 h — prihvaćeno).
  // Namjerno NIJE uključeno 'reklame' (reklame se mogu mijenjati češće) niti 'british'.
  async headers() {
    const cache = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }];
    return [
      { source: '/airlines/:path*', headers: cache },
      { source: '/city-images/:path*', headers: cache },
      { source: '/wallpaper/:path*', headers: cache },
      { source: '/wallpaper-landscape/:path*', headers: cache },
      { source: '/:file(wallpaper[^/]*|dgr-gate\\.png)', headers: cache },
    ];
  },
};

export default nextConfig;