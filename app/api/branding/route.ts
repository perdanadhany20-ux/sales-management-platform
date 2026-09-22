import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * Identitas visual platform, terbuka tanpa sesi.
 *
 * Halaman masuk membutuhkannya justru saat belum ada yang login, sehingga
 * tidak bisa lewat PostgREST: policy `settings_baca` hanya melayani peran
 * `authenticated`. Yang dikeluarkan di sini SATU baris pengaturan dan hanya
 * kunci `branding` — bukan seluruh isi sm_settings, yang juga memuat nilai
 * bisnis seperti ambang akurasi GPS.
 *
 * Penulisannya tidak ada di sini: mengubah branding tetap lewat PostgREST
 * dengan policy `settings_admin`, sehingga hanya Admin yang bisa.
 */
export async function GET() {
  const db = getAdminClient();

  const { data, error } = await db
    .from('sm_settings').select('value').eq('key', 'branding').maybeSingle();

  if (error) {
    return NextResponse.json({ branding: null }, { status: 200 });
  }

  return NextResponse.json(
    { branding: data?.value ?? null },
    // Nama dan logo nyaris tidak pernah berubah, tapi ketika berubah admin
    // ingin melihatnya segera. Satu menit cukup untuk meredam permintaan
    // berulang tanpa membuat perubahan terasa macet.
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  );
}
