// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
package com.salesmanagement.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Membaca lokasi check-in langsung dari Android — bukan lewat browser.
 *
 * Inilah alasan aplikasi native ada: Android menandai setiap lokasi yang
 * berasal dari aplikasi "fake GPS" (penyedia lokasi tiruan) lewat
 * Location.isMock() / isFromMockProvider(). Penanda itu tidak pernah
 * diteruskan ke browser, jadi versi web hanya bisa menebak dari ciri-ciri.
 *
 * Beberapa sampel dikumpulkan selama beberapa detik; bila SATU saja bertanda
 * tiruan, seluruh bacaan dianggap palsu. Hasilnya ditandatangani HMAC-SHA256
 * dengan kunci yang dibagi dengan server (sm_kunci_aplikasi, migrasi 039),
 * sehingga server bisa membedakan laporan asli aplikasi dari laporan yang
 * dikarang lalu dikirim langsung ke API.
 */
final class PembacaLokasi {

    interface Hasil {
        void selesai(JSONObject hasil);
    }

    private static final long DURASI_MS = 7_000;
    private static final long BATAS_MS = 25_000;
    private static final int MAKS_SAMPEL = 6;
    private static final int MIN_SAMPEL = 3;

    private final Context konteks;
    private final Handler utama = new Handler(Looper.getMainLooper());

    PembacaLokasi(Context konteks) {
        this.konteks = konteks.getApplicationContext();
    }

    @SuppressLint("MissingPermission") // izin diperiksa MainActivity sebelum memanggil.
    void baca(final String idJadwal, final Hasil hasil) {
        final LocationManager lm = (LocationManager) konteks.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) {
            hasil.selesai(galat("Perangkat ini tidak mendukung GPS."));
            return;
        }
        boolean gps = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        boolean jaringan = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!gps && !jaringan) {
            hasil.selesai(galat("Lokasi perangkat mati. Nyalakan Lokasi (GPS) di pengaturan HP, lalu coba lagi."));
            return;
        }

        final long mulai = System.currentTimeMillis();
        final List<Location> sampel = new ArrayList<>();
        final boolean[] beres = {false};

        final LocationListener[] pendengar = new LocationListener[1];
        final Runnable tutup = new Runnable() {
            @Override public void run() {
                if (beres[0]) return;
                beres[0] = true;
                try { lm.removeUpdates(pendengar[0]); } catch (Exception ignored) { }
                if (sampel.isEmpty()) {
                    hasil.selesai(galat("Lokasi belum bisa dibaca. Pastikan GPS menyala dan Anda berada di tempat terbuka."));
                } else {
                    hasil.selesai(susun(idJadwal, sampel, System.currentTimeMillis() - mulai));
                }
            }
        };

        pendengar[0] = new LocationListener() {
            @Override public void onLocationChanged(Location lokasi) {
                if (beres[0]) return;
                sampel.add(lokasi);
                long lama = System.currentTimeMillis() - mulai;
                if (sampel.size() >= MAKS_SAMPEL || (sampel.size() >= MIN_SAMPEL && lama >= DURASI_MS)) {
                    utama.post(tutup);
                }
            }
            @Override public void onStatusChanged(String p, int s, Bundle b) { }
            @Override public void onProviderEnabled(String p) { }
            @Override public void onProviderDisabled(String p) { }
        };

        if (gps) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0, 0, pendengar[0], Looper.getMainLooper());
        if (jaringan) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0, 0, pendengar[0], Looper.getMainLooper());
        // Setelah durasi minimal, bila sampel sudah cukup, selesaikan; kalau
        // belum, beri waktu sampai batas atas untuk fix GPS pertama.
        utama.postDelayed(new Runnable() {
            @Override public void run() { if (sampel.size() >= MIN_SAMPEL) tutup.run(); }
        }, DURASI_MS + 500);
        utama.postDelayed(tutup, BATAS_MS);
    }

    @SuppressWarnings("deprecation")
    static boolean tiruan(Location l) {
        if (Build.VERSION.SDK_INT >= 31) return l.isMock();
        return l.isFromMockProvider();
    }

    private JSONObject susun(String idJadwal, List<Location> sampel, long durasi) {
        try {
            Location terbaik = sampel.get(0);
            boolean adaTiruan = false;
            JSONArray daftar = new JSONArray();
            for (Location l : sampel) {
                if (tiruan(l)) adaTiruan = true;
                if (l.getAccuracy() < terbaik.getAccuracy()) terbaik = l;
                JSONObject s = new JSONObject();
                s.put("lat", l.getLatitude());
                s.put("lng", l.getLongitude());
                s.put("accuracy", l.getAccuracy());
                s.put("t", l.getTime());
                s.put("provider", l.getProvider());
                daftar.put(s);
            }

            String lat = String.format(Locale.US, "%.7f", terbaik.getLatitude());
            String lng = String.format(Locale.US, "%.7f", terbaik.getLongitude());
            String akurasi = String.format(Locale.US, "%.1f", terbaik.getAccuracy());
            String versi = BuildConfig.VERSION_NAME;
            // Isi yang ditandatangani. Server memverifikasi HMAC atas teks INI
            // persis, lalu mencocokkan tiap bagiannya dengan parameter check-in.
            String muatan = "v1|" + idJadwal + "|" + lat + "|" + lng + "|" + akurasi + "|"
                    + (adaTiruan ? "1" : "0") + "|" + System.currentTimeMillis() + "|" + versi + "|" + nonce();

            JSONObject asli = new JSONObject();
            asli.put("payload", muatan);
            asli.put("tanda", hmac(muatan));
            asli.put("versi", versi);
            asli.put("mock", adaTiruan);

            JSONObject h = new JSONObject();
            h.put("ok", true);
            h.put("lat", Double.parseDouble(lat));
            h.put("lng", Double.parseDouble(lng));
            h.put("accuracy", Double.parseDouble(akurasi));
            h.put("altitude", terbaik.hasAltitude() ? terbaik.getAltitude() : JSONObject.NULL);
            h.put("altitudeAccuracy", Build.VERSION.SDK_INT >= 26 && terbaik.hasVerticalAccuracy()
                    ? terbaik.getVerticalAccuracyMeters() : JSONObject.NULL);
            h.put("speed", terbaik.hasSpeed() ? terbaik.getSpeed() : JSONObject.NULL);
            h.put("heading", terbaik.hasBearing() ? terbaik.getBearing() : JSONObject.NULL);
            h.put("waktu", iso(terbaik.getTime()));
            h.put("sampel", daftar);
            h.put("durasi_ms", durasi);
            h.put("mock", adaTiruan);
            h.put("native", asli);
            return h;
        } catch (Exception e) {
            return galat("Lokasi gagal diproses. Coba lagi.");
        }
    }

    private static String hmac(String teks) throws Exception {
        String kunci = BuildConfig.KUNCI_TANDA;
        if (kunci.isEmpty()) return "";
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(kunci.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] hasil = mac.doFinal(teks.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : hasil) sb.append(String.format(Locale.US, "%02x", b));
        return sb.toString();
    }

    private static String nonce() {
        byte[] b = new byte[12];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.US, "%02x", x));
        return sb.toString();
    }

    private static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    static JSONObject galat(String pesan) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("galat", pesan);
        } catch (JSONException ignored) { }
        return o;
    }
}
