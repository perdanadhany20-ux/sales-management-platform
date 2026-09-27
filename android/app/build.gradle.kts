import java.util.Properties

plugins {
    id("com.android.application")
}

/*
 * Satu APK = satu deployment pelanggan (lihat android/README.md).
 *
 * Nilai per pelanggan dibaca dari android/pelanggan.properties — berkas yang
 * TIDAK di-commit karena memuat kunci tanda tangan lokasi dan sandi keystore.
 * Tanpa berkas itu build tetap jalan untuk pengembangan, tapi APK-nya tidak
 * bisa dipakai check-in (laporan lokasinya tidak bertanda tangan sah).
 */
val pelanggan = Properties().apply {
    val berkas = rootProject.file("pelanggan.properties")
    if (berkas.exists()) berkas.inputStream().use { load(it) }
}
fun nilai(kunci: String, bawaan: String = ""): String =
    (pelanggan.getProperty(kunci) ?: bawaan).trim()

val alamat = nilai("url", "https://sales-management-platform-git.vercel.app").trimEnd('/')
require(alamat.startsWith("https://")) { "url di pelanggan.properties wajib https://" }

android {
    namespace = "com.salesmanagement.app"
    compileSdk = 36

    defaultConfig {
        applicationId = nilai("applicationId", "com.salesmanagement.app")
        minSdk = 24
        targetSdk = 35
        versionCode = nilai("versionCode", "1").toInt()
        versionName = nilai("versionName", "1.0.0")

        buildConfigField("String", "ALAMAT", "\"$alamat\"")
        // Kunci HMAC laporan lokasi. Padanannya disimpan server di
        // sm_kunci_aplikasi (migrasi 039) — tidak pernah di kode sumber.
        buildConfigField("String", "KUNCI_TANDA", "\"${nilai("kunciTanda")}\"")
        resValue("string", "app_name", nilai("namaAplikasi", "Sales Management"))
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    signingConfigs {
        create("rilis") {
            val ks = nilai("keystore")
            if (ks.isNotEmpty()) {
                storeFile = file(ks)
                storePassword = nilai("keystorePassword")
                keyAlias = nilai("keyAlias", "sales")
                keyPassword = nilai("keyPassword", nilai("keystorePassword"))
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (nilai("keystore").isNotEmpty()) signingConfig = signingConfigs.getByName("rilis")
        }
    }

    // Lint butuh pustaka yang diunduh terpisah; build rilis harus bisa jalan
    // offline di mesin developer.
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
