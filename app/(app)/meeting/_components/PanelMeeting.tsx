'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ambilLokasi, urlPetaKecil, GpsError } from '@/lib/gps';
import { siapkanFoto } from '@/lib/image-compress';
import {
  PESAN_GPS, PESAN_PENYELESAIAN, STATE_KEHADIRAN, STATUS_JADWAL,
  type StateKehadiran, type StatusJadwal,
} from '@/lib/constants';
import { jarak, tanggalPendek, waktuPendek } from '@/lib/format';
import { Modal } from '@/components/shared/Modal';
import { Tombol, Lencana, AreaTeks, Kolom } from '@/components/shared/FormParts';
import { useToast } from '@/components/shared/Feedback';

/**
 * Panel eksekusi Meeting (§28–§39).
 *
 * Tiga langkah berurutan, dan urutannya TIDAK dijaga di sini — komponen ini
 * hanya menampilkan langkah mana yang sedang berlaku. Yang menegakkan
 * urutannya adalah database: sm_check_in() menolak lokasi di luar radius,
 * policy ev_tulis menolak foto sebelum gps_verified, dan
 * sm_complete_schedule() memeriksa ulang semuanya sebelum menutup jadwal.
 * Kalau seseorang memanggil endpoint-nya langsung tanpa membuka panel ini,
 * hasilnya sama persis.
 */

export interface Meeting {
  id: string;
  schedule_date: string;
  schedule_time: string | null;
  customer_name: string;
  project: string | null;
  category: string;
  detail: string | null;
  notes: string | null;
  status: string;
  assigned_to: string | null;
  location_id: string | null;
  completed_at: string | null;
  sm_locations: Lokasi | null;
}

export interface Lokasi {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  gps_radius_m: number;
}

interface Kehadiran {
  id: string;
  state: string;
  gps_verified: boolean;
  distance_m: number | null;
  accuracy_m: number | null;
  checkin_at: string | null;
  checkout_at: string | null;
}

interface Bukti {
  id: string;
  storage_path: string;
  thumb_path: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
}

interface GagalGps {
  status: string;
  jarak_m: number | null;
  radius_m: number | null;
}

export function PanelMeeting({
  buka, onTutup, meeting, userId, pengawas, onBerubah,
}: {
  buka: boolean;
  onTutup: () => void;
  meeting: Meeting;
  userId: string;
  pengawas: boolean;
  onBerubah: () => void;
}) {
  const toast = useToast();

  const [kehadiran, setKehadiran] = useState<Kehadiran | null>(null);
  const [bukti, setBukti] = useState<Bukti[]>([]);
  const [pratinjau, setPratinjau] = useState<Record<string, string>>({});
  const [memuat, setMemuat] = useState(true);

  const [sibuk, setSibuk] = useState<'gps' | 'foto' | 'selesai' | 'override' | null>(null);
  const [gagalGps, setGagalGps] = useState<GagalGps | null>(null);
  const [pesanGalat, setPesanGalat] = useState<string | null>(null);

  const [formOverride, setFormOverride] = useState(false);
  const [alasan, setAlasan] = useState('');

  const berkasRef = useRef<HTMLInputElement>(null);

  const muat = useCallback(async () => {
    setMemuat(true);

    const [hadir, buktiRes] = await Promise.all([
      supabase.from('sm_attendance')
        .select('id, state, gps_verified, distance_m, accuracy_m, checkin_at, checkout_at')
        .eq('schedule_id', meeting.id).maybeSingle(),
      supabase.from('sm_evidence')
        .select('id, storage_path, thumb_path, captured_at, latitude, longitude')
        .eq('schedule_id', meeting.id).order('captured_at', { ascending: true }),
    ]);

    setKehadiran((hadir.data as Kehadiran | null) ?? null);
    const daftarBukti = (buktiRes.data ?? []) as Bukti[];
    setBukti(daftarBukti);
    setMemuat(false);

    // Bucket-nya privat (migrasi 006), jadi tidak ada URL tetap yang bisa
    // dipasang di <img>. Signed URL berumur pendek dibuat saat panel dibuka
    // dan mati sendiri sesudahnya.
    if (daftarBukti.length > 0) {
      const jalur = daftarBukti.map((b) => b.thumb_path ?? b.storage_path);
      const { data: url } = await supabase.storage.from('evidence').createSignedUrls(jalur, 600);
      if (url) {
        setPratinjau(Object.fromEntries(
          url.map((u, i) => [daftarBukti[i].id, u.signedUrl ?? '']).filter(([, v]) => v),
        ));
      }
    } else {
      setPratinjau({});
    }
  }, [meeting.id]);

  useEffect(() => { if (buka) void muat(); }, [buka, muat]);

  const selesai = meeting.status === 'COMPLETED';
  const terverifikasi = Boolean(kehadiran?.gps_verified);
  const adaBukti = bukti.length > 0;
  const milikSaya = meeting.assigned_to === userId;

  /** Langkah aktif; dipakai untuk menandai mana yang sedang berjalan. */
  const langkah = selesai ? 4 : !terverifikasi ? 1 : !adaBukti ? 2 : 3;

  // ── Langkah 1 — check-in GPS ──────────────────────────────────────────────

  async function checkIn() {
    setSibuk('gps');
    setGagalGps(null);
    setPesanGalat(null);
    try {
      const lok = await ambilLokasi();
      const { data, error } = await supabase.rpc('sm_check_in', {
        p_schedule_id: meeting.id,
        p_lat: lok.lat,
        p_lng: lok.lng,
        p_accuracy: lok.accuracy,
      });
      if (error) throw new Error(error.message);

      const hasil = data as {
        validation_status: string;
        distance_m: number | null;
        allowed_radius_m: number | null;
      };

      if (hasil.validation_status !== 'VALID') {
        setGagalGps({
          status: hasil.validation_status,
          jarak_m: hasil.distance_m,
          radius_m: hasil.allowed_radius_m,
        });
        await muat();
        return;
      }

      toast('sukses', 'Lokasi terverifikasi. Lanjutkan dengan foto bukti.');
      await muat();
      onBerubah();
    } catch (e) {
      setPesanGalat(e instanceof GpsError || e instanceof Error
        ? e.message
        : 'Check-in gagal. Coba lagi.');
    } finally {
      setSibuk(null);
    }
  }

  // ── Langkah 2 — unggah foto bukti ─────────────────────────────────────────

  async function unggahFoto(file: File) {
    if (!kehadiran) return;
    setSibuk('foto');
    setPesanGalat(null);
    try {
      // Lokasi dibaca SEBELUM berkasnya diunggah supaya koordinat yang
      // menempel pada bukti adalah tempat fotonya diambil, bukan tempat
      // unggahannya selesai — di lapangan keduanya bisa berjarak ratusan
      // meter kalau sinyalnya baru pulih di perjalanan.
      const lok = await ambilLokasi().catch(() => null);
      const siap = await siapkanFoto(file);

      const dasar = `${userId}/${meeting.id}/${Date.now()}`;
      const jalurUtama = `${dasar}.jpg`;
      const jalurThumb = `${dasar}-kecil.jpg`;

      const opsi = { contentType: 'image/jpeg', upsert: false };
      const naik = await supabase.storage.from('evidence').upload(jalurUtama, siap.utama, opsi);
      if (naik.error) throw new Error(naik.error.message);

      const naikThumb = await supabase.storage.from('evidence').upload(jalurThumb, siap.thumb, opsi);

      const { error } = await supabase.from('sm_evidence').insert({
        attendance_id: kehadiran.id,
        schedule_id: meeting.id,
        user_id: userId,
        storage_path: jalurUtama,
        thumb_path: naikThumb.error ? null : jalurThumb,
        mime_type: 'image/jpeg',
        size_bytes: siap.utama.size,
        latitude: lok?.lat ?? null,
        longitude: lok?.lng ?? null,
        accuracy_m: lok?.accuracy ?? null,
      });
      if (error) throw new Error(error.message);

      toast('sukses', 'Foto bukti tersimpan.');
      await muat();
      onBerubah();
    } catch (e) {
      setPesanGalat(e instanceof Error ? e.message : 'Gagal mengunggah foto.');
    } finally {
      setSibuk(null);
      if (berkasRef.current) berkasRef.current.value = '';
    }
  }

  // ── Langkah 3 — penyelesaian ──────────────────────────────────────────────

  async function selesaikan() {
    setSibuk('selesai');
    setPesanGalat(null);
    const { data, error } = await supabase.rpc('sm_complete_schedule', {
      p_schedule_id: meeting.id,
    });
    setSibuk(null);

    if (error) { setPesanGalat(error.message); return; }

    const hasil = data as { ok: boolean; reason?: string; message?: string };
    if (!hasil.ok) {
      setPesanGalat(PESAN_PENYELESAIAN[hasil.reason ?? ''] ?? hasil.message ?? 'Belum memenuhi syarat.');
      await muat();
      return;
    }

    toast('sukses', 'Meeting diselesaikan.');
    onBerubah();
    onTutup();
  }

  // ── Override pengawas (§39) ───────────────────────────────────────────────

  async function override() {
    if (alasan.trim().length < 10) return;
    setSibuk('override');
    const { error } = await supabase.rpc('sm_override_completion', {
      p_schedule_id: meeting.id,
      p_reason: alasan.trim(),
    });
    setSibuk(null);

    if (error) { toast('galat', error.message); return; }

    toast('sukses', 'Meeting diselesaikan lewat override. Alasannya tercatat permanen.');
    setFormOverride(false);
    setAlasan('');
    onBerubah();
    onTutup();
  }

  const lok = meeting.sm_locations;
  const gayaStatus = STATUS_JADWAL[meeting.status as StatusJadwal] ?? STATUS_JADWAL.UPCOMING;
  const gayaState = kehadiran
    ? STATE_KEHADIRAN[kehadiran.state as StateKehadiran] ?? STATE_KEHADIRAN.NOT_STARTED
    : STATE_KEHADIRAN.NOT_STARTED;

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={meeting.customer_name}
      keterangan={`${tanggalPendek(meeting.schedule_date)}${meeting.schedule_time ? ` · ${meeting.schedule_time.slice(0, 5)}` : ''} · ${meeting.category}`}
      kaki={
        <>
          <Tombol rupa="kedua" onClick={onTutup} className="text-[12px] py-2">Tutup</Tombol>
          {pengawas && !selesai && (
            <Tombol rupa="hantu" onClick={() => setFormOverride((f) => !f)} className="text-[12px] py-2">
              Override
            </Tombol>
          )}
          {!selesai && langkah === 3 && (
            <Tombol onClick={selesaikan} memuat={sibuk === 'selesai'} className="text-[12px] py-2">
              Selesaikan Meeting
            </Tombol>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">

        <div className="flex items-center gap-2 flex-wrap">
          <Lencana {...gayaStatus} />
          <Lencana {...gayaState} />
          {adaBukti && <Lencana label={`${bukti.length} foto`} color="#1d4ed8" bg="#dbeafe" />}
        </div>

        {/* ── Lokasi tujuan ── */}
        {lok ? (
          <section className="rounded-kartu border border-slate-200 overflow-hidden">
            <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-200">
              <p className="text-[13px] font-bold text-slate-800 leading-tight">{lok.name}</p>
              {lok.address && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{lok.address}</p>}
              <p className="text-[11px] text-slate-500 mt-1">
                Radius yang diizinkan <span className="font-bold tabular-nums">{lok.gps_radius_m} m</span>
              </p>
            </div>
            <iframe
              title={`Peta ${lok.name}`}
              src={urlPetaKecil(Number(lok.latitude), Number(lok.longitude))}
              className="w-full h-[150px] border-0"
              loading="lazy"
            />
          </section>
        ) : (
          <p className="text-[12px] text-[#e34948] bg-[#fce3e3] rounded-kontrol px-3 py-2">
            {PESAN_GPS.NO_LOCATION}
          </p>
        )}

        {/* ── Langkah 1 ── */}
        <Langkah
          nomor={1}
          judul="Check-in lokasi"
          aktif={langkah === 1}
          tuntas={terverifikasi}
          keterangan={
            terverifikasi
              ? `Terverifikasi ${kehadiran?.distance_m != null ? `pada ${jarak(kehadiran.distance_m)} dari titik lokasi` : ''}${kehadiran?.checkin_at ? ` · ${waktuPendek(kehadiran.checkin_at)}` : ''}`
              : 'Berdirilah di dalam area meeting, lalu baca lokasi Anda. Jaraknya diperiksa di server.'
          }
        >
          {!terverifikasi && !selesai && milikSaya && (
            <Tombol onClick={checkIn} memuat={sibuk === 'gps'} className="text-[12px] py-2 w-full sm:w-auto">
              {gagalGps ? 'Coba Check-in Lagi' : 'Mulai Check-in'}
            </Tombol>
          )}
          {!milikSaya && (
            <p className="text-[12px] text-slate-500">
              {pengawas
                ? 'Ini meeting milik sales lain — check-in hanya bisa dilakukan oleh yang ditugaskan. Gunakan Override bila perlu menyelesaikannya secara manual.'
                : PESAN_GPS.ASSIGNMENT_MISMATCH}
            </p>
          )}

          {gagalGps && (
            <div className="mt-2 rounded-kontrol bg-[#fce3e3] border border-[#e34948]/30 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-[#8f2c2b] leading-snug">
                {PESAN_GPS[gagalGps.status] ?? 'Check-in belum bisa diterima.'}
              </p>
              {gagalGps.status === 'OUTSIDE_RADIUS' && gagalGps.jarak_m != null && (
                <p className="text-[11px] text-[#8f2c2b]/80 mt-1 tabular-nums">
                  Anda {jarak(gagalGps.jarak_m)} dari titik lokasi; batasnya {gagalGps.radius_m} m.
                </p>
              )}
              <p className="text-[10px] text-[#8f2c2b]/70 mt-1.5">
                Percobaan ini tercatat pada jejak GPS.
              </p>
            </div>
          )}
        </Langkah>

        {/* ── Langkah 2 ── */}
        <Langkah
          nomor={2}
          judul="Foto bukti kehadiran"
          aktif={langkah === 2}
          tuntas={adaBukti}
          keterangan={
            terverifikasi
              ? 'Ambil foto di tempat. Ukurannya dikecilkan otomatis sebelum dikirim.'
              : 'Terbuka setelah lokasi terverifikasi.'
          }
        >
          {terverifikasi && !selesai && milikSaya && (
            <>
              <input
                ref={berkasRef}
                id="bukti-foto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void unggahFoto(f);
                }}
              />
              <label
                htmlFor="bukti-foto"
                className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-kontrol px-4 py-2.5
                            text-[12px] font-semibold cursor-pointer transition-colors
                            ${sibuk === 'foto'
                              ? 'bg-slate-200 text-slate-500 pointer-events-none'
                              : 'bg-aksen-700 text-white hover:bg-aksen-800'}`}
              >
                {sibuk === 'foto' ? 'Mengunggah…' : adaBukti ? '+ Tambah Foto' : '📷 Ambil Foto Bukti'}
              </label>
            </>
          )}

          {memuat ? (
            <p className="text-[11px] text-slate-400 mt-2">Memuat bukti…</p>
          ) : adaBukti && (
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
              {bukti.map((b) => (
                <li key={b.id} className="relative aspect-square rounded-kecil overflow-hidden bg-slate-100 border border-slate-200">
                  {pratinjau[b.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pratinjau[b.id]}
                      alt={`Bukti kehadiran ${waktuPendek(b.captured_at)}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-[10px] text-slate-400">foto</span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-slate-900/60 text-white text-[9px] text-center py-0.5 tabular-nums">
                    {waktuPendek(b.captured_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Langkah>

        {/* ── Langkah 3 ── */}
        <Langkah
          nomor={3}
          judul="Selesaikan meeting"
          aktif={langkah === 3}
          tuntas={selesai}
          keterangan={
            selesai
              ? `Selesai${meeting.completed_at ? ` pada ${tanggalPendek(meeting.completed_at)} ${waktuPendek(meeting.completed_at)}` : ''}.`
              : 'Syaratnya diperiksa ulang di server sebelum jadwal ditutup.'
          }
        />

        {pesanGalat && (
          <p className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-3 py-2 leading-snug">
            {pesanGalat}
          </p>
        )}

        {/* ── Override (§39) ── */}
        {formOverride && pengawas && !selesai && (
          <section className="rounded-kartu border border-[#eda100]/40 bg-[#fef3d9] p-3">
            <p className="text-[12px] font-bold text-[#7a5300]">Override penyelesaian</p>
            <p className="text-[11px] text-[#7a5300]/80 mt-0.5 leading-snug">
              Jadwal ditutup tanpa memenuhi syarat GPS/foto. Alasannya disimpan permanen
              bersama nama Anda dan tidak bisa dihapus.
            </p>
            <div className="mt-2">
              <Kolom label="Alasan" wajib galat={alasan && alasan.trim().length < 10 ? 'Minimal 10 karakter.' : null}>
                {(id, invalid) => (
                  <AreaTeks
                    id={id} rows={3} value={alasan}
                    onChange={(e) => setAlasan(e.target.value)}
                    aria-invalid={invalid}
                    placeholder="Contoh: GPS ponsel rusak, kehadiran dikonfirmasi langsung oleh customer."
                  />
                )}
              </Kolom>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Tombol rupa="kedua" className="text-[12px] py-2"
                onClick={() => { setFormOverride(false); setAlasan(''); }}>
                Batal
              </Tombol>
              <Tombol className="text-[12px] py-2" memuat={sibuk === 'override'}
                disabled={alasan.trim().length < 10} onClick={override}>
                Simpan Override
              </Tombol>
            </div>
          </section>
        )}

        {(meeting.detail || meeting.notes) && (
          <section className="border-t border-slate-100 pt-3 flex flex-col gap-2">
            {meeting.detail && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Detail</p>
                <p className="text-[12px] text-slate-700 whitespace-pre-wrap leading-relaxed">{meeting.detail}</p>
              </div>
            )}
            {meeting.notes && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Catatan</p>
                <p className="text-[12px] text-slate-700 whitespace-pre-wrap leading-relaxed">{meeting.notes}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

function Langkah({
  nomor, judul, keterangan, aktif, tuntas, children,
}: {
  nomor: number;
  judul: string;
  keterangan: string;
  aktif: boolean;
  tuntas: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-kartu border p-3 transition-colors
                  ${tuntas ? 'border-[#008300]/30 bg-[#e0f2e0]/40'
                    : aktif ? 'border-aksen-700/40 bg-aksen-50/40'
                    : 'border-slate-200 bg-slate-50/60'}`}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={`flex-shrink-0 w-6 h-6 grid place-items-center rounded-full text-[11px] font-black
                      ${tuntas ? 'bg-[#008300] text-white'
                        : aktif ? 'bg-aksen-700 text-white'
                        : 'bg-slate-300 text-white'}`}
        >
          {tuntas ? '✓' : nomor}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-slate-800 leading-tight">{judul}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{keterangan}</p>
          {children && <div className="mt-2.5">{children}</div>}
        </div>
      </div>
    </section>
  );
}
