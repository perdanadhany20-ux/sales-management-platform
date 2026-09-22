'use client';

import { usePenggunaAktif } from '@/lib/auth';
import { isPengawas } from '@/lib/constants';
import { bagianUntuk } from '@/lib/admin-bagian';
import { LayarMemuat, Kosong } from '@/components/shared/Feedback';
import { useBagianAdmin } from '@/components/shared/Shell';
import { TabPengguna } from './_components/TabPengguna';
import { TabPersetujuan } from './_components/TabPersetujuan';
import { TabLokasi } from './_components/TabLokasi';
import { TabKonfigurasi } from './_components/TabKonfigurasi';
import { TabTampilan } from './_components/TabTampilan';
import { TabAudit } from './_components/TabAudit';

/**
 * Admin Panel.
 *
 * Navigasinya TIDAK ada di halaman ini: daftar bagian tampil sebagai sub-menu
 * di sidebar, menempel pada menu induknya (lihat SubMenuAdmin di Shell). Versi
 * sebelumnya memasang panel navigasi gelap di dalam area isi, dan itu keliru —
 * kotak navigasi yang mengambang di tengah halaman terbaca sebagai bagian dari
 * isi, bukan sebagai navigasi, sehingga halaman tampak punya dua sidebar yang
 * bersaing.
 *
 * Di ponsel sidebar-nya tidak ada, jadi di sana — dan hanya di sana — bagiannya
 * tampil sebagai baris chip di atas isi.
 *
 * Manager sengaja dibiarkan masuk, tapi hanya melihat Lokasi dan Audit Log —
 * keduanya memang wewenangnya (policy `lok_kelola` dan `audit_baca` di migrasi
 * 005). Pengelolaan akun, identitas platform, dan nilai bisnis khusus Admin.
 */
export default function HalamanAdmin() {
  const { pengguna, memuat } = usePenggunaAktif();
  const { bagian, setBagian } = useBagianAdmin();

  if (memuat) return <LayarMemuat />;
  if (!pengguna) return null;

  if (!isPengawas(pengguna.role)) {
    return (
      <div className="bg-white rounded-kartu border border-slate-200 max-w-lg mx-auto mt-8">
        <Kosong
          judul="Halaman ini bukan untuk peran Anda"
          keterangan="Admin Panel hanya terbuka untuk Manager dan Admin. Kalau Anda merasa ini keliru, hubungi Admin."
        />
      </div>
    );
  }

  const tersedia = bagianUntuk(pengguna.role);
  // Manager mendarat di bagian pertama yang memang boleh ia buka, bukan di
  // "Pengguna" yang tidak ada dalam daftarnya.
  const aktif = tersedia.find((b) => b.kunci === bagian) ?? tersedia[0];

  return (
    <div className="flex flex-col gap-4">

      {/* Navigasi bagian untuk layar sempit; di layar lebar tugas ini
          dipegang sub-menu sidebar. */}
      <nav aria-label="Bagian Admin Panel"
        className="sidebar:hidden flex gap-1.5 overflow-x-auto no-scrollbar bg-white rounded-kartu border border-slate-200 p-1.5">
        {tersedia.map((b) => {
          const ini = b.kunci === aktif.kunci;
          return (
            <button
              key={b.kunci} type="button" onClick={() => setBagian(b.kunci)}
              aria-current={ini ? 'true' : undefined}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-kontrol
                          text-[12px] font-semibold whitespace-nowrap transition-colors
                          ${ini ? 'bg-aksen-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <span aria-hidden="true">{b.ikon}</span>
              {b.label}
            </button>
          );
        })}
      </nav>

      <header className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-kontrol bg-aksen-50 border border-aksen-100 grid place-items-center text-[16px] flex-shrink-0"
          aria-hidden="true">
          {aktif.ikon}
        </span>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-tight">
            {aktif.judul}
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">{aktif.keterangan}</p>
        </div>
      </header>

      <div>
        {aktif.kunci === 'pengguna' && <TabPengguna pemanggilId={pengguna.id} />}
        {aktif.kunci === 'persetujuan' && <TabPersetujuan />}
        {aktif.kunci === 'lokasi' && <TabLokasi />}
        {aktif.kunci === 'tampilan' && <TabTampilan />}
        {aktif.kunci === 'konfigurasi' && <TabKonfigurasi />}
        {aktif.kunci === 'audit' && <TabAudit />}
      </div>
    </div>
  );
}
