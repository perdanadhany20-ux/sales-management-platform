# Aplikasi Android (APK / AAB)

Aplikasi Android Sales Management Platform adalah **Trusted Web Activity (TWA)**:
jendela layar penuh ke deployment web pelanggan, memakai mesin Chrome di ponsel.

Karena isinya adalah aplikasi web yang sama, **setiap pembaruan web langsung
berlaku di APK** — termasuk logo, perubahan fitur, dan status lisensi
(LICENSE_ARCHITECTURE.md). Tidak perlu merilis APK baru saat lisensi
di-upgrade, diperpanjang, atau diturunkan. APK baru hanya perlu dibangun bila
ikon/nama aplikasi/domain berubah.

Satu pelanggan = satu domain = satu APK (package id sendiri). Tidak ada fork kode.

## Prasyarat

- Node.js 20+, JDK 17, dan Android SDK (Bubblewrap bisa mengunduhkannya).
- Deployment web pelanggan sudah online dengan HTTPS.

## Membangun

```bash
# 1. Tulis konfigurasi untuk deployment pelanggan
node android/buat-twa.mjs sales.ptabc.co.id id.co.ptabc.sales "Sales PT ABC" 1

# 2. Bangun (pertama kali Bubblewrap membuat keystore android/android.keystore — SIMPAN baik-baik)
cd android
npx @bubblewrap/cli init --manifest=https://sales.ptabc.co.id/manifest.webmanifest   # hanya sekali, lalu pilih pakai twa-manifest.json
npx @bubblewrap/cli build
#  → app-release-signed.apk  (pasang langsung / distribusi internal)
#  → app-release-bundle.aab  (unggah ke Google Play)

# 3. Ambil sidik jari SHA-256 sertifikat penanda tangan
keytool -list -v -keystore android.keystore -alias android | grep SHA256
```

## Menghubungkan APK ke domain (tanpa bilah alamat)

Di Environment Variables proyek Vercel **pelanggan tersebut**:

| Variabel | Contoh |
|---|---|
| `ANDROID_PACKAGE_ID` | `id.co.ptabc.sales` |
| `ANDROID_CERT_SHA256` | `AB:CD:…` (64 heks bertitik dua; bila memakai Play App Signing, tambahkan sidik jari dari Play Console dipisah koma) |

Lalu redeploy. `https://<domain>/.well-known/assetlinks.json` akan berisi
pernyataan yang cocok, dan APK terbuka tanpa bilah alamat.

## Aset ikon

Ikon aplikasi diambil dari web: `public/icon-512.png` (any) dan
`public/icon-maskable-512.png` (adaptive icon, zona aman 60%). Keduanya dibuat
dari logo resmi di `public/brand/logo-1024.png`.

## Catatan izin

- **Lokasi**: `locationDelegation` aktif, sehingga check-in GPS Meeting memakai izin lokasi Android.
- **Kamera**: foto bukti Meeting memakai pemilih berkas/kamera bawaan Chrome.
- **Notifikasi**: `enableNotifications` aktif untuk pengingat.

Berkas keluaran (`twa-manifest.json`, `android.keystore`, `*.apk`, `*.aab`)
tidak di-commit — lihat `.gitignore`.
