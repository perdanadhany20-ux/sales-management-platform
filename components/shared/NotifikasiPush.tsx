// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useEffect, useState } from 'react';
import { Tombol, Lencana } from '@/components/shared/FormParts';
import { useToast } from '@/components/shared/Feedback';
import { statusPush, nyalakanPush, matikanPush, type StatusPush } from '@/lib/push-klien';

const KETERANGAN: Record<StatusPush, string> = {
  tidak_didukung: 'Perangkat/aplikasi ini belum mendukung notifikasi push (mis. aplikasi Android versi WebView). Pengingat dalam aplikasi tetap berjalan.',
  belum_diatur_server: 'Notifikasi push belum diaktifkan di server platform ini. Hubungi Admin.',
  ditolak: 'Notifikasi diblokir untuk situs ini. Izinkan lewat pengaturan situs di peramban, lalu buka halaman ini lagi.',
  mati: 'Ringkasan tugas yang menunggu dikirim pagi (±07.30) dan siang (±15.00) WIB, walau aplikasi sedang tertutup.',
  menyala: 'Aktif di perangkat ini: ringkasan pagi & siang dikirim hanya bila ada yang perlu tindakan.',
};

export function NotifikasiPush() {
  const toast = useToast();
  const [status, setStatus] = useState<StatusPush | null>(null);
  const [proses, setProses] = useState(false);
  useEffect(() => { void statusPush().then(setStatus).catch(() => setStatus('tidak_didukung')); }, []);

  async function ubah(nyala: boolean) {
    setProses(true);
    try {
      const s = nyala ? await nyalakanPush() : await matikanPush();
      setStatus(s);
      if (nyala && s === 'menyala') toast('sukses', 'Notifikasi push aktif — notifikasi uji dikirim.');
      if (nyala && s === 'ditolak') toast('galat', 'Izin notifikasi ditolak peramban.');
    } catch (e) {
      toast('galat', e instanceof Error ? e.message : 'Gagal mengatur notifikasi push.');
    } finally {
      setProses(false);
    }
  }

  if (!status) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] font-bold text-slate-800">Notifikasi push</p>
        {status === 'menyala' && <Lencana label="Aktif" color="#008300" bg="#e0f2e0" />}
      </div>
      <p className="text-[11.5px] text-slate-500 leading-relaxed">{KETERANGAN[status]}</p>
      {(status === 'mati' || status === 'menyala') && (
        <Tombol rupa={status === 'menyala' ? 'kedua' : 'utama'} className="text-[12px] py-2 w-full" memuat={proses}
          onClick={() => ubah(status !== 'menyala')}>
          {status === 'menyala' ? 'Matikan Notifikasi Push' : 'Nyalakan Notifikasi Push'}
        </Tombol>
      )}
    </div>
  );
}
