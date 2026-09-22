'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { tanggalISO } from '@/lib/format';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, AreaTeks, Tombol } from '@/components/shared/FormParts';
import { PilihCustomer, pastikanCustomer } from '@/components/shared/PilihCustomer';
import { PanelGalat, useToast } from '@/components/shared/Feedback';

export interface Laporan {
  id: string;
  sales_user_id: string;
  report_date: string;
  customer_id: string | null;
  customer_name: string;
  contact_person: string | null;
  position: string | null;
  phone_whatsapp: string | null;
  activity: string;
  lead_project: string | null;
  result: string;
  next_action: string;
}

type Draf = Omit<Laporan, 'id' | 'sales_user_id'>;

function drafKosong(): Draf {
  return {
    report_date: tanggalISO(),
    customer_id: null,
    customer_name: '',
    contact_person: '',
    position: '',
    phone_whatsapp: '',
    activity: '',
    lead_project: '',
    result: '',
    next_action: '',
  };
}

/**
 * Formulir Daily Report (§12, §71).
 *
 * Kolom wajib divalidasi di sini DAN di database — yang di sini supaya
 * kesalahan ketik terlihat seketika tanpa perjalanan ke server, yang di sana
 * supaya validasinya tidak bisa dilewati dengan memanggil API langsung.
 */
export function FormLaporan({
  buka, onTutup, onTersimpan, awal, userId,
}: {
  buka: boolean;
  onTutup: () => void;
  onTersimpan: () => void;
  /** Isi untuk menyunting; null untuk membuat baru. */
  awal: Laporan | null;
  userId: string;
}) {
  const toast = useToast();
  const [draf, setDraf] = useState<Draf>(awal ?? drafKosong());
  const [galat, setGalat] = useState<string | null>(null);
  const [galatKolom, setGalatKolom] = useState<Record<string, string>>({});
  const [menyimpan, setMenyimpan] = useState(false);

  function ubah<K extends keyof Draf>(kunci: K, nilai: Draf[K]) {
    setDraf((d) => ({ ...d, [kunci]: nilai }));
    setGalatKolom((g) => {
      if (!g[kunci as string]) return g;
      const sisa = { ...g };
      delete sisa[kunci as string];
      return sisa;
    });
  }

  function periksa(): boolean {
    const g: Record<string, string> = {};
    if (!draf.report_date) g.report_date = 'Tanggal wajib diisi.';
    if (!draf.customer_name.trim()) g.customer_name = 'Customer wajib diisi.';
    if (!draf.activity.trim()) g.activity = 'Aktivitas wajib diisi.';
    if (!draf.result.trim()) g.result = 'Hasil wajib diisi.';
    if (!draf.next_action.trim()) g.next_action = 'Next action wajib diisi.';
    setGalatKolom(g);
    return Object.keys(g).length === 0;
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);
    if (!periksa()) return;

    setMenyimpan(true);
    try {
      const customerId = await pastikanCustomer(draf.customer_name, draf.customer_id);

      const isi = {
        sales_user_id: userId,
        report_date: draf.report_date,
        customer_id: customerId,
        customer_name: draf.customer_name.trim(),
        contact_person: draf.contact_person?.trim() || null,
        position: draf.position?.trim() || null,
        phone_whatsapp: draf.phone_whatsapp?.trim() || null,
        activity: draf.activity.trim(),
        lead_project: draf.lead_project?.trim() || null,
        result: draf.result.trim(),
        next_action: draf.next_action.trim(),
      };

      const { error } = awal
        ? await supabase.from('sm_daily_reports').update(isi).eq('id', awal.id)
        : await supabase.from('sm_daily_reports').insert(isi);

      if (error) {
        // 23505 = pelanggaran indeks unik. Satu-satunya yang ada di tabel ini
        // adalah "satu laporan per Sales per hari" (§14), jadi pesannya bisa
        // langsung menjelaskan apa yang terjadi alih-alih menampilkan galat
        // Postgres mentah yang tidak berarti apa-apa bagi Sales.
        if (error.code === '23505') {
          setGalat('Anda sudah membuat laporan untuk tanggal ini. Sunting laporan yang sudah ada, atau pilih tanggal lain.');
        } else {
          setGalat(error.message);
        }
        return;
      }

      toast('sukses', awal ? 'Laporan diperbarui.' : 'Laporan tersimpan.');
      onTersimpan();
      onTutup();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan laporan.');
    } finally {
      setMenyimpan(false);
    }
  }

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={awal ? 'Sunting Daily Report' : 'Daily Report Baru'}
      keterangan="Catat aktivitas, hasil, dan langkah berikutnya."
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" type="button" onClick={onTutup} disabled={menyimpan}>Batal</Tombol>
          <Tombol type="submit" form="form-laporan" memuat={menyimpan}>
            {menyimpan ? 'Menyimpan…' : 'Simpan'}
          </Tombol>
        </>
      }
    >
      <form id="form-laporan" onSubmit={simpan} className="flex flex-col gap-4">
        {galat && <PanelGalat pesan={galat} />}

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4">
          <Kolom label="Tanggal" wajib galat={galatKolom.report_date}>
            {(id, invalid) => (
              <Teks
                id={id} type="date" value={draf.report_date} aria-invalid={invalid}
                onChange={(e) => ubah('report_date', e.target.value)}
                // Laporan harian mencatat apa yang SUDAH terjadi. Tanggal masa
                // depan hampir selalu salah ketik, dan sekali tersimpan ia
                // mengacaukan angka kepatuhan hari itu.
                max={tanggalISO()}
              />
            )}
          </Kolom>

          <Kolom label="Customer" wajib galat={galatKolom.customer_name}>
            {(id, invalid) => (
              <PilihCustomer
                id={id} invalid={invalid}
                nilai={{ customer_id: draf.customer_id, customer_name: draf.customer_name }}
                onUbah={(v) => setDraf((d) => ({ ...d, ...v }))}
              />
            )}
          </Kolom>

          <Kolom label="Contact Person">
            {(id) => (
              <Teks id={id} value={draf.contact_person ?? ''}
                onChange={(e) => ubah('contact_person', e.target.value)}
                placeholder="Nama narahubung" />
            )}
          </Kolom>

          <Kolom label="Jabatan">
            {(id) => (
              <Teks id={id} value={draf.position ?? ''}
                onChange={(e) => ubah('position', e.target.value)}
                placeholder="mis. Purchasing Manager" />
            )}
          </Kolom>

          <Kolom label="Telepon / WhatsApp">
            {(id) => (
              <Teks id={id} type="tel" inputMode="tel" value={draf.phone_whatsapp ?? ''}
                onChange={(e) => ubah('phone_whatsapp', e.target.value)}
                placeholder="08xxxxxxxxxx" />
            )}
          </Kolom>

          <Kolom label="Lead Project">
            {(id) => (
              <Teks id={id} value={draf.lead_project ?? ''}
                onChange={(e) => ubah('lead_project', e.target.value)}
                placeholder="Nama proyek yang dibahas" />
            )}
          </Kolom>
        </div>

        <Kolom label="Aktivitas" wajib galat={galatKolom.activity}
          bantuan="Apa yang Anda lakukan hari ini dengan customer ini.">
          {(id, invalid) => (
            <AreaTeks id={id} value={draf.activity} aria-invalid={invalid}
              onChange={(e) => ubah('activity', e.target.value)}
              placeholder="mis. Presentasi produk dan survei lokasi di kantor pusat" />
          )}
        </Kolom>

        <Kolom label="Hasil" wajib galat={galatKolom.result}
          bantuan="Apa yang dihasilkan dari aktivitas tersebut.">
          {(id, invalid) => (
            <AreaTeks id={id} value={draf.result} aria-invalid={invalid}
              onChange={(e) => ubah('result', e.target.value)}
              placeholder="mis. Customer tertarik, meminta penawaran untuk 12 titik" />
          )}
        </Kolom>

        <Kolom label="Next Action" wajib galat={galatKolom.next_action}
          bantuan="Langkah berikutnya yang konkret — inilah yang dibaca manajer (§75).">
          {(id, invalid) => (
            <AreaTeks id={id} value={draf.next_action} aria-invalid={invalid}
              onChange={(e) => ubah('next_action', e.target.value)}
              placeholder="mis. Kirim penawaran paling lambat Jumat, lalu jadwalkan demo" />
          )}
        </Kolom>
      </form>
    </Modal>
  );
}
