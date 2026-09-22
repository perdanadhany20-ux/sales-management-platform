'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { rupiah, persen, tanggalPendek, waktuPendek, angka } from '@/lib/format';
import {
  STATUS_GP, MUTU_MARGIN, LANGKAH_GP, bolehMenyetujui, menungguPeran,
  type GpRingkasan, type GpItem, type StatusGp,
} from '@/lib/gp';
import { eksporGpExcel } from '@/lib/gp-excel';
import { Modal } from '@/components/shared/Modal';
import { Tombol, Lencana, AreaTeks, Kolom } from '@/components/shared/FormParts';
import { useToast } from '@/components/shared/Feedback';

/**
 * Panel detail GP Calculation — tampilan baca, rantai persetujuan, dan ekspor.
 *
 * Susunannya mengikuti berkas asli dari atas ke bawah: identitas, executive
 * summary, detail item, tiga blok ringkasan, lalu blok tanda tangan. Orang
 * yang selama ini memeriksa berkas Excel-nya bisa menelusuri layar ini dengan
 * urutan yang sama persis.
 *
 * Tombol persetujuan hanya muncul bagi peran yang memang ditunggu. Itu
 * kenyamanan, bukan keamanan: sm_gp_setujui() di database memeriksa ulang
 * peran DAN status, sehingga memanggilnya langsung dari luar aplikasi tetap
 * ditolak.
 */

export function PanelGp({ buka, onTutup, gp, item, peran, namaOrang, onBerubah, onSunting }: {
  buka: boolean;
  onTutup: () => void;
  gp: GpRingkasan;
  item: GpItem[];
  peran: string;
  namaOrang: Record<string, string>;
  onBerubah: () => void;
  onSunting: () => void;
}) {
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [formTolak, setFormTolak] = useState(false);
  const [alasan, setAlasan] = useState('');

  const gaya = STATUS_GP[gp.status as StatusGp] ?? STATUS_GP.DRAFT;
  const mutu = MUTU_MARGIN[gp.mutu_margin] ?? MUTU_MARGIN['TANPA NILAI'];
  const bisaSetujui = bolehMenyetujui(gp.status, peran);
  const ditunggu = menungguPeran(gp.status);

  async function panggil(fungsi: string, args: Record<string, unknown>, label: string) {
    setSibuk(fungsi);
    const { data, error } = await supabase.rpc(fungsi, args);
    setSibuk(null);

    if (error) { toast('galat', error.message); return; }

    const hasil = data as { ok: boolean; message?: string; status?: string };
    if (!hasil.ok) { toast('galat', hasil.message ?? 'Tindakan belum bisa dijalankan.'); return; }

    toast('sukses', `${label} — status sekarang ${STATUS_GP[hasil.status as StatusGp]?.label ?? hasil.status}.`);
    setFormTolak(false);
    setAlasan('');
    onBerubah();
  }

  async function unduhExcel() {
    setSibuk('excel');
    try {
      await eksporGpExcel(gp, item, namaOrang[gp.sales_user_id] ?? '—', {
        diperiksa: gp.checked_by ? namaOrang[gp.checked_by] : undefined,
        disetujui: gp.approved_by ? namaOrang[gp.approved_by] : undefined,
        diverifikasi: gp.verified_by ? namaOrang[gp.verified_by] : undefined,
      });
      toast('sukses', 'Berkas Excel diunduh.');
    } catch (e) {
      toast('galat', e instanceof Error ? e.message : 'Gagal membuat berkas.');
    } finally {
      setSibuk(null);
    }
  }

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={`${gp.nomor} · ${gp.project_name}`}
      keterangan={`${gp.customer_name} · ${tanggalPendek(gp.calc_date)}`}
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" onClick={onTutup} className="text-[12px] py-2">Tutup</Tombol>

          <Tombol rupa="kedua" className="text-[12px] py-2" memuat={sibuk === 'excel'}
            onClick={unduhExcel}>
            ⬇ Excel
          </Tombol>

          {/* PDF lewat dialog cetak peramban: tata letaknya persis yang
              terlihat di layar cetak (@media print), tanpa menambah satu pun
              pustaka PDF ke bundel yang harus diunduh Sales di lapangan. */}
          <Tombol rupa="kedua" className="text-[12px] py-2" onClick={() => window.print()}>
            🖨 PDF
          </Tombol>

          {gp.status === 'DRAFT' && (
            <>
              <Tombol rupa="kedua" className="text-[12px] py-2" onClick={onSunting}>Sunting</Tombol>
              <Tombol className="text-[12px] py-2" memuat={sibuk === 'sm_gp_ajukan'}
                onClick={() => panggil('sm_gp_ajukan', { p_id: gp.id }, 'Perhitungan diajukan')}>
                Ajukan
              </Tombol>
            </>
          )}

          {gp.status === 'DITOLAK' && (
            <Tombol className="text-[12px] py-2" memuat={sibuk === 'sm_gp_buka_ulang'}
              onClick={() => panggil('sm_gp_buka_ulang', { p_id: gp.id }, 'Perhitungan dibuka ulang')}>
              Buka Ulang
            </Tombol>
          )}

          {bisaSetujui && (
            <>
              <Tombol rupa="bahaya" className="text-[12px] py-2"
                onClick={() => setFormTolak((f) => !f)}>
                Tolak
              </Tombol>
              <Tombol className="text-[12px] py-2" memuat={sibuk === 'sm_gp_setujui'}
                onClick={() => panggil('sm_gp_setujui', { p_id: gp.id, p_catatan: null }, 'Disetujui')}>
                Setujui
              </Tombol>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 cetak-gp">

        {/* ── Status ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <Lencana {...gaya} />
          <Lencana {...mutu} />
          <span className="text-[11px] text-slate-400">
            {ditunggu
              ? `Menunggu ${ditunggu === 'MANAGER' ? 'Manager Sales' : ditunggu === 'DIRECTOR' ? 'Director' : 'Finance'}`
              : gp.status === 'DIVERIFIKASI' ? 'Rantai tanda tangan lengkap'
              : gp.status === 'DITOLAK' ? 'Dikembalikan ke pembuat'
              : 'Belum diajukan'}
          </span>
        </div>

        {gp.status === 'DITOLAK' && gp.rejection_reason && (
          <p className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] border border-[#e34948]/25 rounded-kontrol px-3.5 py-2.5 leading-snug">
            <b className="font-bold">Ditolak</b>
            {gp.rejected_by && ` oleh ${namaOrang[gp.rejected_by] ?? '—'}`}
            {gp.rejected_at && ` pada ${tanggalPendek(gp.rejected_at)}`} — {gp.rejection_reason}
          </p>
        )}

        {formTolak && bisaSetujui && (
          <section className="rounded-kartu border border-[#e34948]/30 bg-[#fce3e3]/50 p-3">
            <Kolom label="Alasan penolakan" wajib
              galat={alasan && alasan.trim().length < 10 ? 'Minimal 10 karakter.' : null}>
              {(id, invalid) => (
                <AreaTeks id={id} rows={2} value={alasan} aria-invalid={invalid}
                  onChange={(e) => setAlasan(e.target.value)}
                  placeholder="Contoh: harga modal kamera belum termasuk ongkos kirim vendor." />
              )}
            </Kolom>
            <div className="flex justify-end gap-2 mt-2">
              <Tombol rupa="kedua" className="text-[12px] py-2"
                onClick={() => { setFormTolak(false); setAlasan(''); }}>Batal</Tombol>
              <Tombol rupa="bahaya" className="text-[12px] py-2"
                disabled={alasan.trim().length < 10} memuat={sibuk === 'sm_gp_tolak'}
                onClick={() => panggil('sm_gp_tolak', { p_id: gp.id, p_alasan: alasan.trim() }, 'Perhitungan ditolak')}>
                Kirim Penolakan
              </Tombol>
            </div>
          </section>
        )}

        {/* ── Identitas ── */}
        <section className="grid grid-cols-1 formulir:grid-cols-3 gap-3">
          <Blok judul="Identitas">
            <Baris label="Customer" nilai={gp.customer_name} />
            <Baris label="Project" nilai={gp.project_name} />
            <Baris label="Sales" nilai={namaOrang[gp.sales_user_id] ?? '—'} />
            <Baris label="PO / SPK" nilai={gp.po_spk_no} />
          </Blok>
          <Blok judul="Ketentuan">
            <Baris label="Tanggal" nilai={tanggalPendek(gp.calc_date)} />
            <Baris label="PPN" nilai={persen(Number(gp.ppn_rate) * 100)} />
            <Baris label="Payment Term" nilai={gp.payment_term} />
            <Baris label="Lead Time" nilai={gp.lead_time} />
          </Blok>
          <Blok judul="Project Summary">
            <Baris label="GP Target" nilai={persen(Number(gp.gp_target) * 100)} />
            <Baris label="Net Margin" nilai={persen(Number(gp.net_margin) * 100)} tebal />
            <Baris label="Status Margin" nilai={mutu.label} />
            <Baris label="WAPU" nilai={gp.wapu ? 'Ya' : 'Tidak'} />
          </Blok>
        </section>

        {/* ── Executive summary ── */}
        <section>
          <JudulBagian>Executive Summary</JudulBagian>
          <div className="grid grid-cols-2 formulir:grid-cols-4 gap-2">
            <Kotak label="Net Amount Received" nilai={rupiah(gp.net_amount_received)} />
            <Kotak label="Total Costing" nilai={rupiah(gp.total_costing)} />
            <Kotak label="Net Profit" nilai={rupiah(gp.net_profit)}
              warna={Number(gp.net_profit) >= 0 ? '#008300' : '#e34948'} />
            <Kotak label="Net Margin" nilai={persen(Number(gp.net_margin) * 100)}
              warna={mutu.color} />
          </div>
        </section>

        {/* ── Detail item ── */}
        <section>
          <JudulBagian>Detail Item ({angka(gp.jumlah_item)})</JudulBagian>
          {item.length === 0 ? (
            <p className="text-[12px] text-slate-400 py-3">Belum ada item.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {item.map((it, i) => (
                <article key={it.id}
                  className="rounded-kontrol border border-slate-200 px-3 py-2.5 bg-white">
                  <div className="flex items-start gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 grid place-items-center text-[10px] font-bold text-slate-500">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-900 leading-snug">{it.description}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                        {angka(it.qty)} × {rupiah(it.unit_price)}
                        {it.vendor && <span className="text-slate-400"> · {it.vendor}</span>}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-black text-slate-900 tabular-nums">
                        {rupiah(it.selling_total)}
                      </p>
                      <p className="text-[11px] tabular-nums"
                        style={{ color: Number(it.gp_amount) >= 0 ? '#008300' : '#e34948' }}>
                        GP {rupiah(it.gp_amount)} · {persen(it.gp_percentage)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}

              <div className="rounded-kontrol bg-slate-100 px-3 py-2.5 flex items-center justify-between gap-3">
                <span className="text-[12px] font-bold text-slate-600">TOTAL</span>
                <span className="text-right">
                  <span className="block text-[13px] font-black text-slate-900 tabular-nums">
                    {rupiah(gp.total_selling)}
                  </span>
                  <span className="block text-[11px] text-slate-500 tabular-nums">
                    modal {rupiah(gp.total_material)} · GP {rupiah(gp.gross_profit)}
                  </span>
                </span>
              </div>
            </div>
          )}
        </section>

        {/* ── Tiga blok ringkasan ── */}
        <section className="grid grid-cols-1 formulir:grid-cols-3 gap-3">
          <Blok judul="Selling Summary">
            <Baris label="Total Selling (DPP)" nilai={rupiah(gp.dpp)} />
            <Baris label={`PPN ${persen(Number(gp.ppn_rate) * 100, 0)}`} nilai={rupiah(gp.ppn_amount)} />
            <Baris label={`Pph ${persen(Number(gp.pph_rate) * 100)}`} nilai={rupiah(gp.pph_amount)} />
            <Baris label="Disbursement" nilai={rupiah(gp.disbursement_cost)} />
            <Baris label="Net Amount Received" nilai={rupiah(gp.net_amount_received)} tebal />
          </Blok>

          <Blok judul="Cost Breakdown">
            <Baris label="Total Material" nilai={rupiah(gp.total_material)} />
            <Baris label="Instalasi" nilai={rupiah(gp.installation_cost)} />
            <Baris label="Pengiriman" nilai={rupiah(gp.shipping_cost)} />
            <Baris label="Operasional" nilai={rupiah(gp.operational_cost)} />
            <Baris label="Lainnya" nilai={rupiah(gp.other_cost)} />
            <Baris label="Total Costing" nilai={rupiah(gp.total_costing)} tebal />
          </Blok>

          <Blok judul="Profit Analysis">
            <Baris label="Gross Profit (item)" nilai={rupiah(gp.gross_profit)} />
            <Baris label="Net Profit" nilai={rupiah(gp.net_profit)} tebal />
            <Baris label="Net Margin" nilai={persen(Number(gp.net_margin) * 100)} tebal />
            <Baris label="GP Target" nilai={persen(Number(gp.gp_target) * 100)} />
            <Baris label="Currency" nilai={gp.currency} />
          </Blok>
        </section>

        {gp.notes && (
          <section>
            <JudulBagian>Notes</JudulBagian>
            <p className="text-[12px] text-slate-700 leading-relaxed whitespace-pre-wrap">{gp.notes}</p>
          </section>
        )}

        {/* ── Approval ── */}
        <section>
          <JudulBagian>Approval</JudulBagian>
          <div className="grid grid-cols-2 formulir:grid-cols-4 gap-2">
            {LANGKAH_GP.map((l) => {
              const waktu =
                l.status === 'DIAJUKAN' ? gp.submitted_at
                : l.status === 'DIPERIKSA' ? gp.checked_at
                : l.status === 'DISETUJUI' ? gp.approved_at
                : gp.verified_at;
              const oleh =
                l.status === 'DIAJUKAN' ? gp.sales_user_id
                : l.status === 'DIPERIKSA' ? gp.checked_by
                : l.status === 'DISETUJUI' ? gp.approved_by
                : gp.verified_by;
              const tuntas = Boolean(waktu);
              return (
                <div key={l.status}
                  className={`rounded-kontrol border px-3 py-2.5 text-center
                              ${tuntas ? 'border-[#008300]/30 bg-[#e0f2e0]/40' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{l.label}</p>
                  <p className="text-[10px] text-slate-400">{l.peran}</p>
                  <p className={`text-[12px] font-bold mt-1.5 truncate ${tuntas ? 'text-slate-800' : 'text-slate-400'}`}>
                    {tuntas ? (oleh ? (namaOrang[oleh] ?? '—') : '—') : 'Menunggu'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                    {waktu ? `${tanggalPendek(waktu)} ${waktuPendek(waktu)}` : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function JudulBagian({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 pb-1 border-b border-slate-200">
      {children}
    </h3>
  );
}

function Blok({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <div className="rounded-kartu border border-slate-200 overflow-hidden">
      <p className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
        {judul}
      </p>
      <div className="px-3 py-2 flex flex-col">{children}</div>
    </div>
  );
}

function Baris({ label, nilai, tebal }: {
  label: string; nilai: string | null | undefined; tebal?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-slate-100 last:border-0">
      <span className="text-[11px] text-slate-500 flex-shrink-0">{label}</span>
      <span className={`text-right tabular-nums truncate ${tebal ? 'text-[13px] font-black text-slate-900' : 'text-[12px] font-semibold text-slate-700'}`}>
        {nilai || '—'}
      </span>
    </div>
  );
}

function Kotak({ label, nilai, warna }: { label: string; nilai: string; warna?: string }) {
  return (
    <div className="rounded-kontrol bg-slate-50 border border-slate-200 px-3 py-2.5">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-tight">{label}</p>
      <p className="text-[14px] font-black tabular-nums mt-1 truncate"
        style={{ color: warna ?? '#0f172a' }}>
        {nilai}
      </p>
    </div>
  );
}
