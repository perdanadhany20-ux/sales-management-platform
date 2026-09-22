'use client';

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
  /** Baris konteks di bawah judul: rentang tanggal, penyaring, pengekspor. */
  keterangan?: string[];
  kolom: KolomEkspor<T>[];
  baris: T[];
  /** Blok angka ringkas di bawah tabel, mis. total nilai proyek. */
  ringkasan?: { label: string; nilai: string | number }[];
}

/** Batas aman satu berkas. Di atas ini peramban ponsel mulai kehabisan memori
 *  saat menyusun workbook-nya, dan yang gagal bukan hanya ekspornya melainkan
 *  seluruh tab. */
export const BATAS_BARIS_EKSPOR = 5000;

const FORMAT_ANGKA: Record<FormatKolom, string | undefined> = {
  teks: undefined,
  angka: '#,##0',
  // Tanpa "Rp" di dalam formatnya: angka tetap angka yang bisa dijumlahkan,
  // dan satuannya sudah jelas dari judul kolom.
  rupiah: '#,##0',
  persen: '0"%"',
  tanggal: 'dd/mm/yyyy',
};

function namaBerkasBerstempel(dasar: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dasar}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
}

export async function eksporExcel<T>(opsi: OpsiEkspor<T>): Promise<void> {
  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sales Management Platform';
  wb.created = new Date();

  const ws = wb.addWorksheet(opsi.namaSheet.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 0 }],
  });

  const jmlKolom = opsi.kolom.length;

  // ── Blok judul ──
  const barisJudul = ws.addRow([opsi.judul]);
  barisJudul.font = { bold: true, size: 14 };
  barisJudul.height = 22;
  ws.mergeCells(barisJudul.number, 1, barisJudul.number, jmlKolom);

  for (const ket of opsi.keterangan ?? []) {
    const b = ws.addRow([ket]);
    b.font = { size: 9, color: { argb: 'FF64748B' } };
    ws.mergeCells(b.number, 1, b.number, jmlKolom);
  }

  ws.addRow([]);

  // ── Kepala tabel ──
  const kepala = ws.addRow(opsi.kolom.map((k) => k.judul));
  kepala.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  kepala.height = 20;
  kepala.eachCell((sel) => {
    sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    sel.alignment = { vertical: 'middle', horizontal: 'left' };
    sel.border = { bottom: { style: 'thin', color: { argb: 'FF1E40AF' } } };
  });

  const barisKepala = kepala.number;

  // ── Isi ──
  for (const item of opsi.baris) {
    const nilai = opsi.kolom.map((k) => {
      const v = k.nilai(item);
      return v === null || v === undefined ? '' : v;
    });
    const b = ws.addRow(nilai);
    b.font = { size: 10 };
    b.alignment = { vertical: 'top', wrapText: false };
  }

  // Format angka dipasang per kolom SETELAH semua baris masuk, bukan per sel
  // saat menulisnya: memanggilnya ribuan kali pada tabel besar terasa jelas
  // sebagai jeda membeku di peramban.
  opsi.kolom.forEach((k, i) => {
    const kolom = ws.getColumn(i + 1);
    kolom.width = k.lebar ?? Math.min(38, Math.max(12, k.judul.length + 6));
    const format = FORMAT_ANGKA[k.format ?? 'teks'];
    if (format) kolom.numFmt = format;
  });

  // Penyaring otomatis di baris kepala — yang menerima berkas ini hampir
  // selalu langsung menyaring per Sales atau per status.
  if (opsi.baris.length > 0) {
    ws.autoFilter = {
      from: { row: barisKepala, column: 1 },
      to: { row: barisKepala + opsi.baris.length, column: jmlKolom },
    };
  }

  // Kepala tabel dibekukan supaya judul kolom tetap terlihat saat digulir.
  ws.views = [{ state: 'frozen', ySplit: barisKepala }];

  // ── Ringkasan ──
  if (opsi.ringkasan && opsi.ringkasan.length > 0) {
    ws.addRow([]);
    const judulRingkas = ws.addRow(['RINGKASAN']);
    judulRingkas.font = { bold: true, size: 10, color: { argb: 'FF475569' } };

    for (const r of opsi.ringkasan) {
      const b = ws.addRow([r.label, r.nilai]);
      b.getCell(1).font = { size: 10, color: { argb: 'FF64748B' } };
      b.getCell(2).font = { size: 10, bold: true };
      if (typeof r.nilai === 'number') b.getCell(2).numFmt = '#,##0';
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    namaBerkasBerstempel(opsi.namaBerkas),
  );
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
