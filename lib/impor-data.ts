// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
/**
 * lib/impor-data.ts — aturan impor data lama dari Excel (migrasi 043).
 *
 * Berkas ini MURNI (tanpa impor, tanpa jaringan) karena dipakai dua sisi:
 * pratinjau di peramban, dan pemeriksaan ulang di route handler server
 * (app/api/admin/impor). Server tidak pernah memercayai hasil pratinjau —
 * setiap baris dinilai ulang dengan fungsi yang sama.
 *
 * Spreadsheet lama ditulis tangan oleh banyak orang selama bertahun-tahun,
 * jadi pembacanya sengaja pemaaf: judul kolom dikenali dari beberapa sebutan
 * ("Tanggal", "Tgl", "Date"), tanggal boleh 01/10/2026, 2026-10-01, atau
 * "1 Okt 2026", angka boleh "Rp 1.250.000", dan tahapan boleh ditulis
 * "Menang" atau "WON". Yang tidak bisa dibaca tidak ditebak — barisnya
 * ditandai lengkap dengan alasannya, supaya diperbaiki di Excel lalu diunggah
 * ulang.
 */

export type JenisImpor = 'customer' | 'daily_report' | 'pipeline' | 'schedule';
export type TipeKolom = 'teks' | 'tanggal' | 'jam' | 'angka' | 'persen' | 'pilihan' | 'sales';

export interface Pilihan { nilai: string; label: string; sinonim?: string[] }

export interface KolomImpor {
  kunci: string;
  judul: string;
  tipe: TipeKolom;
  wajib?: boolean;
  sinonim?: string[];
  contoh: string | number;
  bantuan: string;
  pilihan?: Pilihan[];
}

export interface DefinisiImpor {
  jenis: JenisImpor;
  label: string;
  keterangan: string;
  /** Kunci menu (lib/menu-akses) & fitur lisensi modul tujuan. */
  menu: string;
  fitur: string;
  kolom: KolomImpor[];
}

export const MAKS_BARIS_IMPOR = 3000;

const SALES: KolomImpor = {
  kunci: 'sales', judul: 'Sales', tipe: 'sales',
  sinonim: ['sales', 'nama sales', 'username', 'pemilik', 'petugas', 'pic', 'sales person', 'salesperson', 'ditugaskan ke', 'assigned to'],
  contoh: 'rina.wulandari',
  bantuan: 'Username atau nama lengkap Sales di platform. Boleh dikosongkan bila memilih "Pemilik bawaan" saat mengunggah.',
};

export const TAHAPAN: Pilihan[] = [
  { nilai: 'OPEN', label: 'Open', sinonim: ['terbuka', 'prospek', 'prospect', 'lead', 'baru'] },
  { nilai: 'QUOTATION', label: 'Quotation', sinonim: ['penawaran', 'quote', 'negosiasi', 'nego'] },
  { nilai: 'WON', label: 'Won', sinonim: ['menang', 'deal', 'closing', 'closed won', 'po', 'berhasil'] },
  { nilai: 'LOST', label: 'Lost', sinonim: ['kalah', 'gagal', 'batal', 'closed lost'] },
];

export const STATUS_JADWAL_IMPOR: Pilihan[] = [
  { nilai: 'COMPLETED', label: 'Selesai', sinonim: ['completed', 'done', 'sudah', 'terlaksana'] },
  { nilai: 'UPCOMING', label: 'Akan Datang', sinonim: ['upcoming', 'terjadwal', 'belum', 'rencana'] },
  { nilai: 'MISSED', label: 'Terlewat', sinonim: ['missed', 'tidak hadir', 'terlewati'] },
  { nilai: 'CANCELLED', label: 'Dibatalkan', sinonim: ['cancelled', 'canceled', 'batal'] },
];

export const DEFINISI_IMPOR: Record<JenisImpor, DefinisiImpor> = {
  customer: {
    jenis: 'customer', label: 'Customer', menu: 'customer', fitur: 'customer',
    keterangan: 'Daftar pelanggan beserta kontak dan alamatnya.',
    kolom: [
      { ...SALES, judul: 'Pemilik (Sales)', bantuan: 'Sales pemilik customer ini. ' + SALES.bantuan },
      { kunci: 'name', judul: 'Nama Customer', tipe: 'teks', wajib: true, sinonim: ['customer', 'nama perusahaan', 'perusahaan', 'pelanggan', 'company', 'instansi'], contoh: 'PT Maju Bersama', bantuan: 'Nama perusahaan / instansi.' },
      { kunci: 'segment', judul: 'Segmen', tipe: 'teks', sinonim: ['industri', 'bidang', 'sektor', 'segment', 'industry'], contoh: 'Perbankan', bantuan: 'Opsional.' },
      { kunci: 'contact_person', judul: 'Kontak', tipe: 'teks', sinonim: ['contact person', 'nama kontak', 'pic customer', 'cp'], contoh: 'Bpk. Andi', bantuan: 'Opsional.' },
      { kunci: 'contact_position', judul: 'Jabatan', tipe: 'teks', sinonim: ['posisi', 'position', 'title'], contoh: 'Head of IT', bantuan: 'Opsional.' },
      { kunci: 'phone', judul: 'Telepon', tipe: 'teks', sinonim: ['telp', 'no telp', 'hp', 'no hp', 'whatsapp', 'wa', 'phone', 'telepon / whatsapp'], contoh: '081234567890', bantuan: 'Opsional.' },
      { kunci: 'email', judul: 'Email', tipe: 'teks', sinonim: ['e-mail', 'surel'], contoh: 'andi@maju.co.id', bantuan: 'Opsional.' },
      { kunci: 'address', judul: 'Alamat', tipe: 'teks', sinonim: ['address', 'alamat lengkap'], contoh: 'Jl. Sudirman No. 1', bantuan: 'Opsional.' },
      { kunci: 'city', judul: 'Kota', tipe: 'teks', sinonim: ['city', 'kabupaten', 'wilayah'], contoh: 'Jakarta Pusat', bantuan: 'Opsional.' },
      { kunci: 'notes', judul: 'Catatan', tipe: 'teks', sinonim: ['keterangan', 'notes', 'remark', 'remarks'], contoh: '', bantuan: 'Opsional.' },
    ],
  },
  daily_report: {
    jenis: 'daily_report', label: 'Laporan Harian', menu: 'daily-report', fitur: 'daily_report',
    keterangan: 'Riwayat laporan kunjungan/aktivitas Sales per hari.',
    kolom: [
      { ...SALES },
      { kunci: 'report_date', judul: 'Tanggal', tipe: 'tanggal', wajib: true, sinonim: ['tgl', 'date', 'tanggal laporan', 'tanggal kunjungan'], contoh: '01/09/2026', bantuan: 'Format 01/09/2026, 2026-09-01, atau sel bertipe tanggal.' },
      { kunci: 'customer_name', judul: 'Customer', tipe: 'teks', wajib: true, sinonim: ['nama customer', 'perusahaan', 'pelanggan', 'company', 'instansi'], contoh: 'PT Maju Bersama', bantuan: 'Customer baru otomatis ditambahkan ke daftar Sales-nya.' },
      { kunci: 'contact_person', judul: 'Contact Person', tipe: 'teks', sinonim: ['kontak', 'cp', 'nama kontak'], contoh: 'Bpk. Andi', bantuan: 'Opsional.' },
      { kunci: 'position', judul: 'Jabatan', tipe: 'teks', sinonim: ['posisi', 'position'], contoh: 'Head of IT', bantuan: 'Opsional.' },
      { kunci: 'phone_whatsapp', judul: 'Telepon', tipe: 'teks', sinonim: ['telp', 'hp', 'whatsapp', 'wa', 'telepon / whatsapp', 'no hp'], contoh: '081234567890', bantuan: 'Opsional.' },
      { kunci: 'lead_project', judul: 'Lead Project', tipe: 'teks', sinonim: ['proyek', 'project', 'peluang', 'lead'], contoh: 'Videowall lobby', bantuan: 'Opsional.' },
      { kunci: 'activity', judul: 'Aktivitas', tipe: 'teks', wajib: true, sinonim: ['kegiatan', 'activity', 'aktifitas', 'uraian'], contoh: 'Presentasi produk ke tim IT', bantuan: 'Wajib.' },
      { kunci: 'result', judul: 'Hasil', tipe: 'teks', wajib: true, sinonim: ['result', 'hasil kunjungan', 'outcome'], contoh: 'Diminta kirim penawaran', bantuan: 'Wajib.' },
      { kunci: 'next_action', judul: 'Next Action', tipe: 'teks', sinonim: ['tindak lanjut', 'rencana', 'next step', 'follow up'], contoh: 'Kirim penawaran minggu depan', bantuan: 'Opsional — kosong diisi "-".' },
    ],
  },
  pipeline: {
    jenis: 'pipeline', label: 'Pipeline', menu: 'pipeline', fitur: 'pipeline',
    keterangan: 'Peluang penjualan lama, termasuk yang sudah menang atau kalah.',
    kolom: [
      { ...SALES },
      { kunci: 'pipeline_date', judul: 'Tanggal', tipe: 'tanggal', sinonim: ['tgl', 'date', 'tanggal input', 'tanggal peluang'], contoh: '05/08/2026', bantuan: 'Opsional — kosong diisi tanggal hari ini.' },
      { kunci: 'customer_name', judul: 'Customer', tipe: 'teks', wajib: true, sinonim: ['nama customer', 'perusahaan', 'pelanggan', 'company', 'instansi'], contoh: 'PT Maju Bersama', bantuan: 'Customer baru otomatis ditambahkan ke daftar Sales-nya.' },
      { kunci: 'contact_person', judul: 'Contact Person', tipe: 'teks', sinonim: ['kontak', 'cp'], contoh: 'Bpk. Andi', bantuan: 'Opsional.' },
      { kunci: 'project_detail', judul: 'Detail Proyek', tipe: 'teks', wajib: true, sinonim: ['proyek', 'project', 'nama proyek', 'deskripsi', 'description', 'detail'], contoh: 'Videowall lobby 3x3', bantuan: 'Wajib.' },
      { kunci: 'quantity', judul: 'Qty', tipe: 'angka', sinonim: ['jumlah', 'quantity', 'kuantitas'], contoh: 1, bantuan: 'Opsional — kosong = 1.' },
      { kunci: 'unit', judul: 'Satuan', tipe: 'teks', sinonim: ['unit', 'uom'], contoh: 'unit', bantuan: 'Opsional — kosong = unit.' },
      { kunci: 'project_value', judul: 'Nilai Proyek', tipe: 'angka', wajib: true, sinonim: ['nilai', 'value', 'harga jual', 'nilai penawaran', 'amount', 'total'], contoh: 150000000, bantuan: 'Rupiah, boleh "Rp 150.000.000".' },
      { kunci: 'project_hpp', judul: 'HPP', tipe: 'angka', sinonim: ['modal', 'harga pokok', 'cost', 'harga modal'], contoh: 110000000, bantuan: 'Opsional — GP & margin dihitung otomatis.' },
      { kunci: 'probability', judul: 'Probability', tipe: 'persen', sinonim: ['probabilitas', 'peluang (%)', 'peluang', 'prob', 'persentase'], contoh: '50%', bantuan: 'Opsional — 0–100. Kosong mengikuti tahapan (Won 100, Lost 0, lainnya 50).' },
      { kunci: 'stage', judul: 'Tahapan', tipe: 'pilihan', pilihan: TAHAPAN, sinonim: ['stage', 'status', 'tahap'], contoh: 'Quotation', bantuan: 'Open, Quotation, Won, atau Lost (boleh: Penawaran, Menang, Kalah). Kosong = Open.' },
      { kunci: 'estimated_closing', judul: 'Perkiraan Closing', tipe: 'tanggal', sinonim: ['closing', 'tanggal closing', 'target closing', 'est closing'], contoh: '30/09/2026', bantuan: 'Opsional — kosong diisi tanggal peluang.' },
      { kunci: 'won_at', judul: 'Tanggal Menang', tipe: 'tanggal', sinonim: ['tanggal won', 'won date', 'tanggal po', 'tanggal deal'], contoh: '', bantuan: 'Opsional, hanya untuk Won — kosong diisi perkiraan closing.' },
      { kunci: 'next_action', judul: 'Next Action', tipe: 'teks', sinonim: ['tindak lanjut', 'rencana', 'next step', 'follow up'], contoh: 'Follow up PO', bantuan: 'Opsional — kosong diisi "-".' },
    ],
  },
  schedule: {
    jenis: 'schedule', label: 'Riwayat Jadwal', menu: 'schedule', fitur: 'schedule',
    keterangan: 'Jadwal kunjungan/meeting lama sebagai riwayat (tanpa kewajiban check-in & foto).',
    kolom: [
      { ...SALES, bantuan: 'Sales yang ditugaskan. ' + SALES.bantuan },
      { kunci: 'schedule_date', judul: 'Tanggal', tipe: 'tanggal', wajib: true, sinonim: ['tgl', 'date', 'tanggal jadwal', 'tanggal kunjungan'], contoh: '12/08/2026', bantuan: 'Wajib.' },
      { kunci: 'schedule_time', judul: 'Jam', tipe: 'jam', sinonim: ['waktu', 'time', 'pukul'], contoh: '10:00', bantuan: 'Opsional — 10:00 atau 10.00.' },
      { kunci: 'customer_name', judul: 'Customer', tipe: 'teks', wajib: true, sinonim: ['nama customer', 'perusahaan', 'pelanggan', 'company', 'instansi'], contoh: 'PT Maju Bersama', bantuan: 'Customer baru otomatis ditambahkan ke daftar Sales-nya.' },
      { kunci: 'category', judul: 'Kategori', tipe: 'teks', sinonim: ['jenis', 'category', 'tipe', 'jenis kegiatan'], contoh: 'Meeting', bantuan: 'Opsional — kosong = Meeting.' },
      { kunci: 'project', judul: 'Nama Proyek', tipe: 'teks', sinonim: ['proyek', 'project'], contoh: 'Videowall lobby', bantuan: 'Opsional.' },
      { kunci: 'detail', judul: 'Detail', tipe: 'teks', sinonim: ['keterangan', 'agenda', 'deskripsi', 'description'], contoh: 'Presentasi dan survei lokasi', bantuan: 'Opsional.' },
      { kunci: 'status', judul: 'Status', tipe: 'pilihan', pilihan: STATUS_JADWAL_IMPOR, sinonim: ['state'], contoh: 'Selesai', bantuan: 'Selesai, Akan Datang, Terlewat, atau Dibatalkan. Kosong = Selesai (bila tanggal sudah lewat) atau Akan Datang.' },
      { kunci: 'notes', judul: 'Catatan', tipe: 'teks', sinonim: ['notes', 'hasil', 'remark'], contoh: '', bantuan: 'Opsional.' },
    ],
  },
};

/* ── Pembaca nilai ────────────────────────────────────────────────────────── */

export const normalJudul = (s: string) => s.toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();

/** Petakan judul kolom berkas → kunci kolom. Kolom yang tak dikenal diabaikan. */
export function petakanJudul(judul: string[], jenis: JenisImpor): Record<number, string> {
  const peta: Record<number, string> = {};
  const terpakai = new Set<string>();
  const def = DEFINISI_IMPOR[jenis].kolom;
  judul.forEach((j, i) => {
    const n = normalJudul(String(j ?? ''));
    if (!n) return;
    const k = def.find((d) => !terpakai.has(d.kunci) && [d.judul, d.kunci, ...(d.sinonim ?? [])].some((s) => normalJudul(s) === n));
    if (k) { peta[i] = k.kunci; terpakai.add(k.kunci); }
  });
  return peta;
}

const BULAN: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};

const dua = (n: number) => String(n).padStart(2, '0');
function isoSah(t: number, b: number, h: number): string | null {
  if (t < 100) t += 2000;
  const d = new Date(Date.UTC(t, b - 1, h));
  if (t < 1990 || t > 2100 || d.getUTCMonth() !== b - 1 || d.getUTCDate() !== h) return null;
  return `${t}-${dua(b)}-${dua(h)}`;
}

/** Nilai sel → 'YYYY-MM-DD' atau null bila tak terbaca. */
export function bacaTanggal(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Sel tanggal Excel dibaca sebagai UTC tengah malam — pakai komponen UTC.
    return isoSah(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // nomor seri Excel (1954–2119)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return isoSah(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return isoSah(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) return isoSah(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]+([a-z]+)\.?[\s-]+(\d{2,4})$/.exec(s);
  if (m && BULAN[m[2]]) return isoSah(+m[3], BULAN[m[2]], +m[1]);
  return null;
}

/** Nilai sel → 'HH:MM' atau null. */
export function bacaJam(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return `${dua(v.getUTCHours())}:${dua(v.getUTCMinutes())}`;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const menit = Math.round(v * 1440);
    return `${dua(Math.floor(menit / 60) % 24)}:${dua(menit % 60)}`;
  }
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(v).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${dua(+m[1])}:${m[2]}`;
}

/** "Rp 1.250.000,50" / 1250000 → 1250000.5; null bila tak terbaca. */
export function bacaAngka(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/rp\.?/gi, '').replace(/idr/gi, '').replace(/\s/g, '');
  if (!s) return null;
  const negatif = /^-|^\(.*\)$/.test(s);
  s = s.replace(/[()\-]/g, '');
  if (s.includes('.') && s.includes(',')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negatif ? -n : n;
}

/** "50%", 0.5 (sel persen Excel), 50 → 50. */
export function bacaPersen(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const persen = typeof v === 'string' && v.includes('%');
  const n = bacaAngka(typeof v === 'string' ? v.replace('%', '') : v);
  if (n === null) return null;
  return !persen && n > 0 && n <= 1 && !Number.isInteger(n) ? Math.round(n * 100) : Math.round(n);
}

export function bacaPilihan(v: unknown, pilihan: Pilihan[]): string | null {
  const s = normalJudul(String(v ?? ''));
  if (!s) return null;
  return pilihan.find((p) => [p.nilai, p.label, ...(p.sinonim ?? [])].some((x) => normalJudul(x) === s))?.nilai ?? null;
}

/* ── Validasi baris ───────────────────────────────────────────────────────── */

export interface KonteksImpor {
  /** Teks kolom Sales → id pengguna, atau null bila tak dikenal. */
  cariSales: (teks: string) => string | null;
  salesBawaan: string | null;
  hariIni: string;
}

export interface BarisValid {
  sales_user_id: string;
  data: Record<string, string | number | boolean | null>;
}

const teks = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();

/** Nilai satu baris mentah (kunci → isi sel). Mengembalikan data siap simpan
 *  atau daftar alasan penolakan. */
export function validasiBaris(jenis: JenisImpor, mentah: Record<string, unknown>, k: KonteksImpor):
  { ok: true; baris: BarisValid } | { ok: false; galat: string[] } {
  const def = DEFINISI_IMPOR[jenis];
  const galat: string[] = [];
  const data: Record<string, string | number | boolean | null> = {};
  let salesId: string | null = null;

  for (const kol of def.kolom) {
    const v = mentah[kol.kunci];
    const kosong = v === null || v === undefined || teks(v) === '';
    if (kol.tipe === 'sales') {
      salesId = kosong ? k.salesBawaan : k.cariSales(teks(v));
      if (!salesId) galat.push(kosong ? 'Kolom Sales kosong dan Pemilik bawaan belum dipilih.' : `Sales "${teks(v)}" tidak ditemukan di platform.`);
      continue;
    }
    if (kosong) {
      if (kol.wajib) galat.push(`${kol.judul} wajib diisi.`);
      data[kol.kunci] = null;
      continue;
    }
    switch (kol.tipe) {
      case 'teks': {
        const t = teks(v).slice(0, 2000);
        data[kol.kunci] = t;
        if (kol.kunci === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) galat.push(`Email "${t}" tidak valid.`);
        break;
      }
      case 'tanggal': {
        const d = bacaTanggal(v);
        if (!d) galat.push(`${kol.judul} "${teks(v)}" tidak terbaca sebagai tanggal.`);
        data[kol.kunci] = d;
        break;
      }
      case 'jam': {
        const j = bacaJam(v);
        if (!j) galat.push(`${kol.judul} "${teks(v)}" tidak terbaca sebagai jam.`);
        data[kol.kunci] = j;
        break;
      }
      case 'angka': {
        const n = bacaAngka(v);
        if (n === null) galat.push(`${kol.judul} "${teks(v)}" bukan angka.`);
        else if (n < 0) galat.push(`${kol.judul} tidak boleh negatif.`);
        data[kol.kunci] = n;
        break;
      }
      case 'persen': {
        const n = bacaPersen(v);
        if (n === null || n < 0 || n > 100) galat.push(`${kol.judul} "${teks(v)}" harus 0–100.`);
        data[kol.kunci] = n;
        break;
      }
      case 'pilihan': {
        const p = bacaPilihan(v, kol.pilihan ?? []);
        if (!p) galat.push(`${kol.judul} "${teks(v)}" tidak dikenal. Pilihan: ${(kol.pilihan ?? []).map((x) => x.label).join(', ')}.`);
        data[kol.kunci] = p;
        break;
      }
    }
  }

  // Nilai bawaan & aturan antarkolom.
  if (jenis === 'daily_report') {
    data.next_action = data.next_action || '-';
  }
  if (jenis === 'pipeline') {
    data.pipeline_date = data.pipeline_date || k.hariIni;
    data.quantity = data.quantity ?? 1;
    data.unit = data.unit || 'unit';
    data.project_hpp = data.project_hpp ?? 0;
    data.stage = data.stage || 'OPEN';
    data.probability = data.probability ?? (data.stage === 'WON' ? 100 : data.stage === 'LOST' ? 0 : 50);
    data.estimated_closing = data.estimated_closing || data.pipeline_date;
    data.next_action = data.next_action || '-';
    data.won_at = data.stage === 'WON' ? (data.won_at || data.estimated_closing) : null;
  }
  if (jenis === 'schedule') {
    data.category = data.category || 'Meeting';
    data.status = data.status || (data.schedule_date && String(data.schedule_date) < k.hariIni ? 'COMPLETED' : 'UPCOMING');
    // Riwayat: tanpa kewajiban check-in & foto (tidak ada bukti untuk masa lalu).
    data.requires_attendance = false;
  }

  if (galat.length || !salesId) return { ok: false, galat };
  return { ok: true, baris: { sales_user_id: salesId, data } };
}

/** Kunci pembanding untuk mendeteksi baris yang sudah ada di platform. */
export function kunciDuplikat(jenis: JenisImpor, salesId: string, d: Record<string, unknown>): string {
  const n = (x: unknown) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  switch (jenis) {
    case 'customer': return [salesId, n(d.name)].join('|');
    case 'daily_report': return [salesId, n(d.report_date), n(d.customer_name), n(d.activity)].join('|');
    case 'pipeline': return [salesId, n(d.customer_name), n(d.project_detail), n(d.pipeline_date)].join('|');
    case 'schedule': return [salesId, n(d.schedule_date), n((d.schedule_time as string | null)?.slice(0, 5)), n(d.customer_name)].join('|');
  }
}
