'use client';

import { useCallback, useEffect, useState } from 'react';
import { LABEL_PERAN, type Peran } from '@/lib/constants';
import { tanggalPendek, waktuPendek } from '@/lib/format';
import { Tombol, Lencana, AreaTeks, Kolom, Teks } from '@/components/shared/FormParts';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Tabel } from '@/components/shared/Tabel';

/**
 * Persetujuan pendaftaran akun.
 *
 * Akun yang mendaftar sendiri lahir dalam keadaan MENUNGGU dan tidak bisa
 * dipakai masuk sampai diperiksa di sini. Yang diperiksa bukan sekadar "orang
 * ini ada" melainkan apakah ia memang bagian dari tim — karena begitu
 * disetujui, akunnya langsung memperoleh akses ke seluruh data miliknya
 * sendiri dan, kalau kelak dinaikkan perannya, ke data seluruh tim.
 *
 * Penolakan menuntut alasan tertulis. Akun yang ditolak tanpa keterangan akan
 * menghasilkan orang yang mendaftar berulang kali dengan username berbeda,
 * karena ia tidak pernah tahu apa yang salah.
 */

interface Akun {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active: boolean;
  created_at: string;
  division: string | null;
  sales_division: string | null;
  position: string | null;
  event_code: string | null;
  joined_at: string | null;
  approval_status: string;
  approved_at: string | null;
  rejection_reason: string | null;
}

const GAYA_PERSETUJUAN: Record<string, { label: string; color: string; bg: string }> = {
  MENUNGGU:  { label: 'Menunggu Verifikasi', color: '#eda100', bg: '#fef3d9' },
  DISETUJUI: { label: 'Disetujui',           color: '#008300', bg: '#e0f2e0' },
  DITOLAK:   { label: 'Ditolak',             color: '#e34948', bg: '#fce3e3' },
};

export function TabPersetujuan() {
  const toast = useToast();

  const [semua, setSemua] = useState<Akun[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [tampilkanRiwayat, setTampilkanRiwayat] = useState(false);

  const [menolak, setMenolak] = useState<string | null>(null);
  const [alasan, setAlasan] = useState('');
  const [cari, setCari] = useState('');

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Gagal memuat akun.'); return; }
      setSemua((data.users ?? []) as Akun[]);
    } catch {
      setGalat('Jaringan bermasalah.');
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  async function putuskan(id: string, keputusan: 'DISETUJUI' | 'DITOLAK', alasanTolak?: string) {
    setSibuk(id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, approval_status: keputusan, rejection_reason: alasanTolak }),
      });
      const data = await res.json();
      if (!res.ok) { toast('galat', data?.error ?? 'Gagal menyimpan keputusan.'); return; }

      toast('sukses', keputusan === 'DISETUJUI'
        ? 'Akun disetujui dan langsung bisa dipakai masuk.'
        : 'Pendaftaran ditolak. Alasannya tersimpan permanen.');
      setMenolak(null);
      setAlasan('');
      void muat();
    } finally {
      setSibuk(null);
    }
  }

  const k = cari.trim().toLowerCase();
  const cocok = (a: Akun) => !k || [a.full_name, a.username, a.email, a.division, a.position]
    .some((v) => (v ?? '').toLowerCase().includes(k));
  const menunggu = semua.filter((a) => a.approval_status === 'MENUNGGU' && cocok(a));
  const sudah = semua.filter((a) => a.approval_status !== 'MENUNGGU' && cocok(a));

  if (memuat) return <KerangkaBaris jumlah={4} />;
  if (galat) return <PanelGalat pesan={galat} onCoba={muat} />;

  return (
    <div className="flex flex-col gap-4">

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-slate-500 leading-relaxed max-w-2xl">
          Akun yang mendaftar sendiri <b>tidak bisa dipakai masuk</b> sebelum disetujui di sini.
          Setiap pendaftar otomatis berperan Sales; menaikkan perannya dilakukan terpisah di
          bagian Pengguna.
        </p>
        <Teks type="search" value={cari} onChange={(e) => setCari(e.target.value)}
          placeholder="Cari nama, username, email, divisi…" aria-label="Cari pendaftar" className="!w-64" />
        <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={tampilkanRiwayat}
            onChange={(e) => setTampilkanRiwayat(e.target.checked)}
            className="w-4 h-4 accent-aksen-700" />
          Tampilkan yang sudah diputuskan
        </label>
      </div>

      {menunggu.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Tidak ada pendaftaran menunggu"
            keterangan="Semua pendaftaran sudah diputuskan. Yang baru akan muncul di sini."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {menunggu.map((a) => (
            <li key={a.id}>
              <KartuAkun akun={a} menonjol>
                {menolak === a.id ? (
                  <div className="w-full pt-2">
                    <Kolom label="Alasan penolakan" wajib
                      galat={alasan && alasan.trim().length < 10 ? 'Minimal 10 karakter.' : null}>
                      {(id, invalid) => (
                        <AreaTeks id={id} rows={2} value={alasan} aria-invalid={invalid}
                          onChange={(e) => setAlasan(e.target.value)}
                          placeholder="Contoh: nama tidak terdaftar sebagai karyawan aktif." />
                      )}
                    </Kolom>
                    <div className="flex justify-end gap-2 mt-2">
                      <Tombol rupa="kedua" className="text-[12px] py-2"
                        onClick={() => { setMenolak(null); setAlasan(''); }}>Batal</Tombol>
                      <Tombol rupa="bahaya" className="text-[12px] py-2"
                        disabled={alasan.trim().length < 10} memuat={sibuk === a.id}
                        onClick={() => putuskan(a.id, 'DITOLAK', alasan.trim())}>
                        Kirim Penolakan
                      </Tombol>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Tombol rupa="kedua" className="text-[12px] py-2"
                      onClick={() => { setMenolak(a.id); setAlasan(''); }}>Tolak</Tombol>
                    <Tombol className="text-[12px] py-2" memuat={sibuk === a.id}
                      onClick={() => putuskan(a.id, 'DISETUJUI')}>Setujui</Tombol>
                  </div>
                )}
              </KartuAkun>
            </li>
          ))}
        </ul>
      )}

      {tampilkanRiwayat && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            Sudah diputuskan ({sudah.length})
          </h3>
          <Tabel
            data={sudah}
            kunci={(a) => a.id}
            kolom={[
              {
                label: 'Pengguna', className: 'w-[32%]',
                render: (a) => (
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900 truncate">{a.full_name}</span>
                      <Lencana {...(GAYA_PERSETUJUAN[a.approval_status] ?? GAYA_PERSETUJUAN.MENUNGGU)} />
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">@{a.username}</p>
                  </div>
                ),
              },
              {
                label: 'Peran', className: 'w-28',
                render: (a) => <Lencana label={LABEL_PERAN[a.role as Peran] ?? a.role} color="#0891b2" bg="#cffafe" />,
              },
              {
                label: 'Divisi / Jabatan', className: 'w-[22%]',
                render: (a) => (
                  <span className="text-slate-600">
                    {[a.division, a.position].filter(Boolean).join(' · ') || '—'}
                  </span>
                ),
              },
              {
                label: 'Diputuskan', className: 'w-32',
                render: (a) => (a.approved_at
                  ? tanggalPendek(a.approved_at)
                  : <span className="text-slate-400">—</span>),
              },
            ]}
          />
          {sudah.some((a) => a.approval_status === 'DITOLAK' && a.rejection_reason) && (
            <ul className="flex flex-col gap-1">
              {sudah.filter((a) => a.approval_status === 'DITOLAK' && a.rejection_reason).map((a) => (
                <li key={a.id} className="text-[11px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-2.5 py-1.5 leading-snug">
                  <b className="font-bold">{a.full_name}:</b> {a.rejection_reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function KartuAkun({ akun: a, menonjol, children }: {
  akun: Akun; menonjol?: boolean; children?: React.ReactNode;
}) {
  const gaya = GAYA_PERSETUJUAN[a.approval_status] ?? GAYA_PERSETUJUAN.MENUNGGU;

  return (
    <article className={`bg-white rounded-kartu border p-3 sm:p-4
                         ${menonjol ? 'border-[#eda100]/40 ring-1 ring-[#eda100]/15' : 'border-slate-200'}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-900 truncate">{a.full_name}</p>
            <Lencana {...gaya} />
            <Lencana label={LABEL_PERAN[a.role as Peran] ?? a.role} color="#0891b2" bg="#cffafe" />
          </div>

          <p className="text-[12px] text-slate-500 mt-0.5">
            @{a.username}
            {a.email && <span className="text-slate-400"> · {a.email}</span>}
            {a.phone && <span className="text-slate-400"> · {a.phone}</span>}
          </p>

          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-1.5 text-[11px] text-slate-500">
            <Fakta label="Divisi" nilai={a.division} />
            <Fakta label="Sales Division" nilai={a.sales_division} />
            <Fakta label="Jabatan" nilai={a.position} />
            <Fakta label="Kode Acara" nilai={a.event_code} />
          </div>

          <p className="text-[11px] text-slate-400 mt-1">
            Mendaftar {tanggalPendek(a.created_at)} {waktuPendek(a.created_at)}
            {a.approved_at && (
              <span> · diputuskan {tanggalPendek(a.approved_at)}</span>
            )}
          </p>

          {a.approval_status === 'DITOLAK' && a.rejection_reason && (
            <p className="text-[11px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-2.5 py-1.5 mt-1.5 leading-snug">
              {a.rejection_reason}
            </p>
          )}
        </div>

        {children}
      </div>
    </article>
  );
}

function Fakta({ label, nilai }: { label: string; nilai: string | null }) {
  if (!nilai) return null;
  return (
    <span>
      <span className="text-slate-400">{label}:</span>{' '}
      <span className="font-semibold text-slate-600">{nilai}</span>
    </span>
  );
}
