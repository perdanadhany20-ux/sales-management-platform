'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { kosongkanCachePengaturan } from '@/lib/use-settings';
import {
  BRANDING_BAWAAN, kosongkanCacheBranding, terapkanWarna, type Branding,
} from '@/lib/branding';
import { Teks, Tombol } from '@/components/shared/FormParts';
import { KerangkaKartu, PanelGalat, useToast } from '@/components/shared/Feedback';

interface KartuDashboard { key: string; label: string; aktif: boolean }

/**
 * Administrasi → Tampilan.
 *
 * Nama, logo, warna, dan gambar latar platform. Semuanya tinggal di satu baris
 * sm_settings('branding') dan dua berkas di bucket 'branding', sehingga
 * mengganti identitas visual tidak menuntut satu pun deploy.
 *
 * Pratinjau di atas formulir bukan hiasan: warna dan nama yang diketik di sini
 * akan muncul di sidebar, tombol, dan halaman masuk — tempat-tempat yang tidak
 * bisa dilihat bersamaan dengan formulir ini. Tanpa pratinjau, satu-satunya
 * cara mengetahui hasilnya adalah menyimpan lalu berpindah halaman, dan itu
 * membuat orang menyimpan berkali-kali hanya untuk mencoba warna.
 */
export function TabTampilan() {
  const toast = useToast();

  const [b, setB] = useState<Branding>(BRANDING_BAWAAN);
  const [kartu, setKartu] = useState<KartuDashboard[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState<string | null>(null);
  const [mengunggah, setMengunggah] = useState<string | null>(null);

  const refLogo = useRef<HTMLInputElement>(null);
  const refLatar = useRef<HTMLInputElement>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    const { data, error } = await supabase.from('sm_settings')
      .select('key, value').in('key', ['branding', 'dashboard_widgets']);
    if (error) { setGalat(error.message); setMemuat(false); return; }

    const peta = Object.fromEntries(
      ((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
    );
    setB({ ...BRANDING_BAWAAN, ...((peta.branding ?? {}) as Partial<Branding>) });
    setKartu((peta.dashboard_widgets ?? []) as KartuDashboard[]);
    setMemuat(false);
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  function ubah<K extends keyof Branding>(kunci: K, nilai: Branding[K]) {
    setB((lama) => {
      const baru = { ...lama, [kunci]: nilai };
      // Warna diterapkan seketika ke seluruh halaman supaya yang terlihat di
      // sidebar kiri benar-benar warna yang sedang dipilih, bukan tebakan.
      if (kunci.toString().startsWith('warna')) terapkanWarna(baru);
      return baru;
    });
  }

  async function simpanBranding() {
    setMenyimpan('branding');
    const { error } = await supabase.from('sm_settings')
      .update({ value: b, updated_at: new Date().toISOString() })
      .eq('key', 'branding');
    setMenyimpan(null);

    if (error) { toast('galat', `Gagal menyimpan: ${error.message}`); return; }

    kosongkanCacheBranding();
    terapkanWarna(b);
    toast('sukses', 'Identitas platform disimpan.');
  }

  async function simpanKartu() {
    setMenyimpan('dashboard_widgets');
    const { error } = await supabase.from('sm_settings')
      .update({ value: kartu, updated_at: new Date().toISOString() })
      .eq('key', 'dashboard_widgets');
    setMenyimpan(null);

    if (error) { toast('galat', `Gagal menyimpan: ${error.message}`); return; }
    kosongkanCachePengaturan();
    toast('sukses', 'Tampilan dashboard disimpan.');
  }

  /**
   * Unggah berkas merek.
   *
   * Nama berkasnya diberi stempel waktu, bukan nama tetap seperti "logo.png".
   * Dengan nama tetap, logo lama akan tetap terlihat berhari-hari di peramban
   * yang sudah menyimpannya di cache — dan admin yang baru saja menggantinya
   * akan yakin fiturnya rusak.
   */
  async function unggah(kunci: 'logo_url' | 'latar_login_url', file: File) {
    setMengunggah(kunci);
    try {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().slice(0, 4);
      const jalur = `${kunci}-${Date.now()}.${ext}`;

      const { error } = await supabase.storage.from('branding')
        .upload(jalur, file, { contentType: file.type, upsert: true });
      if (error) throw new Error(error.message);

      const { data } = supabase.storage.from('branding').getPublicUrl(jalur);
      ubah(kunci, data.publicUrl);
      toast('info', 'Berkas terunggah. Tekan Simpan agar dipakai platform.');
    } catch (e) {
      toast('galat', e instanceof Error ? e.message : 'Gagal mengunggah berkas.');
    } finally {
      setMengunggah(null);
      if (refLogo.current) refLogo.current.value = '';
      if (refLatar.current) refLatar.current.value = '';
    }
  }

  if (memuat) return <div className="flex flex-col gap-4"><KerangkaKartu tinggi={220} /><KerangkaKartu tinggi={260} /></div>;
  if (galat) return <PanelGalat pesan={galat} onCoba={muat} />;

  return (
    <div className="flex flex-col gap-4">

      {/* ══ Identitas platform ══ */}
      <Kartu judul="Dashboard" keterangan="Header yang dilihat tim setelah masuk.">

        <Label>Pratinjau</Label>
        <div className="rounded-kartu border border-slate-200 bg-white px-4 py-3 flex items-center gap-3 mb-4">
          {b.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logo_url} alt="" className="w-10 h-10 rounded-kontrol object-contain" />
          ) : (
            <span className="w-10 h-10 rounded-kontrol grid place-items-center flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${b.warna_utama_2}, ${b.warna_utama})` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 19V10M10 19V5M16 19v-6M22 19H2" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-black text-slate-900 leading-tight truncate">
              {b.nama_platform || 'Nama platform'}
              {b.nama_portal && (
                <span className="font-bold ml-2" style={{ color: b.warna_aksen }}>
                  | {b.nama_portal}
                </span>
              )}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {b.nama_perusahaan || 'Nama perusahaan'}
            </p>
          </div>
        </div>

        <Label>Logo</Label>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          {b.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logo_url} alt="Logo saat ini" className="w-11 h-11 rounded-kontrol object-contain border border-slate-200 bg-white" />
          ) : (
            <span className="w-11 h-11 rounded-kontrol border border-dashed border-slate-300 grid place-items-center text-[10px] text-slate-400">
              kosong
            </span>
          )}
          <input ref={refLogo} id="berkas-logo" type="file" className="sr-only"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void unggah('logo_url', f); }} />
          <label htmlFor="berkas-logo"
            className={`inline-flex items-center rounded-kontrol border border-slate-300 bg-white px-3.5 py-2 text-[12px] font-semibold cursor-pointer transition-colors
                        ${mengunggah === 'logo_url' ? 'opacity-60 pointer-events-none' : 'hover:bg-slate-50'}`}>
            {mengunggah === 'logo_url' ? 'Mengunggah…' : 'Ganti berkas'}
          </label>
          {b.logo_url && (
            <button type="button" onClick={() => ubah('logo_url', '')}
              className="text-[12px] font-semibold text-aksen-700 hover:underline underline-offset-2">
              Kembalikan ke bawaan
            </button>
          )}
        </div>
        <Bantuan>
          PNG atau SVG dengan latar transparan, maks 8&nbsp;MB. Sengaja tidak dikompres
          supaya bagian transparannya tidak berubah jadi kotak putih.
        </Bantuan>

        <div className="grid grid-cols-1 formulir:grid-cols-2 gap-4 mt-4">
          <Isian label="Nama Platform" nilai={b.nama_platform}
            onUbah={(v) => ubah('nama_platform', v)} placeholder="Sales Management Platform" />
          <Isian label="Kredit Pembuat" nilai={b.kredit}
            onUbah={(v) => ubah('kredit', v)} placeholder="Created by …" />
          <Isian label="Kontak Bantuan" nilai={b.kontak_bantuan}
            onUbah={(v) => ubah('kontak_bantuan', v)}
            placeholder="email / no. WA — kosongkan bila tidak dipakai" />
          <Isian label="Nama Platform (layar sempit)" nilai={b.nama_pendek}
            onUbah={(v) => ubah('nama_pendek', v)} placeholder="Sales MP" />
          <Isian label="Nama Portal" nilai={b.nama_portal}
            onUbah={(v) => ubah('nama_portal', v)} placeholder="mis. Portal Sales" />
          <Isian label="Nama Perusahaan" nilai={b.nama_perusahaan}
            onUbah={(v) => ubah('nama_perusahaan', v)} placeholder="PT …" />
        </div>

        <div className="grid grid-cols-1 formulir:grid-cols-3 gap-4 mt-4">
          <Warna label="Warna Utama" nilai={b.warna_utama} onUbah={(v) => ubah('warna_utama', v)} />
          <Warna label="Warna Utama 2" nilai={b.warna_utama_2} onUbah={(v) => ubah('warna_utama_2', v)} />
          <Warna label="Warna Aksen (nama portal)" nilai={b.warna_aksen} onUbah={(v) => ubah('warna_aksen', v)} />
        </div>
        <Bantuan>
          Warna utama mengalir ke sidebar, tombol, dan kartu sorot di seluruh aplikasi —
          perubahannya langsung terlihat di halaman ini sebelum disimpan.
        </Bantuan>

        <div className="mt-4">
          <Label>Gambar Latar Halaman Masuk</Label>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            {b.latar_login_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.latar_login_url} alt="Latar saat ini"
                className="w-20 h-11 rounded-kontrol object-cover border border-slate-200" />
            ) : (
              <span className="w-20 h-11 rounded-kontrol border border-dashed border-slate-300 grid place-items-center text-[10px] text-slate-400">
                kosong
              </span>
            )}
            <input ref={refLatar} id="berkas-latar" type="file" className="sr-only"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void unggah('latar_login_url', f); }} />
            <label htmlFor="berkas-latar"
              className={`inline-flex items-center rounded-kontrol border border-slate-300 bg-white px-3.5 py-2 text-[12px] font-semibold cursor-pointer transition-colors
                          ${mengunggah === 'latar_login_url' ? 'opacity-60 pointer-events-none' : 'hover:bg-slate-50'}`}>
              {mengunggah === 'latar_login_url' ? 'Mengunggah…' : 'Ganti berkas'}
            </label>
            {b.latar_login_url && (
              <button type="button" onClick={() => ubah('latar_login_url', '')}
                className="text-[12px] font-semibold text-aksen-700 hover:underline underline-offset-2">
                Kembalikan ke bawaan
              </button>
            )}
          </div>
          <Bantuan>
            Foto di panel kiri halaman masuk. Ditampilkan digelapkan supaya tulisan putih
            di atasnya tetap terbaca. Maks 8&nbsp;MB.
          </Bantuan>
        </div>

        {/* Pratinjau halaman masuk */}
        <div className="mt-5">
          <Label>Pratinjau Halaman Masuk</Label>
          <div className="rounded-kartu overflow-hidden border border-slate-200 flex">
            <div className="relative w-1/2 p-4 text-white min-h-[120px] flex flex-col justify-between"
              style={{ background: `linear-gradient(145deg, ${b.warna_utama_2}, ${b.warna_utama})` }}>
              {b.latar_login_url && (
                <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center opacity-35"
                  style={{ backgroundImage: `url(${b.latar_login_url})` }} />
              )}
              <p className="relative text-[12px] font-bold truncate">
                {b.nama_platform || 'Nama platform'}
                {b.nama_portal && <span className="font-normal opacity-70"> · {b.nama_portal}</span>}
              </p>
              <p className="relative text-[9px] opacity-60">
                © {new Date().getFullYear()} {b.nama_perusahaan || b.nama_platform}
              </p>
            </div>
            <div className="w-1/2 bg-slate-50 p-4 flex flex-col justify-center gap-2">
              <p className="text-[13px] font-black text-slate-900">Selamat Datang</p>
              <div className="h-6 rounded-kontrol bg-white border border-slate-200" />
              <div className="h-7 rounded-kontrol grid place-items-center text-[10px] font-bold text-white"
                style={{ background: `linear-gradient(to right, ${b.warna_utama_2}, ${b.warna_utama})` }}>
                Masuk
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-5">
          <Tombol memuat={menyimpan === 'branding'} onClick={simpanBranding}>
            Simpan Identitas Platform
          </Tombol>
        </div>
      </Kartu>

      {/* ══ Kartu dashboard ══ */}
      <Kartu judul="Kartu Dashboard" keterangan="Kartu mana yang tampil di halaman Dashboard.">
        <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
          Kartu yang dimatikan tidak akan tampil bagi siapa pun. Angkanya tetap dihitung —
          yang disembunyikan hanya kartunya.
        </p>

        <ul className="grid grid-cols-1 formulir:grid-cols-2 gap-x-4">
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

        <div className="flex justify-end mt-4">
          <Tombol memuat={menyimpan === 'dashboard_widgets'} onClick={simpanKartu}>
            Simpan Kartu Dashboard
          </Tombol>
        </div>
      </Kartu>
    </div>
  );
}

/* ── Bagian kecil ─────────────────────────────────────────────────────────── */

function Kartu({ judul, keterangan, children }: {
  judul: string; keterangan: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-kartu border border-slate-200 shadow-bento overflow-hidden">
      <header className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-slate-50/70">
        <h2 className="text-[14px] font-black text-slate-900 leading-tight">{judul}</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{keterangan}</p>
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">{children}</p>
  );
}

function Bantuan({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-slate-500 leading-relaxed mt-1.5">{children}</p>;
}

function Isian({ label, nilai, onUbah, placeholder }: {
  label: string; nilai: string; onUbah: (v: string) => void; placeholder?: string;
}) {
  const id = `merek-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
        {label}
      </label>
      <Teks id={id} value={nilai} placeholder={placeholder}
        onChange={(e) => onUbah(e.target.value)} />
    </div>
  );
}

function Warna({ label, nilai, onUbah }: {
  label: string; nilai: string; onUbah: (v: string) => void;
}) {
  const id = `warna-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const sah = /^#[0-9a-fA-F]{6}$/.test(nilai);
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* Dua cara memasukkan warna yang sama: pemilih untuk yang memilih
            dengan mata, kolom teks untuk yang sudah memegang kode warna merek
            dari tim desain. */}
        <input
          type="color" value={sah ? nilai : '#1d4ed8'} aria-label={`${label} — pemilih warna`}
          onChange={(e) => onUbah(e.target.value)}
          className="w-10 h-10 rounded-kontrol border border-slate-300 bg-white p-1 cursor-pointer flex-shrink-0"
        />
        <Teks id={id} value={nilai} onChange={(e) => onUbah(e.target.value)}
          placeholder="#1d4ed8" aria-invalid={!sah} />
      </div>
    </div>
  );
}
