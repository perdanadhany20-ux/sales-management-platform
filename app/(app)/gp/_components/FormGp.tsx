'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { rupiah, rupiahRingkas, tanggalISO, persen } from '@/lib/format';
import type { GpRingkasan, GpItem } from '@/lib/gp';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, AreaTeks, Tombol, Uang } from '@/components/shared/FormParts';
import { PilihCustomer } from '@/components/shared/PilihCustomer';
import { useToast } from '@/components/shared/Feedback';

/**
 * Formulir GP Calculation.
 *
 * Dua bagian yang sengaja dipisah tegas: IDENTITAS + BIAYA di atas, DETAIL
 * ITEM di bawah. Pemisahan itu mengikuti berkas asli, dan lebih dari itu —
 * item hanya bisa disimpan setelah dokumennya ada, karena setiap item
 * menunjuk ke calculation_id. Dokumen disimpan lebih dulu, baru itemnya.
 *
 * Seluruh angka turunan (DPP, PPN, GP, margin) TIDAK dihitung di sini. Yang
 * tampil sebagai pratinjau di bawah diambil kembali dari view sm_gp_ringkasan
 * sesudah tersimpan, sehingga yang dilihat penyusun sama persis dengan yang
 * nanti dilihat Director.
 */

interface DrafItem {
  /** id kosong berarti baris baru yang belum pernah tersimpan. */
  id?: string;
  description: string;
  qty: number;
  vendor: string;
  unit_price: number;
  unit_cost: number;
}

function itemKosong(): DrafItem {
  return { description: '', qty: 1, vendor: '', unit_price: 0, unit_cost: 0 };
}

export function FormGp({ buka, onTutup, onTersimpan, awal, awalItem }: {
  buka: boolean;
  onTutup: () => void;
  onTersimpan: (id: string) => void;
  awal: GpRingkasan | null;
  awalItem: GpItem[];
}) {
  const { pengguna } = usePenggunaAktif();
  const toast = useToast();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [poSpk, setPoSpk] = useState('');
  const [tanggal, setTanggal] = useState(tanggalISO());
  const [paymentTerm, setPaymentTerm] = useState('');
  const [leadTime, setLeadTime] = useState('');

  const [ppn, setPpn] = useState(11);
  const [pph, setPph] = useState(2.5);
  const [target, setTarget] = useState(20);

  const [instalasi, setInstalasi] = useState(0);
  const [kirim, setKirim] = useState(0);
  const [operasional, setOperasional] = useState(0);
  const [lain, setLain] = useState(0);
  const [disbursement, setDisbursement] = useState(0);

  const [wapu, setWapu] = useState(false);
  const [catatan, setCatatan] = useState('');

  const [item, setItem] = useState<DrafItem[]>([itemKosong()]);
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    if (!buka) return;
    if (awal) {
      setCustomerId(awal.customer_id);
      setCustomerName(awal.customer_name);
      setProjectName(awal.project_name);
      setPoSpk(awal.po_spk_no ?? '');
      setTanggal(awal.calc_date);
      setPaymentTerm(awal.payment_term ?? '');
      setLeadTime(awal.lead_time ?? '');
      setPpn(Number(awal.ppn_rate) * 100);
      setPph(Number(awal.pph_rate) * 100);
      setTarget(Number(awal.gp_target) * 100);
      setInstalasi(Number(awal.installation_cost));
      setKirim(Number(awal.shipping_cost));
      setOperasional(Number(awal.operational_cost));
      setLain(Number(awal.other_cost));
      setDisbursement(Number(awal.disbursement_cost));
      setWapu(awal.wapu);
      setCatatan(awal.notes ?? '');
      setItem(awalItem.length > 0
        ? awalItem.map((i) => ({
            id: i.id, description: i.description, qty: Number(i.qty),
            vendor: i.vendor ?? '', unit_price: Number(i.unit_price),
            unit_cost: Number(i.unit_cost),
          }))
        : [itemKosong()]);
    } else {
      setCustomerId(null); setCustomerName(''); setProjectName(''); setPoSpk('');
      setTanggal(tanggalISO()); setPaymentTerm(''); setLeadTime('');
      setPpn(11); setPph(2.5); setTarget(20);
      setInstalasi(0); setKirim(0); setOperasional(0); setLain(0); setDisbursement(0);
      setWapu(false); setCatatan(''); setItem([itemKosong()]);
    }
    setGalat(null);
  }, [buka, awal, awalItem]);

  /** Pratinjau kasar, semata untuk menahan salah ketik besar sebelum disimpan.
   *  Angka yang berlaku tetap yang dihitung database sesudahnya. */
  const totalJual = item.reduce((t, i) => t + i.unit_price * i.qty, 0);
  const totalModal = item.reduce((t, i) => t + i.unit_cost * i.qty, 0);
  const dppPratinjau = ppn === -100 ? 0 : totalJual / (1 + ppn / 100);
  const totalBiaya = totalModal + instalasi + kirim + operasional + lain;
  const netPratinjau = dppPratinjau - dppPratinjau * (pph / 100) - disbursement - totalBiaya;
  const marginPratinjau = dppPratinjau === 0 ? 0 : (netPratinjau / dppPratinjau) * 100;

  function ubahItem(indeks: number, tambal: Partial<DrafItem>) {
    setItem((d) => d.map((x, i) => (i === indeks ? { ...x, ...tambal } : x)));
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    if (!pengguna) return;
    setGalat(null);

    const bersih = item.filter((i) => i.description.trim() !== '');
    if (bersih.length === 0) {
      setGalat('Tambahkan minimal satu item dengan deskripsi.');
      return;
    }

    setMenyimpan(true);
    try {
      const isian = {
        customer_id: customerId,
        customer_name: customerName.trim(),
        project_name: projectName.trim(),
        po_spk_no: poSpk.trim() || null,
        calc_date: tanggal,
        payment_term: paymentTerm.trim() || null,
        lead_time: leadTime.trim() || null,
        ppn_rate: ppn / 100,
        pph_rate: pph / 100,
        gp_target: target / 100,
        installation_cost: instalasi,
        shipping_cost: kirim,
        operational_cost: operasional,
        other_cost: lain,
        disbursement_cost: disbursement,
        wapu,
        notes: catatan.trim() || null,
      };

      let id = awal?.id ?? '';

      if (awal) {
        const { error } = await supabase.from('sm_gp_calculations')
          .update(isian).eq('id', awal.id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from('sm_gp_calculations')
          // status & nomor sengaja TIDAK dikirim: yang pertama dijaga policy
          // gp_buat, yang kedua diterbitkan trigger sm_gp_nomor().
          .insert({ ...isian, sales_user_id: pengguna.id })
          .select('id').single();
        if (error) throw new Error(error.message);
        id = (data as { id: string }).id;
      }

      // Item disinkronkan dengan cara paling sederhana yang benar: yang lama
      // dihapus, yang di layar disisipkan ulang. Pencocokan baris per baris
      // terlihat lebih hemat, tapi menuntut melacak baris mana yang berubah,
      // dipindah, atau dihapus — sumber bug yang tidak sepadan untuk tabel
      // sependek ini, dan seluruhnya berada dalam satu dokumen milik satu
      // orang yang sedang membukanya.
      if (awal) {
        const { error } = await supabase.from('sm_gp_items')
          .delete().eq('calculation_id', id);
        if (error) throw new Error(error.message);
      }

      const { error: galatItem } = await supabase.from('sm_gp_items').insert(
        bersih.map((i, urut) => ({
          calculation_id: id,
          urutan: urut + 1,
          description: i.description.trim(),
          qty: i.qty,
          vendor: i.vendor.trim() || null,
          unit_price: i.unit_price,
          unit_cost: i.unit_cost,
          // selling_total, costing_total, gp_amount, gp_percentage adalah
          // kolom GENERATED — mengirimnya akan ditolak database.
        })),
      );
      if (galatItem) throw new Error(galatItem.message);

      toast('sukses', awal ? 'Perhitungan diperbarui.' : 'Perhitungan tersimpan sebagai draft.');
      onTersimpan(id);
      onTutup();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan perhitungan.');
    } finally {
      setMenyimpan(false);
    }
  }

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={awal ? `Sunting ${awal.nomor}` : 'GP Calculation Baru'}
      keterangan="Harga jual per unit diisi BRUTO — sudah termasuk PPN, sama seperti berkas GP yang biasa dipakai."
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" onClick={onTutup} className="text-[12px] py-2">Batal</Tombol>
          <Tombol type="submit" form="form-gp" memuat={menyimpan} className="text-[12px] py-2">
            {awal ? 'Simpan Perubahan' : 'Simpan Draft'}
          </Tombol>
        </>
      }
    >
      <form id="form-gp" onSubmit={simpan} className="flex flex-col gap-5">

        {galat && (
          <p role="alert" className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-3 py-2">
            {galat}
          </p>
        )}

        {/* ── Identitas ── */}
        <section>
          <Judul>Identitas Proyek</Judul>
          <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3.5">
            <Kolom label="Customer" wajib>
              {(id, invalid) => (
                <PilihCustomer
                  id={id} invalid={invalid}
                  nilai={{ customer_id: customerId, customer_name: customerName }}
                  onUbah={(v) => { setCustomerId(v.customer_id); setCustomerName(v.customer_name); }}
                />
              )}
            </Kolom>
            <Kolom label="Nama Proyek" wajib>
              {(id) => (
                <Teks id={id} value={projectName} required
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="mis. Camera" />
              )}
            </Kolom>
            <Kolom label="PO / SPK No">
              {(id) => (
                <Teks id={id} value={poSpk} onChange={(e) => setPoSpk(e.target.value)}
                  placeholder="Kosongkan bila belum terbit" />
              )}
            </Kolom>
            <Kolom label="Tanggal" wajib>
              {(id) => (
                <Teks id={id} type="date" value={tanggal} required
                  onChange={(e) => setTanggal(e.target.value)} />
              )}
            </Kolom>
            <Kolom label="Payment Term">
              {(id) => (
                <Teks id={id} value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)}
                  placeholder="mis. 30 hari setelah BAST" />
              )}
            </Kolom>
            <Kolom label="Lead Time">
              {(id) => (
                <Teks id={id} value={leadTime} onChange={(e) => setLeadTime(e.target.value)}
                  placeholder="mis. 4 minggu" />
              )}
            </Kolom>
          </div>
        </section>

        {/* ── Tarif ── */}
        <section>
          <Judul>Tarif &amp; Target</Judul>
          <div className="grid grid-cols-1 formulir:grid-cols-3 gap-3.5">
            <Kolom label="PPN (%)" wajib
              bantuan="Dipakai memecah harga bruto item jadi DPP.">
              {(id) => (
                <Teks id={id} type="number" step="0.01" min="0" max="100" value={ppn}
                  onChange={(e) => setPpn(Number(e.target.value))} required />
              )}
            </Kolom>
            <Kolom label="Pph (%)" wajib bantuan="Dihitung dari DPP.">
              {(id) => (
                <Teks id={id} type="number" step="0.01" min="0" max="100" value={pph}
                  onChange={(e) => setPph(Number(e.target.value))} required />
              )}
            </Kolom>
            <Kolom label="GP Target (%)" wajib
              bantuan="Pembanding untuk status mutu margin.">
              {(id) => (
                <Teks id={id} type="number" step="0.01" min="0" max="100" value={target}
                  onChange={(e) => setTarget(Number(e.target.value))} required />
              )}
            </Kolom>
          </div>
        </section>

        {/* ── Item ── */}
        <section>
          <div className="flex items-end justify-between gap-2 mb-2">
            <Judul tanpaMargin>Detail Item</Judul>
            <Tombol rupa="kedua" className="text-[11px] py-1.5"
              onClick={() => setItem((d) => [...d, itemKosong()])}>
              + Tambah Item
            </Tombol>
          </div>

          <div className="flex flex-col gap-2">
            {item.map((it, i) => {
              const jual = it.unit_price * it.qty;
              const modal = it.unit_cost * it.qty;
              const gp = jual - modal;
              return (
                <div key={i} className="rounded-kartu border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 grid place-items-center text-[11px] font-bold text-slate-500 mt-1.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0 grid grid-cols-1 formulir:grid-cols-6 gap-2.5">
                      <div className="formulir:col-span-3">
                        <Kolom label="Deskripsi" wajib>
                          {(id) => (
                            <Teks id={id} value={it.description}
                              onChange={(e) => ubahItem(i, { description: e.target.value })}
                              placeholder="mis. Kamera Sony A7S III Body Only" />
                          )}
                        </Kolom>
                      </div>
                      <div className="formulir:col-span-1">
                        <Kolom label="Qty">
                          {(id) => (
                            <Teks id={id} type="number" step="0.01" min="0" value={it.qty}
                              onChange={(e) => ubahItem(i, { qty: Number(e.target.value) })} />
                          )}
                        </Kolom>
                      </div>
                      <div className="formulir:col-span-2">
                        <Kolom label="Vendor">
                          {(id) => (
                            <Teks id={id} value={it.vendor}
                              onChange={(e) => ubahItem(i, { vendor: e.target.value })}
                              placeholder="Opsional" />
                          )}
                        </Kolom>
                      </div>
                      <div className="formulir:col-span-3">
                        <Kolom label="Harga Jual / unit (bruto)">
                          {(id, invalid) => (
                            <Uang id={id} nilai={it.unit_price} invalid={invalid}
                              onUbah={(n) => ubahItem(i, { unit_price: n })} />
                          )}
                        </Kolom>
                      </div>
                      <div className="formulir:col-span-3">
                        <Kolom label="Harga Modal / unit">
                          {(id, invalid) => (
                            <Uang id={id} nilai={it.unit_cost} invalid={invalid}
                              onUbah={(n) => ubahItem(i, { unit_cost: n })} />
                          )}
                        </Kolom>
                      </div>
                    </div>

                    {item.length > 1 && (
                      <button
                        type="button" aria-label={`Hapus item ${i + 1}`}
                        onClick={() => setItem((d) => d.filter((_, j) => j !== i))}
                        className="flex-shrink-0 w-7 h-7 grid place-items-center rounded-kecil text-slate-400 hover:bg-[#fce3e3] hover:text-[#e34948] transition-colors mt-1"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-4 flex-wrap mt-2 pl-8 text-[11px] tabular-nums">
                    <span className="text-slate-500">Jual <b className="text-slate-700">{rupiahRingkas(jual)}</b></span>
                    <span className="text-slate-500">Modal <b className="text-slate-700">{rupiahRingkas(modal)}</b></span>
                    <span className={gp >= 0 ? 'text-[#008300]' : 'text-[#e34948]'}>
                      GP <b>{rupiahRingkas(gp)}</b>
                      {jual > 0 && <span className="opacity-70"> · {persen((gp / jual) * 100)}</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Biaya ── */}
        <section>
          <Judul>Cost Breakdown &amp; Potongan</Judul>
          <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3.5">
            <Kolom label="Instalation Cost">
              {(id, inv) => <Uang id={id} nilai={instalasi} invalid={inv} onUbah={setInstalasi} />}
            </Kolom>
            <Kolom label="Shipping / Delivery">
              {(id, inv) => <Uang id={id} nilai={kirim} invalid={inv} onUbah={setKirim} />}
            </Kolom>
            <Kolom label="Operational Cost">
              {(id, inv) => <Uang id={id} nilai={operasional} invalid={inv} onUbah={setOperasional} />}
            </Kolom>
            <Kolom label="Other Cost">
              {(id, inv) => <Uang id={id} nilai={lain} invalid={inv} onUbah={setLain} />}
            </Kolom>
            <Kolom label="Biaya Pembayaran & Disbursement"
              bantuan="Memotong penerimaan, bukan biaya proyek — sama seperti berkas asli.">
              {(id, inv) => <Uang id={id} nilai={disbursement} invalid={inv} onUbah={setDisbursement} />}
            </Kolom>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-700 cursor-pointer select-none">
                <input type="checkbox" checked={wapu} onChange={(e) => setWapu(e.target.checked)}
                  className="w-4 h-4 accent-aksen-700" />
                WAPU (PPN dipungut pemberi kerja)
              </label>
            </div>
          </div>

          <div className="mt-3.5">
            <Kolom label="Catatan">
              {(id) => (
                <AreaTeks id={id} rows={2} value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  placeholder="Hal yang perlu diketahui pemeriksa." />
              )}
            </Kolom>
          </div>
        </section>

        {/* ── Pratinjau ── */}
        <section className="rounded-kartu bg-slate-50 border border-slate-200 p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
            Pratinjau kasar
          </p>
          <div className="grid grid-cols-2 formulir:grid-cols-4 gap-3">
            <Angka label="Total Selling (bruto)" nilai={rupiah(totalJual)} />
            <Angka label="DPP" nilai={rupiah(dppPratinjau)} />
            <Angka label="Total Costing" nilai={rupiah(totalBiaya)} />
            <Angka label="Net Margin"
              nilai={persen(marginPratinjau)}
              warna={marginPratinjau >= target ? '#008300' : marginPratinjau >= target - 5 ? '#eda100' : '#e34948'} />
          </div>
          <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
            Angka ini pratinjau di peramban. Yang berlaku adalah hasil hitungan database,
            yang tampil begitu perhitungan tersimpan — dan itulah yang dilihat pemeriksa.
          </p>
        </section>
      </form>
    </Modal>
  );
}

function Judul({ children, tanpaMargin }: { children: React.ReactNode; tanpaMargin?: boolean }) {
  return (
    <h3 className={`text-[11px] font-bold text-slate-500 uppercase tracking-wide ${tanpaMargin ? '' : 'mb-2'}`}>
      {children}
    </h3>
  );
}

function Angka({ label, nilai, warna }: { label: string; nilai: string; warna?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold text-slate-400 leading-tight">{label}</p>
      <p className="text-[13px] font-black tabular-nums leading-tight mt-0.5 truncate"
        style={{ color: warna ?? '#0f172a' }}>
        {nilai}
      </p>
    </div>
  );
}
