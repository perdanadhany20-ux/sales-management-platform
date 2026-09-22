'use client';

/**
 * lib/gp-impor.ts — membaca berkas GP Calculation lama menjadi data.
 *
 * Tim sudah memakai berkas Excel ini bertahun-tahun sebelum platform ada.
 * Memaksa mengetik ulang puluhan dokumen lama adalah cara paling pasti membuat
 * modul GP ditinggalkan: yang baru masuk ke platform, yang lama tetap di
 * folder, dan tidak ada satu tempat pun yang lengkap.
 *
 * ── Kenapa pembacaannya berbasis PENCARIAN, bukan alamat sel tetap ─────────
 *
 * Godaannya adalah membaca C5 untuk customer, C6 untuk proyek, dan seterusnya
 * sesuai berkas contoh. Itu akan bekerja sempurna pada berkas contoh dan gagal
 * pada hampir semua berkas lain — karena tiap orang menyisipkan baris, menaruh
 * logo di atas, atau menggeser tabelnya satu-dua kolom.
 *
 * Maka yang dicari di sini adalah LABELNYA: "Customer", "Project Name",
 * "Description", "Qty", dan seterusnya. Tata letak boleh bergeser; selama
 * labelnya masih tertulis, isinya tetap ketemu.
 *
 * Yang dibaca hanya ANGKA MENTAH — deskripsi, qty, harga jual, harga modal,
 * dan biaya. Seluruh turunannya (DPP, PPN, GP, margin) dihitung ulang oleh
 * database. Menyalin angka hasil dari berkas lama justru berbahaya: kalau
 * rumus di berkas itu pernah tertimpa ketikan, kesalahannya ikut terbawa masuk
 * dan menjadi angka resmi.
 */

export interface ItemImpor {
  description: string;
  qty: number;
  vendor: string;
  unit_price: number;
  unit_cost: number;
}

export interface HasilImpor {
  customer_name: string;
  project_name: string;
  po_spk_no: string;
  calc_date: string | null;
  payment_term: string;
  lead_time: string;
  ppn_rate: number | null;
  gp_target: number | null;
  installation_cost: number;
  shipping_cost: number;
  operational_cost: number;
  other_cost: number;
  disbursement_cost: number;
  notes: string;
  item: ItemImpor[];
  /** Hal yang perlu diperiksa manusia sebelum disimpan. */
  catatan: string[];
}

type Sel = { r: number; c: number; teks: string; angka: number | null };

function keTeks(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // Sel berumus: exceljs menyimpan hasilnya di `result`.
    if ('result' in o) return keTeks(o.result);
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((t) => t.text).join('').trim();
    }
    if ('text' in o) return keTeks(o.text);
  }
  return '';
}

function keAngka(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in (v as object)) {
    return keAngka((v as { result: unknown }).result);
  }
  const t = keTeks(v);
  if (!t) return null;
  // Dua gaya penulisan angka beredar di berkas yang sama: "1.234.567,89"
  // (Indonesia) dan "1,234,567.89" (Inggris). Dibedakan dari pemisah TERAKHIR.
  const bersih = t.replace(/[^\d.,-]/g, '');
  if (!bersih) return null;
  const koma = bersih.lastIndexOf(',');
  const titik = bersih.lastIndexOf('.');
  let normal: string;
  if (koma > titik) normal = bersih.replace(/\./g, '').replace(',', '.');
  else normal = bersih.replace(/,/g, '');
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Cari sel yang teksnya cocok, lalu ambil nilai pertama di kanannya. */
function nilaiSetelahLabel(sel: Sel[], label: RegExp, maksKanan = 6): Sel | null {
  const kandidat = sel.filter((s) => label.test(s.teks.toLowerCase()));
  for (const k of kandidat) {
    const kanan = sel
      .filter((s) => s.r === k.r && s.c > k.c && s.c <= k.c + maksKanan && s.teks !== '')
      .sort((a, b) => a.c - b.c);
    if (kanan.length > 0) return kanan[0];
  }
  return null;
}

export async function baaGpDariExcel(file: File): Promise<HasilImpor> {
  const { default: ExcelJS } = await import('exceljs');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Berkas ini tidak memuat satu pun lembar kerja.');

  // Seluruh sel diratakan jadi satu daftar sekali di awal. Pencarian label di
  // bawah dilakukan berkali-kali; memindai ulang lembar kerjanya tiap kali
  // membuat berkas besar terasa membeku.
  const sel: Sel[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const teks = keTeks(cell.value);
      if (teks === '') return;
      sel.push({ r, c, teks, angka: keAngka(cell.value) });
    });
  });

  const catatan: string[] = [];
  const ambilTeks = (label: RegExp) => nilaiSetelahLabel(sel, label)?.teks ?? '';
  const ambilAngka = (label: RegExp) => nilaiSetelahLabel(sel, label)?.angka ?? null;

  /** Tarif ditulis bermacam gaya: 0,11 · 11 · "11%". Ketiganya jadi 0,11. */
  const keTarif = (n: number | null): number | null => {
    if (n === null) return null;
    if (n > 1) return n / 100;
    return n;
  };

  // ── Kepala dokumen ──
  const customer = ambilTeks(/^customer\b/);
  const proyek = ambilTeks(/^project\s*name\b/);
  const poSpk = ambilTeks(/^(po\s*\/?\s*spk|po\b|spk\b)/);
  const term = ambilTeks(/^payment\s*term/);
  const lead = ambilTeks(/^lead\s*time/);
  const tanggalSel = nilaiSetelahLabel(sel, /^date\b/);

  let tanggal: string | null = null;
  if (tanggalSel) {
    const d = new Date(tanggalSel.teks);
    if (!Number.isNaN(d.getTime())) tanggal = d.toISOString().slice(0, 10);
  }

  // ── Tabel item ──
  //
  // Baris kepala ditemukan dari kolom "Description"; kolom lainnya dicari di
  // baris yang sama. Berkas yang kepalanya dua tingkat (Selling → Unit Price /
  // Total) tetap terbaca karena yang dicocokkan katanya, bukan posisinya.
  const barisKepala = sel.find((s) => /^description$/i.test(s.teks));
  const item: ItemImpor[] = [];

  if (!barisKepala) {
    catatan.push('Tabel item tidak ditemukan — kolom "Description" tidak ada. Item harus diisi manual.');
  } else {
    const kepala = sel.filter((s) => s.r === barisKepala.r || s.r === barisKepala.r + 1);
    const kolom = (pola: RegExp): number | null => {
      const k = kepala.find((s) => pola.test(s.teks.toLowerCase()));
      return k ? k.c : null;
    };

    const kDesc = barisKepala.c;
    const kQty = kolom(/^qty|quantity/);
    const kVendor = kolom(/vendor|supplier/);
    const kHargaJual = kolom(/unit\s*price|harga\s*jual/);
    const kHargaModal = kolom(/unit\s*cost|harga\s*modal|cost\s*price/);

    if (kQty === null) catatan.push('Kolom Qty tidak ditemukan; seluruh qty diisi 1.');
    if (kHargaJual === null) catatan.push('Kolom Unit Price tidak ditemukan; harga jual diisi 0.');
    if (kHargaModal === null) catatan.push('Kolom Unit Cost tidak ditemukan; harga modal diisi 0.');

    const barisMaks = Math.max(...sel.map((s) => s.r));
    for (let r = barisKepala.r + 1; r <= barisMaks; r += 1) {
      const deskripsiSel = sel.find((s) => s.r === r && s.c === kDesc);
      const deskripsi = deskripsiSel?.teks ?? '';

      // Baris TOTAL menandai akhir tabel. Tanpa penjaga ini, angka totalnya
      // ikut masuk sebagai satu item dan seluruh nilainya terhitung dua kali.
      if (/^(total|grand\s*total|sub\s*total)/i.test(deskripsi)) break;
      if (!deskripsi) continue;

      const angkaDi = (c: number | null) =>
        c === null ? null : (sel.find((s) => s.r === r && s.c === c)?.angka ?? null);

      item.push({
        description: deskripsi,
        qty: angkaDi(kQty) ?? 1,
        vendor: kVendor === null ? '' : (sel.find((s) => s.r === r && s.c === kVendor)?.teks ?? ''),
        unit_price: angkaDi(kHargaJual) ?? 0,
        unit_cost: angkaDi(kHargaModal) ?? 0,
      });
    }
  }

  if (item.length === 0) {
    catatan.push('Tidak ada baris item yang terbaca. Periksa berkasnya, atau isi itemnya manual.');
  }

  const hasil: HasilImpor = {
    customer_name: customer,
    project_name: proyek,
    po_spk_no: poSpk,
    calc_date: tanggal,
    payment_term: term,
    lead_time: lead,
    ppn_rate: keTarif(ambilAngka(/^ppn\b/)),
    gp_target: keTarif(ambilAngka(/gp\s*target/)),
    installation_cost: ambilAngka(/instala|instalasi/) ?? 0,
    shipping_cost: ambilAngka(/shipping|delivery|pengiriman/) ?? 0,
    operational_cost: ambilAngka(/operational|operasional/) ?? 0,
    other_cost: ambilAngka(/other\s*cost|biaya\s*lain/) ?? 0,
    disbursement_cost: ambilAngka(/disbursement/) ?? 0,
    notes: '',
    item,
    catatan,
  };

  if (!hasil.customer_name) catatan.push('Customer tidak terbaca — isi manual.');
  if (!hasil.project_name) catatan.push('Nama proyek tidak terbaca — isi manual.');

  return hasil;
}
