// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/server-auth';
import { ajukanPendaftaran } from '@/lib/lisensi/server';
import { adalahPaket } from '@/lib/lisensi/kontrak';

export const dynamic = 'force-dynamic';

const DURASI_SAH = [30, 90, 180, 365, 730];

function teks(v: unknown, maks: number): string {
  return typeof v === 'string' ? v.trim().slice(0, maks) : '';
}

/**
 * POST /api/lisensi/pengajuan — platform yang belum punya Kode Aktivasi
 * mengajukan lisensi. Hanya diteruskan ke Telegram developer; Kode Aktivasi
 * tetap dikirim developer secara manual.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: 'Hanya Admin yang dapat mengajukan lisensi.' }, { status: 403 });

  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const perusahaan = teks(b.perusahaan, 160);
  const kontak = teks(b.kontak, 120);
  const trial = b.jenis === 'TRIAL';
  const durasi = Number(b.durasi_hari);
  if (perusahaan.length < 2) return NextResponse.json({ error: 'Nama perusahaan wajib diisi.' }, { status: 400 });
  if (kontak.length < 3) return NextResponse.json({ error: 'Kontak (WhatsApp/email) wajib diisi.' }, { status: 400 });
  if (!adalahPaket(b.paket)) return NextResponse.json({ error: 'Paket tidak dikenal.' }, { status: 400 });
  if (!trial && !DURASI_SAH.includes(durasi)) return NextResponse.json({ error: 'Durasi tidak sah.' }, { status: 400 });

  const h = await ajukanPendaftaran({
    perusahaan, kontak, paket: b.paket, trial, durasiHari: trial ? null : durasi, catatan: teks(b.catatan, 500) || null,
  }, { id: user.id, nama: user.full_name });
  return h.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: h.error, code: h.code }, { status: h.status });
}
