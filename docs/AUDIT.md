# Laporan Audit — Sales Management Platform

Tanggal: 22 September 2026 (diperbarui sesudah modul GP Calculation dan
pendaftaran akun)
Cakupan: keamanan, mobile, dan performa, pada commit yang memuat seluruh modul
(Login & pendaftaran, Dashboard, Daily Report, Pipeline, Request Schedule,
Meeting, GP Calculation, Activity, Profil, Admin Panel).

---

## 0. Cara membaca laporan ini

Yang ditulis di sini hanya hal yang **benar-benar dijalankan dan dilihat
hasilnya**, bukan daftar periksa yang dicentang dari membaca kode. Tiap
temuan menyebut cara mengulanginya, supaya siapa pun bisa membuktikan sendiri
bahwa isinya benar — termasuk membuktikan bahwa isinya salah.

Yang **tidak** bisa diuji dari lingkungan kerja ini disebut apa adanya di
bagian §5, bukan disamarkan jadi "sudah diverifikasi". Lingkungan ini tidak
punya peramban grafis, jadi tidak ada satu pun klaim di bawah yang bersandar
pada "terlihat baik di layar".

---

## 1. Keamanan

### 1.1 Uji penetrasi peran (19 + 29 uji, lulus semua)

Dua berkas: `supabase/tests/keamanan.sql` (19 uji, alur inti) dan
`supabase/tests/keamanan-gp.sql` (29 uji, GP Calculation). Dijalankan langsung terhadap basis data
produksi di dalam satu transaksi yang diakhiri `ROLLBACK`, sehingga tidak ada
satu baris uji pun yang tertinggal (diperiksa sesudahnya: 0 sisa).

Kuncinya ada pada `SET LOCAL ROLE authenticated`. Tanpa baris itu skrip
berjalan sebagai pemilik basis data yang **melewati RLS**, dan seluruh uji akan
"lulus" tanpa arti.

| # | Uji | Harapan | Hasil |
|---|-----|---------|-------|
| 1 | Sales B membaca jadwal Sales A | 0 baris | ✅ |
| 2 | Sales B check-in pada meeting Sales A | `ASSIGNMENT_MISMATCH` | ✅ |
| 3 | Sales `UPDATE status='COMPLETED'` langsung ke tabel | 0 baris diubah | ✅ |
| 4 | Menyelesaikan meeting tanpa check-in | `NO_ATTENDANCE` | ✅ |
| 5 | Check-in dari 3 km di luar radius | `OUTSIDE_RADIUS` | ✅ |
| 6 | Check-in dengan akurasi GPS 250 m | `LOW_ACCURACY` | ✅ |
| 7 | Check-in dari dalam radius | `VALID` | ✅ |
| 8 | Menyelesaikan meeting tanpa foto bukti | `NO_EVIDENCE` | ✅ |
| 9 | Jejak GPS tersaring per pemilik (3 dari 4 percobaan) | 3 jejak | ✅ |
| 10 | Sales mengubah pengaturan `branding` | 0 baris diubah | ✅ |
| 11 | Sales menaikkan perannya sendiri jadi ADMIN | 0 baris diubah | ✅ |
| 12 | Manager mengangkat Sales jadi ADMIN | 0 baris diubah | ✅ |
| 13 | Sales B membaca jejak Sales A lewat `sm_activity_feed` | 0 jejak | ✅ |
| 14 | Sales B menempelkan foto ke kehadiran Sales A | ditolak | ✅ |
| 15 | Manager menambah lokasi meeting (**harus boleh**) | 1 baris ditambah | ✅ |
| 16 | Sales menambah lokasi meeting | ditolak | ✅ |
| 17 | Director melihat jadwal seluruh tim (**harus boleh**) | 1 baris | ✅ |
| 18 | Director mengangkat orang jadi ADMIN | 0 baris diubah | ✅ |
| 19 | Finance melihat jadwal seluruh tim (**harus boleh**) | 1 baris | ✅ |

Uji 3 adalah yang paling penting dan paling mudah disalahpahami: hasilnya
bukan *error*, melainkan **nol baris tersentuh**. Sales memang sengaja tidak
diberi policy `UPDATE` pada `sm_schedules`, sehingga PostgREST menjawab sukses
dengan badan kosong. Aplikasi yang menganggap "tidak error berarti berhasil"
akan salah membacanya — itulah sebabnya seluruh perpindahan status melewati
RPC yang mengembalikan alasan kegagalan secara eksplisit.

Uji 9 memeriksa hal yang mudah terlewat: empat percobaan check-in terjadi,
tapi Sales A hanya boleh melihat tiga. Kalau suatu saat muncul angka 4,
artinya policy `gps_baca` bocor.

Uji 15 dan 16 adalah **uji regresi** untuk migrasi 013 (pemecahan policy
`FOR ALL`). Memecah policy adalah tempat hak paling mudah hilang atau bocor
tanpa sengaja, jadi kedua arah diuji: yang boleh harus tetap boleh.

Uji 17–19 menguji peran DIRECTOR dan FINANCE yang ditambahkan migrasi 015,
juga dari dua arah: keduanya memang harus bisa membaca data tim (kalau tidak,
tanda tangannya di GP Calculation kosong), tapi tetap bukan Admin.

### 1.1b Uji GP Calculation (29 uji, lulus semua)

Berkas: `supabase/tests/keamanan-gp.sql`. Menguji tiga hal yang tidak bisa
diuji di tempat lain.

**Ketepatan angka (uji 1–12).** Dibandingkan dengan berkas asli tim
`GP_BALAIKOTA.xlsx`, sel per sel:

| Pos | Berkas asli | Database | |
|-----|-------------|----------|---|
| Total Selling (bruto) | 56.550.000 | 56.550.000 | ✅ |
| Total Selling (DPP) | 50.945.946 | 50.945.946 | ✅ |
| PPN 11% | 5.604.054 | 5.604.054 | ✅ |
| Pph 2,5% | 1.273.649 | 1.273.649 | ✅ |
| Net Amount Received | 49.664.297 | 49.664.297 | ✅ |
| Total Costing | 48.633.370 | 48.633.370 | ✅ |
| Net Profit | 1.030.927 | 1.030.927 | ✅ |
| Net Margin | 0,0202 | 0,0202 | ✅ |
| Mutu margin | DIRECTOR APPROVAL | DIRECTOR APPROVAL | ✅ |
| GP item | 8.916.630 (15,7677%) | sama | ✅ |

Nilainya cocok sampai rupiah terakhir. Kalau kelak rumus di view diubah
"supaya lebih rapi", uji inilah yang akan memberi tahu bahwa hasilnya tidak
lagi sama dengan berkas yang selama ini dipakai tim.

**Kerahasiaan antar-Sales (uji 13–16).** Syarat yang ditegaskan langsung
pemilik platform. Sales B memperoleh **0 baris** pada tabel dokumen, **0
baris** pada tabel item, dan **0 baris** pada view ringkasan milik Sales A —
view diuji terpisah dari tabelnya dengan sengaja, karena `security_invoker`
bisa saja terlupa saat view-nya kelak dibuat ulang, dan kebocorannya justru
akan lewat sana lengkap dengan seluruh angka marginnya.

**Rantai persetujuan (uji 17–26).** Status tidak bisa ditembak langsung oleh
pemiliknya; Director ditolak saat mencoba melompati pemeriksaan Manager;
Manager ditolak saat mencoba mengambil langkah Director; dokumen beku sesudah
diajukan — menyunting maupun menambah item ditolak.

### 1.2 Advisor keamanan Supabase

Dijalankan ulang sesudah setiap kelompok migrasi. Hasil akhir: **bersih**,
menyisakan tiga hal yang memang disengaja dan terdokumentasi di tabel bawah.

Di antaranya, **satu temuan nyata ditemukan dan diperbaiki.** Segera sesudah migrasi 016
diterapkan, advisor melaporkan bahwa keempat fungsi GP Calculation bisa
dipanggil peran `anon` — yaitu tanpa sesi sama sekali.

Sebabnya halus: migrasi 016 menutupnya dengan `REVOKE ... FROM public`, dan
itu **tidak cukup**. Supabase memberi `EXECUTE` kepada `anon` secara
**eksplisit** pada setiap fungsi baru di schema public, bukan lewat peran
`public`; mencabut dari `public` tidak menyentuh pemberian eksplisit itu.

Dampaknya nyata meski sempit: `sm_gp_buka_ulang()` memeriksa kepemilikan
dengan `v_gp.sales_user_id <> v_uid`, dan ketika pemanggilnya tanpa sesi
`v_uid` bernilai NULL. Di SQL, `sesuatu <> NULL` menghasilkan NULL — bukan
TRUE — sehingga penjaganya terlewati. Siapa pun yang menebak UUID dokumen GP
berstatus DITOLAK bisa mengembalikannya ke DRAFT.

Keduanya ditutup migrasi 017: `anon` dicabut dengan menyebut namanya, dan
fungsinya menolak lebih dulu pemanggil tanpa sesi. Diverifikasi dua kali —
lewat `has_function_privilege()` untuk kesembilan fungsi, dan lewat uji 27–29
yang memanggilnya sebagai `anon` dan memastikan ditolak.

**Pelajarannya sudah dicatat di uji regresi**, karena jenis kesalahan ini tidak
menghasilkan error apa pun saat aplikasi dipakai normal — tanpa advisor, ia
akan tetap berada di sana sampai seseorang menemukannya dari luar.

Sisa temuan sesudah perbaikan, seluruhnya disengaja:

| Temuan | Status | Alasan |
|--------|--------|--------|
| `authenticated` bisa memanggil 7 fungsi `SECURITY DEFINER` | Disengaja | Ketujuhnya (`sm_check_in`, `sm_complete_schedule`, `sm_override_completion`, dan empat fungsi GP) adalah **satu-satunya** jalan sah status berpindah. Justru itu rancangannya. `EXECUTE` sudah dicabut dari `public` dan `anon` (migrasi 004/008/017) — hanya sesi yang membawa JWT terbitan server yang bisa memanggilnya, dan tiap fungsi memeriksa ulang wewenang di dalam dirinya. |
| RLS aktif tanpa policy pada `user_credentials`, `user_sessions`, `login_attempts` | Disengaja | Tanpa policy, klien mana pun membaca ketiganya sebagai tabel kosong. Satu-satunya yang boleh menyentuhnya adalah route handler lewat service role. Menambahkan policy di sini justru akan **membuka** yang sekarang tertutup rapat. |
| — | — | `sm_activity_feed` **tidak** muncul sebagai `security_definer_view`, yang mengonfirmasi `security_invoker = true`-nya benar-benar aktif. |

### 1.3 Keputusan keamanan yang perlu diingat

- **Bucket `evidence` privat, bucket `branding` publik.** Bedanya disengaja.
  Foto kehadiran memuat wajah dan jejak lokasi orang, jadi disajikan lewat
  signed URL berumur 10 menit. Logo dan latar halaman masuk harus tampil
  sebelum ada yang login, sehingga tidak ada sesi yang bisa menandatanganinya;
  isinya pun memang untuk umum. Yang tetap dibatasi rapat pada keduanya adalah
  **siapa yang menulis** — untuk `branding`, hanya Admin.
- **Tidak ada policy UPDATE pada `storage.objects` bucket `evidence`.** Foto
  bukti tidak boleh ditimpa; menimpa berkas pada jalur yang sama mengubah isi
  bukti tanpa meninggalkan jejak.
- **Penyuntingan profil sendiri lewat route handler, bukan policy RLS baru.**
  RLS bekerja per *baris*, bukan per *kolom*. Policy "boleh menyunting baris
  sendiri" otomatis juga mengizinkan mengubah kolom `role` pada baris itu —
  yaitu menaikkan diri sendiri jadi ADMIN lewat satu permintaan. `/api/profil`
  menulis daftar kolom yang boleh berubah secara eksplisit (`email`, `phone`),
  sehingga tidak ada kolom lain yang bisa dititipkan lewat badan permintaan.
- **`/api/branding` terbuka tanpa sesi, tapi hanya membaca SATU baris
  pengaturan.** Bukan seluruh isi `sm_settings`, yang juga memuat ambang
  akurasi GPS dan nilai bisnis lain.
- **Pendaftaran mandiri tidak menerima peran dari klien.** `role`, `active`,
  dan `approval_status` seluruhnya diisi server di `/api/auth/register`. Kalau
  ketiganya boleh datang dari badan permintaan, siapa pun bisa mendaftarkan
  dirinya sebagai ADMIN yang langsung aktif.
- **Status dokumen GP dijaga lewat hak kolom, bukan hanya RLS.** RLS bekerja
  per baris; pemilik dokumen yang punya hak UPDATE atas barisnya juga punya hak
  atas kolom `status` pada baris itu. Hak UPDATE dicabut lalu diberikan ulang
  hanya pada kolom isian.
- **Hash kata sandi wajib bcrypt 60 karakter (`$2b$`).** Pernah tertimpa teks
  polos pada tahap awal dan membuat seluruh login gagal. Periksa dengan
  `SELECT left(password_hash, 4), length(password_hash) FROM user_credentials`.

---

## 2. Performa

### 2.1 Temuan advisor dan tindakannya

| Temuan | Tingkat | Tindakan |
|--------|---------|----------|
| 10 foreign key tanpa indeks penutup | INFO | **Diperbaiki** (migrasi 013). Bukan sekadar soal join: menghapus satu baris `users` memaksa pemindaian penuh delapan tabel anak untuk mencari baris menggantung. |
| 3 tabel dengan dua policy permisif untuk SELECT yang sama | WARN | **Diperbaiki** (migrasi 013). `FOR ALL` mencakup SELECT, sehingga tiap SELECT ke `users`, `sm_settings`, dan `sm_locations` dievaluasi dua kali padahal policy kedua tidak menambah hak apa pun. Dipecah jadi INSERT/UPDATE/DELETE. Hak yang diberikan sama persis — dibuktikan uji regresi 15 & 16. |
| 20 indeks "belum pernah terpakai" | INFO | **Sengaja dibiarkan.** Platformnya baru berisi data contoh; indeks terbaca belum terpakai karena memang belum ada yang menyaring apa pun. Membuang indeks yang dirancang untuk penyaringan harian atas dasar itu adalah kesimpulan terbalik. Tinjau ulang setelah 2–3 bulan pemakaian nyata. |

Advisor dijalankan ulang sesudah perbaikan: **kedua temuan tingkat WARN
hilang**, menyisakan INFO "unused index" yang memang diharapkan.

### 2.2 Temuan dari pembacaan kode

**Header menembakkan enam permintaan HTTP hanya untuk mengisi lencana**, dan
mengulanginya tiap tiga menit selama tab terbuka. Di meja kantor tidak terasa;
di lapangan dengan satu bar sinyal, itu berarti angka header menetes satu per
satu — kalau keenamnya berhasil.

Diperbaiki dengan RPC `sm_lonceng()` (migrasi 014) yang menghitung keenamnya
dalam satu perjalanan. Fungsinya **SECURITY INVOKER**, bukan DEFINER: RLS tetap
berlaku, sehingga angka yang dilihat Sales dihitung dari barisnya sendiri.
Menjadikannya DEFINER akan membocorkan hitungan seluruh tim dalam bentuk angka
— kebocoran yang tidak tampak sebagai data dan karena itu mudah lolos.

**Ekspor Excel tidak ikut membebani halaman.** `exceljs` (±250 KB) diimpor
secara dinamis di dalam fungsi ekspornya, jadi halaman yang tombol ekspornya
tidak pernah ditekan tidak ikut mengunduhnya. Terbukti dari ukuran bundel di
bawah: menambahkan ekspor ke enam modul hanya menaikkan ukuran halaman 1–2 kB.

### 2.3 Ukuran bundel

| Rute | Halaman | First Load JS |
|------|---------|---------------|
| `/` (masuk) | 5,67 kB | 154 kB |
| `/dashboard` | 4,77 kB | 169 kB |
| `/daily-report` | 7,57 kB | 168 kB |
| `/pipeline` | 9,27 kB | 169 kB |
| `/schedule` | 9,09 kB | 178 kB |
| `/meeting` | 9,32 kB | 178 kB |
| `/activity` | 4,25 kB | 164 kB |
| `/profil` | 6,87 kB | 176 kB |
| `/admin` | 13,9 kB | 188 kB |
| Bersama seluruh rute | — | 87,4 kB |

Seluruhnya di bawah 200 kB. Sebagai pembanding kasar, anggaran yang lazim
dipakai untuk halaman yang harus terbuka di jaringan 3G adalah ~200 kB.

**Keputusan yang menjaga angka ini tetap kecil:** tidak ada pustaka grafik
pihak ketiga (donat dan meteran digambar sebagai SVG di
`components/shared/Charts.tsx`), tidak ada pustaka peta (peta lokasi memakai
sematan OpenStreetMap tanpa kunci API), dan tidak ada pustaka tanggal.

### 2.4 Perilaku hemat data lain

- Foto bukti **dikecilkan di perangkat** sebelum diunggah (`lib/image-compress.ts`),
  lengkap dengan thumbnail dari satu kali pembacaan berkas. Kamera ponsel
  menghasilkan 4–8 MB; yang dikirim jauh lebih kecil, dan daftar bukti memuat
  thumbnail, bukan foto penuh.
- Seluruh daftar memakai paginasi dengan `count: 'exact'` dalam respons yang
  sama, sehingga tidak ada query kedua hanya untuk menghitung total.
- Pengaturan dan identitas platform di-cache di level modul; berpindah menu
  tidak memicu query yang sama berulang kali.

---

## 3. Mobile

### 3.1 Bug yang ditemukan audit ini

**Navigasi Admin Panel tampil dobel pada lebar 900–1280 px.** Sub-menu Admin di
sidebar memakai ambang `sidebar` (≥900 px) sedangkan baris chip penggantinya
masih memakai ambang `satulayar` (≥1280 px pada layar sentuh). Di antara
keduanya, kedua navigasi muncul bersamaan. **Diperbaiki** — chip kini
`sidebar:hidden`, tepat berpasangan dengan ambang munculnya sidebar.

**Mode "Situs desktop" Chrome ponsel memberi tata letak terburuk dari dua
dunia.** Chrome melaporkan viewport ~980 px lalu mengecilkan seluruh halaman
agar muat di layar fisik ~400 px. Dengan ambang lama `lg` (1024 px), lebar 980
px itu jatuh ke tata letak ponsel — bilah navigasi bawah dan teks ponsel, tapi
diperkecil 0,73× sampai nyaris tidak terbaca.

Diperbaiki dengan ambang `sidebar` yang **murni lebar**, tanpa syarat
`pointer: fine`: pada 900 px ke atas ruangnya memang cukup untuk sidebar, apa
pun alat penunjuknya. Ditambah ambang `sentuhlebar`
(`(pointer: coarse) and (min-width: 900px)`) yang menaikkan ukuran huruf di
bilah header khusus untuk kondisi ini — tingginya sengaja tidak diubah supaya
offset sticky sidebar tetap cocok.

### 3.2 Yang diperiksa dan bersih

| Aspek | Hasil |
|-------|-------|
| `viewport` meta | `width=device-width, initial-scale=1`; zoom **tidak** dikunci — alur meeting dipakai di bawah matahari terang, dan mengunci `maximum-scale` memaksa orang membaca teks kecil tanpa bisa memperbesarnya |
| Tabel HTML | **Tidak ada satu pun** di seluruh aplikasi; semua daftar berbasis kartu, yang tidak memaksa gulir mendatar |
| Gulir mendatar | Hanya pada tiga tempat yang memang disengaja dan ber-`overflow-x-auto`: deretan lencana header, chip bagian Admin, dan chip rentang tanggal |
| Sasaran sentuh | Bilah bawah `min-h-[56px]`; lencana header `min-h-[34px]`; tombol dan kolom isian memakai padding komponen bersama |
| Area aman iOS | `env(safe-area-inset-bottom)` dipakai pada bilah bawah, kaki modal, dan padding bawah `main` |
| Modal di ponsel | Menempel ke dasar layar (`items-end`), gulir halaman belakang dikunci saat modal terbuka supaya posisi baca tidak hilang |
| Alur Meeting | Kartu satu kolom, tombol selebar layar, penyaring bawaan **hari ini** — yang membukanya hampir selalu sedang menjalankan meeting hari itu |
| Kamera | `capture="environment"` pada input foto bukti, langsung membuka kamera belakang |

### 3.3 Penjagaan tipografi

Judul halaman masuk sempat pecah buruk: `<br />` paksa ditambah kata
"dipertanggungjawabkan" (21 huruf) yang tidak bisa dipenggal peramban membuat
satu baris berisi satu kata sebatang kara. Pemutus baris manual selalu
berakhir begitu — benar pada satu lebar layar, salah pada semua lebar lainnya.

Supaya tidak terulang di halaman lain, penjagaannya dipasang **sekali** di
`app/globals.css`:

- `overflow-wrap: break-word` pada `body` — kata yang tidak muat dipenggal
  alih-alih menjebol lebar kartunya;
- `text-wrap: balance` pada `h1/h2/h3` — peramban membagi baris judul rata;
- `text-wrap: pretty` pada `p` — mencegah kata tunggal terdampar di baris
  penutup.

### 3.4 Aksesibilitas yang relevan

- Palet status di `lib/constants.ts` sudah lolos pemeriksaan buta warna.
  Pasangan merah/hijau versi baseline (#b91c1c vs #15803d) **gagal** uji CVD
  dengan ΔE 4,2 di bawah ambang 8 — persis pasangan yang paling sering tidak
  terbedakan penderita deuteranopia/protanopia. Nilai yang dipakai sekarang
  adalah hasil perbaikannya.
- Status tidak pernah disampaikan lewat warna saja; selalu ada label teks di
  sampingnya.
- Cincin fokus hanya muncul untuk navigasi papan tombol (`:focus-visible`).
- `prefers-reduced-motion` mematikan seluruh transisi, bukan memperlambatnya.

---

## 4. Yang berubah karena audit ini

| Perubahan | Berkas |
|-----------|--------|
| `anon` dicabut dari 5 fungsi + `sm_gp_buka_ulang()` menolak pemanggil tanpa sesi | `supabase/migrations/017_gp_perketat_eksekusi.sql` |
| Uji GP: ketepatan angka, isolasi antar-Sales, rantai persetujuan, regresi `anon` | `supabase/tests/keamanan-gp.sql` |
| Uji peran DIRECTOR & FINANCE | `supabase/tests/keamanan.sql` (17–19) |
| 10 indeks penutup foreign key | `supabase/migrations/013_audit_performa.sql` |
| Policy `FOR ALL` dipecah jadi INSERT/UPDATE/DELETE pada 3 tabel | `supabase/migrations/013_audit_performa.sql` |
| RPC `sm_lonceng()` — 6 permintaan jadi 1 | `supabase/migrations/014_lonceng.sql`, `lib/use-lonceng.ts` |
| Uji keamanan 10–16 (branding, eskalasi peran, activity feed, kepemilikan bukti, regresi policy) | `supabase/tests/keamanan.sql` |
| Navigasi Admin dobel pada 900–1280 px | `app/(app)/admin/page.tsx` |
| Ambang `sidebar` & `sentuhlebar` untuk mode Situs desktop | `tailwind.config.ts`, `components/shared/Shell.tsx`, `components/shared/HeaderAtas.tsx` |
| Penjagaan tipografi menyeluruh | `app/globals.css` |

---

## 5. Batas laporan ini — yang BELUM diuji

Disebutkan terbuka karena laporan audit yang menyembunyikan batasnya sendiri
lebih berbahaya daripada tidak ada laporan sama sekali.

1. **Tidak ada pengujian di peramban sungguhan oleh penyusun laporan ini.**
   Lingkungan kerjanya tanpa peramban grafis. Yang diverifikasi: typecheck,
   `next build` untuk seluruh rute, dan perilaku basis data lewat SQL. Tampilan
   diverifikasi lewat tangkapan layar dari pemakainya.
2. **Alur GPS dan kamera belum diuji di perangkat nyata.** Logika
   penolakannya sudah diuji tuntas di sisi basis data (uji 2, 5, 6, 7), tapi
   pembacaan `navigator.geolocation` dan pengambilan foto hanya bisa dibuktikan
   di ponsel sungguhan.
3. **Notifikasi hanya muncul saat aplikasi terbuka di salah satu tab.** Tanpa
   service worker dan server push, tidak ada pengingat yang datang saat
   aplikasi tertutup. Batas ini disebutkan langsung kepada pengguna di halaman
   Profil, bukan disembunyikan.
4. **Ekspor Excel dibatasi 5.000 baris per berkas.** Di atas itu peramban
   ponsel mulai kehabisan memori saat menyusun workbook. Pemotongan
   **diberitahukan** lewat toast, tidak didiamkan.
5. **Belum ada uji beban.** Seluruh angka performa di atas berasal dari
   basis data yang nyaris kosong. Perilaku pada 10.000 baris pipeline atau
   50.000 baris audit belum diketahui.
6. **Alias `…-project-dwp.vercel.app` masih terkunci Vercel Authentication.**
   Disengaja. URL publik satu-satunya adalah
   `https://sales-management-platform-git.vercel.app`.

---

## 6. Rekomendasi lanjutan

Diurutkan menurut manfaat dibanding usahanya.

1. **Tinjau ulang indeks setelah 2–3 bulan pemakaian nyata.** Advisor akan
   menunjukkan mana yang benar-benar tidak terpakai, dan saat itu angkanya baru
   punya arti.
2. **Tambahkan retensi untuk `sm_gps_events`.** Tabel ini mencatat *setiap*
   percobaan check-in termasuk yang gagal — rancangan yang benar untuk audit,
   tapi tumbuh terus tanpa batas. Arsipkan yang lebih tua dari satu tahun.
3. **Pertimbangkan service worker** bila pengingat saat aplikasi tertutup
   memang dibutuhkan. Ini bukan penambahan kecil: butuh server push dan
   pengelolaan langganan.
4. **Uji beban sebelum pemakaian penuh satu tim.** Terutama halaman Activity,
   yang menyatukan tujuh sumber dalam satu view.
5. **Hapus data uji dan akun contoh** sebelum pemakaian sungguhan.
6. **Ganti dua akun contoh** (`admin`, `budi.santoso`) dengan akun sungguhan,
   dan hapus jadwal contoh "PT Contoh Sejahtera" begitu pengujian selesai.
