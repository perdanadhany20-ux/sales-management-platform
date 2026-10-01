// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LABEL_PERAN, type Peran } from '@/lib/constants';
import { DAFTAR_POSISI, GAYA_POSISI, peringkatPosisi, type Posisi } from '@/lib/posisi';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, Tombol, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';

/**
 * Admin → Struktur Organisasi — pohon atasan–bawahan.
 *
 * Pohon ini bukan hiasan: garis atasan (users.manager_id) menentukan siapa
 * boleh melihat data siapa (mis. daftar customer, migrasi 035). Karena itu
 * aturannya ditegakkan database lewat trigger sm_jaga_struktur (migrasi 036):
 * atasan harus aktif dan berposisi lebih tinggi, tanpa lingkaran. Tampilan di
 * sini hanya menawarkan pilihan yang sah; pesan penolakan database diteruskan
 * apa adanya bila tetap terjadi.
 *
 * Penulisan lewat /api/admin/users (Admin saja), sama dengan Admin → Pengguna.
 */

interface Orang {
  id: string;
  username: string;
  full_name: string;
  role: string;
  active: boolean;
  position: string | null;
  manager_id: string | null;
}

export function TabStruktur() {
  const toast = useToast();
  const [daftar, setDaftar] = useState<Orang[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [tertutup, setTertutup] = useState<Set<string>>(new Set());
  const [diatur, setDiatur] = useState<Orang | null>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Gagal memuat pengguna.'); return; }
      setDaftar(data.users as Orang[]);
    } catch {
      setGalat('Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.');
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  const aktif = useMemo(() => daftar.filter((u) => u.active), [daftar]);
  const perId = useMemo(() => new Map(aktif.map((u) => [u.id, u])), [aktif]);

  const anak = useMemo(() => {
    const m = new Map<string, Orang[]>();
    for (const u of aktif) {
      if (u.manager_id && perId.has(u.manager_id)) {
        const d = m.get(u.manager_id) ?? [];
        d.push(u);
        m.set(u.manager_id, d);
      }
    }
    m.forEach((d) => d.sort(urutOrang));
    return m;
  }, [aktif, perId]);

  const akar = useMemo(
    () => aktif.filter((u) => !u.manager_id || !perId.has(u.manager_id)).sort(urutOrang),
    [aktif, perId],
  );

  const tanpaPosisi = aktif.filter((u) => !u.position);
  // Direktur memang puncak pohon; selain itu, yang tanpa atasan belum dipetakan.
  const belumDipetakan = aktif.filter((u) => u.position && u.position !== 'Direktur'
    && (!u.manager_id || !perId.has(u.manager_id)));
  const nonaktif = daftar.length - aktif.length;

  const jumlahBawahan = useCallback((id: string): number => {
    const d = anak.get(id) ?? [];
    return d.reduce((n, u) => n + 1 + jumlahBawahan(u.id), 0);
  }, [anak]);

  const garisAtasan = useCallback((u: Orang): string[] => {
    const hasil: string[] = [];
    let kini = u.manager_id ? perId.get(u.manager_id) : undefined;
    let jaga = 0;
    while (kini && jaga++ < 20) {
      hasil.unshift(kini.full_name);
      kini = kini.manager_id ? perId.get(kini.manager_id) : undefined;
    }
    return hasil;
  }, [perId]);

  const kataCari = cari.trim().toLowerCase();
  const hasilCari = kataCari
    ? aktif.filter((u) => u.full_name.toLowerCase().includes(kataCari)
        || u.username.toLowerCase().includes(kataCari)).sort(urutOrang)
    : [];

  function alihkan(id: string) {
    setTertutup((t) => {
      const b = new Set(t);
      if (b.has(id)) b.delete(id); else b.add(id);
      return b;
    });
  }

  if (galat) return <PanelGalat pesan={galat} onCoba={muat} />;
  if (memuat) return <KerangkaBaris jumlah={6} />;

  return (
    <div className="flex flex-col gap-4">
      {/* Ringkasan: yang perlu dikerjakan Admin lebih dulu */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Ringkas label="Akun aktif" nilai={aktif.length}
          ket={nonaktif > 0 ? `${nonaktif} nonaktif tidak ditampilkan` : 'Semua akun aktif'} />
        <Ringkas label="Posisi belum diisi" nilai={tanpaPosisi.length}
          ket={tanpaPosisi.length ? 'Wajib diisi sebelum bisa dipetakan' : 'Lengkap'}
          peringatan={tanpaPosisi.length > 0} />
        <Ringkas label="Belum punya atasan" nilai={belumDipetakan.length}
          ket={belumDipetakan.length ? 'Selain Direktur, setiap akun sebaiknya punya atasan' : 'Semua sudah dipetakan'}
          peringatan={belumDipetakan.length > 0} />
      </div>

      {(tanpaPosisi.length > 0 || belumDipetakan.length > 0) && (
        <section aria-labelledby="judul-lengkapi"
          className="bg-[#fffbeb] border border-[#f59e0b]/30 rounded-kartu p-3 sm:p-4 flex flex-col gap-2">
          <h3 id="judul-lengkapi" className="text-[12px] font-bold text-[#92400e]">Perlu dilengkapi</h3>
          <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
            {[...tanpaPosisi, ...belumDipetakan].map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => setDiatur(u)}
                  className="rounded-full border border-[#f59e0b]/40 bg-white px-3 py-1.5 text-[12px] font-semibold
                             text-slate-700 hover:bg-[#fef3c7] min-h-[36px]
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-aksen-600">
                  {u.full_name}
                  <span className="text-slate-400 font-normal"> · {u.position ? 'atur atasan' : 'isi posisi'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label htmlFor="st-cari" className="text-[11px] font-semibold text-slate-600">Cari orang</label>
          <Teks id="st-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Nama atau username…" />
        </div>
        <div className="flex gap-2">
          <Tombol rupa="kedua" type="button" onClick={() => setTertutup(new Set())}>Buka semua</Tombol>
          <Tombol rupa="kedua" type="button"
            onClick={() => setTertutup(new Set(Array.from(anak.keys())))}>Tutup semua</Tombol>
        </div>
      </div>

      {kataCari ? (
        <div className="bg-white rounded-kartu border border-slate-200 overflow-hidden">
          {hasilCari.length === 0 ? (
            <Kosong judul="Tidak ada yang cocok" keterangan={`Tidak ada akun aktif bernama "${cari.trim()}".`} />
          ) : (
            <ul className="m-0 p-0 list-none divide-y divide-slate-100">
              {hasilCari.map((u) => {
                const garis = garisAtasan(u);
                return (
                  <li key={u.id}>
                    <BarisOrang u={u} tingkat={0} jumlah={jumlahBawahan(u.id)} punyaAnak={false}
                      buka onAlih={() => {}} onAtur={() => setDiatur(u)}
                      jalur={garis.length ? garis.join(' › ') : 'Puncak pohon (tanpa atasan)'} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : aktif.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong judul="Belum ada akun aktif" keterangan="Buat akun di Admin → Pengguna." />
        </div>
      ) : (
        <div className="bg-white rounded-kartu border border-slate-200 p-2 sm:p-3">
          <ul role="tree" aria-label="Struktur organisasi" className="m-0 p-0 list-none">
            {akar.map((u) => (
              <Simpul key={u.id} u={u} tingkat={0} anak={anak} tertutup={tertutup}
                jumlahBawahan={jumlahBawahan} onAlih={alihkan} onAtur={setDiatur} />
            ))}
          </ul>
        </div>
      )}

      {diatur && (
        <FormAtur orang={diatur} semua={aktif} garisBawah={(id) => kumpulkanBawahan(id, anak)}
          onTutup={() => setDiatur(null)}
          onTersimpan={(pesan) => { toast('sukses', pesan); setDiatur(null); void muat(); }} />
      )}
    </div>
  );
}

function Simpul({ u, tingkat, anak, tertutup, jumlahBawahan, onAlih, onAtur }: {
  u: Orang;
  tingkat: number;
  anak: Map<string, Orang[]>;
  tertutup: Set<string>;
  jumlahBawahan: (id: string) => number;
  onAlih: (id: string) => void;
  onAtur: (u: Orang) => void;
}) {
  const d = anak.get(u.id) ?? [];
  const buka = !tertutup.has(u.id);
  return (
    <li role="treeitem" aria-expanded={d.length > 0 ? buka : undefined} aria-level={tingkat + 1}
      aria-selected={false}>
      <BarisOrang u={u} tingkat={tingkat} jumlah={jumlahBawahan(u.id)}
        punyaAnak={d.length > 0} buka={buka} onAlih={() => onAlih(u.id)} onAtur={() => onAtur(u)} />
      {d.length > 0 && buka && (
        <ul role="group" className="m-0 p-0 list-none">
          {d.map((c) => (
            <Simpul key={c.id} u={c} tingkat={tingkat + 1} anak={anak} tertutup={tertutup}
              jumlahBawahan={jumlahBawahan} onAlih={onAlih} onAtur={onAtur} />
          ))}
        </ul>
      )}
    </li>
  );
}

function BarisOrang({ u, tingkat, jumlah, punyaAnak, buka, onAlih, onAtur, jalur }: {
  u: Orang; tingkat: number; jumlah: number; punyaAnak: boolean; buka: boolean;
  onAlih: () => void; onAtur: () => void; jalur?: string;
}) {
  const gaya = u.position ? GAYA_POSISI[u.position as Posisi] : undefined;
  return (
    <div className="flex items-center gap-2 rounded-kontrol px-2 py-1.5 hover:bg-slate-50 min-h-[48px]"
      style={{ paddingLeft: `${0.5 + tingkat * 1.5}rem` }}>
      {punyaAnak ? (
        <button type="button" onClick={onAlih} aria-label={buka ? `Tutup bawahan ${u.full_name}` : `Buka bawahan ${u.full_name}`}
          className="w-7 h-7 grid place-items-center rounded-kecil text-slate-500 hover:bg-slate-100 flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
            style={{ transform: buka ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <span className="w-7 flex-shrink-0" aria-hidden="true" />
      )}
      <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 grid place-items-center text-[11px] font-black flex-shrink-0"
        aria-hidden="true">
        {u.full_name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-bold text-slate-800 truncate">{u.full_name}</span>
          {gaya
            ? <Lencana label={u.position!} {...gaya} />
            : <Lencana label="Posisi belum diisi" color="#b45309" bg="#fef3c7" />}
          <span className="text-[11px] text-slate-400">{LABEL_PERAN[u.role as Peran] ?? u.role}</span>
        </span>
        <span className="block text-[11px] text-slate-500 truncate">
          {jalur ?? (jumlah > 0 ? `${jumlah} bawahan` : `@${u.username}`)}
        </span>
      </span>
      <Tombol rupa="kedua" type="button" onClick={onAtur} className="text-[12px] py-1.5 px-3 flex-shrink-0">
        Atur
      </Tombol>
    </div>
  );
}

function Ringkas({ label, nilai, ket, peringatan }: {
  label: string; nilai: number; ket: string; peringatan?: boolean;
}) {
  return (
    <div className={`rounded-kartu border p-3 ${peringatan ? 'border-[#f59e0b]/40 bg-[#fffbeb]' : 'border-slate-200 bg-white'}`}>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-black tabular-nums ${peringatan ? 'text-[#b45309]' : 'text-slate-900'}`}>{nilai}</p>
      <p className="text-[11px] text-slate-500">{ket}</p>
    </div>
  );
}

function FormAtur({ orang, semua, garisBawah, onTutup, onTersimpan }: {
  orang: Orang;
  semua: Orang[];
  garisBawah: (id: string) => Set<string>;
  onTutup: () => void;
  onTersimpan: (pesan: string) => void;
}) {
  const [posisi, setPosisi] = useState(orang.position ?? '');
  const [atasan, setAtasan] = useState(orang.manager_id ?? '');
  const [galat, setGalat] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  // Calon atasan: aktif, berposisi lebih tinggi, dan bukan bawahannya sendiri
  // (yang terakhir mustahil bila jenjang dipatuhi, tapi dijaga juga di sini).
  const bawahan = garisBawah(orang.id);
  const opsi = semua
    .filter((u) => u.id !== orang.id && !bawahan.has(u.id)
      && peringkatPosisi(u.position) > peringkatPosisi(posisi))
    .sort((a, b) => peringkatPosisi(a.position) - peringkatPosisi(b.position)
      || a.full_name.localeCompare(b.full_name, 'id'))
    .map((u) => ({ value: u.id, label: `${u.full_name} — ${u.position}` }));
  const atasanSah = !atasan || opsi.some((o) => o.value === atasan);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);
    if (!posisi) { setGalat('Pilih posisi lebih dulu.'); return; }
    setMemproses(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: orang.id, position: posisi, manager_id: atasanSah ? atasan || null : null }),
      });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Gagal menyimpan.'); return; }
      onTersimpan(`Struktur ${orang.full_name} diperbarui.`);
    } catch {
      setGalat('Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.');
    } finally {
      setMemproses(false);
    }
  }

  return (
    <Modal buka onTutup={onTutup} lebar="kecil"
      judul={`Atur ${orang.full_name}`}
      keterangan={`@${orang.username} · ${LABEL_PERAN[orang.role as Peran] ?? orang.role}`}
      kaki={
        <>
          <Tombol rupa="kedua" type="button" onClick={onTutup} disabled={memproses}>Batal</Tombol>
          <Tombol type="submit" form="form-struktur" memuat={memproses}>
            {memproses ? 'Menyimpan…' : 'Simpan'}
          </Tombol>
        </>
      }
    >
      <form id="form-struktur" onSubmit={simpan} className="flex flex-col gap-4">
        {galat && <PanelGalat pesan={galat} />}

        <Kolom label="Posisi" wajib>
          {(id) => (
            <PilihCari id={id} nilai={posisi} onUbah={setPosisi} disabled={memproses}
              bolehKosong labelKosong="— pilih posisi —"
              opsi={DAFTAR_POSISI.map((p) => ({ value: p, label: p }))} />
          )}
        </Kolom>

        <Kolom label="Atasan"
          bantuan={!posisi
            ? 'Pilih posisi dulu — atasan harus berposisi lebih tinggi.'
            : posisi === 'Direktur'
              ? 'Direktur adalah puncak pohon dan biasanya tanpa atasan.'
              : !atasanSah
                ? 'Atasan sebelumnya tidak lagi lebih tinggi dari posisi ini dan akan dilepas.'
                : 'Hanya akun aktif berposisi lebih tinggi yang bisa dipilih.'}>
          {(id) => (
            <PilihCari id={id} nilai={atasanSah ? atasan : ''} onUbah={setAtasan}
              disabled={memproses || !posisi}
              bolehKosong labelKosong="— tanpa atasan —" opsi={opsi} />
          )}
        </Kolom>
      </form>
    </Modal>
  );
}

function kumpulkanBawahan(id: string, anak: Map<string, Orang[]>): Set<string> {
  const hasil = new Set<string>();
  const antre = [...(anak.get(id) ?? [])];
  while (antre.length) {
    const u = antre.shift()!;
    if (hasil.has(u.id)) continue;
    hasil.add(u.id);
    antre.push(...(anak.get(u.id) ?? []));
  }
  return hasil;
}

function urutOrang(a: Orang, b: Orang): number {
  return peringkatPosisi(b.position) - peringkatPosisi(a.position)
    || a.full_name.localeCompare(b.full_name, 'id');
}
