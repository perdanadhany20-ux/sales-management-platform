import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';

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
  positions: ['Staff', 'Senior Staff', 'Supervisor', 'Manager', 'Senior Manager', 'Director'],
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
    return NextResponse.json({ opsi: BAWAAN });
  }

  const peta = Object.fromEntries(
    ((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
  );

  return NextResponse.json(
    { opsi: { ...BAWAAN, ...peta } },
    { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' } },
  );
}
