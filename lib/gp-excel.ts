'use client';

import type { GpRingkasan, GpItem } from './gp';

/**
 * lib/gp-excel.ts — ekspor GP Calculation ke .xlsx dengan tata letak yang
 * SAMA dengan berkas asli tim (GP_BALAIKOTA.xlsx).
 *
 * Kesamaan tata letak ini bukan soal selera. Berkas GP beredar ke Manager,
 * Director, dan Finance yang sudah bertahun-tahun membacanya dengan urutan
 * tertentu; berkas dengan isi benar tapi susunan berbeda akan dibaca ulang
 * dari awal setiap kali, dan yang paling sering terjadi berikutnya adalah
 * orang kembali memakai berkas manualnya.
 *
 * Satu perbedaan yang disengaja: sel-sel di sini berisi ANGKA, bukan rumus.
 * Pada berkas aslinya rumus bisa tertimpa ketikan tanpa satu pun tanda di
 * layar, lalu angka yang salah itulah yang dibawa ke rapat. Di sini angkanya
 * sudah dihitung database dan tinggal dibaca.
 */

const BIRU = 'FF1D4ED8';
const BIRU_TUA = 'FF1E40AF';
const ABU = 'FFF1F5F9';
const ABU_GARIS = 'FFCBD5E1';

const RP = '#,##0';
const PERSEN = '0.00"%"';

export async function eksporGpExcel(
  gp: GpRingkasan,
  item: GpItem[],
  namaSales: string,
  namaTandaTangan: { diperiksa?: string; disetujui?: string; diverifikasi?: string },
): Promise<void> {
  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sales Management Platform';
  wb.created = new Date();

  const ws = wb.addWorksheet(gp.project_name.slice(0, 28) || 'GP', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  // 15 kolom, sama seperti berkas asli.
  ws.columns = Array.from({ length: 15 }, (_, i) => ({
    width: i === 1 ? 34 : i === 0 ? 6 : 14,
  }));

  const KOL = 15;

  /* ── Alat bantu ─────────────────────────────────────────────────────── */

  const gabung = (baris: number, dari: number, sampai: number) =>
    ws.mergeCells(baris, dari, baris, sampai);

  const isi = (
    baris: number, kolom: number, nilai: unknown,
    opsi: { tebal?: boolean; ukuran?: number; format?: string; warna?: string;
            latar?: string; rata?: 'left' | 'center' | 'right' } = {},
  ) => {
    const sel = ws.getCell(baris, kolom);
    sel.value = nilai as never;
    sel.font = {
      bold: opsi.tebal ?? false,
      size: opsi.ukuran ?? 10,
      color: { argb: opsi.warna ?? 'FF0F172A' },
    };
    if (opsi.format) sel.numFmt = opsi.format;
    if (opsi.latar) {
      sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opsi.latar } };
    }
    sel.alignment = { vertical: 'middle', horizontal: opsi.rata ?? 'left', wrapText: false };
    return sel;
  };

  const garisBawah = (baris: number, dari = 1, sampai = KOL) => {
    for (let c = dari; c <= sampai; c++) {
      ws.getCell(baris, c).border = { bottom: { style: 'thin', color: { argb: ABU_GARIS } } };
    }
  };

  const judulBagian = (baris: number, teks: string, dari: number, sampai: number) => {
    gabung(baris, dari, sampai);
    isi(baris, dari, teks, { tebal: true, ukuran: 9, warna: 'FFFFFFFF', latar: BIRU });
  };

  /* ── Judul ──────────────────────────────────────────────────────────── */

  gabung(1, 1, KOL);
  isi(1, 1, 'GROSS PROFIT CALCULATION FORM',
    { tebal: true, ukuran: 15, warna: 'FFFFFFFF', latar: BIRU_TUA, rata: 'center' });
  ws.getRow(1).height = 26;

  gabung(2, 1, KOL);
  isi(2, 1, `${gp.nomor}  ·  ${gp.currency}`,
    { ukuran: 9, warna: 'FF64748B', rata: 'center' });

  /* ── Identitas & ringkasan proyek ───────────────────────────────────── */

  const pasangan = (baris: number, kolLabel: number, label: string,
                    nilai: unknown, format?: string) => {
    isi(baris, kolLabel, label, { tebal: true, ukuran: 9, warna: 'FF64748B' });
    gabung(baris, kolLabel + 1, kolLabel + 2);
    isi(baris, kolLabel + 1, nilai, { format, ukuran: 10 });
  };

  pasangan(4, 1, 'Customer', gp.customer_name);
  pasangan(5, 1, 'Project Name', gp.project_name);
  pasangan(6, 1, 'Sales', namaSales);
  pasangan(7, 1, 'PO / SPK No', gp.po_spk_no ?? '-');

  pasangan(4, 6, 'Date', gp.calc_date);
  pasangan(5, 6, 'PPN', Number(gp.ppn_rate) * 100, PERSEN);
  pasangan(6, 6, 'Payment Term', gp.payment_term ?? '-');
  pasangan(7, 6, 'Lead Time', gp.lead_time ?? '-');

  judulBagian(3, 'PROJECT SUMMARY', 11, KOL);
  pasangan(4, 11, 'GP Target', Number(gp.gp_target) * 100, PERSEN);
  pasangan(5, 11, 'Net Margin', Number(gp.net_margin) * 100, PERSEN);
  pasangan(6, 11, 'Status', gp.mutu_margin);
  pasangan(7, 11, 'Dokumen', gp.status);

  /* ── EXECUTIVE SUMMARY ──────────────────────────────────────────────── */

  judulBagian(9, 'EXECUTIVE SUMMARY', 1, KOL);

  const kotak = (kolDari: number, kolSampai: number, label: string,
                 nilai: number, format: string) => {
    gabung(10, kolDari, kolSampai);
    isi(10, kolDari, label, { tebal: true, ukuran: 8, warna: 'FF64748B', latar: ABU, rata: 'center' });
    gabung(11, kolDari, kolSampai);
    isi(11, kolDari, nilai, { tebal: true, ukuran: 12, format, rata: 'center' });
  };

  kotak(1, 4, 'NET AMOUNT RECEIVED', Number(gp.net_amount_received), RP);
  kotak(5, 8, 'TOTAL COSTING', Number(gp.total_costing), RP);
  kotak(9, 12, 'NET PROFIT', Number(gp.net_profit), RP);
  kotak(13, 15, 'NET MARGIN', Number(gp.net_margin) * 100, PERSEN);
  ws.getRow(11).height = 20;

  /* ── DETAIL ITEM ────────────────────────────────────────────────────── */

  judulBagian(13, 'DETAIL ITEM', 1, KOL);

  const KEPALA = [
    'No', 'Description', '', 'Qty', 'Vendor',
    'Unit Price', '', 'Total Selling', '', '',
    'Unit Cost', 'Total Cost', '', 'GP (Rp)', 'GP %',
  ];
  KEPALA.forEach((teks, i) => {
    isi(14, i + 1, teks, {
      tebal: true, ukuran: 9, warna: 'FFFFFFFF', latar: BIRU,
      rata: i >= 3 ? 'center' : 'left',
    });
  });
  gabung(14, 2, 3);
  gabung(14, 6, 7);
  gabung(14, 8, 10);
  gabung(14, 12, 13);
  ws.getRow(14).height = 18;

  let baris = 15;
  for (const [i, it] of item.entries()) {
    isi(baris, 1, i + 1, { rata: 'center' });
    gabung(baris, 2, 3);
    isi(baris, 2, it.description);
    isi(baris, 4, Number(it.qty), { format: '#,##0.##', rata: 'center' });
    isi(baris, 5, it.vendor ?? '');
    gabung(baris, 6, 7);
    isi(baris, 6, Number(it.unit_price), { format: RP, rata: 'right' });
    gabung(baris, 8, 10);
    isi(baris, 8, Number(it.selling_total), { format: RP, rata: 'right' });
    isi(baris, 11, Number(it.unit_cost), { format: RP, rata: 'right' });
    gabung(baris, 12, 13);
    isi(baris, 12, Number(it.costing_total), { format: RP, rata: 'right' });
    isi(baris, 14, Number(it.gp_amount), { format: RP, rata: 'right' });
    isi(baris, 15, Number(it.gp_percentage), { format: PERSEN, rata: 'right' });
    garisBawah(baris);
    baris += 1;
  }

  const barisTotal = baris;
  gabung(barisTotal, 1, 3);
  isi(barisTotal, 1, 'TOTAL', { tebal: true, latar: ABU });
  isi(barisTotal, 4, Number(gp.total_qty), { tebal: true, format: '#,##0.##', latar: ABU, rata: 'center' });
  isi(barisTotal, 5, '', { latar: ABU });
  gabung(barisTotal, 6, 7);
  isi(barisTotal, 6, '', { latar: ABU });
  gabung(barisTotal, 8, 10);
  isi(barisTotal, 8, Number(gp.total_selling), { tebal: true, format: RP, latar: ABU, rata: 'right' });
  isi(barisTotal, 11, '', { latar: ABU });
  gabung(barisTotal, 12, 13);
  isi(barisTotal, 12, Number(gp.total_material), { tebal: true, format: RP, latar: ABU, rata: 'right' });
  isi(barisTotal, 14, Number(gp.gross_profit), { tebal: true, format: RP, latar: ABU, rata: 'right' });
  isi(barisTotal, 15,
    Number(gp.total_selling) === 0 ? 0 : (Number(gp.gross_profit) / Number(gp.total_selling)) * 100,
    { tebal: true, format: PERSEN, latar: ABU, rata: 'right' });

  /* ── Tiga blok ringkasan ────────────────────────────────────────────── */

  const awal = barisTotal + 2;

  judulBagian(awal, 'SELLING SUMMARY', 1, 3);
  judulBagian(awal, 'COST BREAKDOWN', 5, 9);
  judulBagian(awal, 'PROFIT ANALYSIS', 11, KOL);

  const barisBlok = (r: number, kolLabel: number, kolNilai: number,
                     label: string, nilai: number, format = RP, tebal = false) => {
    isi(r, kolLabel, label, { tebal, ukuran: 9, warna: tebal ? 'FF0F172A' : 'FF475569' });
    gabung(r, kolNilai, kolNilai + 2);
    isi(r, kolNilai, nilai, { tebal, format, rata: 'right', ukuran: tebal ? 11 : 10 });
  };

  barisBlok(awal + 1, 1, 2, 'Total Selling (DPP)', Number(gp.dpp));
  barisBlok(awal + 2, 1, 2, `PPN ${(Number(gp.ppn_rate) * 100).toFixed(0)}%`, Number(gp.ppn_amount));
  barisBlok(awal + 3, 1, 2, `Pph ${(Number(gp.pph_rate) * 100).toFixed(1)}%`, Number(gp.pph_amount));
  barisBlok(awal + 4, 1, 2, 'Biaya Pembayaran & Disbursement', Number(gp.disbursement_cost));
  barisBlok(awal + 5, 1, 2, 'NET AMOUNT RECEIVED', Number(gp.net_amount_received), RP, true);

  barisBlok(awal + 1, 5, 7, 'Total Material Cost', Number(gp.total_material));
  barisBlok(awal + 2, 5, 7, 'Instalation Cost', Number(gp.installation_cost));
  barisBlok(awal + 3, 5, 7, 'Shipping / Delivery', Number(gp.shipping_cost));
  barisBlok(awal + 4, 5, 7, 'Operational Cost', Number(gp.operational_cost));
  barisBlok(awal + 5, 5, 7, 'Other Cost', Number(gp.other_cost));
  barisBlok(awal + 6, 5, 7, 'TOTAL COSTING', Number(gp.total_costing), RP, true);

  barisBlok(awal + 1, 11, 13, 'Gross Profit (item)', Number(gp.gross_profit));
  barisBlok(awal + 2, 11, 13, 'NET PROFIT', Number(gp.net_profit), RP, true);
  barisBlok(awal + 3, 11, 13, 'Net Margin', Number(gp.net_margin) * 100, PERSEN, true);
  isi(awal + 4, 11, 'GP Target', { ukuran: 9, warna: 'FF475569' });
  gabung(awal + 4, 13, 15);
  isi(awal + 4, 13, Number(gp.gp_target) * 100, { format: PERSEN, rata: 'right' });
  isi(awal + 5, 11, 'Status Margin', { ukuran: 9, warna: 'FF475569' });
  gabung(awal + 5, 13, 15);
  isi(awal + 5, 13, gp.mutu_margin, { tebal: true, rata: 'right' });

  /* ── Informasi tambahan & catatan ───────────────────────────────────── */

  const info = awal + 8;
  judulBagian(info, 'ADDITIONAL INFORMATION', 11, KOL);
  isi(info + 1, 11, 'WAPU', { ukuran: 9, warna: 'FF475569' });
  gabung(info + 1, 13, 15);
  isi(info + 1, 13, gp.wapu ? 'Ya' : 'Tidak', { rata: 'right' });
  isi(info + 2, 11, 'Currency', { ukuran: 9, warna: 'FF475569' });
  gabung(info + 2, 13, 15);
  isi(info + 2, 13, gp.currency, { rata: 'right' });

  judulBagian(info, 'NOTES', 1, 9);
  ws.mergeCells(info + 1, 1, info + 3, 9);
  isi(info + 1, 1, gp.notes ?? '-', { ukuran: 9 });
  ws.getCell(info + 1, 1).alignment = { vertical: 'top', wrapText: true };

  /* ── APPROVAL ───────────────────────────────────────────────────────── */

  const app = info + 5;
  judulBagian(app, 'APPROVAL', 1, KOL);

  const TTD: [string, string, string | undefined, string | null][] = [
    ['Prepared By', 'Sales', namaSales, gp.submitted_at],
    ['Checked By', 'Manager Sales', namaTandaTangan.diperiksa, gp.checked_at],
    ['Approved By', 'Director', namaTandaTangan.disetujui, gp.approved_at],
    ['Verified By', 'Finance', namaTandaTangan.diverifikasi, gp.verified_at],
  ];

  TTD.forEach(([label, peran, nama, waktu], i) => {
    const k = 1 + i * 4;
    gabung(app + 1, k, k + 2);
    isi(app + 1, k, label, { tebal: true, ukuran: 9, warna: 'FF64748B', rata: 'center' });
    gabung(app + 2, k, k + 2);
    isi(app + 2, k, peran, { ukuran: 8, warna: 'FF94A3B8', rata: 'center' });
    // Tiga baris kosong: ruang tanda tangan basah pada cetakan.
    gabung(app + 5, k, k + 2);
    isi(app + 5, k, nama ?? '—', { tebal: true, rata: 'center' });
    garisBawah(app + 4, k, k + 2);
    gabung(app + 6, k, k + 2);
    isi(app + 6, k, waktu ? new Date(waktu).toLocaleString('id-ID') : 'belum',
      { ukuran: 8, warna: 'FF94A3B8', rata: 'center' });
  });

  if (gp.status === 'DITOLAK' && gp.rejection_reason) {
    gabung(app + 8, 1, KOL);
    isi(app + 8, 1, `DITOLAK — ${gp.rejection_reason}`,
      { tebal: true, warna: 'FFB91C1C', latar: 'FFFCE3E3' });
  }

  const buffer = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${gp.nomor.replace(/\//g, '-')}-${gp.project_name.replace(/[^\w\s-]/g, '').trim().slice(0, 30)}.xlsx`,
  );
}
