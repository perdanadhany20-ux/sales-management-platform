# Sales License Authority

Layanan pusat pengendali lisensi untuk semua deployment Sales Management Platform.
Isinya **hanya** kendali lisensi (deployment, lisensi, fitur, permintaan, audit) —
tidak ada data bisnis pelanggan.

Arsitektur lengkap, variabel lingkungan, dan checklist produksi:
[../LICENSE_ARCHITECTURE.md](../LICENSE_ARCHITECTURE.md).

```bash
npm install
npm run keys          # pasangan kunci Ed25519 + rahasia acak
npm run dev           # http://localhost:3100 (Basic Auth: developer / CENTRAL_ADMIN_SECRET)
npm run typecheck && npm run build
```

- Skema: `supabase/migrations/001_license_authority.sql` (proyek Supabase PUSAT).
- Uji: `supabase/tests/authority.sql` (jalankan di SQL Editor; diakhiri ROLLBACK).
- Webhook Telegram: `node scripts/set-telegram-webhook.mjs https://<domain>`.
- Deploy: proyek Vercel tersendiri, Root Directory = `license-authority`.
