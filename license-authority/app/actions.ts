'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adalahPaket, KUNCI_FITUR, type Paket } from '@kontrak/kontrak.ts';
import { LicenseService } from '@/lib/license-service';
import type { Pelaku } from '@/lib/types';

/**
 * Server action dashboard web. Memanggil LicenseService yang SAMA dengan
 * Telegram (§48). Setiap formulir membawa `aksi_id` acak yang dibuat saat
 * halaman dirender — kiriman ganda formulir yang sama tidak diterapkan dua
 * kali (§49). Dilindungi Basic Auth di middleware; Next.js juga menolak
 * server action dari origin lain.
 */

const PELAKU: Pelaku = { nama: 'web:developer', via: 'web' };

function teks(f: FormData, k: string): string {
  return String(f.get(k) ?? '').trim();
}

function kunciAksi(f: FormData): string | null {
  const id = teks(f, 'aksi_id');
  return /^[0-9a-f-]{36}$/.test(id) ? `web:${id}` : null;
}

function kembali(kode: string, pesan: string): never {
  revalidatePath('/');
  revalidatePath(`/l/${kode}`);
  redirect(`/l/${encodeURIComponent(kode)}?pesan=${encodeURIComponent(pesan)}`);
}

export async function aksiPermintaan(f: FormData) {
  const id = teks(f, 'request_id');
  const lic = teks(f, 'license_code');
  const keputusan = teks(f, 'keputusan');
  const h = keputusan === 'approve'
    ? await LicenseService.approve(id, PELAKU)
    : await LicenseService.reject(id, teks(f, 'alasan') || null, PELAKU);
  kembali(lic, h.ok ? `Permintaan ${keputusan === 'approve' ? 'disetujui' : 'ditolak'}.` : `Gagal: ${h.code}`);
}

export async function aksiLisensi(f: FormData) {
  const lic = teks(f, 'license_code');
  const aksi = teks(f, 'aksi');
  const k = kunciAksi(f);
  const alasan = teks(f, 'alasan') || null;
  let h;
  switch (aksi) {
    case 'extend': h = await LicenseService.extend(lic, Number(teks(f, 'hari')), PELAKU, k, alasan); break;
    case 'suspend': h = await LicenseService.suspend(lic, PELAKU, k, alasan); break;
    case 'reactivate': h = await LicenseService.reactivate(lic, PELAKU, k); break;
    case 'revoke':
      if (teks(f, 'konfirmasi') !== lic) kembali(lic, 'Ketik kode lisensi untuk mengonfirmasi pencabutan.');
      h = await LicenseService.revoke(lic, PELAKU, k, alasan);
      break;
    case 'package': {
      const p = teks(f, 'paket');
      if (!adalahPaket(p)) kembali(lic, 'Paket tidak dikenal.');
      const custom = Object.fromEntries(KUNCI_FITUR.map((x) => [x, f.get(`fitur_${x}`) === 'on']));
      h = await LicenseService.setPackage(lic, p as Paket, PELAKU, k, custom);
      break;
    }
    default: kembali(lic, 'Tindakan tidak dikenal.');
  }
  kembali(lic, h.ok ? (h.duplicate ? 'Sudah diproses sebelumnya.' : 'Tersimpan.') : `Gagal: ${h.code}`);
}

export interface HasilRegistrasi {
  galat?: string;
  deployment_code?: string;
  license_code?: string;
  deployment_key?: string;
}

/**
 * Registrasi deployment baru. Kunci deployment dikembalikan SEKALI sebagai
 * state formulir (tidak lewat URL, tidak tersimpan di mana pun selain hash-nya).
 */
export async function aksiRegistrasi(_: HasilRegistrasi, f: FormData): Promise<HasilRegistrasi> {
  const perusahaan = teks(f, 'company');
  const paket = teks(f, 'paket');
  const hari = Number(teks(f, 'hari'));
  const lingkungan = teks(f, 'environment');
  if (perusahaan.length < 2 || !adalahPaket(paket) || !Number.isInteger(hari) || hari < 1 || hari > 3660
      || !['production', 'staging', 'development'].includes(lingkungan)) {
    return { galat: 'Isian tidak lengkap atau tidak sah.' };
  }
  const custom = Object.fromEntries(KUNCI_FITUR.map((x) => [x, f.get(`fitur_${x}`) === 'on']));
  const h = await LicenseService.register({
    company: perusahaan, environment: lingkungan as 'production', paket: paket as Paket, hari,
    aktifkan: f.get('aktifkan') === 'on', custom,
  }, PELAKU);
  revalidatePath('/');
  if (!h.ok || !h.deployment_key) return { galat: `Registrasi gagal: ${h.code ?? 'unknown'}` };
  return { deployment_code: h.deployment_code, license_code: h.license_code, deployment_key: h.deployment_key };
}
