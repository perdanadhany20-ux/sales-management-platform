// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
package com.salesmanagement.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Tempat aplikasi kamera menulis foto bukti Meeting.
 *
 * Kamera butuh URI content:// yang bisa ia tulisi (EXTRA_OUTPUT) — tanpanya
 * yang kembali hanya gambar mini berresolusi rendah. FileProvider biasanya
 * dipakai untuk ini, tapi ia bagian dari AndroidX; aplikasi ini sengaja tanpa
 * pustaka tambahan, jadi penyedia kecil ini menggantikannya. Hanya berkas di
 * cache/foto yang bisa dibuka, dan penyedia ini tidak diekspor.
 */
public class PenyediaFoto extends ContentProvider {

    static File folder(Context c) {
        File f = new File(c.getCacheDir(), "foto");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    static Uri uriUntuk(Context c, File berkas) {
        return new Uri.Builder().scheme("content")
                .authority(c.getPackageName() + ".foto")
                .appendPath(berkas.getName()).build();
    }

    private File berkasDari(Uri uri) throws FileNotFoundException {
        String nama = uri.getLastPathSegment();
        if (nama == null || nama.contains("/") || nama.contains("..")) throw new FileNotFoundException();
        return new File(folder(getContext()), nama);
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        int m = mode.contains("w") ? ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE
                | ParcelFileDescriptor.MODE_TRUNCATE : ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(berkasDari(uri), m);
    }

    @Override public String getType(Uri uri) { return "image/jpeg"; }

    @Override
    public Cursor query(Uri uri, String[] kolom, String sel, String[] arg, String urut) {
        try {
            File f = berkasDari(uri);
            MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException e) {
            return null;
        }
    }

    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
