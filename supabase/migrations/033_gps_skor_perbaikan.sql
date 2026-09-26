-- ════════════════════════════════════════════════════════════════════════════
-- 033 — Perbaikan sm_gps_skor_palsu dari migrasi 032
--
-- Migrasi 032 tidak pernah bisa menolak apa pun. Setiap kali ia hendak
-- mencatat alasan penolakan, ia justru meledak:
--
--     v_tanda := v_tanda || 'TITIK_BEKU';
--     ERROR: malformed array literal: "TITIK_BEKU"
--
-- Penyebabnya halus. Pada `text[] || 'sesuatu'`, literal tanpa tipe itu
-- bertipe `unknown`, dan Postgres memilih menafsirkannya sebagai ARRAY —
-- bukan sebagai satu elemen text. Karena 'TITIK_BEKU' bukan literal array
-- yang sah, seluruh fungsi gagal. Akibatnya sm_check_in ikut gagal, dan
-- check-in yang paling perlu ditolak justru menghasilkan galat, bukan
-- penolakan. Tertangkap oleh berkas uji supabase/tests/keamanan-gps.sql pada
-- percobaan pertama — bukan oleh pembacaan ulang kode.
--
-- Perbaikannya satu hal: setiap literal diberi tipe (`::text`), sehingga
-- operator yang terpilih adalah "tambahkan satu elemen ke array".
--
-- Migrasi 032 sengaja TIDAK diubah isinya. Ia sudah terpasang di produksi
-- dalam bentuk yang tertulis di berkasnya, dan berkas migrasi harus tetap
-- menjadi catatan jujur tentang apa yang pernah dijalankan.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_gps_skor_palsu(
  p_uid      uuid,
  p_lat      numeric,
  p_lng      numeric,
  p_accuracy numeric,
  p_altitude numeric,
  p_samples  jsonb,
  p_signals  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_skor   int := 0;
  v_tanda  text[] := '{}';
  v_n      int := 0;
  v_jitter numeric := NULL;
  v_akurasi_unik int := 0;
  -- Akurasi "kelas GNSS": di bawah nilai ini perangkat sedang mengaku punya
  -- fix satelit sungguhan, dan karena itu wajib menunjukkan ciri-cirinya.
  v_presisi CONSTANT numeric := 15;
  v_prev   record;
  v_jarak  numeric;
  v_detik  numeric;
  v_kmh    numeric;
BEGIN
  -- Laporan tidak ada sama sekali: sangat mencurigakan, BUKAN lulus. Aplikasi
  -- ini selalu mengirimkannya; yang memanggil RPC tanpa laporan berarti skrip.
  IF p_signals IS NULL THEN
    RETURN jsonb_build_object('skor', 60, 'tanda', ARRAY['LAPORAN_KOSONG']::text[]);
  END IF;

  -- Geolocation API sudah ditimpa (ekstensi peramban / devtools).
  IF COALESCE((p_signals->>'api_asli')::boolean, false) = false THEN
    v_skor := v_skor + 60;
    v_tanda := v_tanda || 'API_LOKASI_DITIMPA'::text;
  END IF;

  IF COALESCE((p_signals->>'objek_asli')::boolean, false) = false THEN
    v_skor := v_skor + 60;
    v_tanda := v_tanda || 'OBJEK_POSISI_PALSU'::text;
  END IF;

  IF p_samples IS NOT NULL AND jsonb_typeof(p_samples) = 'array' THEN
    SELECT count(*),
           public.sm_distance_meters(min(lat), min(lng), max(lat), max(lng)),
           count(DISTINCT acc)
      INTO v_n, v_jitter, v_akurasi_unik
    FROM (
      SELECT (e->>'lat')::numeric AS lat, (e->>'lng')::numeric AS lng,
             (e->>'accuracy')::numeric AS acc
      FROM jsonb_array_elements(p_samples) e
    ) s;
  END IF;

  IF v_n < 3 THEN
    v_skor := v_skor + 30;
    v_tanda := v_tanda || 'SAMPEL_TERLALU_SEDIKIT'::text;
  ELSIF v_jitter = 0 THEN
    IF p_accuracy IS NOT NULL AND p_accuracy <= v_presisi THEN
      -- Pertentangan yang paling menentukan: mengaku presisi beberapa meter
      -- tapi tidak bergeser sepersejuta derajat pun. GNSS tidak sediam itu.
      v_skor := v_skor + 45;
      v_tanda := v_tanda || 'TITIK_BEKU_TAPI_MENGAKU_PRESISI'::text;
    ELSE
      -- Fix wifi/menara seluler juga beku, dan itu wajar. Cukup dicatat.
      v_skor := v_skor + 10;
      v_tanda := v_tanda || 'TITIK_BEKU'::text;
    END IF;
  END IF;

  IF v_n >= 3 AND v_akurasi_unik = 1 THEN
    v_skor := v_skor + 10;
    v_tanda := v_tanda || 'AKURASI_TIDAK_BERUBAH'::text;
  END IF;

  IF p_altitude IS NULL THEN
    IF p_accuracy IS NOT NULL AND p_accuracy <= v_presisi THEN
      v_skor := v_skor + 25;
      v_tanda := v_tanda || 'TANPA_KETINGGIAN_TAPI_MENGAKU_PRESISI'::text;
    ELSE
      v_skor := v_skor + 5;
      v_tanda := v_tanda || 'TANPA_KETINGGIAN'::text;
    END IF;
  END IF;

  IF p_accuracy IS NOT NULL AND p_accuracy < 1 THEN
    v_skor := v_skor + 30;
    v_tanda := v_tanda || 'AKURASI_MUSTAHIL'::text;
  ELSIF p_accuracy IS NOT NULL AND p_accuracy <= 20 AND p_accuracy = round(p_accuracy) THEN
    v_skor := v_skor + 10;
    v_tanda := v_tanda || 'AKURASI_BULAT_RAPI'::text;
  END IF;

  -- Kehadiran lapangan dilakukan dari ponsel. Tanpa layar sentuh berarti dari
  -- komputer — tempat ekstensi pemalsu lokasi hidup.
  IF COALESCE((p_signals->>'sentuh')::boolean, true) = false THEN
    v_skor := v_skor + 25;
    v_tanda := v_tanda || 'BUKAN_PERANGKAT_SENTUH'::text;
  END IF;

  IF abs(COALESCE((p_signals->>'selisih_jam_ms')::numeric, 0)) > 120000 THEN
    v_skor := v_skor + 20;
    v_tanda := v_tanda || 'JAM_PERANGKAT_MENYIMPANG'::text;
  END IF;

  -- Satu-satunya sinyal di sini yang TIDAK bisa dikarang klien: dihitung dari
  -- jejak yang sudah tersimpan, bukan dari laporan yang baru masuk.
  SELECT latitude, longitude, created_at INTO v_prev
  FROM public.sm_gps_events
  WHERE user_id = p_uid AND validation_status = 'VALID'
  ORDER BY created_at DESC LIMIT 1;

  IF v_prev.created_at IS NOT NULL THEN
    v_jarak := public.sm_distance_meters(p_lat, p_lng, v_prev.latitude, v_prev.longitude);
    v_detik := GREATEST(EXTRACT(EPOCH FROM (now() - v_prev.created_at)), 1);
    v_kmh   := (v_jarak / v_detik) * 3.6;
    IF v_kmh > public.sm_angka_setelan('gps_max_kmh', 300) THEN
      v_skor := v_skor + 40;
      v_tanda := v_tanda || 'PINDAH_TERLALU_CEPAT'::text;
    END IF;
  END IF;

  RETURN jsonb_build_object('skor', LEAST(v_skor, 100), 'tanda', v_tanda);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_gps_skor_palsu(uuid, numeric, numeric, numeric,
  numeric, jsonb, jsonb) FROM public, anon, authenticated;
