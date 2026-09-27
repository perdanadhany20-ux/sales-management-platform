import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Klien service role untuk Supabase PUSAT. SERVER-ONLY.
 * Database ini hanya berisi catatan kendali lisensi — tidak ada data bisnis pelanggan.
 */
let klien: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (klien) return klien;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diset.');
  klien = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return klien;
}

export async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
