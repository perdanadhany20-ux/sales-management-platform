// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { DAFTAR_POSISI } from '@/lib/posisi';
import { fiturTersedia } from '@/lib/lisensi/server';

export const dynamic = 'force-dynamic';

/**
 * Pilihan Divisi, Sales Division, dan Jabatan untuk formulir pendaftaran.
 *
 * Terbuka tanpa sesi karena yang membukanya menurut definisinya belum punya
 * akun. Yang dikeluarkan HANYA empat kunci pengaturan yang memang berisi
 * daftar pilihan — bukan seluruh isi sm_settings, yang juga memuat ambang
 * akurasi GPS dan nilai bisnis lain yang tidak ada urusannya dengan orang
 * yang sedang mendaftar.
 */

const KUNCI = ['divisions', 'sales_divisions', 'positions', 'registration_open'] as const;

const BAWAAN: Record<string, unknown> = {
  divisions: ['Sales', 'Marketing', 'Teknis', 'Finance', 'Operasional', 'Manajemen'],
  sales_divisions: ['Corporate', 'Government', 'Retail', 'Project', 'Channel Partner'],
  positions: [...DAFTAR_POSISI],
  registration_open: true,
};

export async function GET() {
  const db = getAdminClient();

  const { data, error } = await db
    .from('sm_settings').select('key, value').in('key', KUNCI as unknown as string[]);

  if (error) {
    // Formulir tetap bisa dipakai dengan pilihan bawaan; menolak melayani
    // hanya karena pengaturannya gagal dibaca berarti menutup pendaftaran
    // untuk alasan yang tidak ada hubungannya dengan pendaftar.
    return NextResponse.json({ opsi: { ...BAWAAN, registration_open: await fiturTersedia('approval') } });
  }

  const peta: Record<string, unknown> = Object.fromEntries(
    ((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
  );
  // Tanpa lisensi `approval`, formulir daftar tampil sebagai "ditutup".
  if (!(await fiturTersedia('approval'))) peta.registration_open = false;

  return NextResponse.json(
    // Posisi selalu jenjang baku, apa pun isi pengaturannya: urutannya
    // menentukan pohon organisasi, jadi tidak boleh berbeda dari lib/posisi.ts.
    { opsi: { ...BAWAAN, ...peta, positions: [...DAFTAR_POSISI] } },
    { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' } },
  );
}
