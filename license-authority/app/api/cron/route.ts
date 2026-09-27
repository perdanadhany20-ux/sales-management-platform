import { NextResponse, type NextRequest } from 'next/server';
import { LicenseService } from '@/lib/license-service';
import { cocokBearer } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/cron — peringatan kedaluwarsa ke Telegram developer (Vercel Cron, CRON_SECRET). */
export async function GET(request: NextRequest) {
  if (!cocokBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const jumlah = await LicenseService.runExpiryNotices();
  return NextResponse.json({ ok: true, notices: jumlah });
}
