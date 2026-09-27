/**
 * lib/lisensi/kontrak.ts — kontrak lisensi yang DIPAKAI BERSAMA oleh aplikasi
 * pelanggan dan License Authority pusat (license-authority/).
 *
 * Berkas ini sengaja murni: tanpa impor, tanpa akses jaringan, tanpa React.
 * Dengan begitu satu definisi fitur, paket, dan aturan status berlaku persis
 * sama di kedua sisi — dan bisa diuji langsung dengan `node --test`.
 *
 * PRINSIP: paket hanyalah PRESET. Keputusan akses selalu ditanyakan per fitur
 * (`fiturAktif(...).includes('pipeline')`), tidak pernah `paket === 'X'`.
 */

/* ── Registry fitur ───────────────────────────────────────────────────────── */

export const KUNCI_FITUR = [
  'dashboard', 'customer', 'sales_activity', 'daily_report', 'pipeline',
  'meeting', 'schedule', 'project', 'gp_calculation', 'advanced_reporting',
  'approval', 'admin_settings', 'notifications',
] as const;

export type KunciFitur = typeof KUNCI_FITUR[number];

export interface DefinisiFitur {
  key: KunciFitur;
  display_name: string;
  description: string;
  category: 'inti' | 'penjualan' | 'lapangan' | 'keuangan' | 'laporan' | 'sistem';
}

export const REGISTRY_FITUR: DefinisiFitur[] = [
  { key: 'dashboard',          display_name: 'Dashboard',          category: 'inti',      description: 'Ringkasan kinerja dan target tim.' },
  { key: 'customer',           display_name: 'Customer',           category: 'penjualan', description: 'Data customer dan kontaknya.' },
  { key: 'sales_activity',     display_name: 'Sales Activity',     category: 'penjualan', description: 'Linimasa aktivitas penjualan seluruh tim.' },
  { key: 'daily_report',       display_name: 'Daily Report',       category: 'inti',      description: 'Laporan kunjungan harian Sales.' },
  { key: 'pipeline',           display_name: 'Pipeline',           category: 'penjualan', description: 'Peluang penjualan dari open sampai closing.' },
  { key: 'meeting',            display_name: 'Meeting',            category: 'lapangan',  description: 'Check-in GPS, foto bukti, dan penyelesaian meeting.' },
  { key: 'schedule',           display_name: 'Schedule',           category: 'lapangan',  description: 'Penjadwalan dan penugasan kunjungan.' },
  { key: 'project',            display_name: 'Proyek',             category: 'penjualan', description: 'Proyek yang mengikat pipeline dan lokasi.' },
  { key: 'gp_calculation',     display_name: 'GP Calculation',     category: 'keuangan',  description: 'Perhitungan gross profit beserta persetujuannya.' },
  { key: 'advanced_reporting', display_name: 'Advanced Reporting', category: 'laporan',   description: 'Ekspor laporan ke Excel dari setiap modul.' },
  { key: 'approval',           display_name: 'Advanced Approval',  category: 'sistem',    description: 'Pendaftaran akun mandiri dengan antrean persetujuan Admin.' },
  { key: 'admin_settings',     display_name: 'Admin Settings',     category: 'sistem',    description: 'Pengelolaan pengguna, struktur, dan konfigurasi.' },
  { key: 'notifications',      display_name: 'Notifications',      category: 'sistem',    description: 'Lonceng notifikasi dan pengingat.' },
];

export function adalahKunciFitur(v: unknown): v is KunciFitur {
  return typeof v === 'string' && (KUNCI_FITUR as readonly string[]).includes(v);
}

/* ── Paket (preset) ───────────────────────────────────────────────────────── */

export const PAKET = ['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE', 'CUSTOM'] as const;
export type Paket = typeof PAKET[number];

export const LABEL_PAKET: Record<Paket, string> = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  BUSINESS: 'Business',
  ENTERPRISE: 'Enterprise',
  CUSTOM: 'Custom',
};

const STARTER: KunciFitur[] = [
  'dashboard', 'customer', 'sales_activity', 'daily_report', 'admin_settings', 'notifications',
];
const PROFESSIONAL: KunciFitur[] = [...STARTER, 'pipeline', 'meeting', 'schedule'];
const BUSINESS: KunciFitur[] = [...PROFESSIONAL, 'project', 'gp_calculation', 'advanced_reporting'];
const ENTERPRISE: KunciFitur[] = [...BUSINESS, 'approval'];

/** Matriks bawaan §78. CUSTOM tidak punya preset: fiturnya ditentukan satu per satu. */
export const PRESET_PAKET: Record<Exclude<Paket, 'CUSTOM'>, readonly KunciFitur[]> = {
  STARTER, PROFESSIONAL, BUSINESS, ENTERPRISE,
};

export function adalahPaket(v: unknown): v is Paket {
  return typeof v === 'string' && (PAKET as readonly string[]).includes(v);
}

/** Peta fitur lengkap (semua kunci terisi true/false) dari sebuah preset. */
export function fiturDariPaket(paket: Paket, custom?: Partial<Record<KunciFitur, boolean>>): Record<KunciFitur, boolean> {
  const aktif = paket === 'CUSTOM' ? [] : PRESET_PAKET[paket];
  const peta = Object.fromEntries(KUNCI_FITUR.map((k) => [k, aktif.includes(k)])) as Record<KunciFitur, boolean>;
  if (paket === 'CUSTOM' && custom) {
    for (const k of KUNCI_FITUR) if (typeof custom[k] === 'boolean') peta[k] = custom[k]!;
  }
  return peta;
}

/** Normalisasi peta fitur dari sumber luar: kunci tak dikenal dibuang, yang hilang = false. */
export function normalisasiFitur(v: unknown): Record<KunciFitur, boolean> {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(KUNCI_FITUR.map((k) => [k, src[k] === true])) as Record<KunciFitur, boolean>;
}

/** Paket termurah yang mencakup fitur ini — untuk teks "Tersedia di paket …". */
export function paketMinimum(fitur: KunciFitur): Paket | null {
  for (const p of ['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const) {
    if (PRESET_PAKET[p].includes(fitur)) return p;
  }
  return null;
}

/* ── Status ───────────────────────────────────────────────────────────────── */

/** Status yang DISIMPAN License Authority. */
export const STATUS_DASAR = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REPLACED'] as const;
export type StatusDasar = typeof STATUS_DASAR[number];

/** Status yang DITAMPILKAN: EXPIRING_SOON dan EXPIRED diturunkan dari tanggal. */
export type StatusLisensi = 'PENDING' | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'REPLACED';

export const STATUS_PERMINTAAN = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type StatusPermintaan = typeof STATUS_PERMINTAAN[number];

export const JENIS_PERMINTAAN = ['NEW', 'EXTENSION', 'CHANGE_PACKAGE'] as const;
export type JenisPermintaan = typeof JENIS_PERMINTAAN[number];

/** Kode galat §52 — dipetakan ke kalimat manusiawi di UI, tidak pernah ditampilkan mentah. */
export type KodeLisensi =
  | 'LICENSE_OK'
  | 'LICENSE_NOT_FOUND'
  | 'LICENSE_PENDING'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_SUSPENDED'
  | 'LICENSE_REVOKED'
  | 'LICENSE_VERIFICATION_FAILED'
  | 'LICENSE_AUTHORITY_UNAVAILABLE'
  | 'FEATURE_NOT_LICENSED'
  | 'LICENSE_IN_USE'
  | 'LICENSE_PLATFORM_TAKEN'
  | 'LICENSE_REPLACED'
  | 'LICENSE_DEVELOPMENT';

/* ── Bawaan komersial (§77) — konfigurasi, bukan asumsi yang ditebar ─────── */

export const BAWAAN_LISENSI = {
  paket: 'STARTER' as Paket,
  durasiHari: 365,
  peringatanHari: 30,
  graceHari: 7,
  /**
   * Batas "masa tenggang": verifikasi terakhir yang lebih tua dari ini
   * dianggap tertunda. BUKAN jadwal pemeriksaan — lihat di bawah.
   */
  intervalVerifikasiJam: 24,
  /**
   * Jadwal pemeriksaan rutin ke Authority. Pencabutan, penangguhan, dan
   * perubahan paket oleh developer harus berlaku dalam hitungan menit, bukan
   * keesokan harinya. Satu permintaan kecil per 5 menit per deployment —
   * dan hanya saat platform sedang dipakai.
   */
  intervalVerifikasiRutinMenit: 5,
  /** Selama ada permintaan menunggu, keputusan developer ingin cepat terlihat. */
  intervalVerifikasiMenungguMenit: 5,
  /** Toleransi selisih jam server ↔ Authority saat memeriksa `verified_at`. */
  toleransiJamMenit: 10,
};

/**
 * Fitur yang TETAP tersedia saat lisensi tidak berlaku (kedaluwarsa, ditangguhkan,
 * dicabut, belum disetujui, atau verifikasi melewati masa tenggang). Satu tempat
 * ini yang menentukan "keadaan terbatas" (§16) — mudah diubah kelak.
 * Data TIDAK dihapus; hanya aksesnya yang ditutup.
 */
export const FITUR_SAAT_TERBATAS: readonly KunciFitur[] = ['admin_settings', 'notifications'];

/* ── Muatan bertanda tangan ───────────────────────────────────────────────── */

export interface RingkasanPermintaan {
  id: string;
  kind: JenisPermintaan;
  requested_package: Paket;
  duration_days: number | null;
  status: StatusPermintaan;
  reason: string | null;
  notes: string | null;
  requested_at: string;
  processed_at: string | null;
}

/** Isi token yang ditandatangani Authority (§14). Minimal — tanpa rahasia pusat. */
export interface MuatanLisensi {
  v: 1;
  deployment_id: string;
  license_id: string;
  company_name: string;
  status: StatusDasar;
  package: Paket;
  license_type: 'STANDARD' | 'TRIAL';
  issued_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
  grace_period_days: number;
  warning_days: number;
  features: Record<KunciFitur, boolean>;
  min_version: string | null;
  max_version: string | null;
  requests: RingkasanPermintaan[];
  verified_at: string;
  /** Nonce dari permintaan verifikasi — mencegah respons lama diputar ulang. */
  nonce: string;
  /**
   * Hanya bila status REPLACED: Kode Aktivasi lisensi pengganti. Ikut
   * ditandatangani, jadi platform sah bisa beralih otomatis dengan aman.
   */
  pengganti?: string | null;
}

/* ── Evaluasi ─────────────────────────────────────────────────────────────── */

const HARI_MS = 86_400_000;

export interface MasukanEvaluasi {
  /** null = belum pernah ada lisensi terverifikasi di deployment ini. */
  muatan: MuatanLisensi | null;
  /** Tanda tangan muatan sah? (false = dirusak / kunci publik tidak cocok). */
  tandaTanganSah: boolean;
  /** Verifikasi sukses terakhir (waktu server pelanggan). */
  terakhirTerverifikasi: string | null;
  sekarang: Date;
  /** Mode pengembangan yang sah (sudah dipastikan bukan produksi oleh pemanggil). */
  modePengembangan?: boolean;
}

export interface HasilEvaluasi {
  status: StatusLisensi | null;
  kode: KodeLisensi;
  /** Lisensi berlaku penuh (status aktif, belum lewat tanggal, verifikasi dalam tenggang). */
  berlaku: boolean;
  fitur: KunciFitur[];
  sisaHari: number | null;
  /** Sedang memakai status terakhir karena Authority tak terjangkau. */
  dalamTenggang: boolean;
  tenggangBerakhir: string | null;
  /** Lisensi uji coba (license_type TRIAL). */
  trial?: boolean;
}

export function sisaHari(expiresAt: string | null, sekarang: Date): number | null {
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt).getTime() - sekarang.getTime()) / HARI_MS);
}

/** Status tampilan dari status dasar + tanggal. */
export function statusEfektif(
  dasar: StatusDasar, expiresAt: string | null, sekarang: Date, peringatanHari = BAWAAN_LISENSI.peringatanHari,
): StatusLisensi {
  if (dasar !== 'ACTIVE') return dasar;
  const sisa = sisaHari(expiresAt, sekarang);
  if (sisa === null || !expiresAt) return 'EXPIRED';
  if (new Date(expiresAt).getTime() <= sekarang.getTime()) return 'EXPIRED';
  if (sisa <= peringatanHari) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

/**
 * Satu-satunya aturan "fitur apa yang boleh dipakai sekarang". Fungsi SQL
 * sm_fitur_berlisensi() di migrasi 037 adalah cerminannya di database.
 *
 * Gagal TERTUTUP (§65): kondisi apa pun selain "berlaku" menghasilkan
 * FITUR_SAAT_TERBATAS, tidak pernah "semua fitur".
 */
export function evaluasiLisensi(m: MasukanEvaluasi): HasilEvaluasi {
  const terbatas = [...FITUR_SAAT_TERBATAS];

  if (m.modePengembangan) {
    return {
      status: 'ACTIVE', kode: 'LICENSE_DEVELOPMENT', berlaku: true, fitur: [...KUNCI_FITUR],
      sisaHari: null, dalamTenggang: false, tenggangBerakhir: null,
    };
  }

  if (!m.muatan) {
    return {
      status: null, kode: 'LICENSE_NOT_FOUND', berlaku: false, fitur: terbatas,
      sisaHari: null, dalamTenggang: false, tenggangBerakhir: null,
    };
  }

  // Kasus E: respons dirusak — tidak dipercaya sama sekali, termasuk statusnya.
  if (!m.tandaTanganSah) {
    return {
      status: null, kode: 'LICENSE_VERIFICATION_FAILED', berlaku: false, fitur: terbatas,
      sisaHari: null, dalamTenggang: false, tenggangBerakhir: null,
    };
  }

  const mu = m.muatan;
  const status = statusEfektif(mu.status, mu.expires_at, m.sekarang, mu.warning_days);
  const sisa = sisaHari(mu.expires_at, m.sekarang);

  const acuan = m.terakhirTerverifikasi ?? mu.verified_at;
  const tenggangBerakhirMs = new Date(acuan).getTime() + mu.grace_period_days * HARI_MS;
  const tenggangBerakhir = new Date(tenggangBerakhirMs).toISOString();
  // "Dalam tenggang" = verifikasi terakhir sudah lebih tua dari interval normal.
  const dalamTenggang = m.sekarang.getTime() - new Date(acuan).getTime()
    > BAWAAN_LISENSI.intervalVerifikasiJam * 3_600_000;

  const dasar = { status, sisaHari: sisa, dalamTenggang, tenggangBerakhir, trial: mu.license_type === 'TRIAL' };

  // Kasus A–C: keputusan eksplisit Authority dihormati apa adanya.
  if (status === 'REPLACED')  return { ...dasar, kode: 'LICENSE_REPLACED',  berlaku: false, fitur: terbatas };
  if (status === 'REVOKED')   return { ...dasar, kode: 'LICENSE_REVOKED',   berlaku: false, fitur: terbatas };
  if (status === 'SUSPENDED') return { ...dasar, kode: 'LICENSE_SUSPENDED', berlaku: false, fitur: terbatas };
  if (status === 'PENDING')   return { ...dasar, kode: 'LICENSE_PENDING',   berlaku: false, fitur: terbatas };
  if (status === 'EXPIRED')   return { ...dasar, kode: 'LICENSE_EXPIRED',   berlaku: false, fitur: terbatas };

  // Kasus D: Authority tak terjangkau melewati masa tenggang → keadaan terbatas.
  if (m.sekarang.getTime() > tenggangBerakhirMs) {
    return { ...dasar, kode: 'LICENSE_AUTHORITY_UNAVAILABLE', berlaku: false, fitur: terbatas };
  }

  const fitur = KUNCI_FITUR.filter((k) => mu.features[k] === true);
  return { ...dasar, kode: 'LICENSE_OK', berlaku: true, fitur };
}

/* ── Peringatan (§24) ─────────────────────────────────────────────────────── */

export interface Peringatan {
  kode: KodeLisensi | 'LICENSE_EXPIRING_30' | 'LICENSE_EXPIRING_7' | 'LICENSE_GRACE';
  tingkat: 'info' | 'waspada' | 'bahaya';
  judul: string;
  keterangan: string;
}

export function peringatanLisensi(h: HasilEvaluasi): Peringatan[] {
  const hasil: Peringatan[] = [];
  const pesan = pesanKode(h.kode);
  if (h.kode !== 'LICENSE_OK' && h.kode !== 'LICENSE_DEVELOPMENT') {
    hasil.push({ kode: h.kode, tingkat: h.kode === 'LICENSE_PENDING' ? 'info' : 'bahaya', ...pesan });
    return hasil;
  }
  if (h.trial && h.sisaHari !== null) {
    // Trial selalu diberi tahu sisa harinya — masa uji coba memang pendek.
    hasil.push({
      kode: h.sisaHari <= 7 ? 'LICENSE_EXPIRING_7' : 'LICENSE_EXPIRING_30',
      tingkat: h.sisaHari <= 3 ? 'bahaya' : 'waspada',
      judul: `Masa trial berakhir ${h.sisaHari} hari lagi`,
      keterangan: 'Ajukan lisensi penuh dari halaman Lisensi agar platform tetap bisa dipakai.',
    });
  } else if (h.status === 'EXPIRING_SOON' && h.sisaHari !== null) {
    hasil.push({
      kode: h.sisaHari <= 7 ? 'LICENSE_EXPIRING_7' : 'LICENSE_EXPIRING_30',
      tingkat: h.sisaHari <= 7 ? 'bahaya' : 'waspada',
      judul: `Lisensi berakhir ${h.sisaHari} hari lagi`,
      keterangan: 'Ajukan perpanjangan dari halaman Lisensi agar layanan tidak terputus.',
    });
  }
  if (h.dalamTenggang && h.tenggangBerakhir) {
    hasil.push({
      kode: 'LICENSE_GRACE', tingkat: 'waspada',
      judul: 'Pemeriksaan lisensi tertunda',
      keterangan: 'Server lisensi sedang tidak terjangkau. Platform tetap berjalan memakai status terakhir yang sah.',
    });
  }
  return hasil;
}

/** Kalimat manusiawi untuk setiap kode (§36, §52). */
export function pesanKode(kode: KodeLisensi): { judul: string; keterangan: string } {
  switch (kode) {
    case 'LICENSE_OK':          return { judul: 'Lisensi aktif', keterangan: 'Platform Anda berlisensi resmi.' };
    case 'LICENSE_DEVELOPMENT': return { judul: 'Mode pengembangan', keterangan: 'Seluruh fitur terbuka untuk pengembangan lokal.' };
    case 'LICENSE_NOT_FOUND':   return { judul: 'Lisensi belum diaktifkan', keterangan: 'Platform ini belum memiliki lisensi yang terverifikasi. Admin dapat memasukkan Kode Aktivasi dari penyedia platform di halaman Lisensi.' };
    case 'LICENSE_IN_USE':      return { judul: 'Kode aktivasi sudah dipakai', keterangan: 'Kode aktivasi ini sudah terikat ke platform lain. Hubungi penyedia platform.' };
    case 'LICENSE_PLATFORM_TAKEN': return { judul: 'Platform sudah terdaftar', keterangan: 'Platform ini sudah terdaftar dengan lisensi lain. Hubungi penyedia platform.' };
    case 'LICENSE_REPLACED':    return { judul: 'Lisensi telah diganti', keterangan: 'Lisensi ini sudah diganti dengan lisensi baru dan tidak bisa dipakai lagi. Masukkan Kode Aktivasi yang baru, atau hubungi penyedia platform.' };
    case 'LICENSE_PENDING':     return { judul: 'Menunggu persetujuan', keterangan: 'Lisensi Anda sedang menunggu persetujuan penyedia platform.' };
    case 'LICENSE_EXPIRED':     return { judul: 'Lisensi telah berakhir', keterangan: 'Masa berlaku lisensi sudah habis. Data Anda tetap aman; ajukan perpanjangan untuk membuka kembali seluruh fitur.' };
    case 'LICENSE_SUSPENDED':   return { judul: 'Lisensi ditangguhkan', keterangan: 'Lisensi sedang ditangguhkan sementara oleh penyedia platform. Hubungi penyedia platform.' };
    case 'LICENSE_REVOKED':     return { judul: 'Lisensi dicabut', keterangan: 'Lisensi ini tidak lagi berlaku. Hubungi penyedia platform.' };
    case 'LICENSE_VERIFICATION_FAILED': return { judul: 'Lisensi tidak dapat dipastikan', keterangan: 'Data lisensi tidak lolos pemeriksaan keaslian. Hubungi penyedia platform.' };
    case 'LICENSE_AUTHORITY_UNAVAILABLE': return { judul: 'Verifikasi lisensi diperlukan', keterangan: 'Lisensi tidak dapat diperiksa terlalu lama. Hubungi penyedia platform.' };
    case 'FEATURE_NOT_LICENSED': return { judul: 'Fitur tidak tersedia', keterangan: 'Fitur ini tidak termasuk dalam lisensi Anda saat ini. Hubungi administrator platform Anda bila membutuhkannya.' };
  }
}

/* ── Peristiwa perubahan (§18, §53) ───────────────────────────────────────── */

export type AksiLisensi =
  | 'license_created' | 'license_requested' | 'license_approved' | 'license_rejected'
  | 'license_extended' | 'license_upgraded' | 'license_downgraded' | 'license_changed'
  | 'license_suspended' | 'license_reactivated' | 'license_revoked'
  | 'license_verified' | 'license_verification_failed' | 'license_request_cancelled';

export interface PeristiwaLisensi {
  aksi: AksiLisensi;
  judul: string;
  keterangan: string;
  detail: Record<string, unknown>;
}

function tglIndo(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

/**
 * Bandingkan dua muatan terverifikasi dan hasilkan peristiwa yang bermakna
 * bagi Admin pelanggan. Deployment tidak menerima "push" dari pusat; ia
 * menyadari perubahan saat verifikasi berikutnya, lalu mencatatnya ke
 * audit_trail — sumber panel notifikasi Admin.
 */
export function peristiwaPerubahan(lama: MuatanLisensi | null, baru: MuatanLisensi): PeristiwaLisensi[] {
  const hasil: PeristiwaLisensi[] = [];
  const paket = LABEL_PAKET[baru.package] ?? baru.package;

  if (!lama) {
    hasil.push({
      aksi: 'license_created', judul: 'Lisensi terhubung',
      keterangan: `Platform terhubung ke lisensi ${baru.license_id}.`,
      detail: { status: baru.status, package: baru.package },
    });
  }

  // Permintaan yang baru saja diputuskan.
  const statusLama = new Map((lama?.requests ?? []).map((r) => [r.id, r.status]));
  let adaPersetujuan = false;
  for (const r of baru.requests) {
    const sebelum = statusLama.get(r.id);
    if (sebelum === r.status) continue;
    if (r.status === 'APPROVED') {
      adaPersetujuan = true;
      hasil.push({
        aksi: 'license_approved', judul: 'Lisensi disetujui',
        keterangan: `Lisensi ${LABEL_PAKET[r.requested_package] ?? r.requested_package} kini aktif. Berlaku sampai ${tglIndo(baru.expires_at)}.`,
        detail: { request_id: r.id, kind: r.kind, package: r.requested_package, expires_at: baru.expires_at },
      });
    } else if (r.status === 'REJECTED') {
      hasil.push({
        aksi: 'license_rejected', judul: 'Permintaan lisensi tidak disetujui',
        // Alasan hanya ditampilkan bila developer menuliskannya — tidak dikarang (§68).
        keterangan: r.reason ? `Alasan: ${r.reason}` : 'Tidak ada alasan yang dicantumkan.',
        detail: { request_id: r.id, kind: r.kind, package: r.requested_package, reason: r.reason },
      });
    }
  }

  if (!lama) return hasil;

  if (lama.status !== baru.status) {
    if (baru.status === 'SUSPENDED') {
      hasil.push({ aksi: 'license_suspended', judul: 'Lisensi ditangguhkan', keterangan: 'Penyedia platform menangguhkan lisensi ini untuk sementara.', detail: { from: lama.status } });
    } else if (baru.status === 'REVOKED') {
      hasil.push({ aksi: 'license_revoked', judul: 'Lisensi dicabut', keterangan: 'Lisensi ini tidak lagi berlaku.', detail: { from: lama.status } });
    } else if (baru.status === 'ACTIVE' && lama.status === 'SUSPENDED') {
      hasil.push({ aksi: 'license_reactivated', judul: 'Lisensi aktif kembali', keterangan: `Lisensi ${paket} kembali aktif.`, detail: { from: lama.status } });
    } else if (baru.status === 'ACTIVE' && lama.status === 'PENDING' && !adaPersetujuan) {
      hasil.push({ aksi: 'license_approved', judul: 'Lisensi disetujui', keterangan: `Lisensi ${paket} kini aktif. Berlaku sampai ${tglIndo(baru.expires_at)}.`, detail: { from: lama.status } });
    }
  }

  if (baru.expires_at && lama.expires_at && new Date(baru.expires_at) > new Date(lama.expires_at)) {
    hasil.push({
      aksi: 'license_extended', judul: 'Lisensi diperpanjang',
      keterangan: `Kini berlaku sampai ${tglIndo(baru.expires_at)}.`,
      detail: { from: lama.expires_at, to: baru.expires_at },
    });
  }

  const fLama = KUNCI_FITUR.filter((k) => lama.features[k]);
  const fBaru = KUNCI_FITUR.filter((k) => baru.features[k]);
  const tambah = fBaru.filter((k) => !fLama.includes(k));
  const kurang = fLama.filter((k) => !fBaru.includes(k));
  if (tambah.length || kurang.length || lama.package !== baru.package) {
    const nama = (ks: KunciFitur[]) => ks.map((k) => REGISTRY_FITUR.find((f) => f.key === k)?.display_name ?? k).join(', ');
    const aksi: AksiLisensi = tambah.length && !kurang.length ? 'license_upgraded'
      : kurang.length && !tambah.length ? 'license_downgraded' : 'license_changed';
    const bagian = [
      lama.package !== baru.package ? `Paket kini ${paket}.` : '',
      tambah.length ? `Fitur baru: ${nama(tambah)}.` : '',
      kurang.length ? `Tidak lagi tersedia: ${nama(kurang)}. Datanya tetap tersimpan.` : '',
    ].filter(Boolean);
    hasil.push({
      aksi,
      judul: aksi === 'license_upgraded' ? 'Lisensi ditingkatkan' : aksi === 'license_downgraded' ? 'Lisensi diturunkan' : 'Lisensi diubah',
      keterangan: bagian.join(' '),
      detail: { from_package: lama.package, to_package: baru.package, added: tambah, removed: kurang },
    });
  }

  return hasil;
}

/* ── Peran + lisensi (§33) ────────────────────────────────────────────────── */

/** Kunci menu aplikasi (lib/menu-akses.ts) → fitur lisensi yang dibutuhkannya. */
export const FITUR_MENU: Record<string, KunciFitur> = {
  dashboard: 'dashboard',
  'daily-report': 'daily_report',
  proyek: 'project',
  pipeline: 'pipeline',
  schedule: 'schedule',
  meeting: 'meeting',
  gp: 'gp_calculation',
  activity: 'sales_activity',
  admin: 'admin_settings',
};

/**
 * Kartu Dashboard → menu yang datanya ia tampilkan. Kartu hanya tampil bila
 * menu itu boleh dibuka (peran + lisensi); tanpa entri di sini kartu bersifat
 * umum. Target Sales mengikuti Pipeline karena realisasinya dihitung dari
 * pipeline WON.
 */
export const MENU_KARTU_DASHBOARD: Record<string, string> = {
  kepatuhan: 'daily-report',
  tren: 'daily-report',
  nilai_pipeline: 'pipeline',
  gross_profit: 'pipeline',
  probability: 'pipeline',
  target: 'pipeline',
  status_jadwal: 'schedule',
  meeting: 'meeting',
  pengecualian: 'meeting',
};

/** Akses = hak peran DAN hak lisensi. Lisensi tidak pernah melampaui peran. */
export function bolehMenu(menuKey: string, menuPeran: readonly string[], fitur: readonly KunciFitur[]): boolean {
  if (!menuPeran.includes(menuKey)) return false;
  const butuh = FITUR_MENU[menuKey];
  return butuh ? fitur.includes(butuh) : true;
}

/* ── Versi (§40) ──────────────────────────────────────────────────────────── */

function bagianVersi(v: string): number[] {
  return v.split('.').map((x) => parseInt(x, 10) || 0);
}

export function bandingVersi(a: string, b: string): number {
  const x = bagianVersi(a); const y = bagianVersi(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Hanya informatif untuk sekarang — belum ada pemblokiran paksa (§40). */
export function versiDidukung(versi: string, min: string | null, max: string | null): boolean {
  if (min && bandingVersi(versi, min) < 0) return false;
  if (max && bandingVersi(versi, max) > 0) return false;
  return true;
}
