'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { rupiah, rupiahRingkas, persen, tanggalPendek, angka } from '@/lib/format';
import { STATUS_JADWAL, statusEfektif } from '@/lib/constants';
import { STATUS_PROYEK, type StatusProyek } from '@/lib/proyek';
import { KEHANGATAN, kehangatan, nomorWhatsApp, type CustomerRingkasan } from '@/lib/customer';
import { Modal } from '@/components/shared/Modal';
import { Tombol, Lencana } from '@/components/shared/FormParts';

/**
 * Panel 360° satu customer: kontak, angka penjualan, dan seluruh jejak —
 * pipeline, jadwal & meeting, laporan harian, proyek — tanpa berpindah
 * halaman. Sama seperti PanelProyek, panel ini untuk MELIHAT; setiap baris
 * menuju modul asalnya untuk dikerjakan.
 */

interface BarisPipeline { id: string; project_detail: string; project_value: number; probability: number; estimated_closing: string; stage: string; sales_user_id: string }
interface BarisJadwal { id: string; category: string; schedule_date: string; status: string; requires_attendance: boolean; assigned_to: string | null }
interface BarisLaporan { id: string; report_date: string; activity: string; result: string; contact_person: string | null; sales_user_id: string }
interface BarisProyek { id: string; kode: string; name: string; status: string }

export function PanelCustomer({ buka, onTutup, customer, namaOrang, bolehSunting, onSunting }: {
  buka: boolean;
  onTutup: () => void;
  customer: CustomerRingkasan;
  namaOrang: Record<string, string>;
  bolehSunting: boolean;
  onSunting: () => void;
}) {
  const [pipeline, setPipeline] = useState<BarisPipeline[]>([]);
  const [jadwal, setJadwal] = useState<BarisJadwal[]>([]);
  const [laporan, setLaporan] = useState<BarisLaporan[]>([]);
  const [proyek, setProyek] = useState<BarisProyek[]>([]);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    setMemuat(true);
    const [pl, sc, dr, pr] = await Promise.all([
      supabase.from('sm_pipeline')
        .select('id, project_detail, project_value, probability, estimated_closing, stage, sales_user_id')
        .eq('customer_id', customer.id).order('pipeline_date', { ascending: false }).limit(20),
      supabase.from('sm_schedules')
        .select('id, category, schedule_date, status, requires_attendance, assigned_to')
        .eq('customer_id', customer.id).order('schedule_date', { ascending: false }).limit(20),
      supabase.from('sm_daily_reports')
        .select('id, report_date, activity, result, contact_person, sales_user_id')
        .eq('customer_id', customer.id).order('report_date', { ascending: false }).limit(20),
      supabase.from('sm_projects')
        .select('id, kode, name, status')
        .eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(20),
    ]);
    setPipeline((pl.data ?? []) as BarisPipeline[]);
    setJadwal((sc.data ?? []) as BarisJadwal[]);
    setLaporan((dr.data ?? []) as BarisLaporan[]);
    setProyek((pr.data ?? []) as BarisProyek[]);
    setMemuat(false);
  }, [customer.id]);

  useEffect(() => { if (buka) void muat(); }, [buka, muat]);

  const hangat = KEHANGATAN[kehangatan(customer)];
  const kontak = customer.contact_person ?? customer.kontak_terakhir;
  const jabatan = customer.contact_position ?? customer.jabatan_terakhir;
  const telepon = customer.phone ?? customer.telepon_terakhir;
  const wa = nomorWhatsApp(telepon);

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={customer.name}
      keterangan={[customer.segment, customer.city].filter(Boolean).join(' · ') || 'Riwayat lengkap customer'}
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" onClick={onTutup} className="text-[12px] py-2">Tutup</Tombol>
          {bolehSunting && <Tombol rupa="kedua" onClick={onSunting} className="text-[12px] py-2">Sunting Customer</Tombol>}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Lencana label={hangat.label} color={hangat.color} bg={hangat.bg} />
          <span className="text-[11px] text-slate-500">
            {customer.aktivitas_terakhir ? `Aktivitas terakhir ${tanggalPendek(customer.aktivitas_terakhir)}` : hangat.keterangan}
          </span>
          {customer.created_by && namaOrang[customer.created_by] && (
            <span className="text-[11px] text-slate-400">Pemilik {namaOrang[customer.created_by]}</span>
          )}
        </div>

        {/* ── Kontak ── */}
        <section className="rounded-kartu border border-slate-200 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Kontak</p>
          {kontak || telepon || customer.email || customer.address ? (
            <>
              {kontak && (
                <p className="text-[13px] text-slate-800">
                  <b>{kontak}</b>{jabatan && <span className="text-slate-500"> · {jabatan}</span>}
                </p>
              )}
              {(customer.address || customer.city) && (
                <p className="text-[12px] text-slate-500">{[customer.address, customer.city].filter(Boolean).join(', ')}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {telepon && (
                  <a href={`tel:${telepon.replace(/[^\d+]/g, '')}`}
                    className="inline-flex items-center gap-1.5 rounded-kontrol border border-slate-300 px-3 py-2 text-[12px] font-bold text-slate-700 hover:bg-slate-50">
                    📞 {telepon}
                  </a>
                )}
                {wa && (
                  <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-kontrol border border-[#25d366] bg-[#e8faf0] px-3 py-2 text-[12px] font-bold text-[#0f7a3c] hover:bg-[#d5f5e3]">
                    💬 WhatsApp
                  </a>
                )}
                {customer.email && (
                  <a href={`mailto:${customer.email}`}
                    className="inline-flex items-center gap-1.5 rounded-kontrol border border-slate-300 px-3 py-2 text-[12px] font-bold text-slate-700 hover:bg-slate-50">
                    ✉️ {customer.email}
                  </a>
                )}
              </div>
              {!customer.contact_person && customer.kontak_terakhir && (
                <p className="text-[10.5px] text-slate-400">Diambil dari laporan harian terakhir.</p>
              )}
            </>
          ) : (
            <p className="text-[12px] text-slate-400">
              Belum ada data kontak.{bolehSunting && ' Lengkapi lewat Sunting Customer.'}
            </p>
          )}
          {customer.notes && (
            <p className="text-[12px] text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-kontrol px-3 py-2">{customer.notes}</p>
          )}
        </section>

        {/* ── Angka ── */}
        <section className="grid grid-cols-2 formulir:grid-cols-4 gap-2">
          <Kotak label="Pipeline Terbuka" nilai={rupiah(customer.nilai_terbuka)} keterangan={`${angka(customer.jumlah_pipeline)} peluang total`} />
          <Kotak label="Sudah Menang" nilai={rupiah(customer.nilai_won)} warna="#008300" keterangan={`${angka(customer.jumlah_won)} peluang WON`} />
          <Kotak label="Meeting" nilai={`${angka(customer.jadwal_selesai)}/${angka(customer.jumlah_jadwal)}`}
            keterangan={customer.jadwal_berikutnya ? `berikutnya ${tanggalPendek(customer.jadwal_berikutnya)}` : 'tidak ada jadwal mendatang'} />
          <Kotak label="Laporan Harian" nilai={angka(customer.jumlah_laporan)}
            keterangan={customer.laporan_terakhir ? `terakhir ${tanggalPendek(customer.laporan_terakhir)}` : 'belum ada'} />
        </section>

        {memuat ? (
          <p className="text-[12px] text-slate-400 py-4 text-center">Memuat riwayat customer…</p>
        ) : (
          <>
            <Bagian judul="Pipeline" jumlah={pipeline.length} href="/pipeline" kosong="Belum ada peluang untuk customer ini.">
              {pipeline.map((p) => (
                <Baris key={p.id} href={`/pipeline?fokus=${p.id}`}
                  judul={p.project_detail}
                  keterangan={`${p.stage === 'WON' ? 'Won' : p.stage === 'LOST' ? 'Lost' : persen(p.probability, 0)} · closing ${tanggalPendek(p.estimated_closing)}${namaOrang[p.sales_user_id] ? ` · ${namaOrang[p.sales_user_id]}` : ''}`}
                  kanan={rupiahRingkas(p.project_value)}
                  warna={p.stage === 'WON' ? '#008300' : p.stage === 'LOST' ? '#e34948' : '#2a78d6'} />
              ))}
            </Bagian>

            <Bagian judul="Jadwal & Meeting" jumlah={jadwal.length} href="/schedule" kosong="Belum ada jadwal untuk customer ini.">
              {jadwal.map((j) => {
                const g = STATUS_JADWAL[statusEfektif(j)] ?? STATUS_JADWAL.UPCOMING;
                return (
                  <Baris key={j.id}
                    href={j.requires_attendance ? `/meeting?fokus=${j.id}` : `/schedule?fokus=${j.id}`}
                    judul={j.category}
                    keterangan={`${tanggalPendek(j.schedule_date)}${j.assigned_to && namaOrang[j.assigned_to] ? ` · ${namaOrang[j.assigned_to]}` : ''}`}
                    kanan={g.label} warna={g.color} />
                );
              })}
            </Bagian>

            <Bagian judul="Laporan Harian" jumlah={laporan.length} href="/daily-report" kosong="Belum ada laporan harian untuk customer ini.">
              {laporan.map((l) => (
                <Baris key={l.id} href={`/daily-report?fokus=${l.id}`}
                  judul={l.activity}
                  keterangan={[l.contact_person, namaOrang[l.sales_user_id]].filter(Boolean).join(' · ') || '—'}
                  kanan={tanggalPendek(l.report_date)}
                  bawah={l.result}
                  warna="#1d4ed8" />
              ))}
            </Bagian>

            {proyek.length > 0 && (
              <Bagian judul="Proyek" jumlah={proyek.length} href="/proyek" kosong="">
                {proyek.map((p) => {
                  const g = STATUS_PROYEK[p.status as StatusProyek] ?? STATUS_PROYEK.AKTIF;
                  return <Baris key={p.id} href={`/proyek?fokus=${p.id}`} judul={p.name} keterangan={p.kode} kanan={g.label} warna={g.color} />;
                })}
              </Bagian>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Kotak({ label, nilai, keterangan, warna }: { label: string; nilai: string; keterangan?: string; warna?: string }) {
  return (
    <div className="rounded-kontrol bg-slate-50 border border-slate-200 px-3 py-2.5 min-w-0">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-tight">{label}</p>
      <p className="text-[14px] font-black tabular-nums mt-1 truncate" style={{ color: warna ?? '#0f172a' }}>{nilai}</p>
      {keterangan && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{keterangan}</p>}
    </div>
  );
}

function Bagian({ judul, jumlah, href, kosong, children }: {
  judul: string; jumlah: number; href: string; kosong: string; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-2 pb-1 border-b border-slate-200">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
          {judul} <span className="text-slate-400">({angka(jumlah)})</span>
        </h3>
        <Link href={href} className="text-[11px] font-bold text-aksen-700 hover:underline underline-offset-2">Buka modul →</Link>
      </div>
      {jumlah === 0 ? <p className="text-[12px] text-slate-400 py-2">{kosong}</p> : <ul className="flex flex-col gap-1">{children}</ul>}
    </section>
  );
}

function Baris({ href, judul, keterangan, kanan, bawah, warna }: {
  href: string; judul: string; keterangan: string; kanan?: string; bawah?: string; warna?: string;
}) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-2.5 rounded-kontrol border border-slate-200 px-3 py-2 hover:bg-slate-50 transition-colors">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: warna ?? '#94a3b8' }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-bold text-slate-800 truncate">{judul}</span>
          <span className="block text-[11px] text-slate-500 truncate">{keterangan}</span>
          {bawah && <span className="block text-[10px] text-slate-400 truncate">{bawah}</span>}
        </span>
        {kanan && <span className="text-[11.5px] font-bold text-slate-600 tabular-nums flex-shrink-0">{kanan}</span>}
      </Link>
    </li>
  );
}
