'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { CustomerRingkasan } from '@/lib/customer';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, AreaTeks, Tombol } from '@/components/shared/FormParts';
import { useToast } from '@/components/shared/Feedback';
import { pesanGalat } from '@/lib/pesan-galat';

/** Formulir data master customer. Hanya nama yang wajib — sisanya boleh
 *  dilengkapi belakangan, sama seperti customer yang lahir dari laporan
 *  harian tanpa data lain selain namanya. */
export function FormCustomer({ buka, onTutup, onTersimpan, awal }: {
  buka: boolean;
  onTutup: () => void;
  onTersimpan: () => void;
  awal: CustomerRingkasan | null;
}) {
  const toast = useToast();
  const [isi, setIsi] = useState({
    name: '', segment: '', contact_person: '', contact_position: '', phone: '', email: '',
    address: '', city: '', notes: '',
  });
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    if (!buka) return;
    setGalat(null);
    setIsi({
      name: awal?.name ?? '',
      segment: awal?.segment ?? '',
      // Kontak kosong diisi dari laporan harian terakhir: datanya sudah ada,
      // tinggal dikonfirmasi — bukan diketik ulang.
      contact_person: awal?.contact_person ?? awal?.kontak_terakhir ?? '',
      contact_position: awal?.contact_position ?? awal?.jabatan_terakhir ?? '',
      phone: awal?.phone ?? awal?.telepon_terakhir ?? '',
      email: awal?.email ?? '',
      address: awal?.address ?? '',
      city: awal?.city ?? '',
      notes: awal?.notes ?? '',
    });
  }, [buka, awal]);

  const ubah = (k: keyof typeof isi) => (e: { target: { value: string } }) => setIsi((s) => ({ ...s, [k]: e.target.value }));

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    const nama = isi.name.trim();
    if (!nama) { setGalat('Nama customer wajib diisi.'); return; }
    if (isi.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(isi.email.trim())) {
      setGalat('Format email belum benar.'); return;
    }
    setMenyimpan(true);
    setGalat(null);
    const baris = Object.fromEntries(Object.entries(isi).map(([k, v]) => [k, v.trim() || null])) as Record<string, string | null>;
    baris.name = nama;
    const { error } = awal
      ? await supabase.from('sm_customers').update({ ...baris, updated_at: new Date().toISOString() }).eq('id', awal.id)
      : await supabase.from('sm_customers').insert(baris);
    setMenyimpan(false);
    if (error) {
      setGalat(error.code === '23505'
        ? 'Customer dengan nama ini sudah ada di daftar Anda.'
        : pesanGalat(error));
      return;
    }
    toast('sukses', awal ? 'Customer diperbarui.' : 'Customer ditambahkan.');
    onTersimpan();
    onTutup();
  }

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={awal ? `Sunting ${awal.name}` : 'Customer Baru'}
      keterangan="Data perusahaan dan kontak utamanya. Riwayat laporan, pipeline, dan meeting menyatu otomatis lewat nama yang sama."
      kaki={
        <>
          <Tombol rupa="kedua" onClick={onTutup} className="text-[12px] py-2">Batal</Tombol>
          <Tombol type="submit" form="form-customer" memuat={menyimpan} className="text-[12px] py-2">
            {awal ? 'Simpan Perubahan' : 'Tambah Customer'}
          </Tombol>
        </>
      }
    >
      <form id="form-customer" onSubmit={simpan} className="flex flex-col gap-3.5">
        {galat && (
          <p role="alert" className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-3 py-2">{galat}</p>
        )}

        <Kolom label="Nama Customer" wajib>
          {(id) => <Teks id={id} value={isi.name} required onChange={ubah('name')} placeholder="mis. PT Telekomindo Solusi" />}
        </Kolom>

        <Kolom label="Segmen / Industri" bantuan="Opsional — mis. Perbankan, Pemerintah, Pendidikan, Ritel.">
          {(id) => <Teks id={id} value={isi.segment} onChange={ubah('segment')} placeholder="mis. Telekomunikasi" />}
        </Kolom>

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3.5">
          <Kolom label="Kontak Utama">
            {(id) => <Teks id={id} value={isi.contact_person} onChange={ubah('contact_person')} placeholder="Nama orang yang dihubungi" />}
          </Kolom>
          <Kolom label="Jabatan">
            {(id) => <Teks id={id} value={isi.contact_position} onChange={ubah('contact_position')} placeholder="mis. Head of IT" />}
          </Kolom>
          <Kolom label="Telepon / WhatsApp">
            {(id) => <Teks id={id} type="tel" inputMode="tel" value={isi.phone} onChange={ubah('phone')} placeholder="08xx" />}
          </Kolom>
          <Kolom label="Email">
            {(id) => <Teks id={id} type="email" value={isi.email} onChange={ubah('email')} placeholder="nama@perusahaan.co.id" />}
          </Kolom>
        </div>

        <div className="grid grid-cols-1 formulir:grid-cols-3 gap-3.5">
          <div className="formulir:col-span-2">
            <Kolom label="Alamat">
              {(id) => <Teks id={id} value={isi.address} onChange={ubah('address')} placeholder="Jalan, nomor, gedung" />}
            </Kolom>
          </div>
          <Kolom label="Kota">
            {(id) => <Teks id={id} value={isi.city} onChange={ubah('city')} placeholder="mis. Jakarta Selatan" />}
          </Kolom>
        </div>

        <Kolom label="Catatan">
          {(id) => (
            <AreaTeks id={id} rows={3} value={isi.notes} onChange={ubah('notes')}
              placeholder="Kebiasaan, preferensi, atau hal penting yang perlu diketahui tim." />
          )}
        </Kolom>
      </form>
    </Modal>
  );
}
