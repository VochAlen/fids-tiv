/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  output: 'standalone',
  
  // ⚠️ KLJUČNO: Postavi assetPrefix na relativnu putanju
  assetPrefix: '',
  basePath: '',
  trailingSlash: false,
  
  // Dodatne optimizacije za static fajlove
  distDir: '.next',
  generateEtags: true,
  
  // Konfiguracija za static export
  reactStrictMode: true,
  swcMinify: true,
};

module.exports = nextConfig;