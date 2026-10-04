# Sales Management Platform

> **Hak Cipta © 2026 DWP. Seluruh hak dilindungi.**
> Repositori ini dapat dilihat publik hanya untuk keperluan penyimpanan dan
> penerapan — **bukan izin untuk menyalin, mengubah, menjalankan, atau
> mendistribusikan**. Seluruh kode dilindungi UU No. 28 Tahun 2014 tentang Hak
> Cipta. Ketentuan lengkap: [LICENSE](LICENSE).

Platform pengelolaan aktivitas Sales: laporan harian, proyek, pipeline peluang,
penjadwalan, eksekusi meeting dengan verifikasi lokasi dan bukti foto,
perhitungan GP berjenjang, serta target penjualan per Sales.

---

## 1. Tujuan

Menggantikan pencatatan aktivitas Sales yang tersebar di spreadsheet dan
percakapan dengan satu sistem yang bisa dipertanggungjawabkan:

- **Laporan harian yang terukur** — terlihat siapa yang belum mengirim, hari
  ini juga. Satu Sales boleh mengirim beberapa laporan per hari.
- **Pipeline dengan margin yang benar** — GP dan GP% dihitung database, jadi
  angka di layar manajer tidak pernah berbeda dari angka sebenarnya.
- **Meeting yang terbukti dihadiri** — kehadiran hanya sah bila lokasi
  terverifikasi, tidak menunjukkan ciri lokasi palsu, dan bukti foto ada.
- **Target yang terlihat** — capaian tiap Sales terhadap target bulan,
  kuartal, atau tahun, dihitung dari pipeline yang WON.

## 2. Modul

| Modul | Isi |
|---|---|
| Dashboard | Agenda & tindak lanjut hari ini, ringkasan tim, tren, kepatuhan laporan, GP, pencapaian target, antrian persetujuan GP (paling atas untuk Finance) |
| Daily Report | Laporan kunjungan harian, ekspor Excel; tetap bisa disimpan saat offline dan terkirim otomatis saat online |
| Proyek | Induk yang mengikat pipeline, jadwal, dan GP satu proyek |
| Pipeline | Peluang, probabilitas, tahapan, estimasi closing |
| Schedule | Pengajuan & penugasan jadwal, status terlewat otomatis |
| Meeting | Check-in GPS, foto bukti, penyelesaian, override pengawas |
| GP Calculation | Hitung GP dari item, persetujuan Manager → Director → Finance |
| Activity | Jejak seluruh modul, termasuk check-in yang ditolak |
| Laporan | Tren bulanan, target vs realisasi, peringkat Sales, ekspor Excel (lisensi Advanced Reporting) |
| Admin Panel | Pengguna, persetujuan akun, hak akses menu, lokasi meeting, target Sales, tampilan dashboard, nilai bisnis, audit log |

Setiap daftar punya pencarian, kolom yang bisa diurutkan (di server, seluruh
data), dan konfirmasi sebelum menghapus. Ekspor Excel memakai satu template
siap cetak: kop & logo perusahaan dari Branding, tabel bergaris, baris TOTAL,
ringkasan, blok tanda tangan, kertas A4 dengan nomor halaman.

**Keamanan akun:** verifikasi dua langkah (TOTP + kode cadangan) opsional per
pengguna, daftar perangkat aktif yang bisa diputus, reset sandi & reset 2FA
oleh Admin. **Notifikasi push** (opsional, butuh kunci VAPID): ringkasan tugas
pagi & siang, dan pendaftaran akun baru ke Admin. Menu di sidebar dikelompokkan menurut pekerjaan (Kerja
Harian, Penjualan, Pemantauan, Sistem) dan hanya menampilkan menu yang boleh
dibuka peran tersebut.

**Proyek adalah simpul penghubung.** Pipeline, jadwal/meeting, laporan harian,
dan GP Calculation ditautkan ke proyek; detail Proyek dan detail Pipeline
menampilkan data terkait itu tanpa perlu berpindah menu.

## 3. Arsitektur

```text
Browser (Next.js App Router, React 18)
   │  cookie httpOnly  +  JWT PostgREST (10 menit, diperbarui otomatis)
   ▼
Route Handler (Node)  ──service role──►  Supabase (auth kustom, sesi)
   │
   └── klien Supabase browser ──JWT user──►  PostgREST ──► RLS ──► Postgres
                                                                    │
                                                RPC SECURITY DEFINER┘
                                     (check-in, penyelesaian, persetujuan GP)
```

Keputusan yang paling menentukan: **penegakan wewenang ada di database**, bukan
di frontend. Frontend menyembunyikan tombol demi antarmuka yang bersih; yang
benar-benar menolak akses adalah policy RLS dan fungsi `SECURITY DEFINER`.
Diagram alur lengkap ada di [`docs/ALUR.md`](docs/ALUR.md).

## 4. Teknologi

Next.js 15.5 (App Router) · React 19.1 · TypeScript 5.7 · Tailwind 3.4 ·
Supabase (Postgres 17 + PostgREST + Storage) · bcryptjs · ExcelJS · Leaflet ·
web-push · qrcode.

Grafik digambar sebagai SVG tanpa pustaka grafik.

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
| `LICENSE_AUTHORITY_URL`, `LICENSE_DEPLOYMENT_ID`, `LICENSE_ID` | server | Registrasi deployment di License Authority |
| `LICENSE_DEPLOYMENT_KEY` | **rahasia** | Ditampilkan sekali saat registrasi |
| `LICENSE_PUBLIC_KEY` | server (publik) | `npm run keys` di repo privat sales-license-authority |
| `LICENSE_MODE` | server | `production` (bawaan); `development` hanya berlaku di `next dev` |
| `CRON_SECRET` | **rahasia** | Acak (≥ 16 karakter); dipakai Vercel Cron: verifikasi lisensi harian & notifikasi push |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | server / **rahasia** (privat) | Opsional — notifikasi push. Buat dengan `npm run vapid` |
| `MFA_ENCRYPTION_KEY` | **rahasia** | Opsional — kunci enkripsi rahasia 2FA; bila kosong diturunkan dari `SUPABASE_JWT_SECRET` (mengganti salah satunya membuat 2FA semua pengguna harus dipasang ulang) |
| `ANDROID_PACKAGE_ID`, `ANDROID_CERT_SHA256` | server | Opsional — aplikasi Android (`android/README.md`) |

Dua yang bertanda rahasia tidak boleh diawali `NEXT_PUBLIC_` dan tidak boleh
masuk ke repositori. `SUPABASE_SERVICE_ROLE_KEY` melewati seluruh RLS;
`SUPABASE_JWT_SECRET` menandatangani token identitas — tanpanya setiap query
berangkat sebagai anon dan tabel akan terlihat kosong.

## 7. Migrasi

**Project Supabase baru:** cukup satu berkas — `supabase/SETUP_LENGKAP.sql`.
Ubah 3 isian akun Admin di baris paling atas, tempel seluruh isinya di SQL
Editor, lalu Run. Semua migrasi dan akun Admin pertama dibuat dalam satu
transaksi (gagal = tidak ada yang tersimpan). Berkas ini dihasilkan dari
`supabase/migrations/` dengan `npm run sql:setup` — jalankan ulang setiap
menambah migrasi.

**Project yang sudah berjalan:** terapkan berurutan berkas di
`supabase/migrations/` yang belum pernah dijalankan (001 sampai
terbaru). Nomor berkas adalah urutan wajib; jangan mengubah isi migrasi yang
sudah pernah dijalankan — perbaikan selalu ditulis sebagai migrasi baru.
Supabase Auth tidak perlu diaktifkan: platform ini memakai autentikasi sendiri.

**Lisensi.** Migrasi 037 mengunci modul bisnis sampai lisensi pertama
terverifikasi. Siapkan License Authority dan variabel `LICENSE_*` lebih dulu —
lihat [LICENSE_ARCHITECTURE.md](LICENSE_ARCHITECTURE.md) → Checklist produksi.

## 8. Posisi & Struktur Organisasi

Setiap akun wajib punya **posisi** — jenjang tetap dari bawah ke atas:
Staff → Supervisor → Manager → General Manager → Direktur. Posisi dipilih
saat mendaftar (atau saat Admin membuat akun) dan hanya bisa diubah Admin.

**Pohon** atasan–bawahan (`users.manager_id`) dipetakan Admin di
Admin → Struktur Organisasi. Database (trigger `sm_jaga_struktur`, migrasi
036) menolak pemetaan yang tidak sah: atasan harus aktif dan berposisi lebih
tinggi, tidak ada lingkaran, dan posisi tidak bisa diturunkan selagi masih
membawahi orang yang setara atau lebih tinggi. Pohon inilah yang menentukan
siapa melihat customer siapa.

Posisi berbeda dari **peran**: peran (bagian berikut) menentukan hak akses di
aplikasi, posisi menentukan letak di struktur.

## 9. Peran & Hak

`SALES`, `MANAGER`, `ADMIN`, `DIRECTOR`, `FINANCE`. Empat yang terakhir
disebut **pengawas** dan melihat data seluruh tim.

- **Sales** — hanya data miliknya, plus jadwal yang ditugaskan kepadanya. Boleh
  menyunting data sendiri, tidak boleh menghapus.
- **Admin** — boleh menyunting dan menghapus data siapa pun.
- **Customer** — hanya terlihat oleh Sales yang menanganinya (pembuatnya) dan
  oleh garis atasannya lewat `users.manager_id` (atasan langsung dan atasan di
  atasnya), plus Admin. Sales lain dan Manager di luar garis itu tidak
  melihatnya sama sekali — termasuk lewat pencarian header dan isian pilihan
  customer. Atasan hanya melihat, tidak mengubah. Atasan diisi di
  Admin → Pengguna.
- **GP Calculation** — pembuat dokumen tidak boleh menyetujui dokumennya
  sendiri, dan satu orang tidak boleh mengisi dua tahap persetujuan.
- **`user_credentials`, `user_sessions`, `login_attempts`** — tanpa policy sama
  sekali; hanya route handler lewat service role yang menyentuhnya.
- **`audit_trail`** — bisa disisipi, tidak bisa diubah maupun dihapus siapa pun.
- Kolom pribadi di `users` (email, telepon, alamat) tidak bisa dibaca langsung
  dari browser; hanya lewat API profil/admin.

Akun yang sandinya dibuat atau direset Admin wajib mengganti sandi saat masuk
pertama kali.

Definisi "pengawas" ada di tiga tempat dan harus selalu sama:
`sm_is_pengawas()` (database), `isPengawas()` di `lib/constants.ts` (tampilan),
dan `isPengawas()` di `lib/server-auth.ts` (route handler).

Pesan galat ke pengguna selalu lewat `pesanGalat()` (`lib/pesan-galat.ts`):
galat teknis Postgres/PostgREST diterjemahkan ke kalimat biasa dan rinciannya
dicatat ke console; pesan yang memang ditulis untuk manusia (RAISE EXCEPTION
fungsi kita sendiri) diteruskan apa adanya.

## 10. Storage

Bucket privat `evidence`, jalur `evidence/{user_id}/{schedule_id}/berkas.jpg`.
Kepemilikan terbaca dari jalurnya sendiri. Tidak ada policy UPDATE: berkas
bukti tidak boleh ditimpa.

## 11. Pengujian

Sembilan skrip uji keamanan di `supabase/tests/`, dijalankan di SQL Editor
Supabase — atau semuanya sekaligus pada Postgres kosong dengan
`scripts/uji-sql.sh` (dipakai CI). Setiap skrip diakhiri `ROLLBACK`, jadi data ujinya tidak pernah
tersimpan. Kolom `nyata` harus sama dengan `harapan` di setiap baris.

| Berkas | Uji | Cakupan |
|---|---|---|
| `keamanan.sql` | 19 | Isolasi antar-Sales, manipulasi status, check-in (radius, akurasi), bukti foto, eskalasi peran |
| `keamanan-gp.sql` | 29 | Ketepatan rumus GP terhadap berkas asli, isolasi, rantai persetujuan |
| `keamanan-gps.sql` | 13 | Penolakan lokasi palsu — dan jaminan bahwa Sales jujur tetap lolos |
| `keamanan-customer.sql` | 15 | Customer hanya terlihat oleh Sales pemiliknya dan garis atasannya; nama unik per Sales |
| `keamanan-struktur.sql` | 13 | Jenjang posisi dan pohon organisasi: atasan harus lebih tinggi, tanpa lingkaran, tidak menurunkan posisi selagi membawahi yang setara |
| `keamanan-hak.sql` | 20 | Sales menyunting tapi tidak menghapus miliknya, hanya Admin mengubah data orang lain, isolasi Target Sales, kolom pribadi `users` |
| `keamanan-akun.sql` | 10 | Rahasia 2FA, sesi, langganan push, dan lonceng orang lain hanya untuk server |
| `keamanan-aplikasi.sql` | 10 | Kunci tanda tangan aplikasi Android & laporan lokasi bertanda tangan |
| `keamanan-lisensi.sql` | 21 | Admin pelanggan tidak bisa mengubah lisensi, fitur tak berlisensi tertutup di database (termasuk lewat fungsi DEFINER), kedaluwarsa/penangguhan/tenggang, downgrade tanpa kehilangan data |

Uji Authority pusat: `supabase/tests/authority.sql` di repo privat sales-license-authority (22 uji).

Pemeriksaan kode: `npm run typecheck`, `npm test` (uji unit lisensi, impor, TOTP; Node ≥ 22.6) dan `npm run build`.

**CI (GitHub Actions, `.github/workflows/ci.yml`)** menjalankan semuanya di setiap
push ke `main` dan pull request: typecheck, unit test, build, kecocokan
`SETUP_LENGKAP.sql`, lalu seluruh migrasi + uji keamanan SQL di Postgres 16.
Workflow `apk.yml` (manual) membangun APK per pelanggan dari secret dan
mengunggahnya ke bucket privat `aplikasi` Supabase pelanggan itu.

**Rilis ke repo/server lain** (mis. demo): `npm run rilis -- <commit-terpasang>`
menghasilkan ZIP berisi hanya berkas yang berubah, daftar berkas yang dihapus,
SQL susulan migrasi baru, dan panduan update.

## 12. Deploy

Push ke `main` memicu deployment otomatis di Vercel. Kelima variabel di §6
harus terpasang di Vercel. Migrasi database diterapkan terpisah — terapkan
migrasi **bersamaan** dengan kode yang membutuhkannya, karena kode lama
terhadap fungsi database baru (atau sebaliknya) bisa gagal.

## 13. Lisensi, Logo, dan Aplikasi Android

- **Lisensi**: satu pelanggan = satu deployment = satu lisensi, dikendalikan
  License Authority pusat (repo privat `sales-license-authority`, akun developer terpisah) dengan persetujuan lewat
  Telegram. Admin melihat status dan mengajukan permintaan di Admin → Lisensi.
  Rincian: [LICENSE_ARCHITECTURE.md](LICENSE_ARCHITECTURE.md).
- **Logo**: logo resmi ada di `public/brand/`; favicon, ikon PWA, dan ikon
  Android diturunkan darinya. Logo unggahan Admin (Dashboard Setting) tetap
  didahulukan bila ada.
- **Android**: APK/AAB dibangun sebagai TWA dari PWA ini — lihat
  [android/README.md](android/README.md).

## 14. Batasan yang Diketahui

- **Middleware bukan lapisan keamanan.** Ia hanya memeriksa keberadaan cookie.
  Penegakan sesungguhnya ada di route handler dan database.
- **Lokasi palsu tidak bisa dipastikan 100% dari aplikasi web.** Penyedia
  lokasi tiruan Android bekerja di tingkat sistem operasi. Platform ini
  mengenali jejak khasnya dan mencatat seluruh laporan untuk dilihat pengawas;
  kepastian penuh butuh aplikasi Android native.
- **Pengurutan kolom** mengurutkan seluruh data di server untuk kolom bertanda
  ↕; kolom nama Sales/Owner tidak bisa diurutkan karena tersimpan sebagai id.
