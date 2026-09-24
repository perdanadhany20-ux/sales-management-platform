'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { rupiahRingkas, tanggalISO } from '@/lib/format';
import { Tombol, Uang, Teks } from '@/components/shared/FormParts';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Tabel } from '@/components/shared/Tabel';
import { BatangTarget, warnaCapaian } from '@/components/shared/Charts';
import { ambilPencapaian, type Pencapaian } from '@/lib/target';

interface Isian { nilai: number; gp: number }

/**
 * Penetapan target bulanan per Sales.
 *
 * Satu layar = satu bulan. Kolom realisasi ikut ditampilkan supaya target
 * ditetapkan dengan melihat kenyataan, bukan angka yang diketik buta.
 * Mengosongkan kedua kolom lalu menyimpan berarti menghapus target bulan itu.
 */
export function TabTarget({ pemanggilId }: { pemanggilId: string }) {
  const toast = useToast();
  const [bulan, setBulan] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [data, setData] = useState<Pencapaian[]>([]);
  const [isian, setIsian] = useState<Record<string, Isian>>({});
  const [awal, setAwal] = useState<Record<string, Isian>>({});
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [menyalin, setMenyalin] = useState(false);
  const [cari, setCari] = useState('');

  const periode = tanggalISO(bulan);
  const akhirBulan = tanggalISO(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 0));
  const labelBulan = bulan.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const hasil = await ambilPencapaian(periode, akhirBulan);
      const peta = Object.fromEntries(hasil.map((p) => [p.sales_user_id, { nilai: p.target_nilai, gp: p.target_gp ?? 0 }]));
      setData(hasil);
      setIsian(peta);
      setAwal(peta);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : 'Gagal memuat target.');
    } finally {
      setMemuat(false);
    }
  }, [periode, akhirBulan]);

  useEffect(() => { void muat(); }, [muat]);

  const berubah = useMemo(
    () => Object.keys(isian).filter((id) => isian[id].nilai !== awal[id]?.nilai || isian[id].gp !== awal[id]?.gp),
    [isian, awal],
  );

  function geser(n: number) {
    if (berubah.length > 0 && !window.confirm('Ada perubahan yang belum disimpan. Tinggalkan bulan ini?')) return;
    setBulan((b) => new Date(b.getFullYear(), b.getMonth() + n, 1));
  }

  function ubah(id: string, kunci: keyof Isian, n: number) {
    setIsian((s) => ({ ...s, [id]: { ...s[id], [kunci]: n } }));
  }

  async function salinBulanLalu() {
    setMenyalin(true);
    const lalu = tanggalISO(new Date(bulan.getFullYear(), bulan.getMonth() - 1, 1));
    const { data: rows, error } = await supabase
      .from('sm_sales_targets').select('sales_user_id, target_nilai, target_gp').eq('periode', lalu);
    setMenyalin(false);
    if (error) { toast('galat', error.message); return; }
    if (!rows || rows.length === 0) { toast('info', 'Bulan lalu belum punya target untuk disalin.'); return; }
    setIsian((s) => {
      const baru = { ...s };
      for (const r of rows as { sales_user_id: string; target_nilai: number; target_gp: number | null }[]) {
        if (baru[r.sales_user_id]) baru[r.sales_user_id] = { nilai: Number(r.target_nilai) || 0, gp: Number(r.target_gp) || 0 };
      }
      return baru;
    });
    toast('info', `Target ${rows.length} Sales disalin dari bulan lalu. Periksa lalu tekan Simpan.`);
  }

  async function simpan() {
    setMenyimpan(true);
    try {
      const hapus = berubah.filter((id) => isian[id].nilai === 0 && isian[id].gp === 0);
      const tulis = berubah.filter((id) => !hapus.includes(id)).map((id) => ({
        sales_user_id: id,
        periode,
        target_nilai: isian[id].nilai,
        target_gp: isian[id].gp || null,
        updated_by: pemanggilId,
      }));

      if (tulis.length > 0) {
        const { error } = await supabase.from('sm_sales_targets').upsert(tulis, { onConflict: 'sales_user_id,periode' });
        if (error) throw new Error(error.message);
      }
      if (hapus.length > 0) {
        const { error } = await supabase.from('sm_sales_targets').delete().eq('periode', periode).in('sales_user_id', hapus);
        if (error) throw new Error(error.message);
      }
      toast('sukses', `Target ${labelBulan} disimpan untuk ${berubah.length} Sales.`);
      await muat();
    } catch (e) {
      toast('galat', e instanceof Error ? e.message : 'Gagal menyimpan target.');
    } finally {
      setMenyimpan(false);
    }
  }

  const total = Object.values(isian).reduce((a, b) => ({ nilai: a.nilai + b.nilai, gp: a.gp + b.gp }), { nilai: 0, gp: 0 });
  const totalReal = data.reduce((a, p) => a + p.realisasi_nilai, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Tombol rupa="kedua" className="text-[12px] py-2 px-3" onClick={() => geser(-1)} aria-label="Bulan sebelumnya">‹</Tombol>
          <span className="min-w-[150px] text-center text-[14px] font-black text-slate-900 capitalize">{labelBulan}</span>
          <Tombol rupa="kedua" className="text-[12px] py-2 px-3" onClick={() => geser(1)} aria-label="Bulan berikutnya">›</Tombol>
        </div>
        <div className="text-[12px] text-slate-500">
          Total target <b className="text-slate-800 tabular-nums">{rupiahRingkas(total.nilai)}</b>
          {total.gp > 0 && <> · GP <b className="text-slate-800 tabular-nums">{rupiahRingkas(total.gp)}</b></>}
          <span className="text-slate-400"> · realisasi {rupiahRingkas(totalReal)}</span>
        </div>
        <div className="flex-1" />
        <Teks type="search" value={cari} onChange={(e) => setCari(e.target.value)}
          placeholder="Cari nama Sales…" aria-label="Cari nama Sales" className="!w-56" />
        <Tombol rupa="kedua" className="text-[12px] py-2" memuat={menyalin} onClick={salinBulanLalu}>
          Salin dari bulan lalu
        </Tombol>
        <Tombol className="text-[12px] py-2" memuat={menyimpan} disabled={berubah.length === 0} onClick={simpan}>
          {berubah.length > 0 ? `Simpan (${berubah.length})` : 'Tersimpan'}
        </Tombol>
      </div>

      {galat ? (
        <PanelGalat pesan={galat} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={4} />
      ) : data.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong judul="Belum ada Sales aktif" keterangan="Target hanya bisa ditetapkan untuk akun aktif berperan Sales." />
        </div>
      ) : (
        <Tabel
          data={data.filter((p) => !cari.trim() || p.full_name.toLowerCase().includes(cari.trim().toLowerCase()))}
          kunci={(p) => p.sales_user_id}
          kolom={[
            {
              label: 'Sales', className: 'w-[18%]',
              render: (p) => (
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate">{p.full_name}</p>
                  {berubah.includes(p.sales_user_id) && (
                    <p className="text-[10px] font-bold text-[#c17d0e]">Belum disimpan</p>
                  )}
                </div>
              ),
            },
            {
              label: 'Target Nilai Penjualan', className: 'w-[19%]',
              render: (p) => (
                <Uang aria-label={`Target nilai ${p.full_name}`} nilai={isian[p.sales_user_id]?.nilai ?? 0}
                  onUbah={(n) => ubah(p.sales_user_id, 'nilai', n)} placeholder="0" />
              ),
            },
            {
              label: 'Target GP (opsional)', className: 'w-[17%]',
              render: (p) => (
                <Uang aria-label={`Target GP ${p.full_name}`} nilai={isian[p.sales_user_id]?.gp ?? 0}
                  onUbah={(n) => ubah(p.sales_user_id, 'gp', n)} placeholder="—" />
              ),
            },
            {
              label: 'Realisasi', className: 'w-[14%]',
              render: (p) => (
                <div className="tabular-nums">
                  <p className="font-semibold text-slate-800">{rupiahRingkas(p.realisasi_nilai)}</p>
                  <p className="text-[11px] text-slate-400">GP {rupiahRingkas(p.realisasi_gp)} · {p.jumlah_won} WON</p>
                </div>
              ),
            },
            {
              label: 'Capaian Nilai', className: 'w-[24%]',
              render: (p) => {
                const t = isian[p.sales_user_id]?.nilai ?? 0;
                const r = t > 0 ? p.realisasi_nilai / t : null;
                return (
                  <div className="flex items-center gap-2.5 pt-2">
                    <div className="flex-1"><BatangTarget realisasi={p.realisasi_nilai} target={t} /></div>
                    <span className="w-12 text-right text-[12px] font-black tabular-nums"
                      style={{ color: warnaCapaian(r) }}>
                      {r === null ? '—' : `${Math.round(r * 100)}%`}
                    </span>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Realisasi = total pipeline berstatus <b>WON</b> yang dimenangkan pada bulan ini (tanggal saat
        tahapan diubah menjadi WON). Kuartal dan tahun di Dashboard adalah jumlah target bulanannya.
        Kosongkan kedua kolom lalu simpan untuk menghapus target seorang Sales.
      </p>
    </div>
  );
}
