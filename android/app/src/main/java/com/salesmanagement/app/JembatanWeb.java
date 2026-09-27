package com.salesmanagement.app;

import android.webkit.JavascriptInterface;

/**
 * Fungsi native yang bisa dipanggil halaman web sebagai window.SMPAndroid.
 *
 * Setiap metode memeriksa bahwa halaman yang sedang terbuka adalah domain
 * platform sendiri — WebView hanya membuka domain itu, tapi pemeriksaan
 * ganda ini memastikan halaman lain (seandainya termuat) tidak bisa meminta
 * laporan lokasi bertanda tangan.
 */
final class JembatanWeb {

    private final MainActivity aktivitas;

    JembatanWeb(MainActivity aktivitas) {
        this.aktivitas = aktivitas;
    }

    @JavascriptInterface
    public String versi() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public int kodeVersi() {
        return BuildConfig.VERSION_CODE;
    }

    /** Baca lokasi check-in; hasilnya dikirim ke window.__smpLokasi(id, json). */
    @JavascriptInterface
    public void mintaLokasi(final String idPermintaan, final String idJadwal) {
        if (!aktivitas.halamanTepercaya()) return;
        if (idPermintaan == null || idJadwal == null || !idJadwal.matches("[0-9a-fA-F-]{36}")) return;
        aktivitas.runOnUiThread(new Runnable() {
            @Override public void run() { aktivitas.mintaLokasi(idPermintaan, idJadwal); }
        });
    }

    /** Simpan berkas (mis. ekspor Excel) ke folder Download. */
    @JavascriptInterface
    public void simpanBerkas(final String base64, final String nama, final String mime) {
        if (!aktivitas.halamanTepercaya()) return;
        aktivitas.runOnUiThread(new Runnable() {
            @Override public void run() { aktivitas.simpanBerkas(base64, nama, mime); }
        });
    }
}
