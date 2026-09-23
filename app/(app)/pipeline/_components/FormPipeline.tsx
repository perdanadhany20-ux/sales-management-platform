'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { tanggalISO, hitungGp, rupiah, persen } from '@/lib/format';
import { usePengaturan } from '@/lib/use-settings';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, AreaTeks, Uang, Tombol } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { PilihCustomer, pastikanCustomer } from '@/components/shared/PilihCustomer';
import { PilihProyek } from '@/components/shared/PilihProyek';
import { PanelGalat, useToast } from '@/components/shared/Feedback';

export interface Peluang {
  id: string;
  sales_user_id: string;
  /** Tautan ke sm_projects. Nullable dengan sengaja (migrasi 018). */
  project_id: string | null;
  pipeline_date: string;
  customer_id: string | null;
  customer_name: string;
  contact_person: string | null;
  project_detail: string;
  quantity: number;
  unit: string;
  project_value: number;
  project_hpp: number;
  /** Kolom GENERATED di database — hanya dibaca, tidak pernah dikirim. */
  project_gp: number;
  gp_percentage: number;
  probability: number;
  estimated_closing: string;
  next_action: string;
  stage: string;
}

type Draf = {
  project_id: string | null;
  pipeline_date: string;
  customer_id: string | null;
  customer_name: string;
  contact_person: string;
  project_detail: string;
  quantity: number;
  unit: string;
  project_value: number;
  project_hpp: number;
  probability: number;
  estimated_closing: string;
  next_action: string;
  stage: string;
};

function drafKosong(unitBawaan: string): Draf {
  const tigaPuluhHari = new Date();
  tigaPuluhHari.setDate(tigaPuluhHari.getDate() + 30);
  return {
    pipeline_date: tanggalISO(),
    project_id: null,
    customer_id: null,
    customer_name: '',
    contact_person: '',
    project_detail: '',
    quantity: 1,
    unit: unitBawaan,
    project_value: 0,
    project_hpp: 0,
    probability: 50,
    estimated_closing: tanggalISO(tigaPuluhHari),
    next_action: '',
    stage: 'OPEN',
  };
}

const STAGE = [
  { value: 'OPEN', label: 'Open — masih dijajaki' },
  { value: 'QUOTATION', label: 'Quotation — penawaran terkirim' },
  { value: 'WON', label: 'Won — menang' },
  { value: 'LOST', label: 'Lost — kalah' },
];

export function FormPipeline({
  buka, onTutup, onTersimpan, awal, userId,
}: {
  buka: boolean;
  onTutup: () => void;
  onTersimpan: () => void;
  awal: Peluang | null;
  userId: string;
}) {
  const toast = useToast();
  const { pengaturan } = usePengaturan();

  const [draf, setDraf] = useState<Draf>(() =>
    awal
      ? {
          pipeline_date: awal.pipeline_date,
          project_id: awal.project_id ?? null,
          customer_id: awal.customer_id,
          customer_name: awal.customer_name,
          contact_person: awal.contact_person ?? '',
          project_detail: awal.project_detail,
          quantity: Number(awal.quantity),
          unit: awal.unit,
          project_value: Number(awal.project_value),
          project_hpp: Number(awal.project_hpp),
          probability: awal.probability,
          estimated_closing: awal.estimated_closing,
          next_action: awal.next_action,
          stage: awal.stage,
        }
      : drafKosong('unit'),
  );

  const [galat, setGalat] = useState<string | null>(null);
  const [galatKolom, setGalatKolom] = useState<Record<string, string>>({});
  const [menyimpan, setMenyimpan] = useState(false);

  /**
   * Pratinjau GP saat mengetik. Ini SEMATA tampilan — yang tersimpan adalah
   * kolom GENERATED di database (§19). Kalau rumus di sini kelak meleset,
   * yang salah hanya pratinjaunya, bukan datanya.
   */
  const { gp, gpPersen } = useMemo(
    () => hitungGp(draf.project_value, draf.project_hpp),
    [draf.project_value, draf.project_hpp],
  );

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
    if (!draf.pipeline_date) g.pipeline_date = 'Tanggal wajib diisi.';
    if (!draf.customer_name.trim()) g.customer_name = 'Customer wajib diisi.';
    if (!draf.project_detail.trim()) g.project_detail = 'Detail proyek wajib diisi.';
    if (draf.project_value <= 0) g.project_value = 'Nilai proyek harus lebih dari nol.';
    if (draf.project_hpp < 0) g.project_hpp = 'HPP tidak boleh negatif.';
    if (!draf.estimated_closing) g.estimated_closing = 'Perkiraan closing wajib diisi.';
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

      // project_gp dan gp_percentage SENGAJA tidak ikut: keduanya kolom
      // GENERATED, dan mengirimnya akan ditolak Postgres.
      const isi = {
        pipeline_date: draf.pipeline_date,
        project_id: draf.project_id,
        customer_id: customerId,
        customer_name: draf.customer_name.trim(),
        contact_person: draf.contact_person.trim() || null,
        project_detail: draf.project_detail.trim(),
        quantity: draf.quantity,
        unit: draf.unit,
        project_value: draf.project_value,
        project_hpp: draf.project_hpp,
        probability: draf.probability,
        estimated_closing: draf.estimated_closing,
        next_action: draf.next_action.trim(),
        stage: draf.stage,
      };

      // sales_user_id HANYA diisi saat membuat baris baru — lihat catatan yang
      // sama di FormLaporan.tsx.
      const { error } = awal
        ? await supabase.from('sm_pipeline').update(isi).eq('id', awal.id)
        : await supabase.from('sm_pipeline').insert({ ...isi, sales_user_id: userId });

      if (error) { setGalat(error.message); return; }

      toast('sukses', awal ? 'Peluang diperbarui.' : 'Peluang tersimpan.');
      onTersimpan();
      onTutup();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan peluang.');
    } finally {
      setMenyimpan(false);
    }
  }

  const gpNegatif = gp < 0;

  return (
    <Modal
      buka={buka} onTutup={onTutup}
      judul={awal ? 'Sunting Peluang' : 'Peluang Baru'}
      keterangan="Nilai, HPP, dan perkiraan closing. GP dihitung otomatis."
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" type="button" onClick={onTutup} disabled={menyimpan}>Batal</Tombol>
          <Tombol type="submit" form="form-pipeline" memuat={menyimpan}>
            {menyimpan ? 'Menyimpan…' : 'Simpan'}
          </Tombol>
        </>
      }
    >
      <form id="form-pipeline" onSubmit={simpan} className="flex flex-col gap-4">
        {galat && <PanelGalat pesan={galat} />}

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4">
          <Kolom label="Tanggal" wajib galat={galatKolom.pipeline_date}>
            {(id, invalid) => (
              <Teks id={id} type="date" value={draf.pipeline_date} aria-invalid={invalid}
                onChange={(e) => ubah('pipeline_date', e.target.value)} max={tanggalISO()} />
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

          {/* Tautan ke Proyek. Boleh dikosongkan — lihat catatan di migrasi 018
              soal kenapa memaksa proyek dipilih lebih dulu justru membuat
              catatannya tidak jadi diisi sama sekali. */}
          <Kolom label="Proyek"
            bantuan="Menautkan peluang ini ke ringkasan proyek. Boleh dikosongkan.">
            {(id) => (
              <PilihProyek
                id={id}
                nilai={draf.project_id ?? null}
                ownerId={userId}
                customerId={draf.customer_id}
                customerName={draf.customer_name}
                onUbah={(proyekId) => setDraf((d) => ({ ...d, project_id: proyekId }))}
              />
            )}
          </Kolom>

          <Kolom label="Contact Person">
            {(id) => (
              <Teks id={id} value={draf.contact_person}
                onChange={(e) => ubah('contact_person', e.target.value)}
                placeholder="Nama narahubung" />
            )}
          </Kolom>

          <Kolom label="Tahapan">
            {(id) => (
              <PilihCari id={id} nilai={draf.stage} opsi={STAGE}
                onUbah={(v) => ubah('stage', v)} />
            )}
          </Kolom>
        </div>

        <Kolom label="Detail Proyek" wajib galat={galatKolom.project_detail}>
          {(id, invalid) => (
            <AreaTeks id={id} value={draf.project_detail} aria-invalid={invalid}
              onChange={(e) => ubah('project_detail', e.target.value)}
              placeholder="mis. Videotron indoor P2.5 untuk lobby, 12 titik" />
          )}
        </Kolom>

        <div className="grid grid-cols-2 formulir:grid-cols-4 gap-4">
          <Kolom label="Qty">
            {(id) => (
              <Teks id={id} type="number" min={0} step="any" value={draf.quantity}
                onChange={(e) => ubah('quantity', Number(e.target.value) || 0)}
                className="text-right tabular-nums" />
            )}
          </Kolom>

          <Kolom label="Satuan">
            {(id) => (
              <PilihCari id={id} nilai={draf.unit}
                onUbah={(v) => ubah('unit', v)}
                opsi={pengaturan.pipeline_units.map((u) => ({ value: u, label: u }))} />
            )}
          </Kolom>

          <Kolom label="Probability" wajib className="formulir:col-span-2">
            {(id) => (
              <PilihCari
                id={id}
                nilai={String(draf.probability)}
                onUbah={(v) => ubah('probability', Number(v))}
                opsi={pengaturan.probability_options.map((p) => ({
                  value: String(p),
                  label: `${p}%`,
                  keterangan: KETERANGAN_PROBABILITY[p],
                }))}
              />
            )}
          </Kolom>
        </div>

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4">
          <Kolom label="Nilai Proyek" wajib galat={galatKolom.project_value}>
            {(id, invalid) => (
              <Uang id={id} invalid={invalid} nilai={draf.project_value}
                onUbah={(n) => ubah('project_value', n)} />
            )}
          </Kolom>

          <Kolom label="HPP" wajib galat={galatKolom.project_hpp}
            bantuan="Harga pokok — dasar perhitungan margin.">
            {(id, invalid) => (
              <Uang id={id} invalid={invalid} nilai={draf.project_hpp}
                onUbah={(n) => ubah('project_hpp', n)} />
            )}
          </Kolom>
        </div>

        {/* Pratinjau GP — angka yang paling dilihat manajer, jadi ia tampil
            saat mengetik, bukan baru setelah disimpan. */}
        <div className={`rounded-kartu px-4 py-3 flex items-center justify-between gap-4 flex-wrap
                         ${gpNegatif ? 'bg-[#fce3e3] border border-[#e34948]/30' : 'bg-aksen-50 border border-aksen-200/60'}`}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Gross Profit</p>
            <p className={`text-xl font-black tabular-nums ${gpNegatif ? 'text-[#c93c3b]' : 'text-aksen-800'}`}>
              {rupiah(gp)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Margin</p>
            <p className={`text-xl font-black tabular-nums ${gpNegatif ? 'text-[#c93c3b]' : 'text-aksen-800'}`}>
              {persen(gpPersen, 2)}
            </p>
          </div>
          {gpNegatif && (
            <p className="w-full text-[11px] font-semibold text-[#c93c3b]">
              HPP melebihi nilai proyek — periksa lagi angkanya sebelum menyimpan.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4">
          <Kolom label="Perkiraan Closing" wajib galat={galatKolom.estimated_closing}>
            {(id, invalid) => (
              <Teks id={id} type="date" value={draf.estimated_closing} aria-invalid={invalid}
                onChange={(e) => ubah('estimated_closing', e.target.value)} />
            )}
          </Kolom>
        </div>

        <Kolom label="Next Action" wajib galat={galatKolom.next_action}
          bantuan="Langkah konkret berikutnya — inilah yang dibaca manajer (§75).">
          {(id, invalid) => (
            <AreaTeks id={id} value={draf.next_action} aria-invalid={invalid}
              onChange={(e) => ubah('next_action', e.target.value)}
              placeholder="mis. Follow up keputusan anggaran minggu depan" />
          )}
        </Kolom>
      </form>
    </Modal>
  );
}

/** Keterangan tingkat keyakinan, supaya angkanya tidak ditafsirkan berbeda-beda. */
const KETERANGAN_PROBABILITY: Record<number, string> = {
  10: 'Baru kontak awal',
  25: 'Kebutuhan teridentifikasi',
  50: 'Penawaran dibahas serius',
  75: 'Negosiasi akhir',
  90: 'Tinggal menunggu PO',
};
