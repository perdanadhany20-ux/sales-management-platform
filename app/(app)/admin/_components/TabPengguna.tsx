'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LABEL_PERAN, type Peran } from '@/lib/constants';
import { tanggalPendek } from '@/lib/format';
import { Modal, Konfirmasi } from '@/components/shared/Modal';
import { Kolom, Teks, KataSandi, Tombol, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';

interface Pengguna {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active: boolean;
  created_at: string;
  manager_id: string | null;
}

const GAYA_PERAN: Record<string, { color: string; bg: string }> = {
  ADMIN:    { color: '#7c3aed', bg: '#ede9fe' },
  DIRECTOR: { color: '#be123c', bg: '#ffe4e6' },
  FINANCE:  { color: '#008300', bg: '#e0f2e0' },
  MANAGER:  { color: '#1d4ed8', bg: '#dbeafe' },
  SALES:    { color: '#0891b2', bg: '#cffafe' },
};

const OPSI_PERAN = (['SALES', 'MANAGER', 'DIRECTOR', 'FINANCE', 'ADMIN'] as Peran[]).map((p) => ({
  value: p,
  label: LABEL_PERAN[p],
  keterangan: {
    SALES:    'Hanya data miliknya dan jadwal yang ditugaskan',
    MANAGER:  'Lihat semua, tugaskan jadwal, setujui exception, periksa GP',
    DIRECTOR: 'Lihat semua; menyetujui GP Calculation sesudah diperiksa Manager',
    FINANCE:  'Lihat semua; memverifikasi GP Calculation sesudah disetujui Director',
    ADMIN:    'Semua wewenang di atas, plus kelola akun dan konfigurasi',
  }[p],
}));

/**
 * Kelola akun.
 *
 * Seluruh penulisan lewat /api/admin/users, bukan langsung ke PostgREST —
 * hash bcrypt harus dihitung di server, dan user_credentials sengaja tidak
 * punya policy RLS sehingga hanya service role yang bisa menulisnya.
 */
export function TabPengguna({ pemanggilId }: { pemanggilId: string }) {
  const toast = useToast();

  const [daftar, setDaftar] = useState<Pengguna[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [filterPeran, setFilterPeran] = useState('');

  const [formBuka, setFormBuka] = useState(false);
  const [sunting, setSunting] = useState<Pengguna | null>(null);
  const [resetUntuk, setResetUntuk] = useState<Pengguna | null>(null);
  const [akanUbahAktif, setAkanUbahAktif] = useState<Pengguna | null>(null);
  const [memproses, setMemproses] = useState(false);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Gagal memuat pengguna.'); return; }
      setDaftar(data.users as Pengguna[]);
    } catch {
      setGalat('Jaringan bermasalah.');
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  const tersaring = useMemo(() => {
    const k = cari.trim().toLowerCase();
    return daftar.filter((u) =>
      (!filterPeran || u.role === filterPeran) &&
      (!k || u.full_name.toLowerCase().includes(k) || u.username.toLowerCase().includes(k)));
  }, [daftar, cari, filterPeran]);

  async function ubahAktif() {
    if (!akanUbahAktif) return;
    setMemproses(true);
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: akanUbahAktif.id, active: !akanUbahAktif.active }),
    });
    const data = await res.json();
    setMemproses(false);
    if (!res.ok) { toast('galat', data?.error ?? 'Gagal mengubah status akun.'); return; }
    toast('sukses', akanUbahAktif.active ? 'Akun dinonaktifkan.' : 'Akun diaktifkan.');
    setAkanUbahAktif(null);
    void muat();
  }

  return (
    <div className="flex flex-col gap-4">

      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label htmlFor="u-peran" className="text-[11px] font-semibold text-slate-600">Peran</label>
          <PilihCari id="u-peran" nilai={filterPeran} onUbah={setFilterPeran}
            bolehKosong labelKosong="Semua peran" opsi={OPSI_PERAN} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label htmlFor="u-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="u-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Nama atau username…" />
        </div>
        <Tombol onClick={() => { setSunting(null); setFormBuka(true); }}>+ Pengguna Baru</Tombol>
      </div>

      {galat ? (
        <PanelGalat pesan={galat} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={5} />
      ) : tersaring.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong judul="Tidak ada pengguna"
            keterangan={cari || filterPeran ? 'Tidak ada yang cocok dengan penyaring.' : 'Tambahkan akun pertama.'} />
        </div>
      ) : (
        <Tabel
          data={tersaring}
          kunci={(u) => u.id}
          lebarAksi="w-64"
          kolom={[
            {
              label: 'Pengguna', className: 'w-[38%]',
              render: (u) => {
                const sendiri = u.id === pemanggilId;
                return (
                  <div className={`flex items-center gap-2.5 ${u.active ? '' : 'opacity-60'}`}>
                    <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 grid place-items-center text-[11px] font-black flex-shrink-0">
                      {u.full_name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 truncate">{u.full_name}</span>
                        {sendiri && <Lencana label="Anda" color="#64748b" bg="#f1f5f9" />}
                        {!u.active && <Lencana label="Nonaktif" color="#e34948" bg="#fce3e3" />}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">@{u.username}</p>
                    </div>
                  </div>
                );
              },
            },
            {
              label: 'Peran', className: 'w-32',
              render: (u) => <Lencana label={LABEL_PERAN[u.role as Peran] ?? u.role} {...(GAYA_PERAN[u.role] ?? GAYA_PERAN.SALES)} />,
            },
            {
              label: 'Kontak', className: 'w-[22%]',
              render: (u) => <span className="text-slate-600">{u.email || '—'}</span>,
            },
            {
              label: 'Dibuat', className: 'w-28 whitespace-nowrap',
              render: (u) => tanggalPendek(u.created_at),
            },
          ]}
          aksi={(u) => {
            const sendiri = u.id === pemanggilId;
            return (
              <>
                <TombolIkon rupa="sunting" label="Sunting"
                  onClick={() => { setSunting(u); setFormBuka(true); }} />
                <Tombol rupa="kedua" className="text-[11px] py-1.5 px-2"
                  onClick={() => setResetUntuk(u)}>Reset Sandi</Tombol>
                {!sendiri && (
                  <Tombol rupa="hantu"
                    className={`text-[11px] py-1.5 px-2 ${u.active ? 'text-[#e34948]' : 'text-[#008300]'}`}
                    onClick={() => setAkanUbahAktif(u)}>
                    {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                  </Tombol>
                )}
              </>
            );
          }}
        />
      )}

      {formBuka && (
        <FormPengguna
          buka={formBuka}
          onTutup={() => setFormBuka(false)}
          onTersimpan={muat}
          awal={sunting}
          calonAtasan={daftar}
        />
      )}

      {resetUntuk && (
        <FormResetSandi
          buka={Boolean(resetUntuk)}
          onTutup={() => setResetUntuk(null)}
          onTersimpan={muat}
          pengguna={resetUntuk}
        />
      )}

      <Konfirmasi
        buka={Boolean(akanUbahAktif)}
        onTutup={() => setAkanUbahAktif(null)}
        onSetuju={ubahAktif}
        memproses={memproses}
        bahaya={akanUbahAktif?.active}
        judul={akanUbahAktif?.active ? 'Nonaktifkan akun ini?' : 'Aktifkan akun ini?'}
        pesan={akanUbahAktif?.active
          ? `${akanUbahAktif?.full_name} akan langsung kehilangan akses — sesinya yang sedang berjalan ikut berhenti berlaku.`
          : `${akanUbahAktif?.full_name} akan bisa masuk kembali.`}
        labelSetuju={akanUbahAktif?.active ? 'Nonaktifkan' : 'Aktifkan'}
      />
    </div>
  );
}

function FormPengguna({
  buka, onTutup, onTersimpan, awal, calonAtasan,
}: {
  buka: boolean; onTutup: () => void; onTersimpan: () => void; awal: Pengguna | null;
  calonAtasan: Pengguna[];
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(awal?.full_name ?? '');
  const [username, setUsername] = useState(awal?.username ?? '');
  const [email, setEmail] = useState(awal?.email ?? '');
  const [phone, setPhone] = useState(awal?.phone ?? '');
  const [role, setRole] = useState(awal?.role ?? 'SALES');
  const [managerId, setManagerId] = useState(awal?.manager_id ?? '');
  const [sandi, setSandi] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);
    setMemproses(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: awal ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(
          awal
            ? { id: awal.id, full_name: fullName, email, phone, role, manager_id: managerId || null }
            : { username, full_name: fullName, email, phone, role, password: sandi },
        ),
      });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Gagal menyimpan.'); return; }
      toast('sukses', awal ? 'Pengguna diperbarui.' : 'Pengguna dibuat.');
      onTersimpan();
      onTutup();
    } catch {
      setGalat('Jaringan bermasalah.');
    } finally {
      setMemproses(false);
    }
  }

  return (
    <Modal
      buka={buka} onTutup={onTutup}
      judul={awal ? 'Sunting Pengguna' : 'Pengguna Baru'}
      keterangan={awal ? `@${awal.username}` : 'Akun baru wajib mengganti sandi saat pertama masuk.'}
      kaki={
        <>
          <Tombol rupa="kedua" type="button" onClick={onTutup} disabled={memproses}>Batal</Tombol>
          <Tombol type="submit" form="form-pengguna" memuat={memproses}>
            {memproses ? 'Menyimpan…' : 'Simpan'}
          </Tombol>
        </>
      }
    >
      <form id="form-pengguna" onSubmit={simpan} className="flex flex-col gap-4">
        {galat && <PanelGalat pesan={galat} />}

        <Kolom label="Nama Lengkap" wajib>
          {(id) => <Teks id={id} value={fullName} onChange={(e) => setFullName(e.target.value)}
            required disabled={memproses} placeholder="mis. Budi Santoso" />}
        </Kolom>

        {!awal && (
          <Kolom label="Username" wajib
            bantuan="Huruf kecil, angka, titik, garis bawah, atau strip. Tidak bisa diubah nanti.">
            {(id) => <Teks id={id} value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              required disabled={memproses} autoCapitalize="none" placeholder="budi.santoso" />}
          </Kolom>
        )}

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4">
          <Kolom label="Email">
            {(id) => <Teks id={id} type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} disabled={memproses} />}
          </Kolom>
          <Kolom label="Telepon">
            {(id) => <Teks id={id} type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)} disabled={memproses} />}
          </Kolom>
        </div>

        <Kolom label="Peran" wajib>
          {(id) => <PilihCari id={id} nilai={role} onUbah={setRole} opsi={OPSI_PERAN} disabled={memproses} />}
        </Kolom>

        {awal && (
          <Kolom label="Atasan" bantuan="Siapa yang membawahi akun ini secara struktural.">
            {(id) => (
              <PilihCari
                id={id} nilai={managerId} onUbah={setManagerId} disabled={memproses}
                bolehKosong labelKosong="— tidak ada —"
                opsi={calonAtasan
                  .filter((u) => u.id !== awal.id)
                  .map((u) => ({ value: u.id, label: `${u.full_name} (${LABEL_PERAN[u.role as Peran] ?? u.role})` }))}
              />
            )}
          </Kolom>
        )}

        {!awal && (
          <Kolom label="Kata Sandi Awal" wajib
            bantuan="Minimal 8 karakter, memuat huruf dan angka. Pengguna wajib menggantinya saat pertama masuk.">
            {(id) => <KataSandi id={id} nilai={sandi} onUbah={setSandi}
              disabled={memproses} autoComplete="new-password" />}
          </Kolom>
        )}
      </form>
    </Modal>
  );
}

function FormResetSandi({
  buka, onTutup, onTersimpan, pengguna,
}: {
  buka: boolean; onTutup: () => void; onTersimpan: () => void; pengguna: Pengguna;
}) {
  const toast = useToast();
  const [sandi, setSandi] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);
    setMemproses(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: pengguna.id, password: sandi }),
      });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Gagal mereset kata sandi.'); return; }
      toast('sukses', `Kata sandi ${pengguna.full_name} direset. Sesinya dikeluarkan.`);
      onTersimpan();
      onTutup();
    } catch {
      setGalat('Jaringan bermasalah.');
    } finally {
      setMemproses(false);
    }
  }

  return (
    <Modal
      buka={buka} onTutup={onTutup} lebar="kecil"
      judul="Reset Kata Sandi"
      keterangan={`${pengguna.full_name} · @${pengguna.username}`}
      kaki={
        <>
          <Tombol rupa="kedua" type="button" onClick={onTutup} disabled={memproses}>Batal</Tombol>
          <Tombol type="submit" form="form-reset" memuat={memproses} disabled={!sandi}>
            {memproses ? 'Menyimpan…' : 'Reset'}
          </Tombol>
        </>
      }
    >
      <form id="form-reset" onSubmit={simpan} className="flex flex-col gap-4">
        {galat && <PanelGalat pesan={galat} />}

        <Kolom label="Kata Sandi Baru" wajib
          bantuan="Minimal 8 karakter, memuat huruf dan angka.">
          {(id) => <KataSandi id={id} nilai={sandi} onUbah={setSandi}
            disabled={memproses} autoComplete="new-password" />}
        </Kolom>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          Seluruh sesi aktif milik pengguna ini akan dihapus, sehingga sandi baru
          langsung berlaku. Ia wajib menggantinya lagi saat masuk berikutnya.
        </p>
      </form>
    </Modal>
  );
}
