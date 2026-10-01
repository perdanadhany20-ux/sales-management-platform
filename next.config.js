const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://*.supabase.co';
const supabaseWs = supabase.replace(/^https:/, 'wss:');
const dev = process.env.NODE_ENV !== 'production';

// Identitas build untuk footer: versi dari package.json, commit dari Vercel
// (atau git lokal), dan waktu build. Dibekukan saat build, bukan saat render.
function commitBuild() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return require('child_process').execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return '';
  }
}

// Setiap sumber di bawah dipakai nyata: tile & pencarian alamat Leaflet
// (PetaLokasi), embed peta kecil (lib/gps.ts), ikon penanda Leaflet dari
// unpkg, dan Supabase untuk data, foto bukti, serta logo branding.
// 'unsafe-inline' pada script dibutuhkan skrip hidrasi Next.js tanpa nonce;
// 'unsafe-eval' hanya di mode pengembangan (React Refresh).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase} https://unpkg.com https://*.tile.openstreetmap.org`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabaseWs} https://nominatim.openstreetmap.org`,
  "media-src 'self' blob:",
  'frame-src https://www.openstreetmap.org',
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Jangan umumkan kerangka yang dipakai lewat header X-Powered-By.
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_VERSI: require('./package.json').version,
    NEXT_PUBLIC_COMMIT: commitBuild(),
    NEXT_PUBLIC_WAKTU_BUILD: new Date().toISOString(),
  },
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: csp },
          // Kamera & GPS dipakai alur Meeting; keduanya dibatasi ke origin
          // sendiri supaya iframe pihak ketiga tidak ikut mewarisi izinnya.
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
