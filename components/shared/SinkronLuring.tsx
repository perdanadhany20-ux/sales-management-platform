// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast, PERISTIWA_DATA_BERUBAH } from '@/components/shared/Feedback';
import { jumlahAntrian, kirimAntrian, PERISTIWA_ANTRIAN } from '@/lib/antrian-luring';

/**
 * Bilah kecil "N laporan menunggu sinyal" + pengirim otomatis antrian luring.
 * Dicoba saat aplikasi dibuka, saat perangkat kembali online, dan tiap
 * menit selama antrian belum kosong.
 */
export function SinkronLuring({ userId }: { userId: string }) {
  const toast = useToast();
  const [jumlah, setJumlah] = useState(0);
  const [online, setOnline] = useState(true);
  const [mengirim, setMengirim] = useState(false);

  const segarkan = useCallback(() => {
    setJumlah(jumlahAntrian(userId));
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
  }, [userId]);

  const kirim = useCallback(async () => {
    if (jumlahAntrian(userId) === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    setMengirim(true);
    const h = await kirimAntrian(userId);
    setMengirim(false);
    segarkan();
    if (h.terkirim > 0) {
      toast('sukses', `${h.terkirim} laporan offline terkirim.`);
      window.dispatchEvent(new Event(PERISTIWA_DATA_BERUBAH));
    }
    if (h.ditolak.length > 0) toast('galat', `${h.ditolak.length} laporan offline ditolak server: ${h.ditolak[0]}`);
  }, [userId, segarkan, toast]);

  useEffect(() => {
    segarkan();
    void kirim();
    const naik = () => { segarkan(); void kirim(); };
    window.addEventListener('online', naik);
    window.addEventListener('offline', segarkan);
    window.addEventListener(PERISTIWA_ANTRIAN, segarkan);
    const t = window.setInterval(() => { if (jumlahAntrian(userId) > 0) void kirim(); }, 60_000);
    return () => {
      window.removeEventListener('online', naik);
      window.removeEventListener('offline', segarkan);
      window.removeEventListener(PERISTIWA_ANTRIAN, segarkan);
      window.clearInterval(t);
    };
  }, [userId, segarkan, kirim]);

  if (jumlah === 0 && online) return null;
  return (
    <div role="status" className={`mb-3 flex items-center gap-3 rounded-kartu border px-3.5 py-2.5 text-[12.5px]
      ${online ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-300 bg-slate-100 text-slate-700'}`}>
      <span aria-hidden="true">{online ? '📤' : '📴'}</span>
      <p className="flex-1 leading-snug">
        {!online && <b>Sedang offline. </b>}
        {jumlah > 0
          ? <>{jumlah} laporan tersimpan di perangkat ini {online ? 'menunggu terkirim.' : '— dikirim otomatis saat sinyal kembali.'}</>
          : 'Daily Report baru tetap bisa disimpan dan dikirim otomatis saat online.'}
      </p>
      {online && jumlah > 0 && (
        <button type="button" onClick={() => void kirim()} disabled={mengirim}
          className="font-bold underline underline-offset-2 disabled:opacity-60">
          {mengirim ? 'Mengirim…' : 'Kirim sekarang'}
        </button>
      )}
    </div>
  );
}
