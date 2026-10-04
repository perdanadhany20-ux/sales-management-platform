// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { rupiahRingkas, persen, tanggalPendek } from '@/lib/format';
import { BentoCard, type Rentang } from '@/components/shared/Bento';
import { KerangkaKartu, PanelGalat } from '@/components/shared/Feedback';
import { pesanGalat } from '@/lib/pesan-galat';

/**
 * Antrian persetujuan GP Calculation: DIAJUKAN → Manager, DIPERIKSA →
 * Director, DISETUJUI → Finance. Giliran peran yang sedang login disorot dan
 * dokumennya didaftar (paling lama menunggu dulu). Bagi Finance juga
 * ringkasan GP yang sudah diverifikasi bulan ini.
 */

const TAHAP = [
  { status: 'DIAJUKAN', label: 'Menunggu Manager', peran: ['MANAGER', 'ADMIN'] },
  { status: 'DIPERIKSA', label: 'Menunggu Director', peran: ['DIRECTOR', 'ADMIN'] },
  { status: 'DISETUJUI', label: 'Menunggu Finance', peran: ['FINANCE', 'ADMIN'] },
] as const;

interface Gp {
  id: string; nomor: string; customer_name: string; status: string; total_selling: number;
  gross_profit: number; net_margin: number | null; submitted_at: string | null; verified_at: string | null; updated_at: string;
}

export function KartuAntrianGp({ rentang, role }: { rentang: Rentang; role: string }) {
  const [data, setData] = useState<{ antri: Gp[]; selesai: Gp[] } | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    const awalBulan = new Date(); awalBulan.setDate(1); awalBulan.setHours(0, 0, 0, 0);
    const kolom = 'id, nomor, customer_name, status, total_selling, gross_profit, net_margin, submitted_at, verified_at, updated_at';
    Promise.all([
      supabase.from('sm_gp_ringkasan').select(kolom).in('status', TAHAP.map((t) => t.status))
        .order('updated_at', { ascending: true }).limit(500),
      supabase.from('sm_gp_ringkasan').select(kolom).eq('status', 'DIVERIFIKASI')
        .gte('verified_at', awalBulan.toISOString()).limit(1000),
    ]).then(([a, s]) => {
      if (batal) return;
      if (a.error || s.error) { setGalat(pesanGalat(a.error ?? s.error)); return; }
      setData({ antri: (a.data ?? []) as Gp[], selesai: (s.data ?? []) as Gp[] });
    });
    return () => { batal = true; };
  }, []);

  if (galat) return <BentoCard rentang={rentang} judul="Antrian Persetujuan GP"><PanelGalat pesan={galat} /></BentoCard>;
  if (!data) return <BentoCard rentang={rentang}><KerangkaKartu tinggi={150} /></BentoCard>;

  const giliran = TAHAP.find((t) => t.peran.includes(role as never) && role !== 'ADMIN');
  const milikSaya = giliran ? data.antri.filter((g) => g.status === giliran.status) : [];
  const nilaiSelesai = data.selesai.reduce((t, g) => t + Number(g.total_selling || 0), 0);
  const gpSelesai = data.selesai.reduce((t, g) => t + Number(g.gross_profit || 0), 0);

  return (
    <BentoCard rentang={rentang} judul="Antrian Persetujuan GP"
      aksi={<Link href="/gp" className="text-[11px] font-bold text-aksen-700 hover:underline">Buka GP →</Link>}>
      <div className="grid grid-cols-3 gap-2">
        {TAHAP.map((t) => {
          const n = data.antri.filter((g) => g.status === t.status).length;
          const saya = giliran?.status === t.status;
          return (
            <div key={t.status} className={`rounded-xl border px-3 py-2.5 ${saya ? 'border-aksen-300 bg-aksen-50' : 'border-slate-200'}`}>
              <p className={`text-[24px] font-black leading-none tabular-nums ${n > 0 && saya ? 'text-aksen-700' : 'text-slate-800'}`}>{n}</p>
              <p className="text-[10.5px] text-slate-500 mt-1 leading-tight">{t.label}{saya && <b className="text-aksen-700"> · giliran Anda</b>}</p>
            </div>
          );
        })}
      </div>

      {giliran && (
        milikSaya.length === 0
          ? <p className="text-[12px] text-slate-500">Tidak ada GP yang menunggu tanda tangan Anda. 👍</p>
          : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {milikSaya.slice(0, 5).map((g) => (
                <li key={g.id}>
                  <Link href={`/gp?fokus=${g.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-slate-800 truncate">{g.nomor} · {g.customer_name}</p>
                      <p className="text-[11px] text-slate-500">sejak {tanggalPendek(g.updated_at)} · margin {g.net_margin === null ? '—' : persen(g.net_margin, 1)}</p>
                    </div>
                    <span className="text-[12px] font-bold tabular-nums text-slate-700">{rupiahRingkas(g.total_selling)}</span>
                  </Link>
                </li>
              ))}
              {milikSaya.length > 5 && <li className="px-3 py-2 text-[11px] text-slate-500">+{milikSaya.length - 5} lainnya</li>}
            </ul>
          )
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-[12px] text-slate-600 border-t border-slate-100">
        <span>Terverifikasi bulan ini: <b className="tabular-nums">{data.selesai.length}</b> dokumen</span>
        <span>Nilai: <b className="tabular-nums">{rupiahRingkas(nilaiSelesai)}</b></span>
        <span>GP: <b className="tabular-nums">{rupiahRingkas(gpSelesai)}</b>
          {nilaiSelesai > 0 && <span className="text-slate-400"> ({persen((gpSelesai / nilaiSelesai) * 100, 1)})</span>}</span>
      </div>
    </BentoCard>
  );
}
