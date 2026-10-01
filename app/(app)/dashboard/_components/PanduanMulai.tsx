// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { diAplikasiAndroid } from '@/lib/aplikasi';
import { bukaProfil } from '@/lib/buka-profil';

/**
 * Panduan mulai — kartu "Mulai di sini" untuk akun yang baru memakai platform.
 *
 * Akun baru sebelumnya mendarat di Dashboard berisi deretan kartu "Rp 0" dan
 * "Belum ada data" tanpa petunjuk apa yang harus dikerjakan lebih dulu.
 * Kartu ini memberi urutan langkah yang jelas, dan setiap langkah tercentang
 * SENDIRI dari data yang benar-benar ada — bukan dari kotak yang dicentang
 * tangan — sehingga kartunya jujur dan hilang dengan sendirinya begitu semua
 * langkah benar-benar dikerjakan.
 *
 * Langkah yang menunya tidak boleh dibuka akun ini (peran atau lisensi) tidak
 * ditampilkan. "Sembunyikan" hanya kenyamanan per perangkat (localStorage).
 */

interface Langkah {
  kunci: string;
  judul: string;
  keterangan: string;
  selesai: boolean;
  href?: string;
  aksi?: () => void;
  label: string;
}

const KUNCI_SIMPAN = (uid: string) => `sm:panduan-disembunyikan:${uid}`;
const KUNCI_APLIKASI = (uid: string) => `sm:pernah-di-aplikasi:${uid}`;

function baca(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function tulis(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* mode privat */ } }

async function ada(q: PromiseLike<{ count: number | null }>): Promise<boolean> {
  try { return ((await q).count ?? 0) > 0; } catch { return false; }
}

export function PanduanMulai({ userId, peran, pengawas, admin, boleh }: {
  userId: string;
  peran: string;
  pengawas: boolean;
  admin: boolean;
  boleh: (menu: string) => boolean;
}) {
  const [langkah, setLangkah] = useState<Langkah[] | null>(null);
  const [sembunyi, setSembunyi] = useState(true);

  useEffect(() => {
    setSembunyi(baca(KUNCI_SIMPAN(userId)) === '1');
    if (diAplikasiAndroid()) tulis(KUNCI_APLIKASI(userId), '1');
  }, [userId]);

  useEffect(() => {
    let batal = false;
    (async () => {
      const hitung = (tabel: string) => supabase.from(tabel).select('id', { count: 'exact', head: true });
      const daftar: Langkah[] = [];

      if (pengawas) {
        // Langkah penyiapan tim — untuk Admin dan atasan.
        const [sales, lokasi, target, jadwal, struktur] = await Promise.all([
          admin ? ada(hitung('users').eq('role', 'SALES').eq('active', true)) : Promise.resolve(true),
          boleh('admin') ? ada(hitung('sm_locations')) : Promise.resolve(true),
          boleh('admin') ? ada(hitung('sm_sales_targets')) : Promise.resolve(true),
          boleh('schedule') ? ada(hitung('sm_schedules')) : Promise.resolve(true),
          admin ? ada(hitung('users').eq('role', 'SALES').not('manager_id', 'is', null)) : Promise.resolve(true),
        ]);
        if (admin) daftar.push({ kunci: 'sales', judul: 'Tambahkan tim Sales', keterangan: 'Buat akun untuk setiap Sales beserta perannya.', selesai: sales, href: '/admin?bagian=pengguna', label: 'Kelola pengguna' });
        if (admin) daftar.push({ kunci: 'struktur', judul: 'Atur atasan setiap Sales', keterangan: 'Struktur organisasi menentukan siapa melihat data siapa.', selesai: struktur, href: '/admin?bagian=struktur', label: 'Atur struktur' });
        if (boleh('admin')) daftar.push({ kunci: 'lokasi', judul: 'Daftarkan lokasi meeting', keterangan: 'Titik GPS dan radius yang diterima saat check-in.', selesai: lokasi, href: '/admin?bagian=lokasi', label: 'Tambah lokasi' });
        if (boleh('admin')) daftar.push({ kunci: 'target', judul: 'Tetapkan target Sales', keterangan: 'Target nilai & GP per bulan untuk tiap Sales.', selesai: target, href: '/admin?bagian=target', label: 'Isi target' });
        if (boleh('schedule')) daftar.push({ kunci: 'jadwal', judul: 'Buat & tugaskan jadwal pertama', keterangan: 'Kategori Meeting otomatis mewajibkan check-in GPS dan foto bukti.', selesai: jadwal, href: '/schedule', label: 'Buat jadwal' });
      } else {
        const [customer, laporan, peluang, meeting] = await Promise.all([
          boleh('customer') ? ada(hitung('sm_customers').eq('created_by', userId)) : Promise.resolve(true),
          boleh('daily-report') ? ada(hitung('sm_daily_reports').eq('sales_user_id', userId)) : Promise.resolve(true),
          boleh('pipeline') ? ada(hitung('sm_pipeline').eq('sales_user_id', userId)) : Promise.resolve(true),
          boleh('meeting') ? ada(hitung('sm_schedules').eq('assigned_to', userId).eq('status', 'COMPLETED')) : Promise.resolve(true),
        ]);
        const pernahAplikasi = diAplikasiAndroid() || baca(KUNCI_APLIKASI(userId)) === '1';
        if (boleh('meeting')) daftar.push({ kunci: 'aplikasi', judul: 'Pasang aplikasi Android', keterangan: 'Check-in lebih aman: lokasi dibaca langsung dari HP.', selesai: pernahAplikasi, aksi: bukaProfil, label: 'Unduh aplikasi' });
        if (boleh('customer')) daftar.push({ kunci: 'customer', judul: 'Tambahkan customer Anda', keterangan: 'Nama, kontak, dan alamat — riwayatnya menyatu otomatis.', selesai: customer, href: '/customer', label: 'Buka Customer' });
        if (boleh('daily-report')) daftar.push({ kunci: 'laporan', judul: 'Isi laporan harian pertama', keterangan: 'Aktivitas, hasil, dan next action — atasan langsung melihatnya.', selesai: laporan, href: '/daily-report', label: 'Isi laporan' });
        if (boleh('meeting')) daftar.push({ kunci: 'meeting', judul: 'Selesaikan meeting pertama', keterangan: 'Check-in GPS di lokasi, ambil 3 foto bukti, lalu selesaikan.', selesai: meeting, href: '/meeting', label: 'Buka Meeting' });
        if (boleh('pipeline')) daftar.push({ kunci: 'peluang', judul: 'Catat peluang pertama', keterangan: 'Nilai proyek & HPP — gross profit dihitung otomatis.', selesai: peluang, href: '/pipeline', label: 'Catat peluang' });
      }
      if (!batal) setLangkah(daftar);
    })();
    return () => { batal = true; };
  }, [userId, peran, pengawas, admin, boleh]);

  if (!langkah || langkah.length === 0) return null;
  const jumlahSelesai = langkah.filter((l) => l.selesai).length;
  if (jumlahSelesai === langkah.length || sembunyi) return null;
  const berikutnya = langkah.find((l) => !l.selesai);

  return (
    <section aria-label="Panduan mulai" className="bg-white rounded-kartu border border-aksen-200 p-4 sm:p-5 flex flex-col gap-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-aksen-700 uppercase tracking-wide">Mulai di sini</p>
          <h2 className="text-[15px] font-black text-slate-900 leading-tight mt-0.5">
            {pengawas ? 'Siapkan platform untuk tim Anda' : 'Langkah pertama Anda di platform ini'}
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {jumlahSelesai} dari {langkah.length} selesai — langkah tercentang otomatis begitu dikerjakan.
          </p>
        </div>
        <button type="button" onClick={() => { tulis(KUNCI_SIMPAN(userId), '1'); setSembunyi(true); }}
          className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 px-2 py-1.5 rounded-kontrol hover:bg-slate-100 flex-shrink-0">
          Sembunyikan
        </button>
      </div>

      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={langkah.length} aria-valuenow={jumlahSelesai}>
        <div className="h-full bg-aksen-600 rounded-full transition-all" style={{ width: `${(jumlahSelesai / langkah.length) * 100}%` }} />
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {langkah.map((l, i) => {
          const aktif = l === berikutnya;
          const isi = (
            <>
              <span aria-hidden="true"
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black flex-shrink-0
                  ${l.selesai ? 'bg-[#e0f2e0] text-[#008300]' : aktif ? 'bg-aksen-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {l.selesai ? '✓' : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-bold leading-tight ${l.selesai ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{l.judul}</span>
                <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{l.keterangan}</span>
                {!l.selesai && (
                  <span className={`inline-block mt-1.5 text-[11.5px] font-bold ${aktif ? 'text-aksen-700' : 'text-slate-500'}`}>{l.label} →</span>
                )}
              </span>
              <span className="sr-only">{l.selesai ? '(selesai)' : '(belum)'}</span>
            </>
          );
          const kelas = `flex items-start gap-2.5 rounded-kontrol border px-3 py-2.5 text-left w-full transition-colors min-h-[44px]
            ${aktif ? 'border-aksen-300 bg-aksen-50/60 hover:bg-aksen-50' : 'border-slate-200 hover:bg-slate-50'}`;
          return (
            <li key={l.kunci}>
              {l.selesai ? (
                <div className={kelas}>{isi}</div>
              ) : l.href ? (
                <Link href={l.href} className={kelas}>{isi}</Link>
              ) : (
                <button type="button" onClick={l.aksi} className={kelas}>{isi}</button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
