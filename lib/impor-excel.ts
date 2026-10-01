// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

/**
 * lib/impor-excel.ts — sisi peramban impor data lama: membaca berkas
 * .xlsx/.csv menjadi baris berkunci, dan membuat template Excel.
 * Aturan kolom & validasi ada di lib/impor-data.ts (dipakai juga server).
 */

import { DEFINISI_IMPOR, petakanJudul, bacaTanggal, bacaJam, type JenisImpor } from './impor-data';
import { simpanBlob } from './ekspor-excel';

export interface HasilBaca {
  /** Judul kolom yang dikenali → kunci. */
  dikenali: { judul: string; kunci: string }[];
  /** Judul kolom di berkas yang tidak dipakai. */
  diabaikan: string[];
  /** Kolom wajib yang tidak ditemukan di berkas. */
  hilang: string[];
  baris: { no: number; nilai: Record<string, string | number | null> }[];
}

type Sel = string | number | Date | null;

function nilaiSel(v: unknown): Sel {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if ('result' in o) return nilaiSel(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if ('text' in o) return String(o.text ?? '');
    return null;
  }
  return String(v);
}

/** CSV sederhana: pemisah , atau ; (Excel versi Indonesia memakai ;), kutip ganda. */
function bacaCsv(teks: string): Sel[][] {
  const barisPertama = teks.split(/\r?\n/, 1)[0] ?? '';
  const pemisah = (barisPertama.match(/;/g)?.length ?? 0) > (barisPertama.match(/,/g)?.length ?? 0) ? ';' : ',';
  const hasil: Sel[][] = [];
  let baris: Sel[] = [], sel = '', kutip = false;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    if (kutip) {
      if (c === '"' && teks[i + 1] === '"') { sel += '"'; i++; } else if (c === '"') kutip = false; else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === pemisah) { baris.push(sel); sel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && teks[i + 1] === '\n') i++;
      baris.push(sel); hasil.push(baris); baris = []; sel = '';
    } else sel += c;
  }
  if (sel !== '' || baris.length) { baris.push(sel); hasil.push(baris); }
  return hasil;
}

async function bacaGrid(file: File): Promise<Sel[][]> {
  const nama = file.name.toLowerCase();
  if (nama.endsWith('.csv')) return bacaCsv((await file.text()).replace(/^﻿/, ''));
  if (nama.endsWith('.xls')) throw new Error('Format .xls (Excel 97–2003) belum didukung. Buka di Excel lalu Simpan Sebagai → Excel Workbook (.xlsx).');
  if (!nama.endsWith('.xlsx')) throw new Error('Gunakan berkas .xlsx atau .csv.');
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  // Lembar "Data" (dari template) didahulukan; selain itu lembar pertama yang berisi.
  const ws = wb.getWorksheet('Data') ?? wb.worksheets.find((w) => w.state !== 'hidden' && w.state !== 'veryHidden' && w.actualRowCount > 0);
  if (!ws) throw new Error('Berkas tidak berisi data.');
  const grid: Sel[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, nomor) => {
    const isi: Sel[] = [];
    row.eachCell({ includeEmpty: true }, (cell, kol) => { isi[kol - 1] = nilaiSel(cell.value); });
    grid[nomor - 1] = isi;
  });
  return Array.from(grid, (r) => r ?? []);
}

export async function bacaBerkasImpor(file: File, jenis: JenisImpor): Promise<HasilBaca> {
  const grid = await bacaGrid(file);
  const def = DEFINISI_IMPOR[jenis];

  // Baris judul = baris (di 15 baris pertama) yang paling banyak judul dikenal.
  let barisJudul = -1, terbaik = 0, peta: Record<number, string> = {};
  for (let r = 0; r < Math.min(15, grid.length); r++) {
    const p = petakanJudul((grid[r] ?? []).map((v) => String(v ?? '')), jenis);
    const n = Object.keys(p).length;
    if (n > terbaik) { terbaik = n; barisJudul = r; peta = p; }
  }
  if (barisJudul < 0 || terbaik < 2) {
    throw new Error(`Judul kolom tidak dikenali. Pastikan baris judul memuat mis. ${def.kolom.filter((k) => k.wajib).map((k) => `"${k.judul}"`).join(', ')} — atau pakai template.`);
  }

  const judul = (grid[barisJudul] ?? []).map((v) => String(v ?? '').trim());
  const dikenali = Object.entries(peta).map(([i, kunci]) => ({ judul: judul[Number(i)], kunci }));
  const diabaikan = judul.filter((j, i) => j && !(i in peta));
  const adaKunci = new Set(Object.values(peta));
  const hilang = def.kolom.filter((k) => k.wajib && !adaKunci.has(k.kunci)).map((k) => k.judul);
  const tipe = Object.fromEntries(def.kolom.map((k) => [k.kunci, k.tipe]));

  const baris: HasilBaca['baris'] = [];
  for (let r = barisJudul + 1; r < grid.length; r++) {
    const isi = grid[r] ?? [];
    const nilai: Record<string, string | number | null> = {};
    let ada = false;
    for (const [i, kunci] of Object.entries(peta)) {
      let v = isi[Number(i)] ?? null;
      if (typeof v === 'string') v = v.trim() || null;
      if (v instanceof Date) v = tipe[kunci] === 'jam' ? bacaJam(v) : bacaTanggal(v);
      if (v !== null && v !== '') ada = true;
      nilai[kunci] = v as string | number | null;
    }
    if (ada) baris.push({ no: r + 1, nilai });
  }
  return { dikenali, diabaikan, hilang, baris };
}

/** Unduh template Excel: lembar Data (judul + daftar pilihan), Petunjuk, dan daftar Sales. */
export async function unduhTemplate(jenis: JenisImpor, sales: { username: string; full_name: string }[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const def = DEFINISI_IMPOR[jenis];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sales Management Platform';

  const ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  const kepala = ws.addRow(def.kolom.map((k) => (k.wajib ? `${k.judul} *` : k.judul)));
  kepala.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  kepala.height = 22;
  def.kolom.forEach((k, i) => {
    const sel = kepala.getCell(i + 1);
    sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: k.wajib ? 'FF1D4ED8' : 'FF64748B' } };
    sel.alignment = { vertical: 'middle' };
    sel.note = k.bantuan;
    const kol = ws.getColumn(i + 1);
    kol.width = Math.max(14, Math.min(34, k.judul.length + 8));
    if (k.tipe === 'tanggal') kol.numFmt = 'dd/mm/yyyy';
    if (k.tipe === 'angka') kol.numFmt = '#,##0';
  });

  // Daftar pilihan di lembar tersembunyi, dipakai dropdown di lembar Data.
  const daftar = wb.addWorksheet('Daftar', { state: 'veryHidden' });
  daftar.getColumn(1).values = ['Sales', ...sales.map((s) => s.username)];
  def.kolom.forEach((k, i) => {
    const huruf = ws.getColumn(i + 1).letter;
    let rumus: string | null = null;
    if (k.tipe === 'sales' && sales.length) rumus = `Daftar!$A$2:$A$${sales.length + 1}`;
    if (k.tipe === 'pilihan' && k.pilihan) rumus = `"${k.pilihan.map((p) => p.label).join(',')}"`;
    if (rumus) {
      // exceljs 4 mendukung rentang validasi, tetapi tipenya belum memuatnya.
      (ws as unknown as { dataValidations: { add: (rentang: string, v: object) => void } }).dataValidations.add(`${huruf}2:${huruf}3001`, {
        type: 'list', allowBlank: true, formulae: [rumus],
        showErrorMessage: false,
      });
    }
  });

  const pt = wb.addWorksheet('Petunjuk');
  pt.getColumn(1).width = 24; pt.getColumn(2).width = 10; pt.getColumn(3).width = 70; pt.getColumn(4).width = 26;
  const j = pt.addRow([`Template Impor ${def.label} — Sales Management Platform`]);
  j.font = { bold: true, size: 14 };
  pt.addRow([def.keterangan]);
  pt.addRow(['Isi data mulai baris ke-2 di lembar "Data". Kolom bertanda * wajib. Satu baris = satu data. Maksimal 3.000 baris per berkas.']);
  pt.addRow(['Data yang sudah ada di platform otomatis dilewati, dan satu kali impor bisa dibatalkan utuh dari Admin Panel → Impor Data.']);
  pt.addRow([]);
  const h = pt.addRow(['Kolom', 'Wajib', 'Keterangan', 'Contoh']);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }; });
  for (const k of def.kolom) {
    const b = pt.addRow([k.judul, k.wajib ? 'Ya' : '', k.bantuan, k.contoh]);
    b.alignment = { vertical: 'top', wrapText: true };
  }
  if (sales.length) {
    pt.addRow([]);
    const hs = pt.addRow(['Username Sales', '', 'Nama Lengkap']);
    hs.font = { bold: true };
    for (const s of sales) pt.addRow([s.username, '', s.full_name]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const nama = `template-impor-${jenis.replace('_', '-')}.xlsx`;
  await simpanBlob(blob, nama);
}
