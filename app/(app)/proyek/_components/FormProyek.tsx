'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { STATUS_PROYEK, type ProyekRingkasan, type StatusProyek } from '@/lib/proyek';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, AreaTeks, Tombol, Uang } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { PilihCustomer } from '@/components/shared/PilihCustomer';
import { useToast } from '@/components/shared/Feedback';

/** Formulir proyek. Sengaja pendek: proyek adalah wadah, dan isinya datang
 *  dari modul lain yang menautkan diri kepadanya. */
export function FormProyek({ buka, onTutup, onTersimpan, awal }: {
  buka: boolean;
  onTutup: () => void;
  onTersimpan: () => void;
  awal: ProyekRingkasan | null;
}) {
  const { pengguna } = usePenggunaAktif();
  const toast = useToast();

  const [nama, setNama] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [status, setStatus] = useState<StatusProyek>('AKTIF');
  const [target, setTarget] = useState(0);
  const [mulai, setMulai] = useState('');
  const [selesai, setSelesai] = useState('');
  const [keterangan, setKeterangan] = useState('');

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
    } else {
      setNama(''); setCustomerId(null); setCustomerName('');
      setStatus('AKTIF'); setTarget(0); setMulai(''); setSelesai(''); setKeterangan('');
    }
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

    const { error } = awal
      ? await supabase.from('sm_projects').update(isian).eq('id', awal.id)
      : await supabase.from('sm_projects').insert({ ...isian, owner_user_id: pengguna.id });

    setMenyimpan(false);

    if (error) { setGalat(error.message); return; }

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
      </form>
    </Modal>
  );
}
