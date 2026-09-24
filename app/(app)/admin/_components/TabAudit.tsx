'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { tanggalPendek, waktuPendek, angka } from '@/lib/format';
import { Teks, Tombol, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat } from '@/components/shared/Feedback';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { Tabel } from '@/components/shared/Tabel';
import { BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';

const PER_HALAMAN = 30;

interface Jejak {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Warna dan label per tindakan. Yang menyangkut bukti dan wewenang diberi
 * warna menonjol — itulah yang dicari orang saat membuka halaman ini.
 */
const GAYA_AKSI: Record<string, { label: string; color: string; bg: string }> = {
  MEETING_CHECK_IN:     { label: 'Check-in Meeting',   color: '#2a78d6', bg: '#e3edfb' },
  MEETING_COMPLETED:    { label: 'Meeting Selesai',    color: '#008300', bg: '#e0f2e0' },
  MEETING_OVERRIDE:     { label: 'Override Meeting',   color: '#7c3aed', bg: '#ede9fe' },
  SCHEDULE_COMPLETED:   { label: 'Jadwal Selesai',     color: '#008300', bg: '#e0f2e0' },
  USER_CREATED:         { label: 'Akun Dibuat',        color: '#0891b2', bg: '#cffafe' },
  USER_UPDATED:         { label: 'Akun Diubah',        color: '#64748b', bg: '#f1f5f9' },
  USER_PASSWORD_RESET:  { label: 'Sandi Direset',      color: '#eda100', bg: '#fef3d9' },
  PASSWORD_CHANGED:     { label: 'Sandi Diganti',      color: '#64748b', bg: '#f1f5f9' },
  PROFIL_KONTAK_DIUBAH: { label: 'Profil Diubah',      color: '#64748b', bg: '#f1f5f9' },
  AKUN_MENDAFTAR:       { label: 'Pendaftaran Akun',   color: '#0891b2', bg: '#cffafe' },
  AKUN_DISETUJUI:       { label: 'Akun Disetujui',     color: '#008300', bg: '#e0f2e0' },
  AKUN_DITOLAK:         { label: 'Akun Ditolak',       color: '#e34948', bg: '#fce3e3' },
  LOKASI_DIBUAT:        { label: 'Lokasi Dibuat',      color: '#0891b2', bg: '#cffafe' },
  LOKASI_DIAJUKAN:      { label: 'Lokasi Diajukan',    color: '#eda100', bg: '#fef3d9' },
  LOKASI_DISETUJUI:     { label: 'Lokasi Disetujui',   color: '#008300', bg: '#e0f2e0' },
  LOKASI_DITOLAK:       { label: 'Lokasi Ditolak',     color: '#e34948', bg: '#fce3e3' },
  GP_DIAJUKAN:          { label: 'GP Diajukan',        color: '#eda100', bg: '#fef3d9' },
  GP_DIPERIKSA:         { label: 'GP Diperiksa',       color: '#2a78d6', bg: '#e3edfb' },
  GP_DISETUJUI:         { label: 'GP Disetujui',       color: '#008300', bg: '#e0f2e0' },
  GP_DIVERIFIKASI:      { label: 'GP Diverifikasi',    color: '#008300', bg: '#e0f2e0' },
  GP_DITOLAK:           { label: 'GP Ditolak',         color: '#e34948', bg: '#fce3e3' },
  GP_DIBUKA_ULANG:      { label: 'GP Dibuka Ulang',    color: '#7c3aed', bg: '#ede9fe' },
};

const LABEL_ENTITAS: Record<string, string> = {
  users: 'Akun',
  sm_locations: 'Lokasi',
  sm_schedules: 'Jadwal',
  sm_gp_calculations: 'GP Calculation',
  sm_daily_reports: 'Daily Report',
  sm_pipeline: 'Pipeline',
  sm_projects: 'Proyek',
};

const LABEL_DETAIL: Record<string, string> = {
  role: 'Peran', email: 'Email', phone: 'Telepon', full_name: 'Nama', username: 'Username',
  manager_id: 'Atasan', approved_by: 'Disetujui oleh', approval_status: 'Status',
  rejection_reason: 'Alasan', name: 'Nama', active: 'Aktif', division: 'Divisi',
  position: 'Jabatan', distance_m: 'Jarak (m)', accuracy_m: 'Akurasi (m)',
  evidence_count: 'Foto', original_failure: 'Kegagalan awal', reason: 'Alasan',
  nomor: 'Nomor', catatan: 'Catatan', address: 'Alamat',
};

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gayaAksi(kode: string) {
  return GAYA_AKSI[kode] ?? {
    label: kode.toLowerCase().split('_').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' '),
    color: '#64748b', bg: '#f1f5f9',
  };
}

/** Detail jejak dalam bahasa manusia: id orang diganti namanya, id teknis lain dan nilai kosong dibuang. */
function ringkasDetail(detail: Record<string, unknown> | null, nama: Record<string, string>): string {
  if (!detail) return '';
  return Object.entries(detail)
    .filter(([k, v]) => v !== null && v !== '' && k !== 'approved_at')
    .map(([k, v]) => {
      const teks = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (POLA_UUID.test(teks)) return nama[teks] ? `${LABEL_DETAIL[k] ?? k}: ${nama[teks]}` : null;
      const nilai = typeof v === 'boolean' ? (v ? 'Ya' : 'Tidak') : teks;
      return `${LABEL_DETAIL[k] ?? k.replace(/_/g, ' ')}: ${nilai}`;
    })
    .filter(Boolean)
    .join(' · ');
}

export function TabAudit() {
  const [daftar, setDaftar] = useState<Jejak[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [halaman, setHalaman] = useState(0);
  const [filterAksi, setFilterAksi] = useState('');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    let q = supabase
      .from('audit_trail')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    if (filterAksi) q = q.eq('action', filterAksi);
    if (cariTertunda.trim()) q = q.ilike('actor_name', `%${cariTertunda.trim()}%`);

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as Jejak[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [halaman, filterAksi, cariTertunda]);

  useEffect(() => { void muat(); }, [muat]);

  const [namaPengguna, setNamaPengguna] = useState<Record<string, string>>({});
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('users').select('id, full_name');
      setNamaPengguna(Object.fromEntries(((data ?? []) as { id: string; full_name: string }[])
        .map((u) => [u.id, u.full_name])));
    })();
  }, []);

  /** Seluruh jejak sesuai penyaring, tanpa paginasi. */
  const ambilSemua = useCallback(async () => {
    let q = supabase
      .from('audit_trail')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(BATAS_BARIS_EKSPOR + 1);

    if (filterAksi) q = q.eq('action', filterAksi);
    if (cariTertunda.trim()) q = q.ilike('actor_name', `%${cariTertunda.trim()}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Jejak[];
  }, [filterAksi, cariTertunda]);

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[190px]">
          <label htmlFor="a-aksi" className="text-[11px] font-semibold text-slate-600">Tindakan</label>
          <PilihCari id="a-aksi" nilai={filterAksi}
            onUbah={(v) => { setFilterAksi(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua tindakan"
            opsi={Object.entries(GAYA_AKSI).map(([v, g]) => ({ value: v, label: g.label }))} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label htmlFor="a-cari" className="text-[11px] font-semibold text-slate-600">Pelaku</label>
          <Teks id="a-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Nama pelaku…" />
        </div>
        <TombolEkspor
          ambil={ambilSemua}
          susun={(baris) => ({
            namaBerkas: 'audit-log',
            namaSheet: 'Audit Log',
            judul: 'Audit Log',
            keterangan: [
              filterAksi ? `Tindakan: ${GAYA_AKSI[filterAksi]?.label ?? filterAksi}` : 'Tindakan: semua',
              cariTertunda ? `Pelaku mengandung: ${cariTertunda}` : 'Pelaku: semua',
              `Diekspor pada ${tanggalPendek(new Date().toISOString())}`,
            ],
            kolom: [
              { judul: 'Waktu', lebar: 18,
                nilai: (j) => `${tanggalPendek(j.created_at)} ${waktuPendek(j.created_at)}` },
              { judul: 'Pelaku', lebar: 22, nilai: (j) => j.actor_name ?? '—' },
              { judul: 'Tindakan', lebar: 22,
                nilai: (j) => gayaAksi(j.action).label },
              { judul: 'Kode Tindakan', lebar: 22, nilai: (j) => j.action },
              { judul: 'Objek', lebar: 18, nilai: (j) => LABEL_ENTITAS[j.entity] ?? j.entity },
              { judul: 'ID Entitas', lebar: 38, nilai: (j) => j.entity_id },
              // Detail disimpan sebagai JSON; diratakan jadi teks supaya tetap
              // terbaca di Excel tanpa perlu alat tambahan.
              { judul: 'Detail', lebar: 50,
                nilai: (j) => (j.detail ? JSON.stringify(j.detail) : '') },
            ],
            baris,
            ringkasan: [
              { label: 'Jumlah jejak', nilai: baris.length },
              { label: 'Override meeting',
                nilai: baris.filter((j) => j.action === 'MEETING_OVERRIDE').length },
              { label: 'Pelaku berbeda',
                nilai: new Set(baris.map((j) => j.actor_id ?? '—')).size },
            ],
          })}
        />
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Jejak ini <b>tidak bisa diubah maupun dihapus siapa pun</b>, termasuk Admin —
        tidak ada policy UPDATE atau DELETE pada tabelnya. Jejak yang bisa disunting
        bukan jejak audit.
      </p>

      {galat ? (
        <PanelGalat pesan={galat} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={8} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong judul="Belum ada jejak"
            keterangan={filterAksi || cariTertunda
              ? 'Tidak ada jejak yang cocok dengan penyaring.'
              : 'Tindakan penting akan tercatat di sini secara otomatis.'} />
        </div>
      ) : (
        <>
          <Tabel
            data={daftar}
            kunci={(j) => String(j.id)}
            kolom={[
              {
                label: 'Waktu', className: 'w-32 whitespace-nowrap',
                render: (j) => (
                  <span className="tabular-nums">
                    {tanggalPendek(j.created_at)}
                    <span className="text-slate-400"> · {waktuPendek(j.created_at)}</span>
                  </span>
                ),
              },
              { label: 'Tindakan', className: 'w-40', render: (j) => <Lencana {...gayaAksi(j.action)} /> },
              {
                label: 'Pelaku', className: 'w-[16%]',
                render: (j) => (
                  <span className="font-semibold text-slate-800 truncate block">
                    {j.actor_name ?? (j.actor_id ? namaPengguna[j.actor_id] : null) ?? 'Sistem'}
                  </span>
                ),
              },
              {
                label: 'Objek', className: 'w-28',
                render: (j) => <span className="text-slate-500">{LABEL_ENTITAS[j.entity] ?? j.entity}</span>,
              },
              {
                label: 'Detail', className: 'w-[36%]',
                render: (j) => {
                  const teks = ringkasDetail(j.detail, namaPengguna);
                  return teks
                    ? <span className="text-[12px] text-slate-600 line-clamp-2" title={teks}>{teks}</span>
                    : <span className="text-slate-400">—</span>;
                },
              },
            ]}
          />

          {totalHalaman > 1 ? (
            <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
              <p className="text-[11px] text-slate-500">
                Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
                <span className="font-bold tabular-nums">{totalHalaman}</span>
                <span className="text-slate-400"> · {angka(total)} jejak</span>
              </p>
              <div className="flex items-center gap-2">
                <Tombol rupa="kedua" disabled={halaman === 0}
                  onClick={() => setHalaman((h) => h - 1)} className="text-[12px] py-2">Sebelumnya</Tombol>
                <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman}
                  onClick={() => setHalaman((h) => h + 1)} className="text-[12px] py-2">Berikutnya</Tombol>
              </div>
            </nav>
          ) : (
            <p className="text-[11px] text-slate-400 text-center py-2">{angka(total)} jejak</p>
          )}
        </>
      )}
    </div>
  );
}
