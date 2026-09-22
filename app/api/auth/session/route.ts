import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { issueDbToken } from '@/lib/db-token';

export const dynamic = 'force-dynamic';

/**
 * Identitas pengguna + token PostgREST yang baru.
 *
 * Dipanggil dua keadaan: saat halaman dimuat untuk memulihkan sesi, dan saat
 * token lama mendekati kedaluwarsa. Keduanya memakai satu jalur yang sama —
 * cookie sesi diverifikasi ulang ke database setiap kali, jadi akun yang baru
 * dinonaktifkan langsung berhenti mendapat token baru.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  }

  return NextResponse.json({ user, db_token: issueDbToken(user) });
}
