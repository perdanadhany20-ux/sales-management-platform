package com.salesmanagement.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Sales Management Platform untuk Android.
 *
 * Isinya aplikasi web yang sama (satu kode, selalu versi terbaru) di dalam
 * WebView layar penuh, ditambah kemampuan native yang tidak dimiliki browser:
 * pembacaan lokasi check-in yang mendeteksi fake GPS (PembacaLokasi), kamera
 * untuk foto bukti, dan penyimpanan ekspor ke folder Download.
 *
 * WebView hanya membuka domain platform (BuildConfig.ALAMAT). Tautan ke domain
 * lain dibuka di aplikasi lain (browser, WhatsApp, telepon, peta).
 */
public class MainActivity extends Activity {

    private static final int MINTA_IZIN_LOKASI = 11;
    private static final int MINTA_IZIN_KAMERA = 12;
    private static final int PILIH_BERKAS = 21;

    private WebView web;
    private String hostPlatform;
    private volatile boolean tepercaya = false;

    // Permintaan lokasi yang menunggu izin
    private String idTunda;
    private String jadwalTunda;
    // Pemilih berkas yang menunggu hasil
    private ValueCallback<Uri[]> balasanBerkas;
    private Uri uriKamera;
    private WebChromeClient.FileChooserParams parameterBerkas;
    // Geolokasi web (cadangan) yang menunggu izin
    private GeolocationPermissions.Callback balasanGeo;
    private String asalGeo;

    @Override
    protected void onCreate(Bundle simpanan) {
        super.onCreate(simpanan);
        hostPlatform = Uri.parse(BuildConfig.ALAMAT).getHost();

        FrameLayout akar = new FrameLayout(this);
        web = new WebView(this);
        akar.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(akar);
        aturInset(akar);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " SMPAndroid/" + BuildConfig.VERSION_NAME);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new JembatanWeb(this), "SMPAndroid");
        web.setWebViewClient(new KlienWeb());
        web.setWebChromeClient(new KlienChrome());
        web.setDownloadListener((url, ua, disposisi, mime, panjang) -> bukaLuar(Uri.parse(url)));

        if (simpanan != null) web.restoreState(simpanan);
        else web.loadUrl(BuildConfig.ALAMAT);
    }

    /** Konten tidak boleh tertutup bilah status/navigasi atau keyboard (edge-to-edge Android 15). */
    private void aturInset(View akar) {
        akar.setOnApplyWindowInsetsListener((v, inset) -> {
            int atas, bawah, kiri, kanan;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = inset.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                atas = i.top; bawah = i.bottom; kiri = i.left; kanan = i.right;
            } else {
                atas = inset.getSystemWindowInsetTop(); bawah = inset.getSystemWindowInsetBottom();
                kiri = inset.getSystemWindowInsetLeft(); kanan = inset.getSystemWindowInsetRight();
            }
            v.setPadding(kiri, atas, kanan, bawah);
            return inset;
        });
    }

    boolean halamanTepercaya() {
        return tepercaya;
    }

    private boolean milikPlatform(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && hostPlatform != null
                && hostPlatform.equalsIgnoreCase(uri.getHost());
    }

    private void bukaLuar(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Tidak ada aplikasi untuk membuka tautan ini.", Toast.LENGTH_SHORT).show();
        }
    }

    // ── Lokasi check-in (native) ──────────────────────────────────────────

    void mintaLokasi(String id, String idJadwal) {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            idTunda = id;
            jadwalTunda = idJadwal;
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                    MINTA_IZIN_LOKASI);
            return;
        }
        new PembacaLokasi(this).baca(idJadwal, hasil -> kirimLokasi(id, hasil));
    }

    private void kirimLokasi(String id, JSONObject hasil) {
        String js = "window.__smpLokasi && window.__smpLokasi(" + JSONObject.quote(id) + "," + hasil + ");";
        web.evaluateJavascript(js, null);
    }

    // ── Simpan berkas ─────────────────────────────────────────────────────

    void simpanBerkas(String base64, String nama, String mime) {
        try {
            byte[] isi = Base64.decode(base64, Base64.DEFAULT);
            String aman = (nama == null ? "berkas" : nama).replaceAll("[\\\\/:*?\"<>|]", "_");
            OutputStream out;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, aman);
                v.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException();
                out = getContentResolver().openOutputStream(uri);
            } else {
                File folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                folder.mkdirs();
                out = new FileOutputStream(new File(folder, aman));
            }
            if (out == null) throw new IllegalStateException();
            out.write(isi);
            out.close();
            Toast.makeText(this, "Tersimpan di folder Download: " + aman, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Berkas gagal disimpan.", Toast.LENGTH_LONG).show();
        }
    }

    // ── Izin ──────────────────────────────────────────────────────────────

    @Override
    public void onRequestPermissionsResult(int kode, String[] izin, int[] hasil) {
        boolean diberi = hasil.length > 0 && hasil[0] == PackageManager.PERMISSION_GRANTED;
        if (kode == MINTA_IZIN_LOKASI) {
            if (idTunda != null) {
                String id = idTunda, jadwal = jadwalTunda;
                idTunda = null;
                jadwalTunda = null;
                if (diberi) new PembacaLokasi(this).baca(jadwal, h -> kirimLokasi(id, h));
                else kirimLokasi(id, PembacaLokasi.galat(
                        "Izin lokasi ditolak. Izinkan akses lokasi untuk aplikasi ini di Pengaturan HP, lalu coba lagi."));
            }
            if (balasanGeo != null) {
                balasanGeo.invoke(asalGeo, diberi, false);
                balasanGeo = null;
            }
        } else if (kode == MINTA_IZIN_KAMERA) {
            bukaPemilihBerkas(diberi);
        }
    }

    // ── Pemilih berkas + kamera (foto bukti) ──────────────────────────────

    private void bukaPemilihBerkas(boolean bolehKamera) {
        Intent galeri = parameterBerkas != null ? parameterBerkas.createIntent() : new Intent(Intent.ACTION_GET_CONTENT);
        if (galeri.getType() == null) galeri.setType("*/*");
        galeri.addCategory(Intent.CATEGORY_OPENABLE);

        Intent pilih = Intent.createChooser(galeri, "Pilih foto");
        uriKamera = null;
        if (bolehKamera) {
            File berkas = new File(PenyediaFoto.folder(this), "foto-" + System.currentTimeMillis() + ".jpg");
            uriKamera = PenyediaFoto.uriUntuk(this, berkas);
            Intent kamera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            kamera.putExtra(MediaStore.EXTRA_OUTPUT, uriKamera);
            kamera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            pilih.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{kamera});
        }
        try {
            startActivityForResult(pilih, PILIH_BERKAS);
        } catch (ActivityNotFoundException e) {
            if (balasanBerkas != null) balasanBerkas.onReceiveValue(null);
            balasanBerkas = null;
        }
    }

    @Override
    protected void onActivityResult(int kode, int hasil, Intent data) {
        super.onActivityResult(kode, hasil, data);
        if (kode != PILIH_BERKAS || balasanBerkas == null) return;
        Uri[] terpilih = null;
        if (hasil == RESULT_OK) {
            if (data != null && data.getData() != null) {
                terpilih = new Uri[]{data.getData()};
            } else if (data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                terpilih = new Uri[n];
                for (int i = 0; i < n; i++) terpilih[i] = data.getClipData().getItemAt(i).getUri();
            } else if (uriKamera != null) {
                terpilih = new Uri[]{uriKamera};
            }
        }
        balasanBerkas.onReceiveValue(terpilih);
        balasanBerkas = null;
    }

    // ── Klien WebView ─────────────────────────────────────────────────────

    private class KlienWeb extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri uri = r.getUrl();
            if (milikPlatform(uri)) return false;
            bukaLuar(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, Bitmap ikon) {
            tepercaya = milikPlatform(Uri.parse(url));
        }

        @Override
        public void doUpdateVisitedHistory(WebView v, String url, boolean muatUlang) {
            tepercaya = milikPlatform(Uri.parse(url));
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            tepercaya = false;
            String html = "<!doctype html><html lang='id'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    + "<body style='font-family:sans-serif;background:#f1f5f9;display:flex;align-items:center;"
                    + "justify-content:center;min-height:90vh;margin:0;text-align:center;color:#0f172a'>"
                    + "<div style='padding:24px'><h2 style='margin:0 0 8px'>Tidak ada koneksi</h2>"
                    + "<p style='color:#475569;margin:0 0 20px'>Periksa sambungan internet Anda, lalu coba lagi.</p>"
                    + "<a href='" + BuildConfig.ALAMAT + "' style='display:inline-block;background:#1d4ed8;color:#fff;"
                    + "padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold'>Coba lagi</a>"
                    + "</div></body></html>";
            v.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        }
    }

    private class KlienChrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String asal, GeolocationPermissions.Callback cb) {
            if (!milikPlatform(Uri.parse(asal))) {
                cb.invoke(asal, false, false);
                return;
            }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                cb.invoke(asal, true, false);
            } else {
                balasanGeo = cb;
                asalGeo = asal;
                requestPermissions(new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                        MINTA_IZIN_LOKASI);
            }
        }

        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (balasanBerkas != null) balasanBerkas.onReceiveValue(null);
            balasanBerkas = cb;
            parameterBerkas = p;
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                bukaPemilihBerkas(true);
            } else {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, MINTA_IZIN_KAMERA);
            }
            return true;
        }
    }

    // ── Siklus hidup ──────────────────────────────────────────────────────

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle keluar) {
        super.onSaveInstanceState(keluar);
        web.saveState(keluar);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
