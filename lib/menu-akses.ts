import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * lib/menu-akses.ts — hak akses menu per peran/akun (§023).
 *
 * Dua tabel, satu aturan resolusi: kalau sebuah akun punya baris di
 * sm_user_menu, itulah daftar menunya — MENGGANTIKAN default perannya, bukan
 * digabung. Akun tanpa baris di sana memakai default sm_role_menu untuk
 * perannya. Itu yang membuat satu akun bisa dikecualikan dari kebiasaan
 * perannya (mis. satu Sales tertentu diberi akses GP Calculation) tanpa
 * mengubah peran orangnya atau default seluruh tim.
 */

export const MENU_KEYS = [
  'dashboard', 'daily-report', 'proyek', 'pipeline', 'schedule',
  'meeting', 'gp', 'activity', 'admin',
] as const;

export type MenuKey = typeof MENU_KEYS[number];

export const LABEL_MENU: Record<MenuKey, string> = {
  dashboard: 'Dashboard',
  'daily-report': 'Daily Report',
  proyek: 'Proyek',
  pipeline: 'Pipeline',
  schedule: 'Schedule',
  meeting: 'Meeting',
  gp: 'GP Calculation',
  activity: 'Activity',
  admin: 'Admin Panel',
};

/** Menu yang berlaku untuk SATU akun — dipakai Shell (sidebar & blokir
 *  halaman), profil (badge "Hak Akses Modul"), dan panel admin (pratinjau). */
export async function ambilMenuEfektif(userId: string, role: string): Promise<string[]> {
  const { data: sendiri } = await supabase
    .from('sm_user_menu').select('menu_key').eq('user_id', userId);
  if (sendiri && sendiri.length > 0) return sendiri.map((r: { menu_key: string }) => r.menu_key);

  const { data: bawaan } = await supabase
    .from('sm_role_menu').select('menu_key').eq('role', role);
  return (bawaan ?? []).map((r: { menu_key: string }) => r.menu_key);
}

const HREF_MENU: Record<MenuKey, string> = {
  dashboard: '/dashboard',
  'daily-report': '/daily-report',
  proyek: '/proyek',
  pipeline: '/pipeline',
  schedule: '/schedule',
  meeting: '/meeting',
  gp: '/gp',
  activity: '/activity',
  admin: '/admin',
};

/**
 * Halaman pertama yang dibuka akun ini setelah masuk.
 *
 * Sebelum §023, halaman masuk selalu mengarahkan ke /dashboard tanpa
 * syarat — aman selama semua orang memang boleh melihat Dashboard. Begitu
 * hak akses menu bisa dikustomisasi, akun yang justru tidak diberi
 * Dashboard akan mendarat langsung di layar "tidak tersedia" sesudah masuk,
 * kesan pertama yang buruk padahal akunnya valid. Fungsi ini mencari menu
 * PERTAMA (mengikuti urutan MENU_KEYS) yang benar tersedia untuk akun itu,
 * dan /profil sebagai jaring pengaman terakhir karena selalu terbuka untuk
 * siapa pun yang sudah masuk.
 */
export async function halamanAwal(userId: string, role: string): Promise<string> {
  const menu = await ambilMenuEfektif(userId, role);
  for (const kunci of MENU_KEYS) {
    if (menu.includes(kunci)) return HREF_MENU[kunci];
  }
  return '/profil';
}

/** null berarti masih memuat — pemanggil menahan render sampai ini terisi,
 *  supaya tidak sekilas menampilkan menu yang seharusnya terkunci. */
export function useMenuSaya(userId: string | undefined, role: string | undefined) {
  const [menu, setMenu] = useState<string[] | null>(null);

  useEffect(() => {
    if (!userId || !role) { setMenu(null); return; }
    let batal = false;
    setMenu(null);
    void ambilMenuEfektif(userId, role).then((m) => { if (!batal) setMenu(m); });
    return () => { batal = true; };
  }, [userId, role]);

  return menu;
}
