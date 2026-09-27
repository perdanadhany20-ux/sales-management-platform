# Arsitektur Lisensi — Sales Management Platform

## 1. Model deployment mandiri

```
SATU PELANGGAN = SATU DEPLOYMENT = SATU PROYEK VERCEL + SATU PROYEK SUPABASE + SATU LISENSI
```

- Kode sumber sama untuk semua pelanggan. Tidak ada branch atau fork per pelanggan.
- Setiap pelanggan punya Supabase sendiri: pengguna, customer, pipeline, jadwal, GP, dan foto tidak pernah
  bercampur dengan pelanggan lain.
- Aplikasi ini **bukan** SaaS multi-tenant. Satu-satunya sistem bersama adalah License Authority, dan
  isinya hanya catatan kendali lisensi.

```
Developer ──Telegram──► License Authority (Vercel + Supabase PUSAT, repo PRIVAT sales-license-authority)
                               ▲  token bertanda tangan Ed25519
          ┌────────────────────┼────────────────────┐
     Deployment A         Deployment B         Deployment C
  (Vercel A + Supabase A) (Vercel B + Supabase B) (Vercel C + Supabase C)
```

## 2. License Authority pusat

Kodenya ada di **repo privat terpisah** `sales-license-authority` milik developer (akun GitHub, Vercel, dan Supabase developer, bukan akun pelanggan), sebuah proyek Next.js tersendiri. Proyek ini dideploy ke **proyek Vercel
milik developer** dengan **proyek Supabase milik developer**. Proyek ini tidak ikut ter-deploy bersama
aplikasi pelanggan.

| Bagian | Berkas |
|---|---|
| Skema pusat & aturan transisi | `sales-license-authority/supabase/migrations/001_license_authority.sql` |
| LicenseService (satu jalur perubahan) | `sales-license-authority/lib/license-service.ts` |
| TelegramApprovalService | `sales-license-authority/lib/telegram.ts` |
| API deployment | `POST /api/v1/verify`, `POST /api/v1/requests`, `POST /api/v1/requests/cancel` |
| Webhook Telegram | `POST /api/telegram/webhook` |
| Peringatan kedaluwarsa | `GET /api/cron` (Vercel Cron harian) |
| Dashboard developer | `/`, `/l/<LIC>`, `/register` (Basic Auth) |

Isi database pusat: `deployments`, `licenses`, `license_features`, `license_requests`, `license_audit_logs`,
`processed_actions`. Database pusat **tidak** menyimpan data bisnis pelanggan, sandi pengguna, maupun foto.

Kontrak bersama (daftar fitur, paket, aturan status, format token) ada di `lib/lisensi/kontrak.ts` dan
`lib/lisensi/tanda-tangan.ts`. Aplikasi pelanggan dan Authority mengimpor berkas yang **sama**, bukan salinannya.

## 3. Siklus hidup lisensi

| Status | Arti | Disimpan / diturunkan |
|---|---|---|
| `PENDING` | Terdaftar, belum disetujui | disimpan |
| `ACTIVE` | Disetujui dan masih dalam masa berlaku | disimpan |
| `EXPIRING_SOON` | Aktif, ≤ 30 hari lagi | diturunkan dari `expires_at` |
| `EXPIRED` | Masa berlaku habis | diturunkan dari `expires_at` |
| `SUSPENDED` | Ditangguhkan sementara oleh developer | disimpan |
| `REVOKED` | Dicabut permanen (terminal) | disimpan |

Status permintaan dipisah dari status lisensi: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`,
`CANCELLED`. Jenis permintaan: `NEW`, `EXTENSION`, `CHANGE_PACKAGE`. Setiap deployment hanya boleh punya
satu permintaan yang menunggu. Batas ini dijaga oleh unique index.

Transisi yang ditegakkan database:

- `REVOKED` bersifat final. Lisensi ini tidak bisa diperpanjang, diaktifkan ulang, atau diubah paketnya.
- `REACTIVATE` hanya berlaku dari `SUSPENDED`.
- Perpanjangan dihitung dari yang lebih besar antara `expires_at` dan sekarang.

## 4. Hak fitur (paket ≠ otorisasi)

Aplikasi selalu bertanya "apakah fitur ini aktif?". Aplikasi tidak pernah bertanya "paketnya apa?".
Paket hanyalah preset. Yang disimpan dan ditandatangani adalah peta fitur per lisensi.

| Fitur (`key`) | Starter | Professional | Business | Enterprise |
|---|:-:|:-:|:-:|:-:|
| `dashboard` | ✓ | ✓ | ✓ | ✓ |
| `customer` | ✓ | ✓ | ✓ | ✓ |
| `sales_activity` | ✓ | ✓ | ✓ | ✓ |
| `daily_report` | ✓ | ✓ | ✓ | ✓ |
| `pipeline` | — | ✓ | ✓ | ✓ |
| `meeting` | — | ✓ | ✓ | ✓ |
| `schedule` | — | ✓ | ✓ | ✓ |
| `project` | — | — | ✓ | ✓ |
| `gp_calculation` | — | — | ✓ | ✓ |
| `advanced_reporting` | — | — | ✓ | ✓ |
| `approval` | — | — | — | ✓ |
| `admin_settings` | ✓ | ✓ | ✓ | ✓ |
| `notifications` | ✓ | ✓ | ✓ | ✓ |

`CUSTOM` tidak punya preset. Fiturnya dipilih satu per satu, lewat dashboard atau
`/feature KODE fitur on|off` di Telegram.

### Pemetaan modul

| Fitur | Menu / rute | Tabel (RLS restrictive + trigger) | Route handler |
|---|---|---|---|
| dashboard | `/dashboard` (kartu modul lain ikut hak modulnya) | — | — |
| customer | pemilih customer | `sm_customers`, `sm_contacts` | — |
| sales_activity | `/activity` | (bersumber dari tabel modul lain) | — |
| daily_report | `/daily-report` | `sm_daily_reports` | — |
| pipeline | `/pipeline`, Admin → Target Sales, kartu Target/Pipeline di Dashboard | `sm_pipeline`, `sm_sales_targets` | — |
| schedule | `/schedule` | `sm_schedules` (bersama meeting) | — |
| meeting | `/meeting`, Admin → Lokasi | `sm_attendance`, `sm_evidence`, `sm_gps_events`, `sm_exceptions`, `sm_locations`*, storage `evidence` | `/api/admin/locations`* |
| project | `/proyek` | `sm_projects`, `sm_locations`* | `/api/lokasi`* |
| gp_calculation | `/gp` | `sm_gp_calculations`, `sm_gp_items` (+ RPC `sm_gp_*`) | — |
| advanced_reporting | tombol **Ekspor Excel** di semua modul | — (UI) | — |
| approval | Admin → Persetujuan Akun, formulir daftar | — | `/api/auth/register`, `/api/opsi-pendaftaran` |
| admin_settings | `/admin` | — | `/api/admin/users` |
| notifications | lonceng header | — | — |

\* cukup salah satu fitur aktif, yaitu meeting **atau** project.

### Peran + lisensi

```
akses = hak PERAN (sm_role_menu / sm_user_menu)  DAN  hak LISENSI
```

Lisensi tidak pernah membuka menu yang tidak diberikan oleh peran pengguna. Sebaliknya, peran juga tidak
pernah membuka modul yang tidak berlisensi. Aturan ini diterapkan di `ambilMenuEfektif()`
(`lib/menu-akses.ts`), jadi sidebar, bilah bawah ponsel, halaman awal setelah login, dan badge profil
semuanya ikut. Jika sebuah URL modul yang tidak berlisensi diketik langsung, halaman menampilkan
**"Fitur tidak tersedia"**. Pada saat yang sama database menolak datanya.

## 5. Alur persetujuan Telegram

```
Admin pelanggan → Admin → Lisensi → Ajukan
      → POST /api/lisensi/permintaan (server pelanggan)
      → POST {Authority}/api/v1/requests  (Bearer kunci deployment)
      → license_requests = PENDING_APPROVAL
      → Telegram developer:  🔐 NEW LICENSE REQUEST  [✅ APPROVE] [❌ REJECT]
Developer APPROVE
      → LicenseService.approve() → la_approve_request() → DB + audit → "✅ LICENSE APPROVED"
Deployment verifikasi berikutnya (≤ 5 menit selama ada permintaan menunggu)
      → token baru → fitur muncul, notifikasi "Lisensi disetujui" di lonceng Admin
```

Perintah bot yang tersedia: `/pending`, `/list [status]`, `/info KODE` (menampilkan tombol +30 hari,
+90 hari, +1 tahun, Suspend/Reactivate, ganti paket, dan Revoke dengan konfirmasi), `/approve ID`,
`/reject ID alasan`, `/extend KODE HARI`, `/suspend KODE`, `/reactivate KODE`, `/revoke KODE`,
`/package KODE PAKET`, dan `/feature KODE fitur on|off`.

Telegram dan dashboard web memanggil fungsi `LicenseService` yang **sama**, sehingga sumber kebenarannya
hanya satu.

## 6. Variabel lingkungan

**Deployment pelanggan** (Vercel pelanggan, semuanya server-only):

| Variabel | Keterangan |
|---|---|
| `LICENSE_AUTHORITY_URL` | URL License Authority |
| `LICENSE_DEPLOYMENT_ID` | mis. `SMA-ABC-2026-001` |
| `LICENSE_ID` | mis. `LIC-SMA-2026-0001` |
| `LICENSE_DEPLOYMENT_KEY` | rahasia; ditampilkan sekali saat registrasi |
| `LICENSE_PUBLIC_KEY` | kunci publik Ed25519 |
| `LICENSE_MODE` | `production` (bawaan) / `development` (hanya berlaku di `next dev`) |
| `CRON_SECRET` | untuk `/api/lisensi/cron` |

**License Authority** (Vercel developer, semuanya server-only): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (Supabase pusat), `LICENSE_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_DEVELOPER_ID` (ID numerik, boleh dipisah koma), `TELEGRAM_WEBHOOK_SECRET`,
`CENTRAL_ADMIN_SECRET`, dan `CRON_SECRET`.

Tidak ada satu pun variabel di atas yang diawali `NEXT_PUBLIC_`. `LICENSE_PRIVATE_KEY` dan
`TELEGRAM_BOT_TOKEN` tidak pernah ada di deployment pelanggan.

## 7. Model keamanan

| Ancaman | Penangkal |
|---|---|
| Admin pelanggan menambah fitur atau memperpanjang masa berlaku | `sm_lisensi` tanpa policy dan tanpa grant untuk `authenticated`/`anon`. Diuji di `keamanan-lisensi.sql` #4–6 |
| Mengetik URL modul yang tidak berlisensi | Layar "Fitur tidak tersedia" **dan** policy RESTRICTIVE yang menolak data |
| Melewati RLS lewat RPC `SECURITY DEFINER` | Trigger per pernyataan `lisensi_jaga` tetap menyala di dalam fungsi DEFINER (uji #9) |
| Route handler memakai service role | `tolakJikaTakBerlisensi()` / `fiturTersedia()` di `/api/lokasi`, `/api/admin/*`, `/api/auth/register` |
| Mengubah localStorage atau state React | Nilai di klien hanya dipakai untuk menggambar tampilan. Data tetap ditolak database |
| Memalsukan respons Authority | Token Ed25519. Kunci privat hanya ada di pusat |
| Memutar ulang respons lama | Token memuat `nonce` permintaan dan `verified_at` (toleransi ±10 menit) |
| Menyunting salinan `sm_lisensi` langsung di DB | Server memeriksa ulang tanda tangan setiap kali membaca. Jika tidak cocok, status ditandai `INVALID` dan akses ditutup |
| Menebak kode deployment | Setiap ketidakcocokan dijawab dengan `401` yang sama. Pusat hanya menyimpan hash SHA-256 kunci. Batas 30 permintaan/menit |
| Pengguna Telegram asing menekan APPROVE | Hanya `from.id` di `TELEGRAM_DEVELOPER_ID` yang diterima. Header `secret_token` wajib |
| Webhook Telegram dikirim ulang atau tombol diketuk dua kali | `update_id` diklaim sekali. Tombol membawa nonce yang menjadi kunci idempotensi, dan status permintaan diperiksa ulang |
| Authority mati sehingga semua fitur terbuka | Tidak mungkin. Kondisi gagal selalu jatuh ke `FITUR_SAAT_TERBATAS` (§8) |
| Audit dihapus | Trigger `license_audit_logs_hanya_tambah` |

RLS yang sudah ada tidak dilonggarkan. Policy lisensi bersifat **RESTRICTIVE**, sehingga hanya
menambahkan syarat pada policy lama (uji #10: Sales B tetap tidak melihat laporan Sales A).

## 8. Verifikasi, cache, dan masa tenggang

- Verifikasi terjadi saat `/api/lisensi` dipanggil dan salinannya sudah jatuh tempo: setiap 24 jam, atau
  setiap 5 menit selama ada permintaan yang menunggu. Cron harian `/api/lisensi/cron` juga memicunya.
  Tidak ada verifikasi di setiap halaman. Server menyimpan cache 30 detik per instance, browser 5 menit.
- Jika Authority tidak terjangkau, token terakhir yang sah tetap dipakai sampai
  `last_verified_at + 7 hari`. Setelah itu platform masuk **keadaan terbatas**.
- **Keadaan terbatas** (belum ada lisensi, PENDING, EXPIRED, SUSPENDED, REVOKED, token tidak sah, atau
  melewati masa tenggang): hanya `admin_settings` dan `notifications` yang tetap aktif. Admin masih bisa
  membuka Admin → Lisensi dan mengajukan permintaan. Aturan ini hanya didefinisikan di dua tempat:
  `FITUR_SAAT_TERBATAS` (`kontrak.ts`) dan `sm_fitur_berlisensi()` (migrasi 037).
- Kedaluwarsa ditegakkan oleh jam database sendiri (`expires_at > now()`), jadi tetap berlaku walaupun
  server tidak pernah memeriksa ulang.

## 9. Upgrade / downgrade

Perubahan paket, perubahan fitur, atau perpanjangan **tidak memerlukan redeploy**. Semuanya terbawa oleh
token berikutnya. Downgrade hanya menutup akses: tidak ada baris yang dihapus dan tidak ada tabel yang
diubah. Jika fitur diaktifkan lagi, datanya muncul kembali utuh (uji #11–12). Kedaluwarsa juga tidak
pernah menghapus data.

### 9a. Satu lisensi tidak bisa dipakai ulang — ganti = lisensi baru

- **Perubahan paket/fitur atau trial → penuh selalu menerbitkan lisensi BARU** (kode lisensi dan kunci
  baru, `la_reissue`). Lisensi lama berstatus `REPLACED` (final, dijaga trigger `licenses_diganti_final`)
  dan tidak bisa diperpanjang, diaktifkan kembali, atau dipakai di platform mana pun.
- **Serah-terima otomatis:** Kode Aktivasi pengganti disimpan di pusat (`handover_code`). Saat platform
  yang sah memverifikasi dengan lisensi lama, token bertanda tangan membawa `pengganti`. Platform
  memverifikasi kode itu ke pusat, menyimpannya (`deployment_key` di `sm_lisensi`), dan mencatat audit
  `license_replaced`. Setelah lisensi pengganti dipakai pertama kali, `handover_code` dihapus. Kode baru
  juga dikirim ke Telegram developer sebagai cadangan.
- **Satu platform = satu deployment:** `deployments.instance_hash` unik. Kode dari pendaftaran lain di
  platform yang sudah terdaftar ditolak (`PLATFORM_TAKEN` → `LICENSE_PLATFORM_TAKEN`), sehingga trial
  tidak bisa diulang dengan kode trial baru. Kode lama yang sudah `REPLACED` ditolak di form aktivasi
  (`LICENSE_REPLACED`).
- **Perpanjangan** (+30/+90/+1 tahun) tetap memakai lisensi yang sama.

### 9b. Lisensi TRIAL

`license_type = 'TRIAL'` dengan jumlah hari bebas (1–3660) yang dipilih developer saat registrasi.
Status TRIAL diperlakukan sama seperti lisensi aktif (fitur sesuai paket), ditandai badge TRIAL di
Admin → Lisensi, dengan peringatan "Masa trial berakhir N hari lagi". Admin pelanggan dapat mengajukan
lisensi penuh; developer menyetujui lewat Telegram (**⭐ Trial → Penuh**) atau dashboard.

## 10. Registrasi deployment & Kode Aktivasi

1. Di dashboard Kantor Pusat, buka **Registrasi deployment**: isi nama perusahaan, paket (fitur otomatis
   sesuai paket; manual hanya untuk Custom), durasi, dan pilih apakah langsung aktif.
2. Kantor Pusat menerbitkan satu **Kode Aktivasi** (`SMPA1-…`) yang memuat Deployment ID, License ID, dan
   kunci deployment. Kode ditampilkan sekali; pusat hanya menyimpan hash kuncinya.
3. Admin pelanggan menempelnya di **Admin → Lisensi → Aktifkan**. Kode diverifikasi ke Kantor Pusat dan baru
   disimpan (di `sm_lisensi`, migrasi 038) bila diakui. Tidak perlu env lisensi per pelanggan: alamat dan
   kunci PUBLIK Kantor Pusat sudah bawaan kode (`PUSAT_BAWAAN` di `lib/lisensi/server.ts`).
4. **Satu kode = satu platform.** Verifikasi pertama mengikat kode ke sidik jari Supabase pelanggan
   (`instance_id`); platform lain yang memakai kode yang sama ditolak (`LICENSE_IN_USE`). Pelanggan pindah
   server → developer menekan **Lepas ikatan platform** di dashboard atau `/unbind KODE` di Telegram.
5. Alternatif developer: isi `LICENSE_DEPLOYMENT_ID`, `LICENSE_ID`, `LICENSE_DEPLOYMENT_KEY` di Vercel
   pelanggan — bila terisi, env menang atas Kode Aktivasi.

### 10a. Pengajuan dari platform yang belum punya kode

Admin → Lisensi menampilkan formulir **Ajukan lisensi** selama platform belum punya Kode Aktivasi
(`POST /api/lisensi/pengajuan`, hanya Admin → Kantor Pusat `POST /api/v1/enroll`). Kantor Pusat hanya
meneruskannya ke Telegram developer (tanpa menyimpan atau menerbitkan apa pun, tanpa mengembalikan
kode). Kode Aktivasi tetap dibuat developer lewat dashboard dan dikirim manual ke pelanggan. Dibatasi
1 pengajuan per platform per 15 menit dan 20 per jam secara total.

## 11. Pengembangan lokal

Isi `LICENSE_MODE=development` di `.env.local`. Nilai ini **hanya** berlaku di `next dev`
(`NODE_ENV !== 'production'`). Dengan mode ini, semua fitur terbuka dan Authority tidak dihubungi.

Build produksi selalu mengabaikan nilai ini dan mencatat peringatan. Jika database produksi kedapatan
berisi baris `mode = 'development'`, server mengosongkannya pada pembacaan berikutnya. Tidak ada kata sandi
induk, URL rahasia, atau saklar localStorage.

## 12. Pemecahan masalah

| Gejala | Penyebab / tindakan |
|---|---|
| Semua modul hilang, banner "Lisensi belum diaktifkan" | Env `LICENSE_*` belum lengkap, atau belum pernah terverifikasi. Periksa Admin → Lisensi → "Pemeriksaan terakhir" |
| "Lisensi tidak dapat dipastikan" | `LICENSE_PUBLIC_KEY` tidak berpasangan dengan `LICENSE_PRIVATE_KEY` pusat, atau ID deployment/lisensi salah ketik |
| "Pemeriksaan lisensi tertunda" | Authority tidak terjangkau. Platform tetap berjalan sampai 7 hari. Periksa deployment pusat |
| Persetujuan belum terlihat | Tekan **Periksa sekarang** di Admin → Lisensi (dibatasi sekali per 10 detik) |
| Bot Telegram diam | Periksa `setWebhook` (`sales-license-authority/scripts/set-telegram-webhook.mjs`), `TELEGRAM_WEBHOOK_SECRET`, dan apakah ID Anda ada di `TELEGRAM_DEVELOPER_ID` |
| Galat "Fitur ini tidak termasuk dalam lisensi" saat menyimpan | Database menolak penulisan ke modul yang tidak berlisensi. Ini perilaku yang diharapkan |

## 13. Checklist produksi

**Sekali (developer):**

1. Buat proyek Supabase **pusat**, lalu jalankan `sales-license-authority/supabase/migrations/001_license_authority.sql`.
2. Jalankan `npm run keys` di repo sales-license-authority. Simpan `LICENSE_PRIVATE_KEY` di tempat aman dan catat
   `LICENSE_PUBLIC_KEY`.
3. Buat proyek Vercel (akun developer) dari repo privat sales-license-authority, Root Directory dibiarkan
   kosong. Isi env seperti di §6.
4. Buat bot di @BotFather. Masukkan `TELEGRAM_BOT_TOKEN` ke env Vercel pusat. Jangan pernah menaruhnya di
   repo, karena repo ini publik.
5. Isi `TELEGRAM_DEVELOPER_ID` dengan ID numerik Telegram Anda (bisa dilihat lewat @userinfobot).
6. Jalankan `node scripts/set-telegram-webhook.mjs https://<domain-authority>` untuk memasang webhook.
7. Kirim `/help` ke bot untuk memastikan bot menjawab.

**Per pelanggan:**

1. Registrasi deployment (§10).
2. Isi env `LICENSE_*` dan `CRON_SECRET` di Vercel pelanggan.
3. Terapkan migrasi pelanggan sampai 037 dan jalankan `supabase/tests/keamanan-lisensi.sql` (semua baris
   `lulus = t`).
4. Deploy. Buka Admin → Lisensi, pastikan statusnya Aktif dan fiturnya sesuai.
5. Jika lisensi didaftarkan sebagai PENDING, Admin pelanggan mengajukan permintaan, lalu Anda menekan
   **APPROVE** di Telegram.
