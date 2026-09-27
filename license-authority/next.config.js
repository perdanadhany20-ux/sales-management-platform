/**
 * Kontrak lisensi (fitur, paket, format token) dibagi dengan aplikasi
 * pelanggan dari ../lib/lisensi — satu sumber, bukan salinan. externalDir
 * mengizinkan Next.js mengompilasi berkas di luar folder proyek ini.
 * Di Vercel: Root Directory = license-authority, dan biarkan opsi
 * "Include files outside the Root Directory" menyala (bawaan).
 */
/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    }];
  },
};
