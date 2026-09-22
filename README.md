# Sales Management Platform

Platform pengelolaan aktivitas Sales: laporan harian, pipeline peluang,
penjadwalan, dan eksekusi meeting dengan verifikasi lokasi serta bukti foto.

---

## 1. Tujuan

Menggantikan pencatatan aktivitas Sales yang tersebar di spreadsheet dan
percakapan dengan satu sistem yang bisa dipertanggungjawabkan. Tiga hal yang
jadi alasan utamanya:

- **Laporan harian yang terukur** — bukan sekadar terkumpul, tapi bisa dilihat
  siapa yang belum mengirim, hari ini juga.
- **Pipeline dengan margin yang benar** — GP dan GP% dihitung database, jadi
  angka di layar manajer tidak pernah berbeda dari angka sebenarnya.
- **Meeting yang terbukti dihadiri** — kehadiran hanya sah bila lokasi
  terverifikasi dan bukti foto ada. Tidak ada jalan pintas, bahkan lewat
  pemanggilan API langsung.

## 2. Arsitektur

```text
Browser (Next.js App Router, React 18)
   │  cookie httpOnly  +  JWT PostgREST
   ▼
Route Handler (Node)  ──service role──►  Supabase (auth kustom, sesi)
   │
   └── klien Supabase browser ──JWT user──►  PostgREST ──► RLS ──► Postgres
                                                                    │
                                                RPC SECURITY DEFINER┘
                                                (check-in, penyelesaian)
```

Keputusan yang paling menentukan: **penegakan wewenang ada di database**, bukan
di frontend. Frontend menyembunyikan tombol demi antarmuka yang bersih; yang
benar-benar menolak akses adalah policy RLS dan fungsi `SECURITY DEFINER`.

## 3. Baseline Rujukan

Dibangun dengan mengadaptasi dua platform yang sudah berjalan:

| Dari | Yang diambil |
|---|---|
| **FieldServices Platform** | Verifikasi GPS server-side, migrasi berurutan, penerbit JWT PostgREST, pipeline evidence, alur mobile, palet sadar buta warna |
| **Work Management PTS IVP** | Pola Daily Report, Request Schedule beserta penugasan, ekspor Excel, arsitektur notifikasi |

Analisis lengkap beserta alasan tiap pilihan ada di
[`docs/BASELINE-ANALYSIS.md`](docs/BASELINE-ANALYSIS.md). Kedua baseline hanya
dibaca — tidak diubah, tidak di-commit, tidak di-deploy ulang.

## 4. Teknologi

Next.js 14.2 (App Router) · React 18.3 · TypeScript 5.7 · Tailwind 3.4 ·
Supabase (Postgres 17 + PostgREST + Storage) · bcryptjs · ExcelJS.

Grafik digambar sebagai SVG tanpa pustaka grafik — mengikuti pola dominan kedua
baseline dan memberi kendali penuh atas bentuk kartu bento.

## 5. Instalasi

```bash
npm install
cp .env.example .env.local   # lalu isi nilainya (lihat §6)
npm run dev
```

## 6. Variabel Lingkungan

| Nama | Sifat | Dari mana |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | publik | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publik | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **rahasia** | Supabase → Settings → API |
| `SUPABASE_JWT_SECRET` | **rahasia** | Supabase → Settings → API → JWT Secret |
| `NEXT_PUBLIC_APP_URL` | publik | URL publik aplikasi |

Dua yang bertanda rahasia tidak boleh diawali `NEXT_PUBLIC_` dan tidak boleh
masuk ke repositori. `SUPABASE_SERVICE_ROLE_KEY` melewati seluruh RLS;
`SUPABASE_JWT_SECRET` menandatangani token identitas — tanpanya setiap query
berangkat sebagai anon dan tabel akan terlihat kosong.

## 7. Penyiapan Supabase

Project terpisah dari kedua baseline (§94). Tidak perlu mengaktifkan Supabase
Auth — platform ini memakai autentikasi sendiri.

## 8. Migrasi

Terapkan berurutan dari `supabase/migrations/`:

| Berkas | Isi |
|---|---|
| `001_core_schema.sql` | users, kredensial, sesi, audit, pengaturan |
| `002_sales_schema.sql` | customer, kontak, Daily Report, Pipeline |
| `003_schedule_meeting_schema.sql` | lokasi, jadwal, kehadiran, evidence, jejak GPS, exception |
| `004_functions.sql` | helper identitas, Haversine, check-in, penyelesaian, override |
| `005_rls.sql` | seluruh policy RLS |
| `006_storage.sql` | bucket privat `evidence` + policy-nya |
| `007_seed_settings.sql` | nilai bisnis awal |
| `008_perketat_hak_eksekusi.sql` | penutupan temuan linter 0028/0029 |
| `009_dashboard.sql` | agregat dashboard satu panggilan |

## 9. RLS

Menyala di seluruh tabel. Ringkasnya:

- **Sales** — hanya data miliknya, plus jadwal yang ditugaskan kepadanya.
- **Manager/Admin** — visibilitas penuh, berhak menugaskan dan meng-override.
- **`user_credentials`, `user_sessions`, `login_attempts`** — tanpa policy sama
  sekali; hanya route handler lewat service role yang menyentuhnya.
- **`audit_trail`** — bisa disisipi, tidak bisa diubah maupun dihapus siapa pun.

Sales **tidak punya** policy UPDATE pada `sm_schedules`. Itu disengaja dan
menjadi inti aturan anti-bypass — lihat §11.

## 10. Storage

Bucket privat `evidence`, jalur `evidence/{user_id}/{schedule_id}/berkas.jpg`.
Kepemilikan terbaca dari jalurnya sendiri, sehingga policy cukup membandingkan
satu segmen. Tidak ada policy UPDATE: berkas bukti tidak boleh ditimpa.

## 11. Aturan Meeting

```text
Jadwal (kategori Meeting) → ditugaskan ke Sales
   → sm_check_in(): jadwal? penugasan? akurasi? radius?
   → foto bukti  → sm_complete_schedule(): periksa ulang semuanya
   → COMPLETED
```

Setiap percobaan check-in dicatat ke `sm_gps_events`, **termasuk yang ditolak**.
Tabel yang hanya berisi keberhasilan tidak bisa menjawab "apakah orang ini
berkali-kali mencoba dari luar radius" — padahal justru itu yang ingin
diketahui.

Override oleh Manager/Admin tersedia untuk kasus yang sah gagal, tapi menuntut
alasan tertulis dan meninggalkan baris permanen di `sm_exceptions`.

## 12. Pengguna & Peran

`SALES`, `MANAGER`, `ADMIN`. Akun pertama dibuat langsung di database dengan
hash bcrypt; selanjutnya lewat menu Administrasi.

## 13. Pengembangan Lokal

`npm run dev` · `npm run typecheck` · `npm run build`.

## 14–15. GitHub & Vercel

Repositori sendiri, terpisah dari baseline (§92). Deploy ke project Vercel
sendiri (§93) — push ke `main` memicu deployment otomatis. Empat variabel di §6
harus terpasang di Vercel sebelum deployment pertama bisa dipakai login.

## 16. Pengujian

```bash
# Uji keamanan alur meeting — 9 pemeriksaan, jalankan di SQL Editor Supabase
supabase/tests/keamanan.sql
```

Mencakup akses lintas-Sales, manipulasi status langsung, penyelesaian tanpa
check-in maupun foto, check-in di luar radius, dan akurasi GPS rendah. Skrip
tidak diakhiri COMMIT, jadi data ujinya hilang sendiri saat koneksi ditutup.

## 17. Batasan yang Diketahui

- **Middleware bukan lapisan keamanan.** Ia berjalan di edge runtime dan hanya
  memeriksa keberadaan cookie. Cookie palsu lolos dari sana, lalu berhenti di
  RLS. Penegakan sesungguhnya ada di database.
- **Akurasi GPS bergantung perangkat.** Ambang 100 m menyaring pembacaan buruk,
  tapi tidak bisa membuktikan seseorang benar-benar berada di sana — ia hanya
  membuat pemalsuan jauh lebih sulit (§81).
- **Belum ada notifikasi.** Arsitekturnya disiapkan, implementasinya belum.
- **Ekspor Excel belum terpasang** di seluruh modul.

## 18. Rencana Lanjutan

Notifikasi (WhatsApp/Telegram mengikuti pola Work Management), ekspor Excel per
modul, relasi Pipeline → Quotation → Project, dan pembungkus mobile.
