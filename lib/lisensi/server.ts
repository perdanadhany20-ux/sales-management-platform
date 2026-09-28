import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import paketAplikasi from '@/package.json';
import {
  BAWAAN_LISENSI, KUNCI_FITUR, evaluasiLisensi, peristiwaPerubahan, peringatanLisensi, pesanKode,
  type HasilEvaluasi, type JenisPermintaan, type KodeLisensi, type KunciFitur, type MuatanLisensi,
  type Paket, type PeristiwaLisensi,
} from './kontrak.ts';
import { bacaKodeAktivasi, buatNonce, periksaToken, sidikPlatform } from './tanda-tangan.ts';

/**
 * lib/lisensi/server.ts — LicenseService sisi deployment pelanggan. SERVER-ONLY.
 *
 *   getLicense()         → statusLisensi()
 *   isLicenseActive()    → (await statusLisensi()).evaluasi.berlaku
 *   isFeatureEnabled(k)  → fiturTersedia(k)
 *   getEnabledFeatures() → (await statusLisensi()).evaluasi.fitur
 *   getRemainingDays()   → (await statusLisensi()).evaluasi.sisaHari
 *   getLicenseWarnings() → peringatanLisensi(evaluasi)
 *   verifyLicense()      → statusLisensi({ paksa: true })
 *
 * Alurnya (§13, §38): baca salinan terverifikasi dari sm_lisensi → periksa
 * ulang tanda tangannya → bila jatuh tempo (24 jam; 5 menit selama ada
 * permintaan menunggu) hubungi License Authority → periksa respons
 * bertanda tangan + nonce → simpan → catat peristiwa → terapkan.
 *
 * Tidak ada jalan pintas "gagal ⇒ buka semua" (§65). Authority tak
 * terjangkau ⇒ status terakhir yang sah tetap dipakai sampai masa tenggang
 * habis, sesudah itu keadaan terbatas.
 */

/* ── Konfigurasi ──────────────────────────────────────────────────────────── */

export interface KonfigurasiLisensi {
  authorityUrl: string;
  deploymentId: string;
  licenseId: string;
  deploymentKey: string;
  publicKey: string;
  modePengembangan: boolean;
  versi: string;
  lengkap: boolean;
  /** Dari mana identitas lisensi berasal: env Vercel, Kode Aktivasi yang ditempel Admin, atau belum ada. */
  sumber: 'env' | 'aktivasi' | null;
  /** Sidik jari platform ini (hash URL Supabase) — Kantor Pusat mengikat kode ke sini. */
  instance: string;
}

/**
 * Kantor Pusat bawaan. Sama untuk SEMUA pelanggan (bukan nilai per pelanggan),
 * jadi aman dan wajar ada di kode: alamat publik dan kunci PUBLIK — tidak bisa
 * dipakai memalsukan lisensi. Env LICENSE_AUTHORITY_URL / LICENSE_PUBLIC_KEY
 * tetap bisa menimpanya.
 */
const PUSAT_BAWAAN = {
  url: 'https://sales-license-authority.vercel.app',
  publicKey: 'MCowBQYDK2VwAyEAQIcORX8M3shHkt3awe8IDxTMHfU8CodljpSuzXR+6II=',
};

/** Identitas yang tersimpan dari Kode Aktivasi (kolom sm_lisensi). */
export interface KredensialTersimpan {
  deployment_id: string | null;
  license_id: string | null;
  deployment_key: string | null;
}

let peringatanModeDicetak = false;

export function konfigurasiLisensi(tersimpan: KredensialTersimpan | null = null): KonfigurasiLisensi {
  const produksi = process.env.NODE_ENV === 'production';
  const diminta = (process.env.LICENSE_MODE ?? 'production').trim().toLowerCase() === 'development';

  // §64/§71: mode pengembangan HANYA untuk `next dev`. Build produksi
  // mengabaikannya — tidak ada saklar rahasia yang bisa terbawa ke produksi.
  if (diminta && produksi && !peringatanModeDicetak) {
    peringatanModeDicetak = true;
    console.error('[lisensi] LICENSE_MODE=development DIABAIKAN: build produksi selalu memverifikasi lisensi.');
  }

  const env = (k: string) => (process.env[k] ?? '').trim();
  // Env (bila ketiganya diisi) menang atas Kode Aktivasi — untuk deployment
  // yang dikelola developer langsung. Selain itu, pakai kode yang ditempel Admin.
  const dariEnv = Boolean(env('LICENSE_DEPLOYMENT_ID') && env('LICENSE_ID') && env('LICENSE_DEPLOYMENT_KEY'));
  const dariKode = !dariEnv && Boolean(tersimpan?.deployment_id && tersimpan?.license_id && tersimpan?.deployment_key);

  const cfg = {
    authorityUrl: (env('LICENSE_AUTHORITY_URL') || PUSAT_BAWAAN.url).replace(/\/+$/, ''),
    deploymentId: dariEnv ? env('LICENSE_DEPLOYMENT_ID') : dariKode ? tersimpan!.deployment_id! : '',
    licenseId: dariEnv ? env('LICENSE_ID') : dariKode ? tersimpan!.license_id! : '',
    deploymentKey: dariEnv ? env('LICENSE_DEPLOYMENT_KEY') : dariKode ? tersimpan!.deployment_key! : '',
    publicKey: env('LICENSE_PUBLIC_KEY') || PUSAT_BAWAAN.publicKey,
    modePengembangan: diminta && !produksi,
    versi: String((paketAplikasi as { version?: string }).version ?? '0.0.0'),
    sumber: (dariEnv ? 'env' : dariKode ? 'aktivasi' : null) as KonfigurasiLisensi['sumber'],
    instance: sidikPlatform(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''),
  };
  return {
    ...cfg,
    lengkap: Boolean(cfg.authorityUrl && cfg.deploymentId && cfg.licenseId && cfg.deploymentKey && cfg.publicKey),
  };
}

async function bacaKredensial(): Promise<KredensialTersimpan | null> {
  const { data } = await getAdminClient().from('sm_lisensi')
    .select('deployment_id, license_id, deployment_key').maybeSingle();
  return (data as KredensialTersimpan | null) ?? null;
}

/* ── Baris salinan ────────────────────────────────────────────────────────── */

interface BarisLisensi {
  mode: 'production' | 'development';
  deployment_id: string | null;
  license_id: string | null;
  deployment_key: string | null;
  token: string | null;
  status: string | null;
  last_verified_at: string | null;
  last_attempt_at: string | null;
  last_failed_at: string | null;
  last_error: string | null;
}

export interface StatusLisensiServer {
  evaluasi: HasilEvaluasi;
  muatan: MuatanLisensi | null;
  dikonfigurasi: boolean;
  sumber: KonfigurasiLisensi['sumber'];
  modePengembangan: boolean;
  terakhirTerverifikasi: string | null;
  terakhirGagal: string | null;
  galatTerakhir: KodeLisensi | null;
  versi: string;
}

/** Kolom sm_lisensi dari muatan yang SUDAH lolos pemeriksaan tanda tangan. */
function kolomDariMuatan(token: string, m: MuatanLisensi, sekarang: string): Record<string, unknown> {
  return {
    id: true, mode: 'production', deployment_id: m.deployment_id, license_id: m.license_id, token,
    company_name: m.company_name, status: m.status, package: m.package, license_type: m.license_type,
    features: m.features, issued_at: m.issued_at, starts_at: m.starts_at, expires_at: m.expires_at,
    grace_period_days: m.grace_period_days, warning_days: m.warning_days, requests: m.requests,
    last_verified_at: sekarang, last_attempt_at: sekarang, last_error: null, updated_at: sekarang,
  };
}

/* ── Audit & notifikasi (memakai audit_trail yang sudah ada) ─────────────── */

async function catat(aksi: string, entityId: string | null, detail: Record<string, unknown>, pelaku?: { id: string; nama: string }) {
  await getAdminClient().from('audit_trail').insert({
    actor_id: pelaku?.id ?? null,
    actor_name: pelaku?.nama ?? 'Sistem Lisensi',
    action: aksi,
    entity: 'lisensi',
    entity_id: entityId,
    detail,
  });
}

async function catatPeristiwa(peristiwa: PeristiwaLisensi[], licenseId: string) {
  for (const p of peristiwa) {
    await catat(p.aksi, licenseId, { judul: p.judul, keterangan: p.keterangan, ...p.detail });
  }
}

/* ── Panggilan ke License Authority ───────────────────────────────────────── */

type HasilPanggil =
  | { ok: true; token: string; muatan: MuatanLisensi }
  | { ok: false; kode: KodeLisensi; alasan: string };

async function panggilAuthority(cfg: KonfigurasiLisensi, jalur: string, badan: Record<string, unknown>): Promise<Response> {
  return fetch(`${cfg.authorityUrl}${jalur}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.deploymentKey}`,
    },
    body: JSON.stringify({
      deployment_id: cfg.deploymentId,
      license_id: cfg.licenseId,
      application_version: cfg.versi,
      instance_id: cfg.instance,
      ...badan,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
}

async function verifikasiKeAuthority(cfg: KonfigurasiLisensi): Promise<HasilPanggil> {
  const nonce = buatNonce();
  let res: Response;
  try {
    res = await panggilAuthority(cfg, '/api/v1/verify', { nonce, timestamp: new Date().toISOString() });
  } catch {
    return { ok: false, kode: 'LICENSE_AUTHORITY_UNAVAILABLE', alasan: 'jaringan' };
  }

  if (res.status === 409) {
    const d = await res.json().catch(() => ({})) as { code?: string };
    if (d.code === 'INSTANCE_MISMATCH') return { ok: false, kode: 'LICENSE_IN_USE', alasan: 'instance' };
    if (d.code === 'PLATFORM_TAKEN') return { ok: false, kode: 'LICENSE_PLATFORM_TAKEN', alasan: 'platform' };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return { ok: false, kode: 'LICENSE_NOT_FOUND', alasan: `ditolak_${res.status}` };
  }
  if (!res.ok) return { ok: false, kode: 'LICENSE_AUTHORITY_UNAVAILABLE', alasan: `http_${res.status}` };

  const data = await res.json().catch(() => null) as { token?: unknown } | null;
  if (!data || typeof data.token !== 'string') {
    return { ok: false, kode: 'LICENSE_VERIFICATION_FAILED', alasan: 'respons_tanpa_token' };
  }

  // §15/§39 kasus E: respons yang tidak lolos pemeriksaan TIDAK dipercaya.
  const periksa = periksaToken(data.token, cfg.publicKey);
  if (!periksa.sah) return { ok: false, kode: 'LICENSE_VERIFICATION_FAILED', alasan: `token_${periksa.alasan}` };

  const m = periksa.muatan;
  if (m.nonce !== nonce) return { ok: false, kode: 'LICENSE_VERIFICATION_FAILED', alasan: 'nonce' };
  if (m.deployment_id !== cfg.deploymentId || m.license_id !== cfg.licenseId) {
    return { ok: false, kode: 'LICENSE_VERIFICATION_FAILED', alasan: 'identitas' };
  }
  const selisih = Math.abs(Date.now() - new Date(m.verified_at).getTime());
  if (!Number.isFinite(selisih) || selisih > BAWAAN_LISENSI.toleransiJamMenit * 60_000) {
    return { ok: false, kode: 'LICENSE_VERIFICATION_FAILED', alasan: 'waktu' };
  }

  return { ok: true, token: data.token, muatan: m };
}

/* ── Status (dengan cache singkat per instance) ──────────────────────────── */

let cache: { nilai: StatusLisensiServer; sampai: number } | null = null;
let berjalan: Promise<StatusLisensiServer> | null = null;
const UMUR_CACHE_MS = 30_000;

export function kosongkanCacheLisensi() {
  cache = null;
}

export async function statusLisensi(opsi: { paksa?: boolean } = {}): Promise<StatusLisensiServer> {
  if (!opsi.paksa && cache && cache.sampai > Date.now()) return cache.nilai;
  if (berjalan) return berjalan;

  berjalan = (async () => {
    try {
      const nilai = await hitungStatus(Boolean(opsi.paksa));
      cache = { nilai, sampai: Date.now() + UMUR_CACHE_MS };
      return nilai;
    } finally {
      berjalan = null;
    }
  })();
  return berjalan;
}

async function hitungStatus(paksa: boolean): Promise<StatusLisensiServer> {
  const db = getAdminClient();
  const sekarang = new Date();

  const { data } = await db.from('sm_lisensi').select(
    'mode, deployment_id, license_id, deployment_key, token, status, last_verified_at, last_attempt_at, last_failed_at, last_error',
  ).maybeSingle();
  let baris = data as BarisLisensi | null;
  const cfg = konfigurasiLisensi(baris);

  const dasar = {
    dikonfigurasi: cfg.lengkap, sumber: cfg.sumber, modePengembangan: cfg.modePengembangan, versi: cfg.versi,
  };

  // ── Mode pengembangan (hanya `next dev`) ──
  if (cfg.modePengembangan) {
    // Mode pengembangan TIDAK menulis ke sm_lisensi. Server lokal sering
    // memakai database yang sama dengan produksi; menulis "semua fitur
    // terbuka" ke sana akan ikut membuka lisensi produksi (lapisan database
    // membaca baris ini). Keterbukaan mode ini cukup hidup di proses lokal.
    return {
      ...dasar,
      evaluasi: evaluasiLisensi({ muatan: null, tandaTanganSah: false, terakhirTerverifikasi: null, sekarang, modePengembangan: true }),
      muatan: null, terakhirTerverifikasi: sekarang.toISOString(), terakhirGagal: null, galatTerakhir: null,
    };
  }

  // Baris pengembangan tidak boleh terbawa ke produksi: dikosongkan.
  if (baris?.mode === 'development') {
    await db.from('sm_lisensi').update({
      mode: 'production', token: null, status: null, features: {}, last_verified_at: null,
      updated_at: sekarang.toISOString(),
    }).eq('id', true);
    baris = { ...baris, mode: 'production', token: null, status: null, last_verified_at: null };
  }

  // ── Periksa ulang salinan tersimpan ──
  let muatan: MuatanLisensi | null = null;
  let tandaTanganSah = false;
  if (baris?.token) {
    const p = periksaToken(baris.token, cfg.publicKey);
    if (p.sah && p.muatan.deployment_id === cfg.deploymentId && p.muatan.license_id === cfg.licenseId) {
      muatan = p.muatan;
      tandaTanganSah = true;
    } else if (baris.status !== 'INVALID') {
      // Salinan diubah di luar server, atau kunci/identitas tidak cocok:
      // tutup di database juga, supaya RLS sejalan dengan keputusan ini.
      await db.from('sm_lisensi').update({
        status: 'INVALID', last_error: 'LICENSE_VERIFICATION_FAILED', updated_at: sekarang.toISOString(),
      }).eq('id', true);
      await catat('license_verification_failed', cfg.licenseId || null, { alasan: 'salinan_tidak_sah' });
    }
  }

  // ── Jatuh tempo verifikasi? ──
  const adaMenunggu = muatan?.status === 'PENDING'
    || (muatan?.requests ?? []).some((r) => r.status === 'PENDING_APPROVAL');
  const intervalMs = adaMenunggu
    ? BAWAAN_LISENSI.intervalVerifikasiMenungguMenit * 60_000
    : BAWAAN_LISENSI.intervalVerifikasiRutinMenit * 60_000;
  const umur = baris?.last_verified_at ? sekarang.getTime() - new Date(baris.last_verified_at).getTime() : Infinity;
  const jedaCoba = baris?.last_attempt_at ? sekarang.getTime() - new Date(baris.last_attempt_at).getTime() : Infinity;
  // Rem: sekali per menit (10 detik bila dipaksa Admin) walau banyak pengguna membuka bersamaan.
  const bolehCoba = jedaCoba > (paksa ? 10_000 : 60_000);
  const jatuhTempo = paksa || !tandaTanganSah || umur > intervalMs;

  let terakhirTerverifikasi = baris?.last_verified_at ?? null;
  let terakhirGagal = baris?.last_failed_at ?? null;
  let galatTerakhir = (baris?.last_error as KodeLisensi | null) ?? null;

  if (cfg.lengkap && jatuhTempo && bolehCoba) {
    const stempel = sekarang.toISOString();
    await db.from('sm_lisensi').upsert({ id: true, last_attempt_at: stempel }, { onConflict: 'id' });

    const hasil = await verifikasiKeAuthority(cfg);
    // Lisensi ini sudah DIGANTI (upgrade/ganti paket): Kantor Pusat menyertakan
    // Kode Aktivasi penggantinya di token bertanda tangan → beralih otomatis.
    // Lisensi lama tidak pernah dipakai lagi.
    let beralih: { token: string; muatan: MuatanLisensi; kunci: string } | null = null;
    if (hasil.ok && hasil.muatan.status === 'REPLACED' && hasil.muatan.pengganti) {
      const kred = bacaKodeAktivasi(hasil.muatan.pengganti);
      if (kred && kred.deploymentId === cfg.deploymentId) {
        const baru = await verifikasiKeAuthority(konfigurasiLisensi({
          deployment_id: kred.deploymentId, license_id: kred.licenseId, deployment_key: kred.deploymentKey,
        }));
        if (baru.ok) beralih = { token: baru.token, muatan: baru.muatan, kunci: kred.deploymentKey };
      }
    }

    if (beralih) {
      const peristiwa = peristiwaPerubahan(muatan, beralih.muatan);
      await db.from('sm_lisensi').upsert({
        ...kolomDariMuatan(beralih.token, beralih.muatan, stempel),
        deployment_key: beralih.kunci,
      });
      await catat('license_replaced', beralih.muatan.license_id, {
        judul: 'Lisensi baru dipasang otomatis',
        keterangan: `Lisensi ${muatan?.license_id ?? cfg.licenseId} diganti dengan ${beralih.muatan.license_id}.`,
      });
      await catatPeristiwa(peristiwa.filter((p) => p.aksi !== 'license_created'), beralih.muatan.license_id);
      muatan = beralih.muatan;
      tandaTanganSah = true;
      terakhirTerverifikasi = stempel;
      galatTerakhir = null;
    } else if (hasil.ok) {
      const peristiwa = peristiwaPerubahan(muatan, hasil.muatan);
      await db.from('sm_lisensi').upsert(kolomDariMuatan(hasil.token, hasil.muatan, stempel));
      await catatPeristiwa(peristiwa, hasil.muatan.license_id);
      muatan = hasil.muatan;
      tandaTanganSah = true;
      terakhirTerverifikasi = stempel;
      galatTerakhir = null;
    } else {
      // Kegagalan dicatat ke audit paling sering sekali sehari per jenisnya —
      // Authority yang mati semalaman tidak boleh membanjiri Audit Log.
      const sudahDicatat = baris?.last_error === hasil.kode && baris?.last_failed_at
        && sekarang.getTime() - new Date(baris.last_failed_at).getTime() < 86_400_000;
      await db.from('sm_lisensi').update({
        last_failed_at: stempel, last_error: hasil.kode, updated_at: stempel,
      }).eq('id', true);
      if (!sudahDicatat) {
        await catat('license_verification_failed', cfg.licenseId || null, { kode: hasil.kode, alasan: hasil.alasan });
      }
      terakhirGagal = stempel;
      galatTerakhir = hasil.kode;
    }
  }

  const evaluasi = evaluasiLisensi({ muatan, tandaTanganSah, terakhirTerverifikasi, sekarang });
  if (!cfg.lengkap && !muatan) evaluasi.kode = 'LICENSE_NOT_FOUND';

  return { ...dasar, evaluasi, muatan, terakhirTerverifikasi, terakhirGagal, galatTerakhir };
}

/* ── Pemeriksaan fitur untuk route handler ────────────────────────────────── */

export async function fiturTersedia(fitur: KunciFitur): Promise<boolean> {
  const s = await statusLisensi();
  return s.evaluasi.fitur.includes(fitur);
}

/**
 * Untuk route handler yang memakai service role (melewati RLS). Mengembalikan
 * respons 403 siap kirim bila TIDAK SATU PUN fitur yang disebut berlisensi,
 * atau null bila boleh lanjut.
 */
export async function tolakJikaTakBerlisensi(...fitur: KunciFitur[]): Promise<NextResponse | null> {
  const s = await statusLisensi();
  if (fitur.some((f) => s.evaluasi.fitur.includes(f))) return null;
  const pesan = pesanKode('FEATURE_NOT_LICENSED');
  return NextResponse.json({ error: pesan.keterangan, code: 'FEATURE_NOT_LICENSED' }, { status: 403 });
}

/* ── Permintaan lisensi (§23, §66, §67) ───────────────────────────────────── */

export interface MasukanPermintaan {
  kind: JenisPermintaan;
  requested_package: Paket;
  duration_days: number | null;
  requested_features?: Partial<Record<KunciFitur, boolean>>;
  notes: string | null;
}

export type HasilPermintaan =
  | { ok: true; id: string }
  | { ok: false; status: number; code: string; error: string };

export async function ajukanPermintaan(
  masukan: MasukanPermintaan, pelaku: { id: string; nama: string },
): Promise<HasilPermintaan> {
  const cfg = konfigurasiLisensi(await bacaKredensial());
  if (!cfg.lengkap) {
    return { ok: false, status: 409, code: 'LICENSE_NOT_CONFIGURED', error: 'Masukkan Kode Aktivasi dari penyedia platform terlebih dahulu.' };
  }

  let res: Response;
  try {
    res = await panggilAuthority(cfg, '/api/v1/requests', { ...masukan, requested_by: pelaku.nama });
  } catch {
    return { ok: false, status: 503, code: 'LICENSE_AUTHORITY_UNAVAILABLE', error: 'Server lisensi sedang tidak terjangkau. Coba lagi beberapa saat lagi.' };
  }

  const data = await res.json().catch(() => ({})) as { id?: string; code?: string };
  if (res.status === 409 && data.code === 'REQUEST_ALREADY_PENDING') {
    return { ok: false, status: 409, code: 'REQUEST_ALREADY_PENDING', error: 'Sebuah permintaan masih menunggu persetujuan penyedia platform.' };
  }
  if (!res.ok || !data.id) {
    return { ok: false, status: 502, code: data.code ?? 'REQUEST_FAILED', error: 'Permintaan tidak dapat dikirim. Coba lagi beberapa saat lagi.' };
  }

  await catat('license_requested', cfg.licenseId, {
    request_id: data.id, kind: masukan.kind, package: masukan.requested_package, duration_days: masukan.duration_days,
  }, pelaku);
  // Segarkan salinan supaya permintaan yang baru tampil dengan status resminya.
  await statusLisensi({ paksa: true }).catch(() => null);
  return { ok: true, id: data.id };
}

export async function batalkanPermintaan(id: string, pelaku: { id: string; nama: string }): Promise<HasilPermintaan> {
  const cfg = konfigurasiLisensi(await bacaKredensial());
  if (!cfg.lengkap) return { ok: false, status: 409, code: 'LICENSE_NOT_CONFIGURED', error: 'Masukkan Kode Aktivasi dari penyedia platform terlebih dahulu.' };
  let res: Response;
  try {
    res = await panggilAuthority(cfg, '/api/v1/requests/cancel', { request_id: id });
  } catch {
    return { ok: false, status: 503, code: 'LICENSE_AUTHORITY_UNAVAILABLE', error: 'Server lisensi sedang tidak terjangkau.' };
  }
  if (!res.ok) return { ok: false, status: res.status === 409 ? 409 : 502, code: 'CANCEL_FAILED', error: 'Permintaan ini sudah diproses dan tidak dapat dibatalkan.' };
  await catat('license_request_cancelled', cfg.licenseId, { request_id: id }, pelaku);
  await statusLisensi({ paksa: true }).catch(() => null);
  return { ok: true, id };
}

/* ── Aktivasi dengan Kode (Admin → Lisensi) ────────────────────────────────── */

export type HasilPengajuan = { ok: true } | { ok: false; status: number; code: string; error: string };

export interface MasukanPengajuan {
  perusahaan: string;
  kontak: string;
  paket: Paket;
  trial: boolean;
  durasiHari: number | null;
  catatan: string | null;
}

/**
 * Platform yang BELUM punya Kode Aktivasi mengajukan lisensi. Pengajuan hanya
 * diteruskan ke Telegram developer (Kantor Pusat); tidak ada yang tersimpan
 * atau berubah di sini. Kode Aktivasi tetap dikirim developer secara manual.
 */
export async function ajukanPendaftaran(m: MasukanPengajuan, pelaku: { id: string; nama: string }): Promise<HasilPengajuan> {
  const cfg = konfigurasiLisensi(await bacaKredensial());
  if (cfg.lengkap) {
    return { ok: false, status: 409, code: 'ALREADY_CONFIGURED', error: 'Platform ini sudah terhubung ke lisensi. Gunakan formulir permintaan lisensi.' };
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.authorityUrl}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: m.perusahaan, contact: m.kontak, package: m.paket,
        license_type: m.trial ? 'TRIAL' : 'STANDARD', duration_days: m.trial ? null : m.durasiHari,
        notes: m.catatan, requested_by: pelaku.nama, instance_id: cfg.instance, application_version: cfg.versi,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, status: 503, code: 'LICENSE_AUTHORITY_UNAVAILABLE', error: 'Penyedia platform sedang tidak terjangkau. Coba lagi beberapa saat lagi.' };
  }
  if (res.status === 429) {
    return { ok: false, status: 429, code: 'TOO_FAST', error: 'Pengajuan sudah terkirim. Tunggu 15 menit sebelum mengajukan lagi.' };
  }
  if (!res.ok) {
    return { ok: false, status: 502, code: 'ENROLL_FAILED', error: 'Pengajuan belum dapat dikirim. Coba lagi nanti atau hubungi penyedia platform.' };
  }
  await catat('license_enroll_requested', null, {
    judul: 'Pengajuan lisensi dikirim',
    keterangan: `${m.perusahaan} mengajukan ${m.trial ? 'trial' : 'lisensi'} paket ${m.paket} ke penyedia platform.`,
  }, pelaku);
  return { ok: true };
}

export type HasilAktivasi =
  | { ok: true; perusahaan: string; status: string }
  | { ok: false; status: number; code: string; error: string };

/**
 * Admin menempel Kode Aktivasi dari Kantor Pusat. Kode baru DISIMPAN hanya
 * bila Kantor Pusat mengakuinya dan membalas token bertanda tangan sah untuk
 * identitas itu — kode karangan atau salah ketik tidak mengubah apa pun.
 */
export async function aktifkanKode(kode: string, pelaku: { id: string; nama: string }): Promise<HasilAktivasi> {
  const kred = bacaKodeAktivasi(kode);
  if (!kred) return { ok: false, status: 400, code: 'INVALID_CODE', error: 'Format Kode Aktivasi tidak dikenali. Salin ulang seluruh kode dari penyedia platform.' };

  if (konfigurasiLisensi().sumber === 'env') {
    return { ok: false, status: 409, code: 'MANAGED_BY_ENV', error: 'Lisensi platform ini diatur langsung oleh penyedia platform.' };
  }

  const db = getAdminClient();
  const { data: lama } = await db.from('sm_lisensi').select('last_attempt_at').maybeSingle();
  const jeda = lama?.last_attempt_at ? Date.now() - new Date(lama.last_attempt_at as string).getTime() : Infinity;
  if (jeda < 10_000) return { ok: false, status: 429, code: 'TOO_FAST', error: 'Tunggu beberapa detik lalu coba lagi.' };

  const cfg = konfigurasiLisensi({
    deployment_id: kred.deploymentId, license_id: kred.licenseId, deployment_key: kred.deploymentKey,
  });

  const sekarang = new Date().toISOString();
  await db.from('sm_lisensi').upsert({ id: true, last_attempt_at: sekarang }, { onConflict: 'id' });

  const hasil = await verifikasiKeAuthority(cfg);
  if (!hasil.ok) {
    const peta: Record<string, [number, string]> = {
      LICENSE_NOT_FOUND: [400, 'Kode Aktivasi tidak dikenali penyedia platform.'],
      LICENSE_IN_USE: [409, 'Kode Aktivasi ini sudah dipakai di platform lain. Hubungi penyedia platform.'],
      LICENSE_PLATFORM_TAKEN: [409, 'Platform ini sudah terdaftar dengan lisensi lain. Hubungi penyedia platform.'],
      LICENSE_AUTHORITY_UNAVAILABLE: [503, 'Server lisensi sedang tidak terjangkau. Coba lagi beberapa saat lagi.'],
    };
    const [status, error] = peta[hasil.kode] ?? [502, 'Kode Aktivasi tidak dapat diverifikasi. Hubungi penyedia platform.'];
    return { ok: false, status, code: hasil.kode, error };
  }

  // Kode lisensi yang sudah diganti tidak boleh dipakai lagi (§ satu lisensi sekali pakai).
  if (hasil.muatan.status === 'REPLACED') {
    return { ok: false, status: 409, code: 'LICENSE_REPLACED', error: 'Kode ini milik lisensi yang sudah diganti. Gunakan Kode Aktivasi terbaru dari penyedia platform.' };
  }

  await db.from('sm_lisensi').upsert({
    ...kolomDariMuatan(hasil.token, hasil.muatan, sekarang),
    deployment_key: kred.deploymentKey,
  });
  await catat('license_activated', hasil.muatan.license_id, {
    judul: 'Kode aktivasi dipasang',
    keterangan: `Platform terhubung ke lisensi ${hasil.muatan.license_id} (${hasil.muatan.company_name}).`,
  }, pelaku);
  kosongkanCacheLisensi();
  return { ok: true, perusahaan: hasil.muatan.company_name, status: hasil.muatan.status };
}

export { peringatanLisensi };
