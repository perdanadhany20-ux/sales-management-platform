'use client';

import { useEffect } from 'react';
import { tanggalISO } from './format';
import type { Lonceng } from './use-lonceng';

/**
 * lib/notifikasi.ts — pengingat lewat notifikasi peramban.
 *
 * Kenapa notifikasi peramban dan bukan surel atau WhatsApp: keduanya menuntut
 * layanan pihak ketiga berbayar beserta kunci rahasianya, dan platform ini
 * belum punya. Notification API sudah ada di setiap peramban modern, berjalan
 * tanpa biaya, dan — yang terpenting — tidak menitipkan nomor telepon maupun
 * alamat surel siapa pun ke layanan luar.
 *
 * Batasnya jujur disebutkan ke pengguna di halaman Profil: pengingat hanya
 * muncul saat aplikasi sedang terbuka di salah satu tab. Menjanjikan lebih
 * dari itu tanpa service worker dan server push hanya akan membuat orang
 * mengandalkan sesuatu yang tidak pernah datang.
 */

const KUNCI_IZIN = 'smp_pengingat_aktif';

export type StatusPengingat = 'tidak_didukung' | 'mati' | 'ditolak' | 'menyala';

export function statusPengingat(): StatusPengingat {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'tidak_didukung';
  if (Notification.permission === 'denied') return 'ditolak';
  if (Notification.permission !== 'granted') return 'mati';
  return bacaPreferensi() ? 'menyala' : 'mati';
}

function bacaPreferensi(): boolean {
  try {
    return window.localStorage.getItem(KUNCI_IZIN) === '1';
  } catch {
    // Peramban dengan penyimpanan situs diblokir melempar di sini. Dianggap
    // mati, bukan dibiarkan meledak — pengingat bukan fitur yang boleh
    // menjatuhkan halaman.
    return false;
  }
}

function tulisPreferensi(aktif: boolean): void {
  try {
    window.localStorage.setItem(KUNCI_IZIN, aktif ? '1' : '0');
  } catch {
    /* penyimpanan diblokir — preferensinya hanya berlaku sampai tab ditutup */
  }
}

/** Minta izin ke peramban lalu nyalakan. Harus dipanggil dari klik pengguna:
 *  peramban menolak permintaan izin yang tidak berasal dari tindakan nyata. */
export async function nyalakanPengingat(): Promise<StatusPengingat> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'tidak_didukung';

  if (Notification.permission === 'default') {
    const hasil = await Notification.requestPermission();
    if (hasil !== 'granted') return hasil === 'denied' ? 'ditolak' : 'mati';
  }
  if (Notification.permission === 'denied') return 'ditolak';

  tulisPreferensi(true);
  return 'menyala';
}

export function matikanPengingat(): void {
  // Izin peramban TIDAK dicabut di sini — hanya aplikasi yang tahu caranya
  // mencabut izin adalah penggunanya sendiri lewat pengaturan situs. Yang
  // dimatikan preferensi kita, dan itu cukup: tanpa preferensi, tidak ada
  // satu pun notifikasi yang dikirim.
  tulisPreferensi(false);
}

/* ── Pengiriman ───────────────────────────────────────────────────────────── */

/**
 * Satu pengingat per jenis per hari.
 *
 * Tanpa penanda harian, setiap kali lencana disegarkan (tiga menit sekali)
 * pengingat yang sama akan muncul lagi — dan orang yang diganggu tiap tiga
 * menit akan mematikan notifikasi aplikasi ini selamanya, termasuk yang
 * benar-benar penting.
 */
function sudahDikirimHariIni(jenis: string): boolean {
  try {
    return window.localStorage.getItem(`smp_notif_${jenis}`) === tanggalISO();
  } catch {
    return true;
  }
}

function tandaiTerkirim(jenis: string): void {
  try {
    window.localStorage.setItem(`smp_notif_${jenis}`, tanggalISO());
  } catch {
    /* penyimpanan diblokir — risikonya pengingat berulang, bukan hilang */
  }
}

function kirim(jenis: string, judul: string, isi: string, tujuan: string): void {
  if (sudahDikirimHariIni(jenis)) return;

  try {
    const n = new Notification(judul, {
      body: isi,
      tag: `smp-${jenis}`,        // tag mencegah tumpukan notifikasi kembar
      icon: '/favicon.ico',
    });
    n.onclick = () => {
      window.focus();
      window.location.href = tujuan;
      n.close();
    };
    tandaiTerkirim(jenis);
  } catch {
    /* peramban menolak menampilkan — tidak ada yang bisa diperbuat di sini */
  }
}

/**
 * Kirim pengingat untuk hal-hal yang benar-benar menunggu tindakan.
 *
 * Sumber angkanya sama persis dengan lencana di header (lib/use-lonceng.ts),
 * sehingga notifikasi tidak akan pernah menyebut angka yang berbeda dari yang
 * terlihat di layar.
 */
export function usePengingat(lonceng: Lonceng, pengawas: boolean): void {
  useEffect(() => {
    if (statusPengingat() !== 'menyala') return;

    // Ditunda sebentar: memunculkan notifikasi tepat saat halaman baru selesai
    // dimuat menutupi hal pertama yang ingin dilihat orang.
    const timer = setTimeout(() => {
      if (lonceng.laporanBelum) {
        kirim('laporan',
          'Daily Report belum diisi',
          'Laporan harian Anda untuk hari ini belum masuk.',
          '/daily-report');
      }
      if (lonceng.meetingPerlu > 0) {
        kirim('meeting',
          `${lonceng.meetingPerlu} meeting menunggu`,
          'Check-in GPS dan foto bukti belum lengkap untuk hari ini.',
          '/meeting');
      }
      if (lonceng.terlewat > 0) {
        kirim('terlewat',
          `${lonceng.terlewat} jadwal lewat tanggal`,
          'Jadwal ini belum diselesaikan maupun dibatalkan.',
          '/schedule');
      }
      if (pengawas && lonceng.belumDitugaskan > 0) {
        kirim('penugasan',
          `${lonceng.belumDitugaskan} pengajuan menunggu penugasan`,
          'Ada pengajuan jadwal yang belum punya Sales pelaksana.',
          '/schedule');
      }
    }, 4000);

    return () => clearTimeout(timer);
  }, [lonceng, pengawas]);
}
