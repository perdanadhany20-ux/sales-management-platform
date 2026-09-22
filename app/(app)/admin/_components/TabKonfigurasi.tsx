'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { kosongkanCachePengaturan } from '@/lib/use-settings';
import { Teks, Tombol } from '@/components/shared/FormParts';
import { KerangkaKartu, PanelGalat, useToast } from '@/components/shared/Feedback';
import { BentoGrid, BentoCard } from '@/components/shared/Bento';

interface KategoriJadwal { name: string; requires_attendance: boolean }
interface KartuDashboard { key: string; label: string; aktif: boolean }

/**
 * Konfigurasi nilai bisnis dan tampilan dashboard (§21, §47).
 *
 * Semua yang ada di sini tinggal di sm_settings, bukan di kode — itulah yang
 * membuat kategori bisa ditambah dan radius bawaan bisa diubah tanpa deploy
 * ulang.
 *
 * Penyimpanan per-bagian, bukan satu tombol simpan untuk seluruh halaman.
 * Dengan begitu kegagalan pada satu bagian tidak membatalkan perubahan yang
 * sudah benar di bagian lain, dan pesan galatnya menunjuk tepat ke tempat
 * masalahnya.
 */
export function TabKonfigurasi() {
  const toast = useToast();

  const [kategori, setKategori] = useState<KategoriJadwal[]>([]);
  const [probability, setProbability] = useState<number[]>([]);
  const [unit, setUnit] = useState<string[]>([]);
  const [aktivitas, setAktivitas] = useState<string[]>([]);
  const [radius, setRadius] = useState(50);
  const [akurasi, setAkurasi] = useState(100);
  const [kartu, setKartu] = useState<KartuDashboard[]>([]);

  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    const { data, error } = await supabase.from('sm_settings').select('key, value');
    if (error) { setGalat(error.message); setMemuat(false); return; }

    const peta: Record<string, unknown> = Object.fromEntries(
      ((data ?? []) as { key: string; value: unknown }[]).map((b) => [b.key, b.value]),
    );
    setKategori((peta.schedule_categories ?? []) as KategoriJadwal[]);
    setProbability((peta.probability_options ?? []) as number[]);
    setUnit((peta.pipeline_units ?? []) as string[]);
    setAktivitas((peta.activity_categories ?? []) as string[]);
    setRadius(Number(peta.default_gps_radius_m ?? 50));
    setAkurasi(Number(peta.gps_accuracy_threshold_m ?? 100));
    setKartu((peta.dashboard_widgets ?? []) as KartuDashboard[]);
    setMemuat(false);
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  async function simpan(key: string, value: unknown, label: string) {
    setMenyimpan(key);
    const { error } = await supabase.from('sm_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key);
    setMenyimpan(null);

    if (error) { toast('galat', `Gagal menyimpan ${label}: ${error.message}`); return; }

    // Cache pengaturan dikosongkan supaya halaman lain di tab ini ikut segar
    // tanpa perlu memuat ulang peramban.
    kosongkanCachePengaturan();
    toast('sukses', `${label} disimpan.`);
  }

  if (memuat) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KerangkaKartu tinggi={240} /><KerangkaKartu tinggi={240} />
      </div>
    );
  }

  if (galat) return <PanelGalat pesan={galat} onCoba={muat} />;

  return (
    <BentoGrid>

      {/* ── Kategori jadwal ── */}
      <BentoCard rentang={6} tinggi="auto" judul="Kategori Request Schedule">
        <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
          Kategori bertanda <b>wajib bukti</b> menuntut check-in GPS dalam radius dan foto
          sebelum jadwalnya bisa diselesaikan.
        </p>

        <ul className="flex flex-col gap-2 mb-3">
          {kategori.map((k, i) => (
            <li key={i} className="flex items-center gap-2">
              <Teks
                value={k.name}
                onChange={(e) => setKategori((d) =>
                  d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder="Nama kategori"
              />
              <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox" checked={k.requires_attendance}
                  onChange={(e) => setKategori((d) =>
                    d.map((x, j) => (j === i ? { ...x, requires_attendance: e.target.checked } : x)))}
                  className="w-4 h-4 accent-aksen-700"
                />
                <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">wajib bukti</span>
              </label>
              <button
                type="button" aria-label={`Hapus kategori ${k.name}`}
                onClick={() => setKategori((d) => d.filter((_, j) => j !== i))}
                className="flex-shrink-0 w-8 h-8 grid place-items-center rounded-kecil text-slate-400 hover:bg-[#fce3e3] hover:text-[#e34948] transition-colors"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Tombol rupa="kedua" className="text-[12px] py-2"
            onClick={() => setKategori((d) => [...d, { name: '', requires_attendance: false }])}>
            + Tambah
          </Tombol>
          <Tombol className="text-[12px] py-2"
            memuat={menyimpan === 'schedule_categories'}
            onClick={() => simpan('schedule_categories',
              kategori.filter((k) => k.name.trim()).map((k) => ({ ...k, name: k.name.trim() })),
              'Kategori jadwal')}>
            Simpan
          </Tombol>
        </div>
      </BentoCard>

      {/* ── Tampilan dashboard ── */}
      <BentoCard rentang={6} tinggi="auto" judul="Tampilan Dashboard">
        <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
          Kartu yang dimatikan tidak akan tampil di Dashboard bagi siapa pun. Angkanya
          tetap dihitung — yang disembunyikan hanya kartunya.
        </p>

        <ul className="flex flex-col gap-1 mb-3">
          {kartu.map((k, i) => (
            <li key={k.key}>
              <label className="flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-kontrol hover:bg-slate-50 cursor-pointer select-none transition-colors">
                <input
                  type="checkbox" checked={k.aktif}
                  onChange={(e) => setKartu((d) =>
                    d.map((x, j) => (j === i ? { ...x, aktif: e.target.checked } : x)))}
                  className="w-4 h-4 accent-aksen-700 flex-shrink-0"
                />
                <span className={`text-[13px] font-semibold ${k.aktif ? 'text-slate-700' : 'text-slate-400'}`}>
                  {k.label}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <Tombol className="text-[12px] py-2"
          memuat={menyimpan === 'dashboard_widgets'}
          onClick={() => simpan('dashboard_widgets', kartu, 'Tampilan dashboard')}>
          Simpan
        </Tombol>
      </BentoCard>

      {/* ── GPS ── */}
      <BentoCard rentang={6} tinggi="auto" judul="Verifikasi Lokasi">
        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4 mb-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="k-radius" className="text-[12px] font-semibold text-slate-700">
              Radius bawaan (meter)
            </label>
            <Teks id="k-radius" type="number" min={10} max={5000} value={radius}
              onChange={(e) => setRadius(Number(e.target.value) || 0)}
              className="text-right tabular-nums" />
            <p className="text-[11px] text-slate-500">Dipakai saat membuat lokasi baru. Bisa ditimpa per lokasi.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="k-akurasi" className="text-[12px] font-semibold text-slate-700">
              Akurasi GPS maksimum (meter)
            </label>
            <Teks id="k-akurasi" type="number" min={10} max={1000} value={akurasi}
              onChange={(e) => setAkurasi(Number(e.target.value) || 0)}
              className="text-right tabular-nums" />
            <p className="text-[11px] text-slate-500">
              Pembacaan yang lebih buruk dari ini ditolak. Menaikkannya mempermudah
              check-in, tapi memperlemah buktinya.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Tombol className="text-[12px] py-2" memuat={menyimpan === 'default_gps_radius_m'}
            onClick={() => simpan('default_gps_radius_m', radius, 'Radius bawaan')}>
            Simpan Radius
          </Tombol>
          <Tombol className="text-[12px] py-2" memuat={menyimpan === 'gps_accuracy_threshold_m'}
            onClick={() => simpan('gps_accuracy_threshold_m', akurasi, 'Ambang akurasi')}>
            Simpan Akurasi
          </Tombol>
        </div>
      </BentoCard>

      {/* ── Daftar sederhana ── */}
      <BentoCard rentang={6} tinggi="auto" judul="Pilihan Pipeline & Aktivitas">
        <DaftarAngka
          label="Tingkat probability (%)"
          nilai={probability} onUbah={setProbability}
          menyimpan={menyimpan === 'probability_options'}
          onSimpan={(v) => simpan('probability_options', v, 'Tingkat probability')}
        />
        <div className="h-px bg-slate-100 my-4" />
        <DaftarTeks
          label="Satuan Pipeline"
          nilai={unit} onUbah={setUnit}
          menyimpan={menyimpan === 'pipeline_units'}
          onSimpan={(v) => simpan('pipeline_units', v, 'Satuan Pipeline')}
        />
        <div className="h-px bg-slate-100 my-4" />
        <DaftarTeks
          label="Kategori aktivitas"
          nilai={aktivitas} onUbah={setAktivitas}
          menyimpan={menyimpan === 'activity_categories'}
          onSimpan={(v) => simpan('activity_categories', v, 'Kategori aktivitas')}
        />
      </BentoCard>

    </BentoGrid>
  );
}

function DaftarTeks({
  label, nilai, onUbah, onSimpan, menyimpan,
}: {
  label: string;
  nilai: string[];
  onUbah: (v: string[]) => void;
  onSimpan: (v: string[]) => void;
  menyimpan: boolean;
}) {
  const [baru, setBaru] = useState('');

  function tambah() {
    const v = baru.trim();
    // Duplikat ditolak diam-diam: daftar pilihan yang memuat dua entri sama
    // membingungkan saat dipakai, dan tidak ada gunanya.
    if (!v || nilai.includes(v)) { setBaru(''); return; }
    onUbah([...nilai, v]);
    setBaru('');
  }

  return (
    <div>
      <p className="text-[12px] font-semibold text-slate-700 mb-2">{label}</p>
      <ul className="flex flex-wrap gap-1.5 mb-2 list-none p-0">
        {nilai.map((v) => (
          <li key={v}
            className="inline-flex items-center gap-1.5 rounded-kecil bg-slate-100 pl-2.5 pr-1 py-1 text-[12px] font-semibold text-slate-700">
            {v}
            <button type="button" aria-label={`Hapus ${v}`}
              onClick={() => onUbah(nilai.filter((x) => x !== v))}
              className="w-4 h-4 grid place-items-center rounded text-slate-400 hover:text-[#e34948] transition-colors">
              ✕
            </button>
          </li>
        ))}
        {nilai.length === 0 && <li className="text-[12px] text-slate-400">Belum ada pilihan.</li>}
      </ul>
      <div className="flex items-center gap-2">
        <Teks value={baru} onChange={(e) => setBaru(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tambah(); } }}
          placeholder="Tambah lalu tekan Enter" />
        <Tombol rupa="kedua" className="text-[12px] py-2 flex-shrink-0" onClick={tambah}>+</Tombol>
        <Tombol className="text-[12px] py-2 flex-shrink-0" memuat={menyimpan}
          onClick={() => onSimpan(nilai)}>Simpan</Tombol>
      </div>
    </div>
  );
}

function DaftarAngka({
  label, nilai, onUbah, onSimpan, menyimpan,
}: {
  label: string;
  nilai: number[];
  onUbah: (v: number[]) => void;
  onSimpan: (v: number[]) => void;
  menyimpan: boolean;
}) {
  const [baru, setBaru] = useState('');

  function tambah() {
    const n = Number(baru);
    if (!baru || !Number.isFinite(n) || n < 0 || n > 100 || nilai.includes(n)) { setBaru(''); return; }
    onUbah([...nilai, n].sort((a, b) => a - b));
    setBaru('');
  }

  return (
    <div>
      <p className="text-[12px] font-semibold text-slate-700 mb-2">{label}</p>
      <ul className="flex flex-wrap gap-1.5 mb-2 list-none p-0">
        {nilai.map((v) => (
          <li key={v}
            className="inline-flex items-center gap-1.5 rounded-kecil bg-aksen-50 pl-2.5 pr-1 py-1 text-[12px] font-bold text-aksen-800 tabular-nums">
            {v}%
            <button type="button" aria-label={`Hapus ${v} persen`}
              onClick={() => onUbah(nilai.filter((x) => x !== v))}
              className="w-4 h-4 grid place-items-center rounded text-aksen-400 hover:text-[#e34948] transition-colors">
              ✕
            </button>
          </li>
        ))}
        {nilai.length === 0 && <li className="text-[12px] text-slate-400">Belum ada pilihan.</li>}
      </ul>
      <div className="flex items-center gap-2">
        <Teks type="number" min={0} max={100} value={baru} onChange={(e) => setBaru(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tambah(); } }}
          placeholder="0–100" className="text-right tabular-nums" />
        <Tombol rupa="kedua" className="text-[12px] py-2 flex-shrink-0" onClick={tambah}>+</Tombol>
        <Tombol className="text-[12px] py-2 flex-shrink-0" memuat={menyimpan}
          onClick={() => onSimpan(nilai)}>Simpan</Tombol>
      </div>
    </div>
  );
}
