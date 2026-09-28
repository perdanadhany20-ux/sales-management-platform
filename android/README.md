# Aplikasi Android

Aplikasi Android Sales Management Platform adalah aplikasi **native** ringan
(Java, tanpa pustaka tambahan) yang menampilkan deployment web pelanggan di
WebView layar penuh, ditambah kemampuan yang tidak dimiliki browser:

| Kemampuan | Kenapa native |
|---|---|
| **Lokasi check-in anti fake GPS** | Android menandai lokasi dari aplikasi pengubah lokasi (`Location.isMock()`). Penanda itu tidak pernah sampai ke browser. Laporan lokasi ditandatangani HMAC dan diverifikasi server (`sm_verifikasi_aplikasi`, migrasi 039). |
| Kamera foto bukti | Foto resolusi penuh lewat kamera HP (`PenyediaFoto`). |
| Simpan ekspor Excel | Ke folder Download (WebView tidak bisa mengunduh blob). |

Isi halaman tetap aplikasi web yang sama, jadi pembaruan web, logo, dan status
lisensi langsung berlaku tanpa merilis APK baru. APK baru hanya perlu bila kode
native, ikon, atau domain berubah.

**Satu pelanggan = satu APK.** Domain, kunci tanda tangan lokasi, dan keystore
berbeda per deployment. Tidak ada fork kode.

## Membangun APK untuk satu pelanggan

Prasyarat: JDK 17 dan Android SDK (platform 36). Build berjalan offline bila
dependensi Gradle sudah ada di cache.

1. Buat folder rahasia pelanggan **di luar repositori** (dan cadangkan):

   ```bash
   keytool -genkeypair -keystore sales-release.jks -alias sales -keyalg RSA -keysize 2048 -validity 10000
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # kunciTanda
   ```

2. Tulis `pelanggan.properties` di folder itu:

   ```properties
   url=https://sales.ptabc.co.id
   applicationId=id.co.ptabc.sales
   namaAplikasi=Sales PT ABC
   versionCode=1
   versionName=1.0.0
   kunciTanda=<64 heksadesimal>
   keystore=C:/lokasi/rahasia/sales-release.jks
   keyAlias=sales
   keystorePassword=<sandi keystore>
   ```

3. Pasang `kunciTanda` yang SAMA ke database pelanggan (tabel
   `sm_kunci_aplikasi`, hanya bisa ditulis service role):

   ```sql
   insert into sm_kunci_aplikasi (id, kunci) values (true, '<kunciTanda>')
   on conflict (id) do update set kunci = excluded.kunci, dibuat_pada = now();
   ```

4. Salin `pelanggan.properties` ke `android/` (diabaikan git), lalu bangun:

   ```bash
   cd android
   ./gradlew assembleRelease
   # → app/build/outputs/apk/release/app-release.apk
   ```

5. Unggah APK ke bucket Storage **privat** `aplikasi` milik pelanggan dengan
   nama `sales-management.apk`. Pengguna yang sudah masuk mengunduhnya lewat
   Profil → Aplikasi Android (`/api/aplikasi/unduh`, tautan sementara 5 menit).

## Riwayat versi

| Versi | Perubahan native |
|---|---|
| 1.1.0 (versionCode 2) | Layar pembuka berlogo yang memudar saat halaman pertama siap (tidak ada lagi layar putih kosong); bilah progres biru di atas saat membuka/memuat ulang halaman. |
| 1.0.0 (versionCode 1) | Rilis awal: WebView, lokasi anti fake GPS, kamera, simpan Excel. |

Perubahan tampilan web (animasi pindah menu, lisensi, dll.) berlaku otomatis di APK
tanpa build ulang — APK memuat website platform secara langsung.

## Merilis versi baru

Naikkan `versionCode` dan `versionName`, bangun dengan **keystore yang sama**
(tanpa itu APK baru tidak bisa dipasang menimpa versi lama), unggah ulang. Bila
versi lama harus dipaksa berhenti, naikkan *Versi aplikasi minimum* di
Admin → Nilai Bisnis → Aplikasi Android.

## Mewajibkan check-in lewat aplikasi

Admin → Nilai Bisnis → Aplikasi Android → *Wajib check-in lewat aplikasi*.
Nyalakan setelah seluruh Sales memasang APK: check-in Meeting dari browser
lalu ditolak dengan status `APP_REQUIRED`.

## Batasan yang jujur

- Kunci tanda tangan tertanam di APK. Orang yang membongkar APK bisa
  mengambilnya dan mengarang laporan. Itu jauh lebih sulit daripada memasang
  aplikasi fake GPS, dan APK hanya dibagikan ke pengguna yang sudah masuk.
  Kepastian penuh butuh Play Integrity API (distribusi lewat Google Play).
- HP yang di-root dengan modul penyembunyi (mis. Xposed) bisa menyembunyikan
  penanda `isMock`.
