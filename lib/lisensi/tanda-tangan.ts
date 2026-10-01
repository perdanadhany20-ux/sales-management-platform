// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import crypto from 'crypto';
import type { MuatanLisensi } from './kontrak.ts';

/**
 * lib/lisensi/tanda-tangan.ts — format token lisensi bertanda tangan Ed25519.
 *
 *   SMPL1.<base64url(JSON muatan)>.<base64url(tanda tangan)>
 *
 * License Authority menandatangani dengan KUNCI PRIVAT yang hanya ada di
 * server pusat. Deployment pelanggan hanya memegang KUNCI PUBLIK — cukup
 * untuk memeriksa, mustahil untuk memalsukan (§15, §31).
 *
 * SERVER-ONLY: memakai modul `crypto` Node. Jangan diimpor komponen klien.
 */

const AWALAN = 'SMPL1';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function dariB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Terima PEM, atau DER base64 (lebih mudah disimpan di satu baris env). */
function kunciPublik(teks: string): crypto.KeyObject {
  const t = teks.trim().replace(/\\n/g, '\n');
  if (t.includes('BEGIN')) return crypto.createPublicKey(t);
  return crypto.createPublicKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'spki' });
}

function kunciPrivat(teks: string): crypto.KeyObject {
  const t = teks.trim().replace(/\\n/g, '\n');
  if (t.includes('BEGIN')) return crypto.createPrivateKey(t);
  return crypto.createPrivateKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'pkcs8' });
}

export function tandatangani(muatan: MuatanLisensi, privatKey: string): string {
  const isi = b64url(Buffer.from(JSON.stringify(muatan), 'utf8'));
  const masukan = Buffer.from(`${AWALAN}.${isi}`, 'utf8');
  const sig = crypto.sign(null, masukan, kunciPrivat(privatKey));
  return `${AWALAN}.${isi}.${b64url(sig)}`;
}

export type HasilPeriksa =
  | { sah: true; muatan: MuatanLisensi }
  | { sah: false; alasan: 'format' | 'tanda_tangan' | 'kunci' };

/** Periksa keaslian token. TIDAK memeriksa kecocokan deployment/nonce — itu tugas pemanggil. */
export function periksaToken(token: string, publikKey: string): HasilPeriksa {
  const bagian = token.split('.');
  if (bagian.length !== 3 || bagian[0] !== AWALAN) return { sah: false, alasan: 'format' };

  let kunci: crypto.KeyObject;
  try { kunci = kunciPublik(publikKey); } catch { return { sah: false, alasan: 'kunci' }; }

  let cocok = false;
  try {
    cocok = crypto.verify(null, Buffer.from(`${bagian[0]}.${bagian[1]}`, 'utf8'), kunci, dariB64url(bagian[2]));
  } catch {
    cocok = false;
  }
  if (!cocok) return { sah: false, alasan: 'tanda_tangan' };

  try {
    const muatan = JSON.parse(dariB64url(bagian[1]).toString('utf8')) as MuatanLisensi;
    if (!muatan || muatan.v !== 1) return { sah: false, alasan: 'format' };
    return { sah: true, muatan };
  } catch {
    return { sah: false, alasan: 'format' };
  }
}

/** Pasangan kunci baru (dipakai skrip license-authority/scripts/generate-keys.mjs dan uji). */
export function buatPasanganKunci(): { publik: string; privat: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publik: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privat: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/* ── Kode Aktivasi ──────────────────────────────────────────────────────────
 * Satu string yang diterbitkan Kantor Pusat saat registrasi dan ditempel Admin
 * pelanggan di Admin → Lisensi. Isinya identitas + kunci deployment:
 *   SMPA1-<base64url(JSON {d, l, k})>
 * Rahasia seperti kata sandi: siapa pun yang memegangnya bisa mengaktifkan
 * satu platform — karena itu Kantor Pusat mengikat kode ke platform pertama
 * yang memakainya (instance_id).
 */
export interface KredensialAktivasi { deploymentId: string; licenseId: string; deploymentKey: string }

const AWALAN_AKTIVASI = 'SMPA1-';
const POLA_KODE_ID = /^[A-Z0-9][A-Z0-9-]{3,63}$/;

export function buatKodeAktivasi(k: KredensialAktivasi): string {
  return AWALAN_AKTIVASI + b64url(Buffer.from(JSON.stringify({ d: k.deploymentId, l: k.licenseId, k: k.deploymentKey }), 'utf8'));
}

export function bacaKodeAktivasi(kode: string): KredensialAktivasi | null {
  const t = kode.replace(/\s+/g, '');
  if (!t.startsWith(AWALAN_AKTIVASI) || t.length > 400) return null;
  try {
    const o = JSON.parse(dariB64url(t.slice(AWALAN_AKTIVASI.length)).toString('utf8')) as { d?: unknown; l?: unknown; k?: unknown };
    if (typeof o.d !== 'string' || typeof o.l !== 'string' || typeof o.k !== 'string') return null;
    if (!POLA_KODE_ID.test(o.d) || !POLA_KODE_ID.test(o.l) || o.k.length < 32 || o.k.length > 200) return null;
    return { deploymentId: o.d, licenseId: o.l, deploymentKey: o.k };
  } catch {
    return null;
  }
}

/** Sidik jari platform: hash URL Supabase-nya. Stabil per pelanggan, tidak membocorkan URL-nya. */
export function sidikPlatform(supabaseUrl: string): string {
  return crypto.createHash('sha256').update(`smp-instance:${supabaseUrl.trim().replace(/\/+$/, '').toLowerCase()}`).digest('hex');
}

export function hashKunciDeployment(kunci: string): string {
  return crypto.createHash('sha256').update(kunci, 'utf8').digest('hex');
}

export function buatNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
