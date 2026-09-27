#!/usr/bin/env node
/**
 * Daftarkan webhook bot ke License Authority.
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *   node scripts/set-telegram-webhook.mjs https://license.example.com
 * Hanya update `message` dan `callback_query` yang diterima.
 */
const [, , base] = process.argv;
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!base || !token || !secret) {
  console.error('Pakai: TELEGRAM_BOT_TOKEN=.. TELEGRAM_WEBHOOK_SECRET=.. node scripts/set-telegram-webhook.mjs https://domain-authority');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `${base.replace(/\/+$/, '')}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  }),
});
const data = await res.json();
console.log(data.ok ? 'Webhook terpasang.' : `Gagal: ${data.description}`);
