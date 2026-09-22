import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * lib/supabase-admin.ts — klien service role. SERVER-ONLY.
 *
 * Kunci ini MELEWATI SELURUH RLS. Ia hanya boleh dipakai route handler untuk
 * hal-hal yang memang tidak bisa dilakukan atas nama user: memeriksa hash
 * password, membuat/menghapus baris sesi, dan mengelola akun.
 *
 * Jangan pernah mengimpor berkas ini dari komponen berlabel 'use client'.
 * Nama variabel lingkungannya sengaja tanpa awalan NEXT_PUBLIC_, sehingga
 * Next.js tidak akan pernah membundelnya ke browser walau impornya kelewat.
 */

let klien: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (klien) return klien;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diset.',
    );
  }

  klien = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return klien;
}
