import crypto from 'crypto';

/**
 * lib/db-token.ts — penerbit JWT untuk PostgREST (server-only).
 *
 * Platform ini tidak memakai Supabase Auth; sesinya custom (bcrypt + tabel
 * user_sessions + cookie httpOnly). Akibatnya auth.uid() di dalam policy RLS
 * selalu NULL, dan policy terpaksa berbunyi USING (true) — alias RLS yang
 * hanya ada namanya.
 *
 * Jembatannya: login menerbitkan JWT bertanda tangan SUPABASE_JWT_SECRET
 * berisi identitas user. PostgREST memverifikasi tanda tangannya, lalu policy
 * bisa menulis syarat sungguhan lewat helper sm_uid()/sm_role():
 *
 *     USING (sales_user_id = public.sm_uid())
 *
 * BERBEDA DARI BASELINE — dan ini disengaja. FieldServices menerbitkan klaim
 * role 'anon' karena policy lamanya memang ditulis untuk peran itu; mengubahnya
 * di sana akan menutup tabel seketika. Platform ini tidak punya beban itu:
 * seluruh policy-nya ditulis TO authenticated sejak awal (migrasi 005), jadi
 * klaim role di bawah pun 'authenticated' — peran Postgres yang semestinya.
 * Mengubahnya jadi 'anon' akan membuat setiap query ditolak.
 */

const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

/**
 * Sengaja pendek. sm_role() membaca peran dari klaim token, bukan dari tabel
 * users, jadi akun yang dinonaktifkan, di-logout, atau diturunkan perannya
 * tetap memegang hak lamanya sampai tokennya habis. Pembaruan otomatis di
 * lib/supabase.ts lewat /api/auth/session memverifikasi ulang sesi, status
 * aktif, dan peran terkini — umur 10 menit membatasi celah itu ke 10 menit.
 */
const TOKEN_MENIT = 10;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface DbTokenUser {
  id: string;
  username: string;
  full_name?: string | null;
  role?: string | null;
}

/**
 * Terbitkan JWT HS256 untuk dipakai klien saat memanggil PostgREST.
 *
 * Mengembalikan null bila SUPABASE_JWT_SECRET belum diset. Dalam keadaan itu
 * aplikasi tetap bisa login, tapi setiap query berangkat sebagai anon dan akan
 * melihat tabel kosong — gagal yang kelihatan, bukan diam-diam terbuka.
 */
export function issueDbToken(user: DbTokenUser): string | null {
  if (!SECRET) return null;

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_MENIT * 60;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    role: 'authenticated',
    aud: 'authenticated',
    iat,
    exp,
    // Dibaca sm_role() di migrasi 004. Tanpa klaim ini setiap user terlihat
    // sebagai bukan siapa-siapa, dan seluruh cabang Manager/Admin pada policy
    // mati tanpa satu pun pesan error.
    user_role: (user.role ?? 'SALES').toUpperCase(),
    username: user.username,
    full_name: user.full_name ?? '',
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', SECRET).update(signingInput).digest();

  return `${signingInput}.${base64url(signature)}`;
}
