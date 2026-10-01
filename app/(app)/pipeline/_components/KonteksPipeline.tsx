// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { rupiahRingkas, persen, tanggalPendek, tanggalISO } from '@/lib/format';
import { STATUS_GP, type StatusGp } from '@/lib/gp';
import { STATUS_JADWAL, statusEfektif } from '@/lib/constants';

/**
 * "Terkait" di detail peluang — supaya Sales tidak perlu berpindah menu hanya
 * untuk tahu apa yang sudah terjadi pada peluang ini.
 *
 * Simpulnya adalah PROYEK: GP Calculation dan jadwal/meeting ditautkan ke
 * proyek (migrasi 018), bukan langsung ke peluang. Jadi yang ditampilkan di
 * sini adalah proyek peluang ini beserta jadwal dan GP-nya. GP yang kebetulan
 * menunjuk peluang ini lewat pipeline_id ikut diambil.
 *
 * Tiga query berjalan bersamaan dan RLS tetap berlaku — pengguna hanya melihat
 * baris yang memang boleh ia baca.
 */

interface Proyek { id: string; kode: string | null; name: string; status: string }
interface Jadwal {
  id: string; customer_name: string; category: string; schedule_date: string;
  status: string; requires_attendance: boolean;
}
interface Gp { id: string; nomor: string; project_name: string; total_selling: number; net_margin: number; status: string }

export function KonteksPipeline({ peluangId, proyekId, bisaSunting, onSunting }: {
  peluangId: string;
  proyekId: string | null;
  bisaSunting: boolean;
  onSunting: () => void;
}) {
  const [proyek, setProyek] = useState<Proyek | null>(null);
  const [jadwal, setJadwal] = useState<Jadwal[]>([]);
  const [gp, setGp] = useState<Gp[]>([]);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    let batal = false;
    (async () => {
      setMemuat(true);
      const gpQ = supabase.from('sm_gp_ringkasan')
        .select('id, nomor, project_name, total_selling, net_margin, status')
        .order('calc_date', { ascending: false }).limit(5);

      const [pr, sc, g] = await Promise.all([
        proyekId
          ? supabase.from('sm_projects').select('id, kode, name, status').eq('id', proyekId).maybeSingle()
          : Promise.resolve({ data: null }),
        proyekId
          ? supabase.from('sm_schedules')
              .select('id, customer_name, category, schedule_date, status, requires_attendance')
              .eq('project_id', proyekId).order('schedule_date', { ascending: false }).limit(5)
          : Promise.resolve({ data: [] }),
        proyekId
          ? gpQ.or(`project_id.eq.${proyekId},pipeline_id.eq.${peluangId}`)
          : gpQ.eq('pipeline_id', peluangId),
      ]);
      if (batal) return;
      setProyek((pr.data as Proyek | null) ?? null);
      setJadwal((sc.data ?? []) as Jadwal[]);
      setGp((g.data ?? []) as Gp[]);
      setMemuat(false);
    })();
    return () => { batal = true; };
  }, [peluangId, proyekId]);

  if (memuat) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Memuat data terkait">
        <div className="h-3 w-20 rounded bg-slate-100 animate-pulse" />
        <div className="h-9 rounded-kontrol bg-slate-100 animate-pulse" />
      </div>
    );
  }

  const hariIni = tanggalISO();

  return (
    <section aria-labelledby="judul-terkait" className="flex flex-col gap-3 border-t border-slate-100 pt-3">
      <h3 id="judul-terkait" className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Terkait</h3>

      {!proyekId ? (
        <div className="rounded-kontrol border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2.5 text-[12px] text-slate-600">
          Peluang ini belum ditautkan ke proyek. Tautkan supaya jadwal, meeting, dan GP Calculation-nya
          terkumpul di satu tempat.
          {bisaSunting && (
            <button type="button" onClick={onSunting}
              className="ml-1 font-bold text-aksen-700 hover:underline">
              Tautkan sekarang →
            </button>
          )}
        </div>
      ) : proyek ? (
        <Link href={`/proyek?fokus=${proyek.id}`}
          className="flex items-center justify-between gap-2 rounded-kontrol border border-slate-200 px-3 py-2
                     hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-aksen-600">
          <span className="min-w-0">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Proyek</span>
            <span className="block text-[13px] font-semibold text-slate-800 truncate">
              {proyek.kode ? `${proyek.kode} · ` : ''}{proyek.name}
            </span>
          </span>
          <span className="text-[11px] font-semibold text-aksen-700 whitespace-nowrap">Buka →</span>
        </Link>
      ) : (
        <p className="text-[12px] text-slate-500">Proyek tertaut tidak dapat dibuka dengan akun ini.</p>
      )}

      {proyekId && (
        <DaftarTerkait judul="Jadwal & Meeting" kosong="Belum ada jadwal untuk proyek ini."
          semua={`/proyek?fokus=${proyekId}`}>
          {jadwal.map((j) => {
            const st = STATUS_JADWAL[statusEfektif(j, hariIni)];
            return (
              <BarisTerkait key={j.id}
                href={j.requires_attendance ? `/meeting?fokus=${j.id}` : `/schedule?fokus=${j.id}`}
                judul={`${j.category} · ${j.customer_name}`}
                ket={tanggalPendek(j.schedule_date)}
                label={st?.label} warna={st?.color} latar={st?.bg} />
            );
          })}
        </DaftarTerkait>
      )}

      <DaftarTerkait judul="GP Calculation"
        kosong={proyekId ? 'Belum ada GP Calculation untuk proyek ini.' : 'Belum ada GP Calculation untuk peluang ini.'}
        semua="/gp">
        {gp.map((g) => {
          const st = STATUS_GP[g.status as StatusGp];
          return (
            <BarisTerkait key={g.id} href={`/gp?fokus=${g.id}`}
              judul={`${g.nomor} · ${g.project_name}`}
              ket={`${rupiahRingkas(g.total_selling)} · margin ${persen(Number(g.net_margin) * 100)}`}
              label={st?.label ?? g.status} warna={st?.color} latar={st?.bg} />
          );
        })}
      </DaftarTerkait>
    </section>
  );
}

function DaftarTerkait({ judul, kosong, semua, children }: {
  judul: string; kosong: string; semua: string; children: React.ReactNode[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-bold text-slate-700">{judul}</p>
        {children.length > 0 && (
          <Link href={semua} className="text-[11px] font-semibold text-aksen-700 hover:underline">Lihat semua →</Link>
        )}
      </div>
      {children.length === 0
        ? <p className="text-[12px] text-slate-400">{kosong}</p>
        : <ul className="flex flex-col m-0 p-0 list-none">{children}</ul>}
    </div>
  );
}

function BarisTerkait({ href, judul, ket, label, warna, latar }: {
  href: string; judul: string; ket: string; label?: string; warna?: string; latar?: string;
}) {
  return (
    <li>
      <Link href={href}
        className="flex items-center gap-2 rounded-kontrol px-2 py-1.5 -mx-2 min-h-[40px] hover:bg-slate-50
                   focus-visible:outline focus-visible:outline-2 focus-visible:outline-aksen-600">
        <span className="flex-1 min-w-0">
          <span className="block text-[12px] font-semibold text-slate-800 truncate">{judul}</span>
          <span className="block text-[11px] text-slate-500 truncate">{ket}</span>
        </span>
        {label && (
          <span className="text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap"
            style={{ color: warna, background: latar }}>{label}</span>
        )}
      </Link>
    </li>
  );
}
