'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { bandingVersi, diAplikasiAndroid, diBrowserAndroid, versiAplikasi } from '@/lib/aplikasi';

const ALAMAT_UNDUH = '/api/aplikasi/unduh';

/** Status lingkungan dibaca setelah terpasang — window tidak ada saat render server. */
function useLingkungan() {
  const [l, setL] = useState<{ diApp: boolean; browserAndroid: boolean; versi: string | null } | null>(null);
  useEffect(() => {
    setL({ diApp: diAplikasiAndroid(), browserAndroid: diBrowserAndroid(), versi: versiAplikasi() });
  }, []);
  return l;
}

/** Kartu di halaman Profil: status aplikasi, atau cara mengunduh dan memasangnya. */
export function KartuAplikasi() {
  const l = useLingkungan();
  if (!l) return null;

  return (
    <section aria-labelledby="judul-aplikasi"
      className="bg-white rounded-kartu border border-slate-200 shadow-bento p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="" width={40} height={40} className="rounded-kontrol" />
        <div>
          <h2 id="judul-aplikasi" className="text-[14px] font-bold text-slate-900">Aplikasi Android</h2>
          <p className="text-[12px] text-slate-500">
            {l.diApp ? `Anda sedang memakai aplikasinya — versi ${l.versi ?? '?'}.` : 'Buka platform langsung dari layar utama HP.'}
          </p>
        </div>
      </div>

      {!l.diApp && (
        <>
          <p className="text-[12px] text-slate-600 leading-relaxed">
            Check-in Meeting lewat aplikasi lebih aman: lokasi dibaca langsung dari HP, dan lokasi
            dari aplikasi pengubah lokasi (fake GPS) terdeteksi otomatis.
          </p>
          <a href={ALAMAT_UNDUH}
            className="self-start rounded-kontrol bg-aksen-600 hover:bg-aksen-700 text-white text-[13px] font-bold
                       px-4 py-2.5 min-h-[44px] inline-flex items-center gap-2
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aksen-600">
            ⬇ Unduh aplikasi (.apk)
          </a>
          <ol className="text-[12px] text-slate-600 list-decimal pl-5 space-y-1">
            <li>Buka berkas yang terunduh dari notifikasi atau folder Download.</li>
            <li>Bila diminta, izinkan pemasangan dari sumber ini (browser Anda).</li>
            <li>Pilih <strong>Instal</strong>, lalu buka <strong>Sales Management</strong> dan masuk seperti biasa.</li>
          </ol>
        </>
      )}
    </section>
  );
}

/** Banner di halaman Meeting untuk yang membuka lewat browser di HP Android. */
export function BannerAplikasi() {
  const l = useLingkungan();
  if (!l?.browserAndroid) return null;
  return (
    <div className="rounded-kontrol border border-aksen-600/25 bg-aksen-50 px-3.5 py-2.5 flex flex-wrap items-center gap-2 justify-between">
      <p className="text-[12px] text-slate-700">
        <strong className="font-bold">Check-in lebih aman lewat aplikasi Android.</strong>{' '}
        Lokasi palsu terdeteksi langsung dari HP.
      </p>
      <a href={ALAMAT_UNDUH} className="text-[12px] font-bold text-aksen-700 hover:underline whitespace-nowrap">
        Unduh aplikasi →
      </a>
    </div>
  );
}

/**
 * Penjaga versi: di dalam aplikasi yang versinya lebih lama dari
 * apk_versi_minimum (Admin → Nilai Bisnis), tampilkan permintaan
 * memperbarui. Tidak menghapus apa pun; hanya menghalangi pemakaian versi
 * lama yang mungkin sudah tidak cocok dengan server.
 */
export function PenjagaVersiAplikasi() {
  const [kedaluwarsa, setKedaluwarsa] = useState<{ versi: string; minimum: string } | null>(null);

  useEffect(() => {
    if (!diAplikasiAndroid()) return;
    const versi = versiAplikasi();
    if (!versi) return;
    let batal = false;
    (async () => {
      const { data } = await supabase.from('sm_settings').select('value').eq('key', 'apk_versi_minimum').maybeSingle();
      const minimum = typeof data?.value === 'string' ? data.value : null;
      if (!batal && minimum && bandingVersi(versi, minimum) < 0) setKedaluwarsa({ versi, minimum });
    })();
    return () => { batal = true; };
  }, []);

  if (!kedaluwarsa) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="judul-versi"
      className="fixed inset-0 z-[90] bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-kartu shadow-modal max-w-sm w-full p-5 text-center flex flex-col gap-3">
        <img src="/icon-192.png" alt="" width={56} height={56} className="mx-auto rounded-kontrol" />
        <h2 id="judul-versi" className="text-base font-bold text-slate-900">Perbarui aplikasi</h2>
        <p className="text-[13px] text-slate-600">
          Versi {kedaluwarsa.versi} sudah tidak didukung. Pasang versi {kedaluwarsa.minimum} atau yang lebih baru
          untuk melanjutkan.
        </p>
        <a href={ALAMAT_UNDUH}
          className="rounded-kontrol bg-aksen-600 hover:bg-aksen-700 text-white text-[13px] font-bold px-4 py-2.5 min-h-[44px] inline-flex items-center justify-center">
          ⬇ Unduh versi terbaru
        </a>
      </div>
    </div>
  );
}
