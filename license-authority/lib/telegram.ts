import crypto from 'crypto';
import { LABEL_PAKET, PAKET, type Paket } from '@kontrak/kontrak.ts';
import type { HasilAksi, InfoLisensi } from './types';

/**
 * TelegramApprovalService — satu-satunya tempat yang tahu soal Telegram (§19).
 *
 * Bot token dan daftar ID developer hanya ada di env License Authority;
 * deployment pelanggan tidak pernah melihatnya (§21). Bila env belum diisi,
 * semua pengiriman menjadi no-op — sistem lisensi tetap berjalan lewat
 * dashboard web.
 *
 * Format callback_data (≤ 64 byte, divalidasi ketat di webhook):
 *   ap:<request-uuid>              setujui permintaan
 *   rj:<request-uuid>              tolak permintaan (tanpa alasan)
 *   in:<LIC>                       tampilkan menu lisensi
 *   ex:<LIC>:<hari>:<nonce>        perpanjang
 *   su:<LIC>:<nonce>               tangguhkan
 *   re:<LIC>:<nonce>               aktifkan kembali
 *   rv:<LIC>                       minta konfirmasi cabut
 *   rk:<LIC>:<nonce>               cabut (terkonfirmasi)
 *   pk:<LIC>:<PAKET>:<nonce>       ubah paket
 * Nonce 6 heks per papan tombol menjadi kunci idempotensi: ketukan ganda
 * pada tombol yang sama tidak menerapkan tindakan dua kali (§49).
 */

const API = 'https://api.telegram.org';

function token(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? '';
}

export function idDeveloper(): number[] {
  return (process.env.TELEGRAM_DEVELOPER_ID ?? '')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isSafeInteger(n) && n > 0);
}

export function telegramAktif(): boolean {
  return Boolean(token()) && idDeveloper().length > 0;
}

/** Hanya ID numerik yang ada di allowlist — bukan username, bukan nama tampilan (§21). */
export function bolehBertindak(userId: unknown): boolean {
  return typeof userId === 'number' && idDeveloper().includes(userId);
}

export function cocokRahasiaWebhook(diterima: string | null): boolean {
  const harap = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (harap.length < 32 || !diterima || diterima.length !== harap.length) return false;
  return crypto.timingSafeEqual(Buffer.from(diterima), Buffer.from(harap));
}

export function nonce(): string {
  return crypto.randomBytes(3).toString('hex');
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function tgl(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

function sisaHari(iso: string | null): string {
  if (!iso) return '—';
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return h > 0 ? `${h} hari` : 'berakhir';
}

type Tombol = { text: string; callback_data: string };
export type Papan = Tombol[][];

async function panggil(metode: string, badan: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!token()) return null;
  try {
    const res = await fetch(`${API}/bot${token()}/${metode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(badan),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; result?: Record<string, unknown> } | null;
    if (!data?.ok) {
      // Token tidak pernah dicetak — hanya nama metodenya.
      console.error(`[telegram] ${metode} gagal (${res.status})`);
      return null;
    }
    return data.result ?? {};
  } catch {
    console.error(`[telegram] ${metode} tidak terjangkau`);
    return null;
  }
}

/** Kirim ke setiap developer di allowlist. Mengembalikan message_id pertama. */
export async function kirimKeDeveloper(teks: string, papan?: Papan): Promise<number | null> {
  if (!telegramAktif()) return null;
  let pertama: number | null = null;
  for (const chat of idDeveloper()) {
    const r = await panggil('sendMessage', {
      chat_id: chat, text: teks, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(papan ? { reply_markup: { inline_keyboard: papan } } : {}),
    });
    if (pertama === null && r && typeof r.message_id === 'number') pertama = r.message_id;
  }
  return pertama;
}

export async function balas(chatId: number, teks: string, papan?: Papan) {
  await panggil('sendMessage', {
    chat_id: chatId, text: teks, parse_mode: 'HTML', disable_web_page_preview: true,
    ...(papan ? { reply_markup: { inline_keyboard: papan } } : {}),
  });
}

export async function jawabCallback(id: string, teks: string) {
  await panggil('answerCallbackQuery', { callback_query_id: id, text: teks.slice(0, 190) });
}

/** Hapus tombol dari pesan yang sudah ditindaklanjuti supaya tidak diketuk lagi. */
export async function lepasTombol(chatId: number, messageId: number) {
  await panggil('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

/* ── Papan tombol ─────────────────────────────────────────────────────────── */

export function papanPermintaan(requestId: string): Papan {
  return [[
    { text: '✅ APPROVE', callback_data: `ap:${requestId}` },
    { text: '❌ REJECT', callback_data: `rj:${requestId}` },
  ]];
}

export function papanLisensi(info: InfoLisensi): Papan {
  const lic = info.license_code;
  const n = nonce();
  const baris: Papan = [[
    { text: '+30 DAYS', callback_data: `ex:${lic}:30:${n}` },
    { text: '+90 DAYS', callback_data: `ex:${lic}:90:${n}` },
    { text: '+1 YEAR', callback_data: `ex:${lic}:365:${n}` },
  ]];
  if (info.status === 'SUSPENDED') {
    baris.push([{ text: '▶ REACTIVATE', callback_data: `re:${lic}:${n}` }]);
  } else if (info.status !== 'REVOKED') {
    baris.push([{ text: '⏸ SUSPEND', callback_data: `su:${lic}:${n}` }]);
  }
  const paketLain = PAKET.filter((p) => p !== 'CUSTOM' && p !== info.package);
  baris.push(paketLain.map((p) => ({ text: `→ ${LABEL_PAKET[p]}`, callback_data: `pk:${lic}:${p}:${n}` })));
  if (info.status !== 'REVOKED') baris.push([{ text: '⛔ REVOKE', callback_data: `rv:${lic}` }]);
  return baris;
}

export function papanKonfirmasiCabut(lic: string): Papan {
  return [[
    { text: '⛔ Ya, cabut permanen', callback_data: `rk:${lic}:${nonce()}` },
    { text: 'Batal', callback_data: `in:${lic}` },
  ]];
}

/* ── Isi pesan (§19, §69) ─────────────────────────────────────────────────── */

function jumlahFitur(info: InfoLisensi): number {
  return Object.values(info.features ?? {}).filter(Boolean).length;
}

export function teksLisensi(info: InfoLisensi): string {
  return [
    `🔑 <b>${esc(info.company_name)}</b>`,
    `Deployment: <code>${esc(info.deployment_code)}</code>`,
    `License: <code>${esc(info.license_code)}</code>`,
    `Package: ${esc(LABEL_PAKET[info.package] ?? info.package)} · ${jumlahFitur(info)} fitur`,
    `Status: <b>${esc(info.status)}</b>`,
    `Valid: ${tgl(info.starts_at)} → ${tgl(info.expires_at)} (${sisaHari(info.expires_at)})`,
    `Last check: ${info.last_verified_at ? `${tgl(info.last_verified_at)} ${new Date(info.last_verified_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}` : '—'}`,
  ].join('\n');
}

export function teksPermintaanBaru(info: InfoLisensi, r: {
  id: string; kind: string; requested_package: Paket; duration_days: number | null; notes: string | null; requested_by: string | null;
}): string {
  const judul = r.kind === 'EXTENSION' ? 'LICENSE EXTENSION REQUEST'
    : r.kind === 'CHANGE_PACKAGE' ? 'LICENSE CHANGE REQUEST' : 'NEW LICENSE REQUEST';
  const durasi = r.duration_days
    ? (r.duration_days % 365 === 0 ? `${r.duration_days / 365} Year` : `${r.duration_days} Days`)
    : '—';
  return [
    `🔐 <b>${judul}</b>`,
    '',
    `Company:\n${esc(info.company_name)}`,
    '',
    `Deployment:\n<code>${esc(info.deployment_code)}</code>`,
    '',
    `License:\n${esc(LABEL_PAKET[r.requested_package] ?? r.requested_package)}${r.kind === 'CHANGE_PACKAGE' ? ` (now ${esc(LABEL_PAKET[info.package])})` : ''}`,
    '',
    `Duration:\n${durasi}`,
    '',
    `Requested:\n${tgl(new Date().toISOString())}${r.requested_by ? ` by ${esc(r.requested_by)}` : ''}`,
    r.notes ? `\nNotes:\n${esc(r.notes)}` : '',
    '',
    `Request ID: <code>${esc(r.id)}</code>`,
    'Tolak dengan alasan: <code>/reject ID alasan</code>',
  ].filter((x) => x !== undefined).join('\n');
}

export function teksHasil(h: HasilAksi): string | null {
  if (!h.ok || !h.license) return null;
  const l = h.license;
  const nama = esc(l.company_name);
  const paket = esc(LABEL_PAKET[l.package] ?? l.package);
  switch (h.action) {
    case 'APPROVED':    return `✅ <b>LICENSE APPROVED</b>\n\n${nama}\n${paket}\nValid until ${tgl(l.expires_at)}`;
    case 'REJECTED':    return `❌ <b>LICENSE REJECTED</b>\n\n${nama}\n${esc(LABEL_PAKET[h.requested_package ?? l.package])}`;
    case 'EXTENDED':    return `📅 <b>LICENSE EXTENDED</b>\n\n${nama}\nValid until ${tgl(l.expires_at)}`;
    case 'UPGRADED':    return `⬆ <b>LICENSE UPGRADED</b>\n\n${nama}\n${paket}`;
    case 'DOWNGRADED':  return `⬇ <b>LICENSE DOWNGRADED</b>\n\n${nama}\n${paket}`;
    case 'CHANGED':     return `✏ <b>LICENSE CHANGED</b>\n\n${nama}\n${paket}`;
    case 'SUSPENDED':   return `⏸ <b>LICENSE SUSPENDED</b>\n\n${nama}`;
    case 'REACTIVATED': return `▶ <b>LICENSE REACTIVATED</b>\n\n${nama}\nValid until ${tgl(l.expires_at)}`;
    case 'REVOKED':     return `⛔ <b>LICENSE REVOKED</b>\n\n${nama}`;
    default:            return null;
  }
}

export function teksKedaluwarsa(info: InfoLisensi & { stage: string }): string {
  if (info.stage === 'EXPIRED') return `⛔ <b>LICENSE EXPIRED</b>\n\n${esc(info.company_name)}\n<code>${esc(info.license_code)}</code>`;
  return `⚠ <b>LICENSE EXPIRING</b>\n\n${esc(info.company_name)}\n${sisaHari(info.expires_at)} remaining`;
}

export const TEKS_BANTUAN = [
  '<b>License Authority</b>',
  '/pending — permintaan menunggu',
  '/list [active|pending|expiring|expired|suspended|revoked]',
  '/info KODE — rincian + tombol tindakan (KODE = license atau deployment)',
  '/approve REQUEST_ID',
  '/reject REQUEST_ID [alasan]',
  '/extend KODE HARI',
  '/suspend KODE [alasan]',
  '/reactivate KODE',
  '/revoke KODE — meminta konfirmasi',
  '/package KODE STARTER|PROFESSIONAL|BUSINESS|ENTERPRISE',
  '/feature KODE fitur on|off — mengubah ke CUSTOM',
].join('\n');
