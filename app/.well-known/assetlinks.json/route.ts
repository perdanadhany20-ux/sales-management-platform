import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Digital Asset Links untuk aplikasi Android (TWA). Tanpa berkas ini APK
 * tetap terbuka, tapi dengan bilah alamat Chrome di atasnya.
 *
 * Nilainya per DEPLOYMENT, bukan per kode sumber: setiap pelanggan punya
 * domain dan APK-nya sendiri, jadi paket & sidik jari sertifikat dibaca dari
 * env (ANDROID_PACKAGE_ID, ANDROID_CERT_SHA256 — boleh lebih dari satu,
 * pisahkan koma, mis. kunci unggah + kunci Play App Signing).
 */
export function GET() {
  const paket = (process.env.ANDROID_PACKAGE_ID ?? '').trim();
  const sidik = (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));

  const isi = paket && sidik.length > 0
    ? [{
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: paket, sha256_cert_fingerprints: sidik },
      }]
    : [];

  return NextResponse.json(isi, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
