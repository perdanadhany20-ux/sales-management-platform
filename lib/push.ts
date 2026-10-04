// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import webpush from 'web-push';
import { getAdminClient } from './supabase-admin';

/**
 * lib/push.ts — kirim notifikasi push (Web Push / VAPID) dari server.
 *
 * Aktif hanya bila VAPID_PUBLIC_KEY & VAPID_PRIVATE_KEY diisi di Vercel
 * (buat dengan `npm run vapid`). Tanpa itu fitur push disembunyikan dan
 * pengingat dalam aplikasi tetap berjalan seperti biasa.
 *
 * Catatan: WebView aplikasi Android tidak mendukung Web Push; push bekerja di
 * Chrome/Edge/Firefox (komputer & HP) dan PWA yang dipasang dari peramban.
 */

export interface PesanPush {
  judul: string;
  isi: string;
  /** Halaman yang dibuka saat notifikasi diketuk. */
  url?: string;
  /** Notifikasi dengan tag sama saling menggantikan, bukan menumpuk. */
  tag?: string;
}

export function vapidPublik(): string | null {
  const k = process.env.VAPID_PUBLIC_KEY?.trim();
  return k && process.env.VAPID_PRIVATE_KEY?.trim() ? k : null;
}

let siap = false;
function pasang(): boolean {
  if (siap) return true;
  const pub = vapidPublik();
  if (!pub) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@localhost',
    pub, process.env.VAPID_PRIVATE_KEY!.trim(),
  );
  siap = true;
  return true;
}

interface Langganan { id: string; endpoint: string; p256dh: string; auth: string }

/**
 * Kirim ke semua perangkat milik para pengguna ini. Langganan yang sudah
 * mati (404/410 dari layanan push) dihapus. Mengembalikan jumlah terkirim.
 */
export async function kirimPush(userIds: string[], pesan: PesanPush, saring?: (l: Langganan & { user_id: string }) => boolean): Promise<number> {
  if (!pasang() || userIds.length === 0) return 0;
  const db = getAdminClient();
  const { data } = await db.from('sm_push_langganan')
    .select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds);
  const daftar = ((data ?? []) as (Langganan & { user_id: string })[]).filter((l) => !saring || saring(l));
  const muatan = JSON.stringify({ judul: pesan.judul, isi: pesan.isi, url: pesan.url ?? '/', tag: pesan.tag });
  let terkirim = 0;
  const mati: string[] = [];
  await Promise.all(daftar.map(async (l) => {
    try {
      await webpush.sendNotification({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } }, muatan,
        { TTL: 6 * 3600, urgency: 'normal' });
      terkirim++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) mati.push(l.id);
      else console.error('[push] gagal', status ?? (e instanceof Error ? e.message : e));
    }
  }));
  if (mati.length) await db.from('sm_push_langganan').delete().in('id', mati);
  return terkirim;
}

/** Kirim ke semua Admin aktif (mis. ada pendaftaran akun baru). */
export async function kirimPushAdmin(pesan: PesanPush): Promise<number> {
  if (!vapidPublik()) return 0;
  const { data } = await getAdminClient().from('users').select('id').eq('role', 'ADMIN').eq('active', true);
  return kirimPush((data ?? []).map((u: { id: string }) => u.id), pesan);
}

/** Ringkasan lonceng → kalimat notifikasi. null = tidak ada yang perlu. */
export function ringkasLonceng(l: {
  laporan_belum?: boolean; meeting_perlu?: number; terlewat?: number; belum_ditugaskan?: number; jadwal_hari_ini?: number;
} | null): PesanPush | null {
  if (!l) return null;
  const bagian: string[] = [];
  if (l.laporan_belum) bagian.push('laporan harian hari ini belum diisi');
  if (l.meeting_perlu) bagian.push(`${l.meeting_perlu} meeting menunggu check-in/foto`);
  if (l.terlewat) bagian.push(`${l.terlewat} jadwal lewat tanggal`);
  if (l.belum_ditugaskan) bagian.push(`${l.belum_ditugaskan} pengajuan jadwal belum ditugaskan`);
  if (bagian.length === 0) return null;
  const isi = bagian.join(', ');
  return {
    judul: `${bagian.length} hal perlu tindakan`,
    isi: isi.charAt(0).toUpperCase() + isi.slice(1) + '.',
    url: l.laporan_belum ? '/daily-report' : '/schedule',
    tag: 'lonceng',
  };
}
