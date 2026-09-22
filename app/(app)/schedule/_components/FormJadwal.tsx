'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { tanggalISO } from '@/lib/format';
import { usePengaturan } from '@/lib/use-settings';
import { Modal } from '@/components/shared/Modal';
import { Kolom, Teks, AreaTeks, Tombol } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { PilihCustomer, pastikanCustomer } from '@/components/shared/PilihCustomer';
import { PilihProyek } from '@/components/shared/PilihProyek';
import { PanelGalat, useToast } from '@/components/shared/Feedback';

export interface Jadwal {
  id: string;
  schedule_date: string;
  schedule_time: string | null;
  customer_id: string | null;
  customer_name: string;
  project: string | null;
  /** Tautan ke sm_projects. Nullable dengan sengaja (migrasi 018). */
  project_id: string | null;
  category: string;
  detail: string | null;
  requires_attendance: boolean;
  assigned_to: string | null;
  location_id: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  completed_at: string | null;
}

export interface Lokasi {
  id: string; name: string; address: string | null; gps_radius_m: number;
}

interface Sales { id: string; full_name: string }

type Draf = {
  schedule_date: string;
  schedule_time: string;
  customer_id: string | null;
  customer_name: string;
  project: string;
  project_id: string | null;
  category: string;
  detail: string;
  assigned_to: string;
  location_id: string;
  notes: string;
};

/**
 * Formulir Request Schedule (§23, §24, §76).
 *
 * Dua peran memakai formulir yang sama tapi haknya berbeda, dan pembedaannya
 * ditegakkan database — bukan hanya disembunyikan di sini. Policy `sch_ajukan`
 * (migrasi 005) mengharuskan Sales menyimpan dengan `assigned_to` kosong dan
 * status UPCOMING; penugasan adalah wewenang Manager/Admin. Kolom "Tugaskan
 * ke" di bawah disembunyikan dari Sales karena mengisinya toh akan ditolak,
 * bukan karena penyembunyian itu yang mengamankannya.
 */
export function FormJadwal({
  buka, onTutup, onTersimpan, awal, userId, pengawas,
}: {
  buka: boolean;
  onTutup: () => void;
  onTersimpan: () => void;
  awal: Jadwal | null;
  userId: string;
  pengawas: boolean;
}) {
  const toast = useToast();
  const { pengaturan } = usePengaturan();

  const [daftarSales, setDaftarSales] = useState<Sales[]>([]);
  const [daftarLokasi, setDaftarLokasi] = useState<Lokasi[]>([]);

  const [draf, setDraf] = useState<Draf>(() =>
    awal
      ? {
          schedule_date: awal.schedule_date,
          schedule_time: awal.schedule_time?.slice(0, 5) ?? '',
          customer_id: awal.customer_id,
          customer_name: awal.customer_name,
          project: awal.project ?? '',
          project_id: awal.project_id ?? null,
          category: awal.category,
          detail: awal.detail ?? '',
          assigned_to: awal.assigned_to ?? '',
          location_id: awal.location_id ?? '',
          notes: awal.notes ?? '',
        }
      : {
          schedule_date: tanggalISO(),
          schedule_time: '',
          customer_id: null,
          customer_name: '',
          project: '',
          project_id: null,
          category: '',
          detail: '',
          assigned_to: '',
          location_id: '',
          notes: '',
        },
  );

  const [galat, setGalat] = useState<string | null>(null);
  const [galatKolom, setGalatKolom] = useState<Record<string, string>>({});
  const [menyimpan, setMenyimpan] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: sales }, { data: lokasi }] = await Promise.all([
        supabase.from('users').select('id, full_name').eq('role', 'SALES').eq('active', true).order('full_name'),
        supabase.from('sm_locations').select('id, name, address, gps_radius_m').eq('active', true).order('name'),
      ]);
      setDaftarSales((sales ?? []) as Sales[]);
      setDaftarLokasi((lokasi ?? []) as Lokasi[]);
    })();
  }, []);

  /**
   * Apakah kategori yang dipilih menuntut check-in GPS + foto.
   *
   * Nilainya diambil dari sm_settings, bukan dari perbandingan nama kategori.
   * Lihat catatan di migrasi 003: kategori bisa diganti namanya admin, dan
   * penjaga yang mencocokkan string akan diam-diam mematikan seluruh syarat
   * bukti begitu namanya berubah.
   */
  const butuhKehadiran = useMemo(
    () => pengaturan.schedule_categories.find((k) => k.name === draf.category)?.requires_attendance ?? false,
    [pengaturan.schedule_categories, draf.category],
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
    if (!draf.schedule_date) g.schedule_date = 'Tanggal wajib diisi.';
    if (!draf.customer_name.trim()) g.customer_name = 'Customer wajib diisi.';
    if (!draf.category) g.category = 'Kategori wajib dipilih.';
    // Constraint sm_schedules_meeting_butuh_lokasi akan menolaknya juga, tapi
    // memberi tahu di sini jauh lebih cepat dan pesannya bisa menjelaskan
    // KENAPA — tanpa titik acuan, verifikasi GPS tidak punya pembanding.
    if (butuhKehadiran && !draf.location_id) {
      g.location_id = 'Kategori ini mewajibkan lokasi — GPS butuh titik acuan untuk dibandingkan.';
    }
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
        schedule_date: draf.schedule_date,
        schedule_time: draf.schedule_time || null,
        customer_id: customerId,
        customer_name: draf.customer_name.trim(),
        project: draf.project.trim() || null,
        project_id: draf.project_id,
        category: draf.category,
        detail: draf.detail.trim() || null,
        requires_attendance: butuhKehadiran,
        location_id: draf.location_id || null,
        notes: draf.notes.trim() || null,
        // Sales tidak boleh menugaskan — dan tidak boleh menugaskan ke dirinya
        // sendiri. Nilainya dipaksa null di sini agar cocok dengan policy;
        // kalau dikirim terisi, PostgREST menolak seluruh baris.
        assigned_to: pengawas ? (draf.assigned_to || null) : null,
        ...(awal ? {} : { created_by: userId, status: 'UPCOMING' }),
      };

      const { error } = awal
        ? await supabase.from('sm_schedules').update(isi).eq('id', awal.id)
        : await supabase.from('sm_schedules').insert(isi);

      if (error) {
        // 42501 = RLS menolak. Untuk Sales yang mencoba menugaskan, pesan
        // Postgres mentah tidak menjelaskan apa pun.
        if (error.code === '42501') {
          setGalat('Anda tidak berhak menyimpan perubahan ini. Pengajuan jadwal akan ditugaskan oleh Manager atau Admin.');
        } else {
          setGalat(error.message);
        }
        return;
      }

      toast('sukses', awal ? 'Jadwal diperbarui.' : pengawas ? 'Jadwal dibuat.' : 'Pengajuan jadwal terkirim.');
      onTersimpan();
      onTutup();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan jadwal.');
    } finally {
      setMenyimpan(false);
    }
  }

  return (
    <Modal
      buka={buka} onTutup={onTutup}
      judul={awal ? 'Sunting Jadwal' : pengawas ? 'Jadwal Baru' : 'Ajukan Jadwal'}
      keterangan={pengawas
        ? 'Tentukan kategori, lokasi, dan Sales yang ditugaskan.'
        : 'Pengajuan Anda akan ditugaskan oleh Manager atau Admin.'}
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" type="button" onClick={onTutup} disabled={menyimpan}>Batal</Tombol>
          <Tombol type="submit" form="form-jadwal" memuat={menyimpan}>
            {menyimpan ? 'Menyimpan…' : 'Simpan'}
          </Tombol>
        </>
      }
    >
      <form id="form-jadwal" onSubmit={simpan} className="flex flex-col gap-4">
        {galat && <PanelGalat pesan={galat} />}

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4">
          <Kolom label="Tanggal" wajib galat={galatKolom.schedule_date}>
            {(id, invalid) => (
              <Teks id={id} type="date" value={draf.schedule_date} aria-invalid={invalid}
                onChange={(e) => ubah('schedule_date', e.target.value)} />
            )}
          </Kolom>

          <Kolom label="Jam" bantuan="Kosongkan bila belum pasti.">
            {(id) => (
              <Teks id={id} type="time" value={draf.schedule_time}
                onChange={(e) => ubah('schedule_time', e.target.value)} />
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

          {/* Dua isian proyek yang berbeda, dan keduanya perlu.
              "Tautkan ke Proyek" menyambungkan jadwal ini ke ringkasan proyek;
              "Nama proyek" tetap ada sebagai catatan bebas untuk pembicaraan
              yang belum punya proyek terdaftar — persis kasus yang paling
              sering terjadi saat jadwal dibuat mendahului pipelinenya. */}
          <Kolom label="Tautkan ke Proyek"
            bantuan="Membuat jadwal ini muncul di ringkasan proyek. Boleh dikosongkan.">
            {(id) => (
              <PilihProyek
                id={id}
                nilai={draf.project_id}
                ownerId={userId}
                customerId={draf.customer_id}
                customerName={draf.customer_name}
                onUbah={(proyekId, proyek) => {
                  setDraf((d) => ({
                    ...d,
                    project_id: proyekId,
                    // Nama proyek ikut terisi saat tautannya dipilih, supaya
                    // tidak perlu mengetik hal yang sama dua kali.
                    project: proyek?.name ?? d.project,
                  }));
                }}
              />
            )}
          </Kolom>

          <Kolom label="Nama Proyek (catatan bebas)">
            {(id) => (
              <Teks id={id} value={draf.project} onChange={(e) => ubah('project', e.target.value)}
                placeholder="Nama proyek yang dibahas" />
            )}
          </Kolom>

          <Kolom label="Kategori" wajib galat={galatKolom.category}>
            {(id, invalid) => (
              <PilihCari
                id={id} invalid={invalid} nilai={draf.category}
                onUbah={(v) => ubah('category', v)}
                placeholder="— pilih kategori —"
                opsi={pengaturan.schedule_categories.map((k) => ({
                  value: k.name,
                  label: k.name,
                  keterangan: k.requires_attendance
                    ? 'Wajib check-in GPS + foto bukti'
                    : 'Tanpa syarat bukti lokasi',
                }))}
              />
            )}
          </Kolom>

          {pengawas && (
            <Kolom label="Tugaskan ke"
              bantuan="Hanya Sales yang ditugaskan yang bisa mengeksekusi meeting ini.">
              {(id) => (
                <PilihCari
                  id={id} nilai={draf.assigned_to}
                  onUbah={(v) => ubah('assigned_to', v)}
                  bolehKosong labelKosong="Belum ditugaskan"
                  opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))}
                />
              )}
            </Kolom>
          )}
        </div>

        {butuhKehadiran && (
          <div className="rounded-kartu bg-aksen-50 border border-aksen-200/60 px-4 py-3">
            <p className="text-[12px] font-bold text-aksen-800 mb-2">
              Kategori ini mewajibkan bukti kehadiran
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed mb-3">
              Sales yang ditugaskan harus check-in di lokasi dengan GPS di dalam radius,
              lalu mengunggah foto bukti. Tanpa keduanya, jadwal tidak bisa diselesaikan.
            </p>

            <Kolom label="Lokasi Meeting" wajib galat={galatKolom.location_id}>
              {(id, invalid) => (
                daftarLokasi.length === 0 ? (
                  <p className="text-[12px] text-[#c93c3b] font-medium py-2">
                    Belum ada lokasi terdaftar. Tambahkan dulu di menu Administrasi → Lokasi.
                  </p>
                ) : (
                  <PilihCari
                    id={id} invalid={invalid} nilai={draf.location_id}
                    onUbah={(v) => ubah('location_id', v)}
                    placeholder="— pilih lokasi —"
                    opsi={daftarLokasi.map((l) => ({
                      value: l.id,
                      label: l.name,
                      keterangan: `${l.address ?? 'Tanpa alamat'} · radius ${l.gps_radius_m} m`,
                    }))}
                  />
                )
              )}
            </Kolom>
          </div>
        )}

        <Kolom label="Detail">
          {(id) => (
            <AreaTeks id={id} value={draf.detail} onChange={(e) => ubah('detail', e.target.value)}
              placeholder="Agenda, hal yang perlu disiapkan, atau konteks lain" />
          )}
        </Kolom>

        <Kolom label="Catatan">
          {(id) => (
            <AreaTeks id={id} value={draf.notes} onChange={(e) => ubah('notes', e.target.value)}
              placeholder="Catatan internal" />
          )}
        </Kolom>
      </form>
    </Modal>
  );
}
