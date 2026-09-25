'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { usePengaturan } from '@/lib/use-settings';
import { STATUS_PROYEK, type ProyekRingkasan, type StatusProyek } from '@/lib/proyek';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, AreaTeks, Tombol, Uang, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { PilihCustomer } from '@/components/shared/PilihCustomer';
import { useToast } from '@/components/shared/Feedback';

// ssr:false — lihat catatan yang sama di admin/_components/TabLokasi.tsx.
const PetaLokasi = dynamic(
  () => import('@/components/shared/PetaLokasi').then((m) => m.PetaLokasi),
  { ssr: false, loading: () => <div className="w-full h-56 rounded-kontrol bg-slate-100 animate-pulse" /> },
);

interface LokasiProyek {
  id: string;
  name: string;
  address: string | null;
  approval_status: string;
  rejection_reason: string | null;
}

const GAYA_LOKASI: Record<string, { label: string; color: string; bg: string }> = {
  MENUNGGU:  { label: 'Menunggu persetujuan admin', color: '#eda100', bg: '#fef3d9' },
  DISETUJUI: { label: 'Disetujui — siap dipakai check-in', color: '#008300', bg: '#e0f2e0' },
  DITOLAK:   { label: 'Ditolak', color: '#e34948', bg: '#fce3e3' },
};

/** Formulir proyek. Sengaja pendek: proyek adalah wadah, dan isinya datang
 *  dari modul lain yang menautkan diri kepadanya. */
export function FormProyek({ buka, onTutup, onTersimpan, awal }: {
  buka: boolean;
  onTutup: () => void;
  onTersimpan: () => void;
  awal: ProyekRingkasan | null;
}) {
  const { pengguna } = usePenggunaAktif();
  const { pengaturan } = usePengaturan();
  const toast = useToast();

  const [nama, setNama] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [status, setStatus] = useState<StatusProyek>('AKTIF');
  const [target, setTarget] = useState(0);
  const [mulai, setMulai] = useState('');
  const [selesai, setSelesai] = useState('');
  const [keterangan, setKeterangan] = useState('');

  const [lokasiExisting, setLokasiExisting] = useState<LokasiProyek | null>(null);
  const [alamatBaru, setAlamatBaru] = useState('');
  const [latBaru, setLatBaru] = useState<number | null>(null);
  const [lngBaru, setLngBaru] = useState<number | null>(null);

  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    if (!buka) return;
    if (awal) {
      setNama(awal.name);
      setCustomerId(awal.customer_id);
      setCustomerName(awal.customer_name);
      setStatus((awal.status as StatusProyek) ?? 'AKTIF');
      setTarget(Number(awal.target_value));
      setMulai(awal.start_date ?? '');
      setSelesai(awal.end_date ?? '');
      setKeterangan(awal.description ?? '');

      setLokasiExisting(null);
      void supabase.from('sm_locations')
        .select('id, name, address, approval_status, rejection_reason')
        .eq('project_id', awal.id).maybeSingle()
        .then(({ data }: { data: LokasiProyek | null }) => setLokasiExisting(data));
    } else {
      setNama(''); setCustomerId(null); setCustomerName('');
      setStatus('AKTIF'); setTarget(0); setMulai(''); setSelesai(''); setKeterangan('');
      setLokasiExisting(null);
    }
    setAlamatBaru(''); setLatBaru(null); setLngBaru(null);
    setGalat(null);
  }, [buka, awal]);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    if (!pengguna) return;
    setGalat(null);

    if (!nama.trim() || !customerName.trim()) {
      setGalat('Nama proyek dan customer wajib diisi.');
      return;
    }
    if (mulai && selesai && selesai < mulai) {
      setGalat('Tanggal selesai tidak boleh mendahului tanggal mulai.');
      return;
    }

    setMenyimpan(true);
    const isian = {
      name: nama.trim(),
      customer_id: customerId,
      customer_name: customerName.trim(),
      status,
      target_value: target,
      start_date: mulai || null,
      end_date: selesai || null,
      description: keterangan.trim() || null,
    };

    const { data: proyekBaru, error } = awal
      ? await supabase.from('sm_projects').update(isian).eq('id', awal.id).select('id').single()
      : await supabase.from('sm_projects').insert({ ...isian, owner_user_id: pengguna.id }).select('id').single();

    if (error) {
      setMenyimpan(false);
      setGalat(error.message);
      return;
    }

    // Lokasi baru dikirim lewat route terpisah (bukan langsung ke tabel)
    // karena radius GPS-nya harus dipaksa dari server — lihat app/api/lokasi.
    if (latBaru != null && lngBaru != null && !lokasiExisting) {
      const resLokasi = await fetch('/api/lokasi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: `${nama.trim()} — ${customerName.trim()}`,
          address: alamatBaru.trim() || null,
          latitude: latBaru,
          longitude: lngBaru,
          project_id: proyekBaru!.id,
        }),
      });
      if (!resLokasi.ok) {
        const dataLokasi = await resLokasi.json().catch(() => ({}));
        setMenyimpan(false);
        toast('galat', `Proyek tersimpan, tapi lokasi gagal: ${dataLokasi?.error ?? 'kesalahan tidak diketahui'}.`);
        onTersimpan();
        onTutup();
        return;
      }
    }

    setMenyimpan(false);
    toast('sukses', awal ? 'Proyek diperbarui.' : 'Proyek dibuat.');
    onTersimpan();
    onTutup();
  }

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={awal ? `Sunting ${awal.kode}` : 'Proyek Baru'}
      keterangan="Proyek adalah wadah. Pipeline, jadwal, meeting, laporan, dan GP menautkan diri kepadanya dari modulnya masing-masing."
      kaki={
        <>
          <Tombol rupa="kedua" onClick={onTutup} className="text-[12px] py-2">Batal</Tombol>
          <Tombol type="submit" form="form-proyek" memuat={menyimpan} className="text-[12px] py-2">
            {awal ? 'Simpan Perubahan' : 'Buat Proyek'}
          </Tombol>
        </>
      }
    >
      <form id="form-proyek" onSubmit={simpan} className="flex flex-col gap-3.5">
        {galat && (
          <p role="alert" className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-3 py-2">
            {galat}
          </p>
        )}

        <Kolom label="Nama Proyek" wajib>
          {(id) => (
            <Teks id={id} value={nama} required onChange={(e) => setNama(e.target.value)}
              placeholder="mis. Camera Balaikota DKI" />
          )}
        </Kolom>

        <Kolom label="Customer" wajib>
          {(id, invalid) => (
            <PilihCustomer
              id={id} invalid={invalid}
              nilai={{ customer_id: customerId, customer_name: customerName }}
              onUbah={(v) => { setCustomerId(v.customer_id); setCustomerName(v.customer_name); }}
            />
          )}
        </Kolom>

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3.5">
          <Kolom label="Status">
            {(id) => (
              <PilihCari id={id} nilai={status} onUbah={(v) => setStatus(v as StatusProyek)}
                opsi={(Object.keys(STATUS_PROYEK) as StatusProyek[]).map((k) => ({
                  value: k, label: STATUS_PROYEK[k].label,
                }))} />
            )}
          </Kolom>

          <Kolom label="Target Nilai Proyek"
            bantuan="Perkiraan. Angka sesungguhnya dihitung dari pipeline & GP yang tertaut.">
            {(id, invalid) => <Uang id={id} nilai={target} invalid={invalid} onUbah={setTarget} />}
          </Kolom>

          <Kolom label="Mulai">
            {(id) => (
              <Teks id={id} type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} />
            )}
          </Kolom>

          <Kolom label="Perkiraan Selesai">
            {(id) => (
              <Teks id={id} type="date" value={selesai} onChange={(e) => setSelesai(e.target.value)} />
            )}
          </Kolom>
        </div>

        <Kolom label="Keterangan">
          {(id) => (
            <AreaTeks id={id} rows={3} value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Ruang lingkup, catatan penting, atau hal yang perlu diketahui tim." />
          )}
        </Kolom>

        <div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
            Lokasi Proyek <span className="font-normal normal-case text-slate-400">(opsional)</span>
          </p>

          {lokasiExisting ? (
            <div className="rounded-kontrol border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[13px] font-bold text-slate-800">{lokasiExisting.name}</p>
                <Lencana {...(GAYA_LOKASI[lokasiExisting.approval_status] ?? GAYA_LOKASI.MENUNGGU)} />
              </div>
              {lokasiExisting.address && (
                <p className="text-[11px] text-slate-500 mt-0.5">{lokasiExisting.address}</p>
              )}
              {lokasiExisting.approval_status === 'DITOLAK' && lokasiExisting.rejection_reason && (
                <p className="text-[11px] text-[#8f2c2b] mt-1">{lokasiExisting.rejection_reason}</p>
              )}
              <p className="text-[11px] text-slate-400 mt-1.5">
                Lokasi hanya bisa ditentukan sekali dari sini. Hubungi admin di menu Lokasi Meeting untuk mengubahnya.
              </p>
            </div>
          ) : (
            <>
              <Kolom label="Alamat">
                {(id) => (
                  <Teks id={id} value={alamatBaru} onChange={(e) => setAlamatBaru(e.target.value)}
                    placeholder="Alamat lengkap customer" />
                )}
              </Kolom>
              <div className="mt-2">
                <PetaLokasi
                  lat={latBaru} lng={lngBaru}
                  radiusM={pengaturan.default_gps_radius_m}
                  onUbahTitik={(lat, lng) => { setLatBaru(lat); setLngBaru(lng); }}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                Radius kehadiran memakai nilai bawaan sistem ({pengaturan.default_gps_radius_m} m) dan lokasi ini
                perlu disetujui admin sebelum bisa dipakai untuk check-in Meeting.
              </p>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
