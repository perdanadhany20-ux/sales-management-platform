// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import crypto from 'node:crypto';

/**
 * lib/totp.ts — verifikasi dua langkah (TOTP, RFC 6238) untuk server.
 *
 * Kompatibel dengan Google Authenticator, Microsoft Authenticator, Authy:
 * HMAC-SHA1, 6 digit, langkah 30 detik. Toleransi ±1 langkah untuk jam HP
 * yang sedikit meleset. Kode yang langkahnya sudah pernah dipakai ditolak
 * (pemanggil menyimpan `langkah_terakhir`), jadi kode yang tersadap tidak
 * bisa diputar ulang.
 *
 * Hanya modul bawaan Node — bisa diuji langsung dengan node --test.
 */

const ABJAD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const LANGKAH_DETIK = 30;
const DIGIT = 6;

export function base32Enc(buf: Uint8Array): string {
  let bit = 0, nilai = 0, out = '';
  for (const b of buf) {
    nilai = (nilai << 8) | b; bit += 8;
    while (bit >= 5) { out += ABJAD[(nilai >>> (bit - 5)) & 31]; bit -= 5; }
  }
  if (bit > 0) out += ABJAD[(nilai << (5 - bit)) & 31];
  return out;
}

export function base32Dec(teks: string): Buffer {
  const bersih = teks.toUpperCase().replace(/[\s=-]/g, '');
  let bit = 0, nilai = 0;
  const out: number[] = [];
  for (const c of bersih) {
    const i = ABJAD.indexOf(c);
    if (i < 0) throw new Error('Karakter base32 tidak sah.');
    nilai = (nilai << 5) | i; bit += 5;
    if (bit >= 8) { out.push((nilai >>> (bit - 8)) & 255); bit -= 8; }
  }
  return Buffer.from(out);
}

/** Rahasia baru 160 bit (panjang yang dianjurkan RFC 4226), base32. */
export function rahasiaBaru(): string {
  return base32Enc(crypto.randomBytes(20));
}

export function kodePadaLangkah(rahasia: string, langkah: number): string {
  const pesan = Buffer.alloc(8);
  pesan.writeBigUInt64BE(BigInt(langkah));
  const h = crypto.createHmac('sha1', base32Dec(rahasia)).update(pesan).digest();
  const o = h[h.length - 1] & 15;
  const angka = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(angka % 10 ** DIGIT).padStart(DIGIT, '0');
}

export function langkahSekarang(ms = Date.now()): number {
  return Math.floor(ms / 1000 / LANGKAH_DETIK);
}

/**
 * Cocokkan kode. Mengembalikan langkah yang cocok (untuk disimpan sebagai
 * `langkah_terakhir`), atau null. Langkah ≤ `terakhir` ditolak (replay).
 */
export function periksaKode(rahasia: string, kode: string, terakhir = 0, ms = Date.now()): number | null {
  const k = kode.replace(/\s/g, '');
  if (!/^\d{6}$/.test(k)) return null;
  const kini = langkahSekarang(ms);
  for (const d of [0, -1, 1]) {
    const l = kini + d;
    if (l <= terakhir) continue;
    const harap = kodePadaLangkah(rahasia, l);
    if (crypto.timingSafeEqual(Buffer.from(harap), Buffer.from(k))) return l;
  }
  return null;
}

export function uriOtpauth(rahasia: string, akun: string, penerbit: string): string {
  const p = encodeURIComponent(penerbit);
  return `otpauth://totp/${p}:${encodeURIComponent(akun)}?secret=${rahasia}&issuer=${p}&algorithm=SHA1&digits=${DIGIT}&period=${LANGKAH_DETIK}`;
}

/* ── Kode cadangan ─────────────────────────────────────────────────────────
 * 8 kode "xxxx-xxxx" sekali pakai untuk HP hilang. Yang disimpan hanya
 * hash-nya; kode polos ditampilkan sekali saat 2FA diaktifkan. */

export function kodeCadanganBaru(jumlah = 8): string[] {
  return Array.from({ length: jumlah }, () => {
    const h = crypto.randomBytes(5).toString('hex'); // 10 heksa
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
}

export function hashCadangan(kode: string): string {
  return crypto.createHash('sha256').update(kode.trim().toLowerCase().replace(/\s/g, '')).digest('hex');
}

/* ── Enkripsi rahasia saat disimpan ─────────────────────────────────────── */

function kunci(): Buffer {
  const dasar = process.env.MFA_ENCRYPTION_KEY || process.env.SUPABASE_JWT_SECRET || '';
  // Gagal tertutup: tanpa kunci server, 2FA tidak bisa diaktifkan sama sekali.
  if (dasar.length < 16) throw new Error('MFA_KUNCI_BELUM_DISET');
  return crypto.createHash('sha256').update('smp-mfa:' + dasar).digest();
}

export function enkripsi(teks: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kunci(), iv);
  const isi = Buffer.concat([c.update(teks, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), isi.toString('base64url')].join('.');
}

export function dekripsi(sandi: string): string {
  const [v, iv, tag, isi] = sandi.split('.');
  if (v !== 'v1' || !iv || !tag || !isi) throw new Error('Format rahasia 2FA tidak dikenal.');
  const d = crypto.createDecipheriv('aes-256-gcm', kunci(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(isi, 'base64url')), d.final()]).toString('utf8');
}

/* ── Tiket langkah kedua ───────────────────────────────────────────────────
 * Setelah sandi benar tetapi sebelum kode 2FA: tiket bertanda tangan berumur
 * 5 menit yang hanya berisi id pengguna. Sesi belum dibuat. */

const UMUR_TIKET_MS = 5 * 60_000;

export function buatTiket(userId: string, ms = Date.now()): string {
  const isi = `${userId}.${ms + UMUR_TIKET_MS}`;
  const tt = crypto.createHmac('sha256', kunci()).update('tiket:' + isi).digest('base64url');
  return `${Buffer.from(isi).toString('base64url')}.${tt}`;
}

export function bacaTiket(tiket: string, ms = Date.now()): string | null {
  const [isiB64, tt] = String(tiket).split('.');
  if (!isiB64 || !tt) return null;
  const isi = Buffer.from(isiB64, 'base64url').toString('utf8');
  const harap = crypto.createHmac('sha256', kunci()).update('tiket:' + isi).digest('base64url');
  if (harap.length !== tt.length || !crypto.timingSafeEqual(Buffer.from(harap), Buffer.from(tt))) return null;
  const [userId, exp] = isi.split('.');
  if (!userId || !(Number(exp) > ms)) return null;
  return userId;
}
