'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { usePengaturan } from '@/lib/use-settings';
import { ambilLokasi, GpsError } from '@/lib/gps';
import { Modal, Konfirmasi } from '@/components/shared/Modal';
import { Kolom, Teks, Tombol, Lencana } from '@/components/shared/FormParts';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';

// Leaflet menyentuh `window` saat modulnya dimuat, jadi ia tidak boleh ikut
// dirender di server — `ssr:false` membuat Next.js hanya memuatnya di
// browser, sesudah hidrasi.
const PetaLokasi = dynamic(
  () => import('@/components/shared/PetaLokasi').then((m) => m.PetaLokasi),
  { ssr: false, loading: () => <div className="w-full h-72 rounded-kontrol bg-slate-100 animate-pulse" /> },
);

interface Lokasi {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  gps_radius_m: number;
  active: boolean;
}

/**
 * Kelola lokasi meeting.
 *
 * Koordinat dan radius di sini adalah pembanding yang dipakai sm_check_in()
 * untuk memutuskan sah-tidaknya kehadiran. Karena itu policy `lok_kelola`
 * (migrasi 005) hanya memberi akses tulis kepada Manager/Admin: kalau Sales
 * bisa melebarkan radiusnya sendiri jadi 5 km, seluruh verifikasi lokasi
 * kehilangan arti.
 */
export function TabLokasi() {
  const toast = useToast();
  const [daftar, setDaftar] = useState<Lokasi[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [cari, setCari] = useState('');

  const [formBuka, setFormBuka] = useState(false);
  const [sunting, setSunting] = useState<Lokasi | null>(null);
  const [akanUbahAktif, setAkanUbahAktif] = useState<Lokasi | null>(null);
  const [memproses, setMemproses] = useState(false);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    const { data, error } = await supabase
      .from('sm_locations')
      .select('id, name, address, latitude, longitude, gps_radius_m, active')
      .order('name');
    if (error) setGalat(error.message);
    else setDaftar((data ?? []) as Lokasi[]);
    setMemuat(false);
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  const tersaring = useMemo(() => {
    const k = cari.trim().toLowerCase();
    if (!k) return daftar;
    return daftar.filter((l) =>
      l.name.toLowerCase().includes(k) || (l.address ?? '').toLowerCase().includes(k));
  }, [daftar, cari]);

  async function ubahAktif() {
    if (!akanUbahAktif) return;
    setMemproses(true);
    const { error } = await supabase.from('sm_locations')
      .update({ active: !akanUbahAktif.active }).eq('id', akanUbahAktif.id);
    setMemproses(false);
    if (error) { toast('galat', error.message); return; }
    toast('sukses', akanUbahAktif.active ? 'Lokasi dinonaktifkan.' : 'Lokasi diaktifkan.');
    setAkanUbahAktif(null);
    void muat();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label htmlFor="l-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="l-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Nama lokasi atau alamat…" />
        </div>
        <Tombol onClick={() => { setSunting(null); setFormBuka(true); }}>+ Lokasi Baru</Tombol>
      </div>

      {galat ? (
        <PanelGalat pesan={galat} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={4} />
      ) : tersaring.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Belum ada lokasi"
            keterangan="Jadwal berkategori Meeting membutuhkan lokasi sebagai titik acuan GPS. Tambahkan minimal satu."
            aksi={<Tombol onClick={() => { setSunting(null); setFormBuka(true); }}>+ Lokasi Baru</Tombol>}
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {tersaring.map((l) => (
            <li key={l.id}
              className={`bg-white rounded-kartu border border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap
                          ${l.active ? '' : 'opacity-60'}`}>
              <span className="w-9 h-9 rounded-kontrol bg-aksen-50 text-aksen-700 grid place-items-center flex-shrink-0">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11z M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
                    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>

              <div className="flex-1 min-w-[170px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-slate-900">{l.name}</p>
                  <Lencana label={`radius ${l.gps_radius_m} m`} color="#1d4ed8" bg="#dbeafe" />
                  {!l.active && <Lencana label="Nonaktif" color="#e34948" bg="#fce3e3" />}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {l.address || 'Tanpa alamat'}
                  <span className="text-slate-400 tabular-nums"> · {Number(l.latitude).toFixed(5)}, {Number(l.longitude).toFixed(5)}</span>
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <Tombol rupa="kedua" className="text-[12px] py-2"
                  onClick={() => { setSunting(l); setFormBuka(true); }}>Sunting</Tombol>
                <Tombol rupa="hantu"
                  className={`text-[12px] py-2 ${l.active ? 'text-[#e34948]' : 'text-[#008300]'}`}
                  onClick={() => setAkanUbahAktif(l)}>
                  {l.active ? 'Nonaktifkan' : 'Aktifkan'}
                </Tombol>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formBuka && (
        <FormLokasi buka={formBuka} onTutup={() => setFormBuka(false)}
          onTersimpan={muat} awal={sunting} />
      )}

      <Konfirmasi
        buka={Boolean(akanUbahAktif)}
        onTutup={() => setAkanUbahAktif(null)}
        onSetuju={ubahAktif}
        memproses={memproses}
        bahaya={akanUbahAktif?.active}
        judul={akanUbahAktif?.active ? 'Nonaktifkan lokasi ini?' : 'Aktifkan lokasi ini?'}
        pesan={akanUbahAktif?.active
          ? `${akanUbahAktif?.name} tidak lagi bisa dipilih pada jadwal baru. Jadwal yang sudah memakainya tidak terpengaruh.`
          : `${akanUbahAktif?.name} bisa dipilih kembali pada jadwal baru.`}
        labelSetuju={akanUbahAktif?.active ? 'Nonaktifkan' : 'Aktifkan'}
      />
    </div>
  );
}

function FormLokasi({
  buka, onTutup, onTersimpan, awal,
}: {
  buka: boolean; onTutup: () => void; onTersimpan: () => void; awal: Lokasi | null;
}) {
  const toast = useToast();
  const { pengaturan } = usePengaturan();

  const [nama, setNama] = useState(awal?.name ?? '');
  const [alamat, setAlamat] = useState(awal?.address ?? '');
  const [lat, setLat] = useState(awal ? String(awal.latitude) : '');
  const [lng, setLng] = useState(awal ? String(awal.longitude) : '');
  const [radius, setRadius] = useState(awal?.gps_radius_m ?? pengaturan.default_gps_radius_m);
  const [galat, setGalat] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);
  const [ambilBerjalan, setAmbilBerjalan] = useState(false);

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const koordinatSah = lat !== '' && lng !== ''
    && Number.isFinite(latNum) && Number.isFinite(lngNum)
    && latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180;

  /** Ambil koordinat dari perangkat — jauh lebih akurat daripada mengetik manual. */
  async function pakaiLokasiSaya() {
    setAmbilBerjalan(true);
    setGalat(null);
    try {
      const pos = await ambilLokasi();
      setLat(pos.lat.toFixed(7));
      setLng(pos.lng.toFixed(7));
      toast('info', `Koordinat diambil dengan akurasi ±${Math.round(pos.accuracy)} m.`);
    } catch (err) {
      setGalat(err instanceof GpsError ? err.message : 'Gagal membaca lokasi.');
    } finally {
      setAmbilBerjalan(false);
    }
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);

    if (!nama.trim()) { setGalat('Nama lokasi wajib diisi.'); return; }
    if (!koordinatSah) { setGalat('Koordinat belum sah. Isi latitude dan longitude yang benar.'); return; }

    setMemproses(true);
    const isi = {
      name: nama.trim(),
      address: alamat.trim() || null,
      latitude: latNum,
      longitude: lngNum,
      gps_radius_m: radius,
    };

    const { error } = awal
      ? await supabase.from('sm_locations').update(isi).eq('id', awal.id)
      : await supabase.from('sm_locations').insert(isi);

    setMemproses(false);
    if (error) { setGalat(error.message); return; }

    toast('sukses', awal ? 'Lokasi diperbarui.' : 'Lokasi ditambahkan.');
    onTersimpan();
    onTutup();
  }

  return (
    <Modal
      buka={buka} onTutup={onTutup}
      judul={awal ? 'Sunting Lokasi' : 'Lokasi Baru'}
      keterangan="Koordinat dan radius inilah yang dipakai memverifikasi kehadiran."
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" type="button" onClick={onTutup} disabled={memproses}>Batal</Tombol>
          <Tombol type="submit" form="form-lokasi" memuat={memproses}>
            {memproses ? 'Menyimpan…' : 'Simpan'}
          </Tombol>
        </>
      }
    >
      <form id="form-lokasi" onSubmit={simpan} className="flex flex-col gap-4">
        {galat && <PanelGalat pesan={galat} />}

        <Kolom label="Nama Lokasi" wajib>
          {(id) => <Teks id={id} value={nama} onChange={(e) => setNama(e.target.value)}
            required disabled={memproses} placeholder="mis. Kantor Pusat PT Contoh" />}
        </Kolom>

        <Kolom label="Alamat">
          {(id) => <Teks id={id} value={alamat} onChange={(e) => setAlamat(e.target.value)}
            disabled={memproses} placeholder="Alamat lengkap" />}
        </Kolom>

        <div className="grid grid-cols-1 formulir:grid-cols-3 gap-4">
          <Kolom label="Latitude" wajib>
            {(id) => <Teks id={id} value={lat} onChange={(e) => setLat(e.target.value)}
              inputMode="decimal" disabled={memproses} placeholder="-6.1753924"
              className="tabular-nums" />}
          </Kolom>
          <Kolom label="Longitude" wajib>
            {(id) => <Teks id={id} value={lng} onChange={(e) => setLng(e.target.value)}
              inputMode="decimal" disabled={memproses} placeholder="106.8271528"
              className="tabular-nums" />}
          </Kolom>
          <Kolom label="Radius (meter)" wajib
            bantuan="Sejauh mana dari titik ini kehadiran masih dianggap sah.">
            {(id) => <Teks id={id} type="number" min={10} max={5000} value={radius}
              onChange={(e) => setRadius(Number(e.target.value) || 0)}
              disabled={memproses} className="text-right tabular-nums" />}
          </Kolom>
        </div>

        <div>
          <Tombol rupa="kedua" type="button" onClick={pakaiLokasiSaya}
            memuat={ambilBerjalan} disabled={memproses}>
            {ambilBerjalan ? 'Membaca GPS…' : '📍 Pakai lokasi saya sekarang'}
          </Tombol>
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            Paling akurat bila ditekan saat Anda benar-benar berdiri di lokasi tersebut.
          </p>
        </div>

        <div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            Cari &amp; Tunjuk di Peta
          </p>
          <PetaLokasi
            lat={koordinatSah ? latNum : null}
            lng={koordinatSah ? lngNum : null}
            radiusM={radius}
            onUbahTitik={(latBaru, lngBaru) => {
              setLat(String(latBaru));
              setLng(String(lngBaru));
              setGalat(null);
            }}
          />
        </div>
      </form>
    </Modal>
  );
}
