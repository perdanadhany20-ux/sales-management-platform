# Sales Management Platform

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
| Dashboard | Agenda & tindak lanjut hari ini, ringkasan tim, tren, kepatuhan laporan, GP, pencapaian target |
| Daily Report | Laporan kunjungan harian, ekspor Excel |
| Proyek | Induk yang mengikat pipeline, jadwal, dan GP satu proyek |
| Pipeline | Peluang, probabilitas, tahapan, estimasi closing |
| Schedule | Pengajuan & penugasan jadwal, status terlewat otomatis |
| Meeting | Check-in GPS, foto bukti, penyelesaian, override pengawas |
| GP Calculation | Hitung GP dari item, persetujuan Manager → Director → Finance |
| Activity | Jejak seluruh modul, termasuk check-in yang ditolak |
| Admin Panel | Pengguna, persetujuan akun, hak akses menu, lokasi meeting, target Sales, tampilan dashboard, nilai bisnis, audit log |

Setiap daftar punya pencarian, kolom yang bisa diurutkan, dan konfirmasi
sebelum menghapus. Menu di sidebar dikelompokkan menurut pekerjaan (Kerja
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

Next.js 14.2 (App Router) · React 18.3 · TypeScript 5.7 · Tailwind 3.4 ·
Supabase (Postgres 17 + PostgREST + Storage) · bcryptjs · ExcelJS · Leaflet.

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

Dua yang bertanda rahasia tidak boleh diawali `NEXT_PUBLIC_` dan tidak boleh
masuk ke repositori. `SUPABASE_SERVICE_ROLE_KEY` melewati seluruh RLS;
`SUPABASE_JWT_SECRET` menandatangani token identitas — tanpanya setiap query
berangkat sebagai anon dan tabel akan terlihat kosong.

## 7. Migrasi

Terapkan berurutan seluruh berkas di `supabase/migrations/` (001 sampai
terbaru). Nomor berkas adalah urutan wajib; jangan mengubah isi migrasi yang
sudah pernah dijalankan — perbaikan selalu ditulis sebagai migrasi baru.
Supabase Auth tidak perlu diaktifkan: platform ini memakai autentikasi sendiri.

## 8. Peran & Hak

`SALES`, `MANAGER`, `ADMIN`, `DIRECTOR`, `FINANCE`. Empat yang terakhir
disebut **pengawas** dan melihat data seluruh tim.

- **Sales** — hanya data miliknya, plus jadwal yang ditugaskan kepadanya. Boleh
  menyunting data sendiri, tidak boleh menghapus.
- **Admin** — boleh menyunting dan menghapus data siapa pun.
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

## 9. Storage

Bucket privat `evidence`, jalur `evidence/{user_id}/{schedule_id}/berkas.jpg`.
Kepemilikan terbaca dari jalurnya sendiri. Tidak ada policy UPDATE: berkas
bukti tidak boleh ditimpa.

## 10. Pengujian

Empat skrip uji keamanan di `supabase/tests/`, dijalankan di SQL Editor
Supabase. Setiap skrip diakhiri `ROLLBACK`, jadi data ujinya tidak pernah
tersimpan. Kolom `nyata` harus sama dengan `harapan` di setiap baris.

| Berkas | Uji | Cakupan |
|---|---|---|
| `keamanan.sql` | 19 | Isolasi antar-Sales, manipulasi status, check-in (radius, akurasi), bukti foto, eskalasi peran |
| `keamanan-gp.sql` | 29 | Ketepatan rumus GP terhadap berkas asli, isolasi, rantai persetujuan |
| `keamanan-gps.sql` | 13 | Penolakan lokasi palsu — dan jaminan bahwa Sales jujur tetap lolos |
| `keamanan-hak.sql` | 20 | Sales menyunting tapi tidak menghapus miliknya, hanya Admin mengubah data orang lain, isolasi Target Sales, kolom pribadi `users` |

Pemeriksaan kode: `npm run typecheck` dan `npm run build`.

## 11. Deploy

Push ke `main` memicu deployment otomatis di Vercel. Kelima variabel di §6
harus terpasang di Vercel. Migrasi database diterapkan terpisah — terapkan
migrasi **bersamaan** dengan kode yang membutuhkannya, karena kode lama
terhadap fungsi database baru (atau sebaliknya) bisa gagal.

## 12. Batasan yang Diketahui

- **Middleware bukan lapisan keamanan.** Ia hanya memeriksa keberadaan cookie.
  Penegakan sesungguhnya ada di route handler dan database.
- **Lokasi palsu tidak bisa dipastikan 100% dari aplikasi web.** Penyedia
  lokasi tiruan Android bekerja di tingkat sistem operasi. Platform ini
  mengenali jejak khasnya dan mencatat seluruh laporan untuk dilihat pengawas;
  kepastian penuh butuh aplikasi Android native.
- **Pengurutan kolom berlaku per halaman** yang sedang tampil, bukan seluruh
  data.
