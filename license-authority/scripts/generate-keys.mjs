#!/usr/bin/env node
/**
 * Buat pasangan kunci Ed25519 untuk License Authority.
 *
 *   LICENSE_PRIVATE_KEY → HANYA di env License Authority (Vercel pusat).
 *   LICENSE_PUBLIC_KEY  → di env setiap deployment pelanggan.
 *
 * Keluaran dicetak ke terminal Anda sendiri; jangan di-commit.
 */
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

console.log('# License Authority (RAHASIA — server pusat saja)');
console.log(`LICENSE_PRIVATE_KEY=${priv}`);
console.log('');
console.log('# Setiap deployment pelanggan (publik, aman dibagikan)');
console.log(`LICENSE_PUBLIC_KEY=${pub}`);
console.log('');
console.log('# Rahasia acak tambahan (webhook Telegram, dashboard, cron)');
for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'CENTRAL_ADMIN_SECRET', 'CRON_SECRET']) {
  console.log(`${k}=${crypto.randomBytes(32).toString('base64url')}`);
}
