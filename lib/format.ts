/**
 * lib/format.ts — pemformatan angka, uang, tanggal.
 *
 * Semua fungsi di sini menolak menampilkan NaN, Infinity, maupun "undefined"
 * (§20). Nilai yang tidak masuk akal dipetakan ke 0 atau tanda hubung — bukan
 * karena rapi, tapi karena "Rp NaN" di layar manajer adalah bug yang terlihat
 * seperti kerusakan data.
 */

/** Angka yang bisa dipercaya: bukan null, bukan NaN, bukan Infinity. */
function aman(n: unknown): number {
  const x = typeof n === 'string' ? Number(n) : (n as number);
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

/** "Rp 100.000.000" — §72. */
export function rupiah(n: unknown): string {
  return 'Rp ' + aman(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

/**
 * Bentuk ringkas untuk kartu KPI dan sumbu grafik, di mana "Rp 1.250.000.000"
 * akan melimpah keluar kartunya di layar ponsel.
 */
export function rupiahRingkas(n: unknown): string {
  const x = aman(n);
  const tanda = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (a >= 1e12) return `${tanda}Rp ${(a / 1e12).toFixed(1).replace('.', ',')} T`;
  if (a >= 1e9)  return `${tanda}Rp ${(a / 1e9 ).toFixed(1).replace('.', ',')} M`;
  if (a >= 1e6)  return `${tanda}Rp ${(a / 1e6 ).toFixed(1).replace('.', ',')} jt`;
  if (a >= 1e3)  return `${tanda}Rp ${(a / 1e3 ).toFixed(0)} rb`;
  return `${tanda}Rp ${a.toFixed(0)}`;
}

export function angka(n: unknown): string {
  return aman(n).toLocaleString('id-ID');
}

/** "30,00%" — satu tempat desimal sudah cukup untuk GP. */
export function persen(n: unknown, desimal = 1): string {
  return `${aman(n).toFixed(desimal).replace('.', ',')}%`;
}

/**
 * GP% dihitung ulang di sisi klien HANYA untuk pratinjau langsung saat
 * mengetik di formulir. Angka yang disimpan tetap yang dihitung database
 * lewat kolom GENERATED (§19) — jadi kalaupun fungsi ini kelak meleset,
 * yang tersimpan tidak ikut salah.
 */
export function hitungGp(nilai: unknown, hpp: unknown): { gp: number; gpPersen: number } {
  const v = aman(nilai);
  const h = aman(hpp);
  const gp = v - h;
  // Pembagi nol ditangani eksplisit; inilah satu-satunya sumber NaN di rumus
  // ini kalau dibiarkan.
  return { gp, gpPersen: v > 0 ? (gp / v) * 100 : 0 };
}

/** Input <input type="date"> selalu "YYYY-MM-DD". */
export function tanggalISO(d: Date = new Date()): string {
  const off = d.getTimezoneOffset();
  // Dikoreksi ke waktu lokal dulu. toISOString() memakai UTC, sehingga di
  // WIB (UTC+7) setiap saat sebelum pukul 07.00 akan dilaporkan sebagai
  // TANGGAL KEMARIN — dan laporan harian pagi hari masuk ke hari yang salah.
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
                    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function tanggalPendek(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${NAMA_BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

export function waktuPendek(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

/** Jarak meeting: "27 m" atau "1,2 km" — manajer tidak butuh 1247,83 m. */
export function jarak(meter: unknown): string {
  const m = aman(meter);
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m)} m`;
}

/** Selisih persen antar periode; naik dari nol adalah 100%, bukan tak hingga. */
export function hitungDelta(sekarang: number, sebelumnya: number): number {
  if (sebelumnya === 0) return sekarang === 0 ? 0 : 100;
  return ((sekarang - sebelumnya) / sebelumnya) * 100;
}
