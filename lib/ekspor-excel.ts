// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { simpanBlobNative } from './aplikasi';
import { ambilBranding, logoUntuk, BRANDING_BAWAAN, type Branding } from './branding';

/**
 * lib/ekspor-excel.ts — ekspor data ke berkas .xlsx.
 *
 * Kenapa xlsx dan bukan CSV: yang menerima berkas ini adalah manajemen yang
 * langsung memakainya untuk rekap. CSV kehilangan format angka, sehingga
 * "Rp 1.250.000" terbuka sebagai teks di Excel Indonesia (pemisah desimalnya
 * koma) dan setiap kolom harus dibetulkan manual sebelum bisa dijumlahkan.
 * Sekali kejadian, orang berhenti memakai fitur ekspornya.
 *
 * exceljs diimpor secara dinamis — pustakanya ±250 KB, dan halaman yang tidak
 * pernah menekan tombol Ekspor tidak perlu ikut menanggungnya.
 */

export type FormatKolom = 'teks' | 'angka' | 'rupiah' | 'persen' | 'tanggal';

export interface KolomEkspor<T> {
  judul: string;
  nilai: (baris: T) => string | number | Date | null | undefined;
  format?: FormatKolom;
  lebar?: number;
}

export interface OpsiEkspor<T> {
  /** Tanpa ekstensi; stempel tanggal ditambahkan otomatis. */
  namaBerkas: string;
  namaSheet: string;
  judul: string;
  /** Baris konteks di bawah judul. Bentuk "Label: isi" ditata sebagai
   *  pasangan label–isi; selain itu tampil apa adanya. */
  keterangan?: string[];
  kolom: KolomEkspor<T>[];
  baris: T[];
  /** Blok angka ringkas di bawah tabel, mis. total nilai proyek. */
  ringkasan?: { label: string; nilai: string | number }[];
  /** Nama & jabatan pengekspor — diisi TombolEkspor dari sesi aktif. */
  pengekspor?: { nama: string; jabatan?: string };
  /** Blok tanda tangan "Dibuat oleh / Diketahui oleh". Bawaan: tampil. */
  tandaTangan?: boolean;
}

/** Batas aman satu berkas. Di atas ini peramban ponsel mulai kehabisan memori
 *  saat menyusun workbook-nya, dan yang gagal bukan hanya ekspornya melainkan
 *  seluruh tab. */
export const BATAS_BARIS_EKSPOR = 5000;

const FORMAT_ANGKA: Record<FormatKolom, string | undefined> = {
  teks: undefined,
  angka: '#,##0;[Red]-#,##0',
  // Tanpa "Rp" di dalam formatnya: angka tetap angka yang bisa dijumlahkan,
  // dan satuannya sudah jelas dari judul kolom.
  rupiah: '#,##0;[Red]-#,##0',
  persen: '0.0"%"',
  tanggal: 'dd/mm/yyyy',
};

const RATA: Record<FormatKolom, 'left' | 'right' | 'center'> = {
  teks: 'left', angka: 'right', rupiah: 'right', persen: 'right', tanggal: 'center',
};

function namaBerkasBerstempel(dasar: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dasar}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
}

/* ── Tema ─────────────────────────────────────────────────────────────────
 * Warna diturunkan dari warna merek yang diatur Admin (Pengaturan → Branding),
 * jadi berkas yang dicetak tampil dengan identitas perusahaan yang sama
 * dengan aplikasinya. */

interface Tema {
  utama: string;   // ARGB kepala tabel, garis kop
  gelap: string;   // judul, garis bawah kepala
  muda: string;    // baris zebra
  sedang: string;  // baris total, kotak keterangan
}

function hexKeRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  const penuh = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(penuh)) return null;
  return [0, 2, 4].map((i) => parseInt(penuh.slice(i, i + 2), 16)) as [number, number, number];
}

function argb(rgb: [number, number, number], rasio = 0): string {
  const target = rasio > 0 ? 255 : 0;
  const k = Math.abs(rasio);
  return 'FF' + rgb.map((v) => Math.round(v + (target - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function susunTema(b: Branding): Tema {
  const u = hexKeRgb(b.warna_utama) ?? hexKeRgb(BRANDING_BAWAAN.warna_utama)!;
  const u2 = hexKeRgb(b.warna_utama_2) ?? u;
  return { utama: argb(u), gelap: argb(u2, -0.25), muda: argb(u, 0.94), sedang: argb(u, 0.84) };
}

const ABU_GARIS = 'FFD5DBE3';
const ABU_TEKS = 'FF64748B';
const HITAM = 'FF1E293B';
const FONT = 'Calibri';

/** Logo perusahaan sebagai data URL untuk kop. Gagal → kop tanpa logo,
 *  bukan ekspor yang gagal. */
async function ambilLogo(url: string): Promise<{ data: string; ext: 'png' | 'jpeg' | 'gif'; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpeg' : blob.type === 'image/gif' ? 'gif' : null;
    if (!ext) return null;
    const data = await new Promise<string>((ok, gagal) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => gagal(r.error);
      r.readAsDataURL(blob);
    });
    const ukuran = await new Promise<{ w: number; h: number }>((ok) => {
      const img = new Image();
      img.onload = () => ok({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => ok({ w: 1, h: 1 });
      img.src = data;
    });
    return { data, ext, ...ukuran };
  } catch {
    return null;
  }
}

/** Teks untuk header/footer cetak: "&" adalah kode kendali di sana. */
const amanKaki = (s: string) => s.replace(/&/g, '&&');

export async function eksporExcel<T>(opsi: OpsiEkspor<T>): Promise<void> {
  const [{ default: ExcelJS }, branding] = await Promise.all([import('exceljs'), ambilBranding()]);
  const tema = susunTema(branding);
  const perusahaan = branding.nama_perusahaan || branding.nama_platform;
  const sekarang = new Date();
  const tglPanjang = sekarang.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const jamCetak = sekarang.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const wb = new ExcelJS.Workbook();
  wb.creator = opsi.pengekspor?.nama || branding.nama_platform;
  wb.company = perusahaan;
  wb.title = opsi.judul;
  wb.created = sekarang;

  // Kolom 1 = "No"; kolom data mulai kolom 2.
  const N = opsi.kolom.length + 1;
  const lebar = [5, ...opsi.kolom.map((k) => k.lebar ?? Math.min(38, Math.max(12, k.judul.length + 6)))];
  const totalLebar = lebar.reduce((a, b) => a + b, 0);

  const ws = wb.addWorksheet(opsi.namaSheet.slice(0, 31), {
    properties: { defaultRowHeight: 16 },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: totalLebar > 105 ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
    },
    headerFooter: {
      oddFooter: `&L&8&K64748B${amanKaki(perusahaan)} — ${amanKaki(opsi.judul)}&C&8&K64748BHalaman &P dari &N&R&8&K64748BDicetak ${tglPanjang} ${jamCetak}`,
    },
  });
  ws.columns = lebar.map((w) => ({ width: w }));

  const gabung = (r: number, c1: number, c2: number) => { if (c2 > c1) ws.mergeCells(r, c1, r, c2); };

  // ── Kop ──────────────────────────────────────────────────────────────────
  const logo = await ambilLogo(logoUntuk(branding));
  const kolKop = logo ? Math.min(3, N) : 1; // teks kop mulai setelah logo
  const r1 = ws.addRow([]); r1.height = 24;
  const r2 = ws.addRow([]); r2.height = 15;
  const r3 = ws.addRow([]); r3.height = 15;
  const selNama = r1.getCell(kolKop);
  selNama.value = perusahaan;
  selNama.font = { name: FONT, bold: true, size: 16, color: { argb: tema.gelap } };
  selNama.alignment = { vertical: 'bottom' };
  const selSub = r2.getCell(kolKop);
  selSub.value = branding.nama_perusahaan ? branding.nama_platform : '';
  selSub.font = { name: FONT, size: 9, color: { argb: ABU_TEKS } };
  const selKontak = r3.getCell(kolKop);
  selKontak.value = branding.kontak_bantuan || '';
  selKontak.font = { name: FONT, size: 9, color: { argb: ABU_TEKS } };
  [1, 2, 3].forEach((r) => gabung(r, kolKop, N));
  if (logo) {
    const tinggi = 52;
    const id = wb.addImage({ base64: logo.data, extension: logo.ext });
    ws.addImage(id, { tl: { col: 0.15, row: 0.1 }, ext: { width: Math.round(tinggi * (logo.w / logo.h)), height: tinggi } });
  }
  // Garis kop ganda selebar tabel.
  for (let c = 1; c <= N; c++) {
    r3.getCell(c).border = { bottom: { style: 'double', color: { argb: tema.utama } } };
  }

  ws.addRow([]).height = 8;

  // ── Judul laporan ────────────────────────────────────────────────────────
  const rJudul = ws.addRow([opsi.judul.toUpperCase()]);
  rJudul.height = 22;
  rJudul.getCell(1).font = { name: FONT, bold: true, size: 14, color: { argb: HITAM } };
  rJudul.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  gabung(rJudul.number, 1, N);

  // ── Kotak keterangan ─────────────────────────────────────────────────────
  const info: [string, string][] = [];
  for (const k of opsi.keterangan ?? []) {
    const i = k.indexOf(': ');
    info.push(i > 0 && i < 30 ? [k.slice(0, i), k.slice(i + 2)] : ['', k]);
  }
  if (opsi.pengekspor?.nama) {
    info.push(['Dicetak oleh', opsi.pengekspor.jabatan ? `${opsi.pengekspor.nama} (${opsi.pengekspor.jabatan})` : opsi.pengekspor.nama]);
  }
  info.push(['Tanggal cetak', `${tglPanjang}, ${jamCetak}`]);
  info.push(['Jumlah data', `${opsi.baris.length.toLocaleString('id-ID')} baris`]);

  ws.addRow([]).height = 6;
  info.forEach(([label, isi], i) => {
    const r = ws.addRow([]);
    const sel = r.getCell(1);
    sel.value = label
      ? { richText: [
          { text: `${label}`, font: { name: FONT, size: 9, bold: true, color: { argb: tema.gelap } } },
          { text: `  :  ${isi}`, font: { name: FONT, size: 9, color: { argb: HITAM } } },
        ] }
      : isi;
    if (!label) sel.font = { name: FONT, size: 9, color: { argb: HITAM } };
    sel.alignment = { vertical: 'middle', indent: 1 };
    gabung(r.number, 1, N);
    sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tema.muda } };
    sel.border = {
      left: { style: 'medium', color: { argb: tema.utama } },
      top: i === 0 ? { style: 'thin', color: { argb: tema.sedang } } : undefined,
      bottom: i === info.length - 1 ? { style: 'thin', color: { argb: tema.sedang } } : undefined,
    };
  });

  ws.addRow([]).height = 8;

  // ── Kepala tabel ─────────────────────────────────────────────────────────
  const kepala = ws.addRow(['No', ...opsi.kolom.map((k) => k.judul)]);
  const barisKepala = kepala.number;
  kepala.height = 30;
  const gayaKepalaBorder = {
    top: { style: 'thin' as const, color: { argb: tema.gelap } },
    bottom: { style: 'medium' as const, color: { argb: tema.gelap } },
    left: { style: 'thin' as const, color: { argb: 'FFFFFFFF' } },
    right: { style: 'thin' as const, color: { argb: 'FFFFFFFF' } },
  };
  for (let c = 1; c <= N; c++) {
    const sel = kepala.getCell(c);
    sel.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tema.utama } };
    sel.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sel.border = gayaKepalaBorder;
  }

  // ── Isi ──────────────────────────────────────────────────────────────────
  // Objek gaya dibagi pakai bersama, bukan dibuat per sel: pada 5000 baris
  // × 15 kolom itu 75 ribu objek yang tidak perlu.
  const garis = { style: 'thin' as const, color: { argb: ABU_GARIS } };
  const borderIsi = { top: garis, bottom: garis, left: garis, right: garis };
  const fontIsi = { name: FONT, size: 10, color: { argb: HITAM } };
  const isiZebra = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: tema.muda } };
  const rataKolom = [
    { horizontal: 'center' as const, vertical: 'top' as const },
    ...opsi.kolom.map((k) => ({
      horizontal: RATA[k.format ?? 'teks'], vertical: 'top' as const, indent: 1,
      wrapText: (k.format ?? 'teks') === 'teks',
    })),
  ];
  // Excel/LibreOffice tidak selalu menyesuaikan tinggi baris berteks
  // terbungkus saat berkas dibuka, sehingga baris kedua terpotong di cetakan.
  // Tingginya diperkirakan dari panjang teks terhadap lebar kolom.
  const kolTeks = opsi.kolom
    .map((k, i) => ((k.format ?? 'teks') === 'teks' ? { i, muat: Math.max(4, (lebar[i + 1] - 1) * 1.2) } : null))
    .filter((x): x is { i: number; muat: number } => x !== null);

  opsi.baris.forEach((item, idx) => {
    const nilai = opsi.kolom.map((k) => {
      const v = k.nilai(item);
      if (v === null || v === undefined) return '';
      if (typeof v === 'number' && !Number.isFinite(v)) return '';
      return v;
    });
    const r = ws.addRow([idx + 1, ...nilai]);
    let baris = 1;
    for (const { i, muat } of kolTeks) {
      const v = nilai[i];
      if (typeof v !== 'string' || !v) continue;
      const n = v.split('\n').reduce((t, s) => t + Math.max(1, Math.ceil(s.length / muat)), 0);
      if (n > baris) baris = n;
    }
    if (baris > 1) r.height = Math.min(409, 13 * baris + 3);
    for (let c = 1; c <= N; c++) {
      const sel = r.getCell(c);
      sel.font = fontIsi;
      sel.border = borderIsi;
      sel.alignment = rataKolom[c - 1];
      if (idx % 2 === 1) sel.fill = isiZebra;
    }
  });
  const barisAkhir = barisKepala + opsi.baris.length;

  // Format angka per kolom, dipasang setelah semua baris masuk.
  opsi.kolom.forEach((k, i) => {
    const format = FORMAT_ANGKA[k.format ?? 'teks'];
    if (format) ws.getColumn(i + 2).numFmt = format;
  });

  // ── Baris total (kolom rupiah) ───────────────────────────────────────────
  const kolTotal = opsi.kolom.map((k, i) => (k.format === 'rupiah' ? i + 2 : 0)).filter(Boolean);
  if (kolTotal.length > 0 && opsi.baris.length > 0) {
    const r = ws.addRow([]);
    r.height = 20;
    const akhirLabel = Math.max(1, kolTotal[0] - 1);
    r.getCell(1).value = 'TOTAL';
    for (let c = 1; c <= N; c++) {
      const sel = r.getCell(c);
      sel.font = { name: FONT, bold: true, size: 10, color: { argb: tema.gelap } };
      sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tema.sedang } };
      sel.border = { top: { style: 'medium', color: { argb: tema.gelap } }, bottom: { style: 'double', color: { argb: tema.gelap } } };
      sel.alignment = { vertical: 'middle', horizontal: c === 1 ? 'center' : 'right' };
    }
    for (const c of kolTotal) {
      const huruf = ws.getColumn(c).letter;
      const jumlah = opsi.baris.reduce((t, b) => {
        const v = opsi.kolom[c - 2].nilai(b);
        return t + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      }, 0);
      const sel = r.getCell(c);
      sel.value = { formula: `SUBTOTAL(9,${huruf}${barisKepala + 1}:${huruf}${barisAkhir})`, result: jumlah };
      sel.numFmt = FORMAT_ANGKA.rupiah!;
    }
    if (akhirLabel > 1) ws.mergeCells(r.number, 1, r.number, akhirLabel);
  }

  // Penyaring otomatis di baris kepala.
  if (opsi.baris.length > 0) {
    ws.autoFilter = { from: { row: barisKepala, column: 1 }, to: { row: barisAkhir, column: N } };
  }

  // ── Ringkasan ────────────────────────────────────────────────────────────
  // Label menempati kolom 1..L, nilai L+1..akhir blok, supaya angka tidak
  // terpotong pada kolom sempit.
  if (opsi.ringkasan && opsi.ringkasan.length > 0) {
    ws.addRow([]).height = 10;
    const L = N >= 5 ? 3 : Math.max(1, N - 1);
    const V2 = Math.min(N, L + 2);
    const rj = ws.addRow(['RINGKASAN']);
    for (let c = 1; c <= V2; c++) {
      const sel = rj.getCell(c);
      sel.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tema.gelap } };
      sel.alignment = { vertical: 'middle', indent: 1 };
    }
    gabung(rj.number, 1, V2);
    rj.height = 18;

    opsi.ringkasan.forEach((rk, i) => {
      const r = ws.addRow([]);
      r.getCell(1).value = rk.label;
      r.getCell(L + 1).value = rk.nilai;
      for (let c = 1; c <= V2; c++) {
        const sel = r.getCell(c);
        sel.border = { bottom: garis, left: c === 1 ? garis : undefined, right: c === V2 ? garis : undefined };
        if (i % 2 === 1) sel.fill = isiZebra;
      }
      r.getCell(1).font = { name: FONT, size: 10, color: { argb: ABU_TEKS } };
      r.getCell(1).alignment = { indent: 1 };
      const sv = r.getCell(L + 1);
      sv.font = { name: FONT, size: 10, bold: true, color: { argb: HITAM } };
      sv.alignment = { horizontal: 'right' };
      if (typeof rk.nilai === 'number') sv.numFmt = '#,##0;[Red]-#,##0';
      gabung(r.number, 1, L);
      gabung(r.number, L + 1, V2);
    });
  }

  // ── Tanda tangan ─────────────────────────────────────────────────────────
  if (opsi.tandaTangan !== false) {
    ws.addRow([]).height = 14;
    // Dua blok: kiri "Dibuat oleh", kanan "Diketahui oleh".
    const lebarBlok = Math.max(1, Math.min(3, Math.floor(N / 2)));
    const kiri: [number, number] = [1, lebarBlok];
    const kanan: [number, number] = N > lebarBlok ? [Math.max(lebarBlok + 1, N - lebarBlok + 1), N] : [1, N];
    const tulis = (rIdx: number, [a, b]: [number, number], teks: string, gaya: Partial<import('exceljs').Font>, garisBawah = false) => {
      const sel = ws.getRow(rIdx).getCell(a);
      sel.value = teks;
      sel.font = { name: FONT, size: 10, color: { argb: HITAM }, ...gaya };
      sel.alignment = { horizontal: 'center', vertical: 'bottom' };
      if (b > a) ws.mergeCells(rIdx, a, rIdx, b);
      if (garisBawah) for (let c = a; c <= b; c++) ws.getRow(rIdx).getCell(c).border = { bottom: { style: 'thin', color: { argb: HITAM } } };
    };
    const awal = ws.rowCount + 1;
    tulis(awal, kanan, tglPanjang, { color: { argb: ABU_TEKS } });
    tulis(awal + 1, kiri, 'Dibuat oleh,', {});
    tulis(awal + 1, kanan, 'Diketahui oleh,', {});
    for (let i = 2; i <= 5; i++) ws.getRow(awal + i).height = 16;
    tulis(awal + 6, kiri, opsi.pengekspor?.nama ?? '', { bold: true }, true);
    tulis(awal + 6, kanan, '', { bold: true }, true);
    tulis(awal + 7, kiri, opsi.pengekspor?.jabatan ?? '', { size: 9, color: { argb: ABU_TEKS } });
    tulis(awal + 7, kanan, 'Manager / Atasan', { size: 9, color: { argb: ABU_TEKS } });
  }

  // Kepala tabel dibekukan & diulang di tiap halaman cetak.
  ws.views = [{ state: 'frozen', ySplit: barisKepala, xSplit: 0, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${barisKepala}:${barisKepala}`;
  ws.pageSetup.printArea = `A1:${ws.getColumn(N).letter}${ws.rowCount}`;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await simpanBlob(blob, namaBerkasBerstempel(opsi.namaBerkas));
}

/**
 * Simpan blob sebagai unduhan. Di aplikasi Android lewat jembatan native
 * (WebView tidak bisa mengunduh blob seperti browser); di browser lewat
 * file-saver.
 *
 * file-saver adalah modul UMD: tergantung cara bundler memuatnya, fungsinya
 * bisa ada di `saveAs`, `default.saveAs`, atau `default` itu sendiri. Dulu
 * hanya `saveAs` yang dicoba, dan di salah satu halaman nilainya kosong
 * sehingga tombol unduh gagal diam-diam ("n is not a function").
 */
export async function simpanBlob(blob: Blob, nama: string): Promise<void> {
  if (await simpanBlobNative(blob, nama)) return;
  const m = (await import('file-saver')) as unknown as {
    saveAs?: (b: Blob, n: string) => void;
    default?: ((b: Blob, n: string) => void) & { saveAs?: (b: Blob, n: string) => void };
  };
  const simpan = m.saveAs ?? m.default?.saveAs ?? m.default;
  if (typeof simpan === 'function') { simpan(blob, nama); return; }
  // Cadangan terakhir tanpa pustaka: tautan unduhan sementara.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nama; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Tanggal ISO (YYYY-MM-DD) → Date lokal untuk sel bertipe tanggal.
 *  new Date('2026-09-22') dibaca sebagai UTC tengah malam, yang di zona waktu
 *  Indonesia mundur jadi tanggal 21 — kesalahan sehari yang menyesatkan pada
 *  laporan harian. */
export function selTanggal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [t, b, h] = iso.slice(0, 10).split('-').map(Number);
  if (!t || !b || !h) return null;
  return new Date(t, b - 1, h);
}
