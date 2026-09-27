/**
 * lib/pesan-galat.ts — menerjemahkan galat teknis menjadi kalimat untuk pengguna.
 *
 * Pesan asli Postgres/PostgREST seperti `new row violates row-level security
 * policy for table "sm_pipeline"` atau `PGRST116` tidak berarti apa-apa bagi
 * Sales di lapangan, dan sebagian malah membocorkan nama tabel. Galat teknis
 * diterjemahkan di sini; rinciannya tetap dicatat ke console untuk debugging.
 *
 * Yang TIDAK diterjemahkan: pesan yang memang ditulis untuk manusia — RAISE
 * EXCEPTION dari fungsi database kita sendiri ("Pembuat dokumen tidak boleh
 * menyetujui…"), pesan route handler, dan pesan GpsError. Pesan semacam itu
 * sudah menjelaskan apa yang harus dilakukan; menggantinya dengan kalimat umum
 * justru membuang informasi.
 */

interface GalatBerkode {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Kode Postgres/PostgREST → kalimat untuk pengguna. */
const PER_KODE: Record<string, string> = {
  '42501':    'Anda tidak memiliki izin untuk tindakan ini.',
  '23505':    'Data yang sama sudah ada.',
  '23503':    'Data ini masih dipakai oleh data lain, atau data rujukannya sudah tidak ada.',
  '23502':    'Ada isian wajib yang belum diisi.',
  '23514':    'Isian tidak memenuhi aturan yang berlaku.',
  '22P02':    'Format isian tidak sah.',
  '22001':    'Isian terlalu panjang.',
  '22003':    'Angka di luar batas yang diizinkan.',
  '22007':    'Format tanggal tidak sah.',
  'PGRST116': 'Data tidak ditemukan, atau Anda tidak berhak mengaksesnya.',
  'PGRST301': 'Sesi Anda sudah berakhir. Muat ulang halaman.',
  'PGRST302': 'Sesi Anda sudah berakhir. Muat ulang halaman.',
  '57014':    'Permintaan terlalu lama diproses. Coba lagi.',
};

/** Pola pesan teknis → kalimat untuk pengguna (untuk galat yang kodenya sudah hilang). */
const PER_POLA: [RegExp, string][] = [
  [/row-level security|permission denied|insufficient_privilege/i, PER_KODE['42501']],
  [/duplicate key value/i, PER_KODE['23505']],
  [/violates foreign key/i, PER_KODE['23503']],
  [/violates not-null/i, PER_KODE['23502']],
  [/violates check constraint/i, PER_KODE['23514']],
  [/invalid input syntax/i, PER_KODE['22P02']],
  [/value too long/i, PER_KODE['22001']],
  [/JSON object requested|0 rows|multiple \(or no\) rows/i, PER_KODE['PGRST116']],
  [/JWT|jwt expired|invalid claim/i, PER_KODE['PGRST301']],
  [/Failed to fetch|NetworkError|Load failed|network request failed/i,
    'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.'],
  [/statement timeout|canceling statement/i, PER_KODE['57014']],
  // Sisa pesan mentah yang jelas teknis: menyebut relasi/kolom/sintaks SQL.
  [/\brelation\b|\bcolumn\b|syntax error|\bfunction\b.*does not exist|PGRST\d+|violates/i,
    'Terjadi kesalahan pada server. Coba lagi; bila berulang, hubungi Admin.'],
];

const CADANGAN = 'Terjadi kesalahan. Coba lagi; bila berulang, hubungi Admin.';

/**
 * Ubah galat apa pun menjadi kalimat yang layak ditampilkan.
 *
 * @param galat    PostgrestError, Error, string, atau apa saja yang dilempar.
 * @param cadangan Kalimat bila galatnya tidak membawa pesan sama sekali.
 */
export function pesanGalat(galat: unknown, cadangan: string = CADANGAN): string {
  if (galat == null) return cadangan;

  const berkode = (typeof galat === 'object' ? galat : {}) as GalatBerkode;
  const pesan = typeof galat === 'string' ? galat : (berkode.message ?? '');
  const kode = berkode.code;

  // RAISE EXCEPTION dari fungsi kita sendiri (P0001) sudah ditulis untuk manusia.
  if (kode === 'P0001' && pesan) return pesan;

  if (kode && PER_KODE[kode]) {
    catat(galat);
    return PER_KODE[kode];
  }

  for (const [pola, terjemahan] of PER_POLA) {
    if (pola.test(pesan)) {
      catat(galat);
      return terjemahan;
    }
  }

  return pesan.trim() || cadangan;
}

function catat(galat: unknown) {
  // Rincian asli tetap tersedia bagi yang men-debug, tanpa tampil di layar.
  if (typeof console !== 'undefined') console.error('[galat]', galat);
}
