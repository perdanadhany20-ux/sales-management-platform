-- ════════════════════════════════════════════════════════════════════════════
-- Sales Management Platform — SETUP LENGKAP (migrasi 001–042 + Admin pertama)
-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
--
-- Untuk project Supabase BARU yang masih kosong. Cara pakai:
--   1. Ubah 3 isian akun Admin di bawah (username, nama, kata sandi sementara).
--   2. Supabase → SQL Editor → New query → tempel SELURUH isi berkas → Run.
--   3. Hasil akhir menampilkan akun Admin. Saat login pertama Admin wajib ganti sandi.
--
-- Seluruh isi berjalan dalam SATU transaksi: bila ada yang gagal, tidak ada
-- yang tersimpan — perbaiki penyebabnya lalu jalankan ulang.
-- Berkas ini DIHASILKAN oleh scripts/gabung-migrasi.mjs — jangan diedit manual
-- selain 3 isian Admin; sumber aslinya supabase/migrations/.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ▼▼▼ UBAH DI SINI — akun Admin pertama ▼▼▼
CREATE TEMP TABLE _admin_awal (username text, nama text, sandi text) ON COMMIT DROP;
INSERT INTO _admin_awal VALUES (
  'admin',                -- username: huruf kecil/angka/titik/strip, 3–40 karakter
  'Administrator',        -- nama lengkap
  'GantiSandiIni!2026'    -- kata sandi SEMENTARA (min. 8 karakter)
);
-- ▲▲▲ selesai — tidak perlu mengubah apa pun di bawah ini ▲▲▲


-- ▼▼▼ 001_core_schema.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 001 — Skema inti: identitas, sesi, audit, pengaturan
--
-- Pola auth diadaptasi dari kedua baseline: BUKAN Supabase Auth, melainkan
-- tabel users + bcrypt + tabel sesi + cookie httpOnly. Konsekuensinya
-- auth.uid() selalu NULL di dalam policy, jadi identitas dibawa lewat klaim
-- JWT yang diterbitkan server (lihat lib/db-token.ts dan migrasi 004).
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Identitas ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  email         text,
  phone         text,
  -- Tiga peran sesuai §48. Sengaja tidak memakai enum: menambah peran baru
  -- lewat ALTER TYPE mengunci tabel, sedangkan CHECK bisa diubah tanpa itu.
  role          text NOT NULL DEFAULT 'SALES'
                CHECK (role IN ('SALES', 'MANAGER', 'ADMIN')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role   ON public.users (role) WHERE active;
CREATE INDEX IF NOT EXISTS idx_users_active ON public.users (active);

-- Kredensial dipisah dari tabel users supaya hash tidak pernah ikut terbawa
-- oleh SELECT * yang ceroboh pada profil user.
CREATE TABLE IF NOT EXISTS public.user_credentials (
  user_id       uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change   boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Yang disimpan hash-nya, bukan tokennya. Bocornya isi tabel ini tidak
-- memberi penyerang sesi yang bisa dipakai.
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON public.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id          bigserial PRIMARY KEY,
  username    text NOT NULL,
  ip          text,
  success     boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup
  ON public.login_attempts (username, attempted_at DESC);

-- ── Audit ───────────────────────────────────────────────────────────────────

-- Append-only: tidak ada policy UPDATE/DELETE untuk siapa pun (migrasi 005),
-- mengikuti pola audit immutable FieldServices. Jejak yang bisa disunting
-- bukan jejak audit.
CREATE TABLE IF NOT EXISTS public.audit_trail (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name  text,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity  ON public.audit_trail (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_trail (created_at DESC);

-- ── Pengaturan yang bisa diubah admin ───────────────────────────────────────

-- §21/§47: nilai bisnis yang mungkin berubah (kategori jadwal, opsi
-- probability, radius default, satuan) tinggal di sini, bukan di-hardcode di
-- kode. Bentuk key/value jsonb dipilih supaya menambah satu pengaturan baru
-- tidak perlu migrasi kolom.
CREATE TABLE IF NOT EXISTS public.sm_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Pemicu updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_touch ON public.users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();


-- ▼▼▼ 002_sales_schema.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 002 — Daily Report & Pipeline
--
-- Customer dibuat relasional sejak awal (§45) supaya jalur
-- Customer → Lead → Pipeline → Quotation → Won → Project (§46) bisa tumbuh
-- tanpa migrasi besar — tapi berhenti di situ: tidak ada modul Project
-- Management yang dibangun sekarang.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Customer & kontak ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  address    text,
  city       text,
  phone      text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Nama customer dinormalkan saat dicocokkan supaya "PT Maju" dan "pt maju"
-- tidak jadi dua baris berbeda yang memecah riwayat satu pelanggan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_name_unik
  ON public.sm_customers (lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.sm_customers (name);

CREATE TABLE IF NOT EXISTS public.sm_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES public.sm_customers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  position       text,
  phone_whatsapp text,
  email          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_customer ON public.sm_contacts (customer_id);

-- ── Daily Sales Report (§12–§16) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_daily_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  report_date    date NOT NULL,
  customer_id    uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,
  -- Nama customer ikut disalin sebagai teks: laporan harian adalah catatan
  -- historis, jadi ia harus tetap terbaca apa adanya walau baris customer-nya
  -- kelak dirapikan atau digabung.
  customer_name  text NOT NULL,
  contact_person text,
  position       text,
  phone_whatsapp text,
  activity       text NOT NULL,
  lead_project   text,
  result         text NOT NULL,
  next_action    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- §14: satu laporan per Sales per hari, ditegakkan database — bukan hanya
-- validasi frontend, yang bisa dilewati dengan memanggil API langsung.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_satu_per_hari
  ON public.sm_daily_reports (sales_user_id, report_date);

CREATE INDEX IF NOT EXISTS idx_daily_report_tanggal
  ON public.sm_daily_reports (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_report_sales
  ON public.sm_daily_reports (sales_user_id, report_date DESC);

DROP TRIGGER IF EXISTS trg_daily_report_touch ON public.sm_daily_reports;
CREATE TRIGGER trg_daily_report_touch BEFORE UPDATE ON public.sm_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── Sales Pipeline (§17–§22) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_pipeline (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pipeline_date    date NOT NULL DEFAULT current_date,
  customer_id      uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,
  customer_name    text NOT NULL,
  contact_person   text,
  project_detail   text NOT NULL,
  quantity         numeric(14,2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit             text NOT NULL DEFAULT 'unit',

  -- numeric, bukan float: perhitungan uang tidak boleh kena galat biner
  -- (§73). numeric(18,2) cukup untuk nilai proyek sampai ribuan triliun.
  project_value    numeric(18,2) NOT NULL DEFAULT 0 CHECK (project_value >= 0),
  project_hpp      numeric(18,2) NOT NULL DEFAULT 0 CHECK (project_hpp    >= 0),

  -- §19: GP dihitung database, bukan diketik manual. GENERATED STORED membuat
  -- nilainya mustahil berbeda dari rumusnya — termasuk lewat pemanggilan API
  -- langsung yang melewati frontend.
  project_gp       numeric(18,2)
                   GENERATED ALWAYS AS (project_value - project_hpp) STORED,

  -- §20: pembagian nol ditutup di sini. Inilah alasan NaN/Infinity tidak
  -- pernah bisa sampai ke layar — bukan karena frontend rajin memeriksanya,
  -- tapi karena nilainya memang tidak pernah ada di database.
  gp_percentage    numeric(6,2)
                   GENERATED ALWAYS AS (
                     CASE WHEN project_value > 0
                          THEN round((project_value - project_hpp) / project_value * 100, 2)
                          ELSE 0 END
                   ) STORED,

  -- Opsi yang boleh dipakai tinggal di sm_settings (§21); di sini hanya
  -- dijaga rentang wajarnya supaya data tetap masuk akal kalau daftar
  -- opsinya kelak diubah admin.
  probability      smallint NOT NULL DEFAULT 50
                   CHECK (probability BETWEEN 0 AND 100),
  estimated_closing date NOT NULL,
  next_action      text NOT NULL,
  stage            text NOT NULL DEFAULT 'OPEN'
                   CHECK (stage IN ('OPEN', 'QUOTATION', 'WON', 'LOST')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_sales
  ON public.sm_pipeline (sales_user_id, pipeline_date DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_closing
  ON public.sm_pipeline (estimated_closing);
CREATE INDEX IF NOT EXISTS idx_pipeline_probability
  ON public.sm_pipeline (probability);
CREATE INDEX IF NOT EXISTS idx_pipeline_customer
  ON public.sm_pipeline (customer_id);

DROP TRIGGER IF EXISTS trg_pipeline_touch ON public.sm_pipeline;
CREATE TRIGGER trg_pipeline_touch BEFORE UPDATE ON public.sm_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();


-- ▼▼▼ 003_schedule_meeting_schema.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 003 — Request Schedule, Meeting Attendance, GPS, Photo Evidence
--
-- Bentuk relasinya mengikuti §27: Attendance MILIK Request Schedule, dan
-- Evidence MILIK Attendance. Ini bukan sistem absensi umum yang berdiri
-- sendiri — tidak ada cara menyimpan kehadiran tanpa jadwal yang memayunginya.
--
--   sm_schedules ──1:1── sm_attendance ──1:N── sm_evidence
--         └──────────────1:N── sm_gps_events (termasuk percobaan yang GAGAL)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Lokasi meeting (§77, §78) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  address      text,
  latitude     numeric(10,7) NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
  longitude    numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- §30: radius bisa diatur per lokasi. Nilai bawaan diambil dari
  -- sm_settings('default_gps_radius_m') oleh aplikasi saat membuat lokasi,
  -- bukan dipaku 50 di sini.
  gps_radius_m integer NOT NULL DEFAULT 50 CHECK (gps_radius_m BETWEEN 10 AND 5000),
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_active ON public.sm_locations (active);

DROP TRIGGER IF EXISTS trg_locations_touch ON public.sm_locations;
CREATE TRIGGER trg_locations_touch BEFORE UPDATE ON public.sm_locations
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── Request Schedule (§23–§24) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date  date NOT NULL,
  schedule_time  time,
  customer_id    uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,
  customer_name  text NOT NULL,
  project        text,
  -- Daftar kategori yang sah tinggal di sm_settings supaya admin bisa
  -- menambah/mengubahnya tanpa migrasi (§24). Karena itu di sini tidak ada
  -- CHECK yang mengunci daftarnya.
  category       text NOT NULL,
  detail         text,

  -- Inilah yang membuat alur penyelesaian sadar-kategori (§83), dan yang
  -- dibaca penjaga penyelesaian di migrasi 004.
  --
  -- Kenapa kolom, bukan sekadar membandingkan category = 'Meeting': kategori
  -- bisa diganti namanya admin kapan saja. Kalau penjaganya mencocokkan
  -- string, mengganti nama "Meeting" jadi "Meeting Client" akan diam-diam
  -- MEMATIKAN seluruh syarat GPS + evidence — jadwal langsung bisa
  -- diselesaikan tanpa bukti apa pun, tanpa satu pun pesan error. Menyimpan
  -- keputusannya sebagai boolean saat jadwal dibuat membuatnya kebal
  -- terhadap penggantian nama.
  requires_attendance boolean NOT NULL DEFAULT false,

  assigned_to    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  location_id    uuid REFERENCES public.sm_locations(id) ON DELETE SET NULL,

  status         text NOT NULL DEFAULT 'UPCOMING'
                 CHECK (status IN ('UPCOMING', 'IN_PROGRESS', 'COMPLETED',
                                   'MISSED', 'CANCELLED')),
  notes          text,
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Jadwal yang mewajibkan kehadiran harus punya lokasi — tanpa titik acuan,
  -- tidak ada yang bisa dibandingkan dengan GPS si Sales, dan verifikasinya
  -- jadi teater belaka.
  CONSTRAINT sm_schedules_meeting_butuh_lokasi
    CHECK (NOT requires_attendance OR location_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_schedules_tanggal  ON public.sm_schedules (schedule_date DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_assignee ON public.sm_schedules (assigned_to, schedule_date DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_status   ON public.sm_schedules (status);
CREATE INDEX IF NOT EXISTS idx_schedules_customer ON public.sm_schedules (customer_id);

DROP TRIGGER IF EXISTS trg_schedules_touch ON public.sm_schedules;
CREATE TRIGGER trg_schedules_touch BEFORE UPDATE ON public.sm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── Meeting Attendance (§27, §36) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 1:1 dengan jadwal. UNIQUE-nya yang membuat check-in idempotent: percobaan
  -- kedua mengenai baris yang sama, bukan membuat kehadiran ganda.
  schedule_id  uuid NOT NULL UNIQUE REFERENCES public.sm_schedules(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  checkin_at   timestamptz,
  checkout_at  timestamptz,

  -- State machine §36. Urutannya ditegakkan fungsi di migrasi 004, bukan
  -- oleh klien.
  --
  -- CHECKED_IN dan GPS_VERIFIED sengaja tetap ada walau jarang terlihat:
  -- sm_check_in() membaca GPS dan memverifikasinya dalam satu transaksi, jadi
  -- barisnya mendarat langsung di EVIDENCE_PENDING. Keduanya dipertahankan
  -- karena bagian model status yang disepakati, dan supaya alur yang kelak
  -- memisahkan "sudah datang" dari "lokasi terbukti" tidak perlu mengubah
  -- constraint ini.
  state        text NOT NULL DEFAULT 'NOT_STARTED'
               CHECK (state IN ('NOT_STARTED', 'CHECKED_IN', 'GPS_VERIFIED',
                                'EVIDENCE_PENDING', 'READY_TO_COMPLETE',
                                'COMPLETED', 'GPS_FAILED', 'EXCEPTION')),

  -- Hasil verifikasi GPS saat check-in, disalin ke sini supaya penjaga
  -- penyelesaian tidak perlu memindai seluruh riwayat sm_gps_events.
  gps_verified boolean NOT NULL DEFAULT false,
  distance_m   numeric(10,2),
  accuracy_m   numeric(10,2),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_user  ON public.sm_attendance (user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_state ON public.sm_attendance (state);

DROP TRIGGER IF EXISTS trg_attendance_touch ON public.sm_attendance;
CREATE TRIGGER trg_attendance_touch BEFORE UPDATE ON public.sm_attendance
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── Photo Evidence (§33, §34, §80) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES public.sm_attendance(id) ON DELETE CASCADE,
  -- schedule_id ikut disimpan walau bisa diturunkan lewat attendance: policy
  -- RLS storage dan penyaringan daftar butuh jadwalnya tanpa join tambahan.
  schedule_id   uuid NOT NULL REFERENCES public.sm_schedules(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Foto TIDAK disimpan sebagai blob di baris ini (§57) — yang di sini hanya
  -- jalurnya di Supabase Storage.
  storage_path  text NOT NULL,
  thumb_path    text,
  mime_type     text,
  size_bytes    integer,

  -- GPS & waktu ikut menempel pada foto supaya bukti berdiri sebagai satu
  -- kesatuan (§34), bukan gambar lepas yang bisa dipasangkan ke mana saja.
  captured_at   timestamptz NOT NULL DEFAULT now(),
  latitude      numeric(10,7),
  longitude     numeric(10,7),
  accuracy_m    numeric(10,2),

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_attendance ON public.sm_evidence (attendance_id);
CREATE INDEX IF NOT EXISTS idx_evidence_schedule   ON public.sm_evidence (schedule_id);

-- ── Jejak GPS (§79) ─────────────────────────────────────────────────────────

-- Setiap percobaan dicatat, TERMASUK yang ditolak. Tabel yang hanya berisi
-- keberhasilan tidak bisa menjawab "apakah orang ini berkali-kali mencoba
-- check-in dari luar radius" — padahal justru itu yang ingin diketahui.
CREATE TABLE IF NOT EXISTS public.sm_gps_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id       uuid NOT NULL REFERENCES public.sm_schedules(id) ON DELETE CASCADE,
  attendance_id     uuid REFERENCES public.sm_attendance(id) ON DELETE SET NULL,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  event_type        text NOT NULL CHECK (event_type IN ('CHECK_IN', 'CHECK_OUT')),

  latitude          numeric(10,7) NOT NULL,
  longitude         numeric(10,7) NOT NULL,
  accuracy_m        numeric(10,2),

  -- Titik acuan ikut dibekukan di sini: kalau kelak koordinat atau radius
  -- lokasinya diubah admin, jejak lama tetap bisa dibaca apa adanya dan
  -- keputusan masa lalu tetap bisa dipertanggungjawabkan.
  expected_latitude  numeric(10,7),
  expected_longitude numeric(10,7),
  allowed_radius_m   integer,
  distance_m         numeric(10,2),

  validation_status text NOT NULL
                    CHECK (validation_status IN ('VALID', 'SCHEDULE_MISMATCH',
                                                 'ASSIGNMENT_MISMATCH',
                                                 'LOW_ACCURACY', 'OUTSIDE_RADIUS',
                                                 'NO_LOCATION', 'ALREADY_CLOSED')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gps_schedule ON public.sm_gps_events (schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_user     ON public.sm_gps_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_status   ON public.sm_gps_events (validation_status);

-- ── Exception / override admin (§39, §84) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id      uuid NOT NULL REFERENCES public.sm_schedules(id) ON DELETE CASCADE,
  original_failure text NOT NULL,
  reason           text NOT NULL,
  approved_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at      timestamptz NOT NULL DEFAULT now(),
  resulting_status text NOT NULL,

  -- Alasan kosong atau satu-dua huruf membuat catatan override tidak ada
  -- gunanya saat ditinjau berbulan-bulan kemudian.
  CONSTRAINT sm_exceptions_alasan_berisi CHECK (length(trim(reason)) >= 10)
);

CREATE INDEX IF NOT EXISTS idx_exceptions_schedule ON public.sm_exceptions (schedule_id);


-- ▼▼▼ 004_functions.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 004 — Fungsi identitas, jarak, dan penjaga alur Meeting
--
-- Berkas ini adalah SATU-SATUNYA tempat keabsahan check-in dan penyelesaian
-- Meeting diputuskan (§37, §38). Klien tidak pernah menghitung jarak, tidak
-- pernah menyatakan dirinya sah, dan tidak punya jalan lain menuju COMPLETED
-- untuk jadwal yang mewajibkan kehadiran.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Identitas dari klaim JWT ────────────────────────────────────────────────

-- Platform ini tidak memakai Supabase Auth, jadi auth.uid() selalu NULL.
-- Identitas dibawa lewat JWT yang diterbitkan server (lib/db-token.ts) dan
-- dibaca di sini. STABLE, bukan IMMUTABLE: nilainya tetap dalam satu
-- pernyataan tapi berbeda antar permintaan.
CREATE OR REPLACE FUNCTION public.sm_jwt(claim text)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> claim,
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.sm_uid()
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v text := public.sm_jwt('sub');
BEGIN
  -- Token tanpa `sub`, atau `sub` yang bentuknya bukan UUID, harus berarti
  -- "tidak ada identitas" — bukan menggagalkan seluruh query dengan error
  -- konversi, yang akan membuat halaman kosong tanpa penjelasan.
  IF v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sm_role()
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT upper(public.sm_jwt('user_role')); $$;

CREATE OR REPLACE FUNCTION public.sm_is_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.sm_role() = 'ADMIN'; $$;

/** Manager DAN Admin — dipakai policy "boleh lihat semua / boleh assign". */
CREATE OR REPLACE FUNCTION public.sm_is_pengawas()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.sm_role() IN ('MANAGER', 'ADMIN'); $$;

-- ── Jarak Haversine ─────────────────────────────────────────────────────────

-- Diadaptasi dari fs_distance_meters (FieldServices migrasi 005). LEAST/
-- GREATEST mengurung argumen acos di [-1,1]: tanpa itu, dua titik yang
-- praktis identik bisa menghasilkan 1.0000000002 karena pembulatan floating
-- point dan acos() melempar error domain — yakni justru pada kasus paling
-- umum, orang yang berdiri tepat di lokasinya.
CREATE OR REPLACE FUNCTION public.sm_distance_meters(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT round((6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  ))::numeric, 2);
$$;

/** Ambang akurasi GPS (meter) dari sm_settings; 100 m bila belum disetel. */
CREATE OR REPLACE FUNCTION public.sm_ambang_akurasi()
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::numeric FROM public.sm_settings
      WHERE key = 'gps_accuracy_threshold_m'),
    100
  );
$$;

-- ── Check-in (§25, §26, §28–§32) ────────────────────────────────────────────

-- Urutan pemeriksaan disengaja dan mengikuti FieldServices: jadwal dulu, lalu
-- penugasan, baru GPS. Kalau orangnya memang bukan yang ditugaskan, seberapa
-- dekat ia berdiri tidak relevan sama sekali.
--
-- Idempotent: memanggilnya lagi pada jadwal yang sudah terverifikasi
-- mengembalikan kehadiran yang sama, bukan membuat baris baru.
CREATE OR REPLACE FUNCTION public.sm_check_in(
  p_schedule_id uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy    numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := public.sm_uid();
  v_sched     public.sm_schedules%ROWTYPE;
  v_lok       public.sm_locations%ROWTYPE;
  v_status    text;
  v_distance  numeric;
  v_att_id    uuid;
  v_gps_id    uuid;
  v_ambang    numeric := public.sm_ambang_akurasi();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_sched.requires_attendance THEN
    RAISE EXCEPTION 'Jadwal ini tidak memerlukan kehadiran ber-GPS.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_lok FROM public.sm_locations WHERE id = v_sched.location_id;

  -- Rantai keputusan. Hanya SATU status yang keluar, dan itu yang dicatat.
  IF v_sched.assigned_to IS DISTINCT FROM v_uid THEN
    -- §98: ini uji lintas-user yang wajib. Sales B tidak boleh check-in pada
    -- Meeting milik Sales A, sedekat apa pun ia berdiri.
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF v_sched.schedule_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  ELSIF v_lok.id IS NULL THEN
    v_status := 'NO_LOCATION';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_ambang THEN
    -- §31: GPS yang buruk tidak boleh diam-diam dianggap sah.
    v_status := 'LOW_ACCURACY';
  ELSE
    v_distance := public.sm_distance_meters(p_lat, p_lng, v_lok.latitude, v_lok.longitude);
    IF v_distance > v_lok.gps_radius_m THEN
      v_status := 'OUTSIDE_RADIUS';
    ELSE
      v_status := 'VALID';
    END IF;
  END IF;

  -- Dicatat SEBELUM percabangan berhasil/gagal, supaya percobaan yang ditolak
  -- pun meninggalkan jejak (§79).
  INSERT INTO public.sm_gps_events (
    schedule_id, user_id, event_type, latitude, longitude, accuracy_m,
    expected_latitude, expected_longitude, allowed_radius_m, distance_m,
    validation_status
  ) VALUES (
    p_schedule_id, v_uid, 'CHECK_IN', p_lat, p_lng, p_accuracy,
    v_lok.latitude, v_lok.longitude, v_lok.gps_radius_m, v_distance, v_status
  )
  RETURNING id INTO v_gps_id;

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object(
      'validation_status', v_status,
      'distance_m', v_distance,
      'allowed_radius_m', v_lok.gps_radius_m,
      'attendance_id', NULL
    );
  END IF;

  -- ON CONFLICT pada schedule_id (UNIQUE di migrasi 003) — inilah yang
  -- membuat panggilan kedua aman.
  INSERT INTO public.sm_attendance (
    schedule_id, user_id, checkin_at, state, gps_verified, distance_m, accuracy_m
  ) VALUES (
    p_schedule_id, v_uid, now(), 'EVIDENCE_PENDING', true, v_distance, p_accuracy
  )
  -- Baris yang sudah ada dirujuk dengan nama tabel TANPA skema; bentuk
  -- `public.sm_attendance.state` di sini ditolak parser.
  ON CONFLICT (schedule_id) DO UPDATE SET
    gps_verified = true,
    distance_m   = EXCLUDED.distance_m,
    accuracy_m   = EXCLUDED.accuracy_m,
    checkin_at   = COALESCE(sm_attendance.checkin_at, EXCLUDED.checkin_at),
    -- Jangan mundurkan state kehadiran yang sudah lebih maju: check-in ulang
    -- karena sinyal putus tidak boleh menghapus foto yang sudah diunggah.
    state        = CASE
                     WHEN sm_attendance.state IN ('COMPLETED', 'READY_TO_COMPLETE')
                       THEN sm_attendance.state
                     ELSE 'EVIDENCE_PENDING'
                   END
  RETURNING id INTO v_att_id;

  -- HANYA baris jejak yang baru saja dibuat. Menambal semua baris jadwal ini
  -- yang attendance_id-nya masih kosong akan salah: percobaan gagal milik
  -- orang lain (ASSIGNMENT_MISMATCH) ikut tercatut ke kehadiran ini, dan
  -- jejak auditnya justru jadi menyesatkan.
  UPDATE public.sm_gps_events SET attendance_id = v_att_id WHERE id = v_gps_id;

  UPDATE public.sm_schedules
    SET status = 'IN_PROGRESS'
    WHERE id = p_schedule_id AND status = 'UPCOMING';

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_CHECK_IN', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('distance_m', v_distance, 'accuracy_m', p_accuracy));

  RETURN jsonb_build_object(
    'validation_status', 'VALID',
    'distance_m', v_distance,
    'allowed_radius_m', v_lok.gps_radius_m,
    'attendance_id', v_att_id
  );
END;
$$;

-- ── Evidence menggeser state ────────────────────────────────────────────────

-- Begitu foto pertama masuk, kehadiran naik ke READY_TO_COMPLETE. Ditaruh
-- sebagai trigger, bukan di kode aplikasi, supaya jalur mana pun yang
-- menyisipkan evidence menghasilkan state yang sama.
CREATE OR REPLACE FUNCTION public.sm_evidence_naikkan_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.sm_attendance
    SET state = 'READY_TO_COMPLETE'
    WHERE id = NEW.attendance_id
      AND gps_verified = true
      AND state IN ('CHECKED_IN', 'GPS_VERIFIED', 'EVIDENCE_PENDING');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evidence_naikkan_state ON public.sm_evidence;
CREATE TRIGGER trg_evidence_naikkan_state AFTER INSERT ON public.sm_evidence
  FOR EACH ROW EXECUTE FUNCTION public.sm_evidence_naikkan_state();

-- ── Penyelesaian Meeting (§38, §82) ─────────────────────────────────────────

-- Syaratnya diperiksa ULANG dari database di sini. Apa pun yang dikirim
-- klien tidak dipercaya — klien hanya menyebut jadwal mana yang ingin
-- diselesaikan.
CREATE OR REPLACE FUNCTION public.sm_complete_schedule(p_schedule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid        uuid := public.sm_uid();
  v_sched      public.sm_schedules%ROWTYPE;
  v_att        public.sm_attendance%ROWTYPE;
  v_jml_bukti  integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_sched.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'COMPLETED', 'note', 'sudah selesai');
  END IF;

  IF v_sched.assigned_to IS DISTINCT FROM v_uid AND NOT public.sm_is_pengawas() THEN
    RAISE EXCEPTION 'Anda tidak berhak menyelesaikan jadwal ini.'
      USING ERRCODE = '42501';
  END IF;

  -- §83: jadwal non-Meeting tidak dibebani syarat GPS/foto yang tidak
  -- relevan baginya.
  IF NOT v_sched.requires_attendance THEN
    UPDATE public.sm_schedules
      SET status = 'COMPLETED', completed_at = now()
      WHERE id = p_schedule_id;

    INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
    VALUES (v_uid, 'SCHEDULE_COMPLETED', 'sm_schedules', p_schedule_id::text,
            jsonb_build_object('requires_attendance', false));

    RETURN jsonb_build_object('ok', true, 'status', 'COMPLETED');
  END IF;

  SELECT * INTO v_att FROM public.sm_attendance WHERE schedule_id = p_schedule_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ATTENDANCE',
      'message', 'Belum ada check-in untuk meeting ini.');
  END IF;

  IF NOT v_att.gps_verified THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'GPS_NOT_VERIFIED',
      'message', 'Lokasi Anda belum terverifikasi.');
  END IF;

  SELECT count(*) INTO v_jml_bukti FROM public.sm_evidence
    WHERE attendance_id = v_att.id;

  IF v_jml_bukti = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_EVIDENCE',
      'message', 'Foto bukti kehadiran belum diunggah.');
  END IF;

  UPDATE public.sm_attendance
    SET state = 'COMPLETED', checkout_at = COALESCE(checkout_at, now())
    WHERE id = v_att.id;

  UPDATE public.sm_schedules
    SET status = 'COMPLETED', completed_at = now()
    WHERE id = p_schedule_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_COMPLETED', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('attendance_id', v_att.id, 'evidence_count', v_jml_bukti,
                             'distance_m', v_att.distance_m));

  RETURN jsonb_build_object('ok', true, 'status', 'COMPLETED');
END;
$$;

-- ── Override admin (§39, §84) ───────────────────────────────────────────────

-- Jalan keluar yang SAH untuk meeting yang gagal diverifikasi — dan satu-
-- satunya. Bedanya dengan bypass: ia menuntut alasan tertulis, mencatat siapa
-- yang menyetujui, dan meninggalkan baris permanen di sm_exceptions.
CREATE OR REPLACE FUNCTION public.sm_override_completion(
  p_schedule_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := public.sm_uid();
  v_sched  public.sm_schedules%ROWTYPE;
  v_att    public.sm_attendance%ROWTYPE;
  v_gagal  text;
BEGIN
  IF NOT public.sm_is_pengawas() THEN
    RAISE EXCEPTION 'Hanya Manager atau Admin yang boleh melakukan override.'
      USING ERRCODE = '42501';
  END IF;

  IF length(trim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Alasan override wajib diisi minimal 10 karakter.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_att FROM public.sm_attendance WHERE schedule_id = p_schedule_id;

  v_gagal := CASE
    WHEN v_att.id IS NULL           THEN 'NO_ATTENDANCE'
    WHEN NOT v_att.gps_verified     THEN 'GPS_NOT_VERIFIED'
    WHEN NOT EXISTS (SELECT 1 FROM public.sm_evidence WHERE attendance_id = v_att.id)
                                    THEN 'NO_EVIDENCE'
    ELSE 'NONE'
  END;

  INSERT INTO public.sm_exceptions (
    schedule_id, original_failure, reason, approved_by, resulting_status
  ) VALUES (p_schedule_id, v_gagal, trim(p_reason), v_uid, 'COMPLETED');

  IF v_att.id IS NOT NULL THEN
    UPDATE public.sm_attendance SET state = 'EXCEPTION' WHERE id = v_att.id;
  END IF;

  UPDATE public.sm_schedules
    SET status = 'COMPLETED', completed_at = now()
    WHERE id = p_schedule_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_OVERRIDE', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('original_failure', v_gagal, 'reason', trim(p_reason)));

  RETURN jsonb_build_object('ok', true, 'original_failure', v_gagal);
END;
$$;

-- Fungsi di atas SECURITY DEFINER: ia berjalan dengan hak pemiliknya, jadi
-- siapa yang boleh memanggilnya harus dibatasi rapat. Postgres memberi
-- EXECUTE ke role `public` secara bawaan pada setiap fungsi baru — itu
-- ditarik dulu di sini, baru diberikan ke satu peran yang memang butuh.
--
-- `anon` sengaja TIDAK ikut. Klien aplikasi selalu membawa JWT terbitan
-- server dengan role 'authenticated' (lihat lib/db-token.ts); permintaan yang
-- berjalan sebagai anon berarti tidak ada sesi, dan tidak ada alasan sah
-- baginya menyentuh alur check-in maupun penyelesaian meeting.
REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           FROM public;

GRANT EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           TO authenticated;

-- Fungsi trigger tidak pernah dipanggil langsung. Membiarkannya bisa
-- dieksekusi lewat /rest/v1/rpc/ hanya menambah permukaan serang tanpa
-- memberi manfaat apa pun — trigger tetap menyala tanpa hak EXECUTE ini.
REVOKE EXECUTE ON FUNCTION public.sm_evidence_naikkan_state()
  FROM public, anon, authenticated;


-- ▼▼▼ 005_rls.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 005 — Row Level Security
--
-- Inilah lapisan penegak wewenang yang sebenarnya (§7, §55). Menyembunyikan
-- tombol di frontend tidak menghalangi siapa pun memanggil PostgREST langsung
-- dengan curl; policy di berkas inilah yang menghalanginya.
--
-- KEPUTUSAN PENTING — kenapa Sales TIDAK punya policy UPDATE pada
-- sm_schedules, sm_attendance, dan sm_gps_events:
--
--   §37 menuntut `UPDATE sm_schedules SET status='completed'` tidak boleh
--   cukup untuk menyelesaikan Meeting. Cara paling kokoh memenuhinya bukan
--   menulis policy UPDATE yang rumit dan berusaha menebak niat penulisnya,
--   melainkan TIDAK MEMBERI jalur UPDATE sama sekali. Satu-satunya pintu
--   menuju COMPLETED adalah sm_complete_schedule() — yang SECURITY DEFINER,
--   memeriksa ulang semua prasyarat, dan mencatat jejaknya.
--
--   Konsekuensinya disengaja: tidak ada kombinasi permintaan PostgREST yang
--   bisa disusun Sales untuk menembus urutan check-in → GPS → foto.
-- ════════════════════════════════════════════════════════════════════════════

-- Klien membawa JWT terbitan server dengan klaim role = 'authenticated'
-- (lihat lib/db-token.ts). Permintaan tanpa token berjalan sebagai `anon` dan
-- sengaja tidak diberi hak apa pun.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_trail      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_pipeline      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_attendance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_evidence      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_gps_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_exceptions    ENABLE ROW LEVEL SECURITY;

-- ── users ───────────────────────────────────────────────────────────────────

-- Semua yang login boleh melihat daftar user: dropdown "tugaskan ke" dan
-- penyaringan "per Sales" tidak bisa jalan tanpanya. Kolom rahasia tidak ada
-- di tabel ini — hash password tinggal di user_credentials.
DROP POLICY IF EXISTS users_baca ON public.users;
CREATE POLICY users_baca ON public.users
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS users_admin_kelola ON public.users;
CREATE POLICY users_admin_kelola ON public.users
  FOR ALL TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

-- Kredensial & sesi: tidak ada policy untuk siapa pun. Keduanya hanya boleh
-- disentuh route handler lewat service role, yang melewati RLS. Tanpa policy,
-- klien mana pun membacanya sebagai tabel kosong.
-- (login_attempts sama — hanya ditulis server.)

-- ── audit_trail — append-only (§65) ─────────────────────────────────────────

DROP POLICY IF EXISTS audit_baca ON public.audit_trail;
CREATE POLICY audit_baca ON public.audit_trail
  FOR SELECT TO authenticated
  USING (public.sm_is_pengawas() OR actor_id = public.sm_uid());

-- Sengaja TIDAK ada policy UPDATE maupun DELETE, untuk siapa pun — termasuk
-- Admin. Jejak audit yang bisa disunting bukan jejak audit.
DROP POLICY IF EXISTS audit_tulis ON public.audit_trail;
CREATE POLICY audit_tulis ON public.audit_trail
  FOR INSERT TO authenticated WITH CHECK (actor_id = public.sm_uid());

-- ── sm_settings (§47) ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS settings_baca ON public.sm_settings;
CREATE POLICY settings_baca ON public.sm_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS settings_admin ON public.sm_settings;
CREATE POLICY settings_admin ON public.sm_settings
  FOR ALL TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

-- ── Customer & kontak — data master bersama ─────────────────────────────────

DROP POLICY IF EXISTS customers_baca ON public.sm_customers;
CREATE POLICY customers_baca ON public.sm_customers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS customers_tulis ON public.sm_customers;
CREATE POLICY customers_tulis ON public.sm_customers
  FOR INSERT TO authenticated WITH CHECK (public.sm_uid() IS NOT NULL);

DROP POLICY IF EXISTS customers_ubah ON public.sm_customers;
CREATE POLICY customers_ubah ON public.sm_customers
  FOR UPDATE TO authenticated
  USING (created_by = public.sm_uid() OR public.sm_is_pengawas())
  WITH CHECK (created_by = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS customers_hapus ON public.sm_customers;
CREATE POLICY customers_hapus ON public.sm_customers
  FOR DELETE TO authenticated USING (public.sm_is_admin());

DROP POLICY IF EXISTS contacts_baca ON public.sm_contacts;
CREATE POLICY contacts_baca ON public.sm_contacts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS contacts_tulis ON public.sm_contacts;
CREATE POLICY contacts_tulis ON public.sm_contacts
  FOR INSERT TO authenticated WITH CHECK (public.sm_uid() IS NOT NULL);

DROP POLICY IF EXISTS contacts_ubah ON public.sm_contacts;
CREATE POLICY contacts_ubah ON public.sm_contacts
  FOR UPDATE TO authenticated
  USING (public.sm_uid() IS NOT NULL) WITH CHECK (public.sm_uid() IS NOT NULL);

-- ── Daily Report (§49) ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS dr_baca ON public.sm_daily_reports;
CREATE POLICY dr_baca ON public.sm_daily_reports
  FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

-- WITH CHECK mengunci sales_user_id ke pemanggil: tanpa ini, Sales A bisa
-- menyisipkan laporan atas nama Sales B dan merusak angka kepatuhan.
DROP POLICY IF EXISTS dr_tulis ON public.sm_daily_reports;
CREATE POLICY dr_tulis ON public.sm_daily_reports
  FOR INSERT TO authenticated
  WITH CHECK (sales_user_id = public.sm_uid());

-- USING memutuskan baris mana yang boleh disentuh; WITH CHECK memutuskan
-- bentuk baris SESUDAH diubah. Keduanya diperlukan — tanpa WITH CHECK,
-- laporan sendiri bisa "dioper" ke user lain lewat satu UPDATE.
DROP POLICY IF EXISTS dr_ubah ON public.sm_daily_reports;
CREATE POLICY dr_ubah ON public.sm_daily_reports
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid())
  WITH CHECK (sales_user_id = public.sm_uid());

DROP POLICY IF EXISTS dr_hapus ON public.sm_daily_reports;
CREATE POLICY dr_hapus ON public.sm_daily_reports
  FOR DELETE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin());

-- ── Pipeline (§49) ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS pl_baca ON public.sm_pipeline;
CREATE POLICY pl_baca ON public.sm_pipeline
  FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS pl_tulis ON public.sm_pipeline;
CREATE POLICY pl_tulis ON public.sm_pipeline
  FOR INSERT TO authenticated
  WITH CHECK (sales_user_id = public.sm_uid());

DROP POLICY IF EXISTS pl_ubah ON public.sm_pipeline;
CREATE POLICY pl_ubah ON public.sm_pipeline
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid())
  WITH CHECK (sales_user_id = public.sm_uid());

DROP POLICY IF EXISTS pl_hapus ON public.sm_pipeline;
CREATE POLICY pl_hapus ON public.sm_pipeline
  FOR DELETE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin());

-- ── Lokasi (§78) ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS lok_baca ON public.sm_locations;
CREATE POLICY lok_baca ON public.sm_locations
  FOR SELECT TO authenticated USING (true);

-- Radius dan koordinat menentukan lolos-tidaknya verifikasi GPS. Kalau Sales
-- boleh menyuntingnya, seluruh pemeriksaan jarak kehilangan arti — cukup
-- lebarkan radius jadi 5000 m dan check-in dari mana pun akan lolos.
DROP POLICY IF EXISTS lok_kelola ON public.sm_locations;
CREATE POLICY lok_kelola ON public.sm_locations
  FOR ALL TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

-- ── Request Schedule (§76) ──────────────────────────────────────────────────

DROP POLICY IF EXISTS sch_baca ON public.sm_schedules;
CREATE POLICY sch_baca ON public.sm_schedules
  FOR SELECT TO authenticated
  USING (assigned_to = public.sm_uid()
         OR created_by = public.sm_uid()
         OR public.sm_is_pengawas());

-- Sales boleh MENGAJUKAN jadwal, tapi tidak boleh menugaskannya ke dirinya
-- sendiri maupun langsung menandainya selesai: assigned_to wajib kosong dan
-- status wajib UPCOMING. Penugasan adalah wewenang Manager/Admin (§76).
DROP POLICY IF EXISTS sch_ajukan ON public.sm_schedules;
CREATE POLICY sch_ajukan ON public.sm_schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.sm_is_pengawas()
    OR (created_by = public.sm_uid()
        AND assigned_to IS NULL
        AND status = 'UPCOMING')
  );

-- Hanya Manager/Admin yang punya jalur UPDATE langsung. Sales tidak — lihat
-- catatan panjang di kepala berkas ini. Jalan Sales menuju COMPLETED hanya
-- lewat sm_complete_schedule().
DROP POLICY IF EXISTS sch_kelola ON public.sm_schedules;
CREATE POLICY sch_kelola ON public.sm_schedules
  FOR UPDATE TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

DROP POLICY IF EXISTS sch_hapus ON public.sm_schedules;
CREATE POLICY sch_hapus ON public.sm_schedules
  FOR DELETE TO authenticated USING (public.sm_is_pengawas());

-- ── Attendance — hanya baca; penulisan lewat RPC ────────────────────────────

DROP POLICY IF EXISTS att_baca ON public.sm_attendance;
CREATE POLICY att_baca ON public.sm_attendance
  FOR SELECT TO authenticated
  USING (user_id = public.sm_uid() OR public.sm_is_pengawas());

-- ── Evidence (§101) ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ev_baca ON public.sm_evidence;
CREATE POLICY ev_baca ON public.sm_evidence
  FOR SELECT TO authenticated
  USING (user_id = public.sm_uid() OR public.sm_is_pengawas());

-- Tiga syarat sekaligus, dan ketiganya perlu:
--   user_id = pemanggil     → foto tidak bisa diunggah atas nama orang lain
--   kehadiran memang miliknya → tidak bisa menempel ke jadwal orang lain
--   gps_verified = true     → foto tanpa lokasi terverifikasi tidak diterima,
--                             sehingga urutan GPS → foto tidak bisa dibalik
DROP POLICY IF EXISTS ev_tulis ON public.sm_evidence;
CREATE POLICY ev_tulis ON public.sm_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.sm_uid()
    AND EXISTS (
      SELECT 1 FROM public.sm_attendance a
       WHERE a.id = attendance_id
         AND a.user_id = public.sm_uid()
         AND a.schedule_id = sm_evidence.schedule_id
         AND a.gps_verified = true
    )
  );

-- Bukti yang bisa dihapus pemiliknya bukan bukti. Hanya Admin, dan itu pun
-- meninggalkan jejak di audit_trail lewat aplikasi.
DROP POLICY IF EXISTS ev_hapus ON public.sm_evidence;
CREATE POLICY ev_hapus ON public.sm_evidence
  FOR DELETE TO authenticated USING (public.sm_is_admin());

-- ── Jejak GPS — hanya baca ──────────────────────────────────────────────────

-- §42: Sales melihat jejaknya sendiri, pengawas melihat semua. Tidak ada
-- policy INSERT: satu-satunya penulis adalah sm_check_in() yang SECURITY
-- DEFINER, sehingga jejak tidak bisa dikarang dari klien.
DROP POLICY IF EXISTS gps_baca ON public.sm_gps_events;
CREATE POLICY gps_baca ON public.sm_gps_events
  FOR SELECT TO authenticated
  USING (user_id = public.sm_uid() OR public.sm_is_pengawas());

-- ── Exception (§39) ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS exc_baca ON public.sm_exceptions;
CREATE POLICY exc_baca ON public.sm_exceptions
  FOR SELECT TO authenticated
  USING (public.sm_is_pengawas()
         OR EXISTS (SELECT 1 FROM public.sm_schedules s
                     WHERE s.id = schedule_id AND s.assigned_to = public.sm_uid()));

-- Tidak ada policy INSERT: override hanya lewat sm_override_completion(),
-- yang menuntut alasan tertulis dan mencatat penyetujunya.


-- ▼▼▼ 006_storage.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 006 — Supabase Storage untuk foto bukti meeting (§57)
--
-- Bucket PRIVAT. Foto kehadiran memuat wajah orang dan jejak lokasinya;
-- bucket publik berarti siapa pun yang menebak URL bisa mengunduhnya tanpa
-- login. Aplikasi menyajikannya lewat signed URL berumur pendek.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence', 'evidence', false,
  5242880,                                   -- 5 MB; foto sudah dikompres klien
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Kesepakatan jalur berkas ────────────────────────────────────────────────
--
--   evidence/{user_id}/{schedule_id}/{namaberkas}.jpg
--
-- user_id ditaruh sebagai folder PERTAMA dengan sengaja: dengan begitu
-- kepemilikan bisa dibaca dari jalurnya sendiri, dan policy di bawah cukup
-- membandingkan satu segmen — tanpa perlu menjoin tabel lain di setiap
-- pemeriksaan unggahan.

DROP POLICY IF EXISTS evidence_unggah ON storage.objects;
CREATE POLICY evidence_unggah ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = public.sm_uid()::text
  );

DROP POLICY IF EXISTS evidence_baca ON storage.objects;
CREATE POLICY evidence_baca ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (
      (storage.foldername(name))[1] = public.sm_uid()::text
      OR public.sm_is_pengawas()
    )
  );

-- Tidak ada policy UPDATE: berkas bukti tidak boleh ditimpa. Menimpa foto
-- lama dengan foto baru pada jalur yang sama akan mengubah isi bukti tanpa
-- meninggalkan jejak apa pun — persis bentuk manipulasi yang hendak dicegah
-- §35 dan §81.

DROP POLICY IF EXISTS evidence_hapus ON storage.objects;
CREATE POLICY evidence_hapus ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'evidence' AND public.sm_is_admin());


-- ▼▼▼ 007_seed_settings.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 007 — Nilai bisnis awal (§21, §24, §30, §47)
--
-- Semua yang ada di sini BISA diubah admin lewat menu Konfigurasi. Yang
-- ditanam di sini hanya titik awalnya, supaya aplikasi bisa jalan sejak
-- pasang pertama tanpa layar setup wajib.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.sm_settings (key, value, description) VALUES

  -- `requires_attendance` di sinilah yang menentukan kategori mana yang
  -- menyeret alur GPS + foto. Nilainya disalin ke kolom sm_schedules saat
  -- jadwal dibuat — lihat catatan di migrasi 003 soal kenapa disalin, bukan
  -- dicocokkan ulang lewat nama.
  ('schedule_categories',
   '[{"name":"Meeting","requires_attendance":true},
     {"name":"Other Sales Activity","requires_attendance":false}]'::jsonb,
   'Kategori Request Schedule. requires_attendance=true mewajibkan check-in GPS + foto bukti.'),

  ('probability_options',
   '[10, 25, 50, 75, 90]'::jsonb,
   'Pilihan probability Pipeline (persen).'),

  ('default_gps_radius_m',
   '50'::jsonb,
   'Radius bawaan lokasi meeting baru, dalam meter. Bisa ditimpa per lokasi.'),

  ('gps_accuracy_threshold_m',
   '100'::jsonb,
   'Akurasi GPS terburuk yang masih diterima saat check-in, dalam meter. Dibaca sm_ambang_akurasi().'),

  ('pipeline_units',
   '["unit","set","titik","paket","lot","meter"]'::jsonb,
   'Pilihan satuan pada Pipeline.'),

  ('activity_categories',
   '["Meeting","Follow Up","Quotation","Customer Visit","Survey","Other"]'::jsonb,
   'Kategori aktivitas untuk analitik halaman Activity.')

ON CONFLICT (key) DO NOTHING;


-- ▼▼▼ 008_perketat_hak_eksekusi.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 008 — Perketat hak eksekusi fungsi SECURITY DEFINER
--
-- Ditemukan oleh database linter Supabase (0028/0029) setelah 004 diterapkan:
-- ketiga fungsi alur meeting bisa dipanggil peran `anon` lewat
-- /rest/v1/rpc/. Badan fungsinya memang sudah menolak pemanggil tanpa
-- identitas (sm_uid() NULL → error 28000), jadi ini bukan lubang yang bisa
-- ditembus — tapi tidak ada alasan membiarkan pintunya terbuka.
--
-- Migrasi ini dipertahankan terpisah, bukan dilebur ke 004, supaya riwayat
-- basis data yang sudah berjalan tetap jujur. 004 juga sudah diperbaiki agar
-- pemasangan baru langsung benar sejak awal; menjalankan keduanya berurutan
-- aman karena REVOKE/GRANT bersifat idempoten.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           FROM anon, public;

REVOKE EXECUTE ON FUNCTION public.sm_evidence_naikkan_state()
  FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           TO authenticated;


-- ▼▼▼ 009_dashboard.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 009 — Agregat dashboard dalam satu panggilan
--
-- §62/§63 melarang menarik seluruh baris ke browser hanya untuk menghitung
-- sebuah donat. Fungsi ini menghitung SEMUA angka dashboard di dalam Postgres
-- dan mengembalikannya sebagai satu jsonb — satu perjalanan jaringan, bukan
-- delapan, dan nol baris mentah yang menyeberang.
--
-- SECURITY INVOKER, bukan DEFINER, dan itu keputusan penting: fungsinya
-- berjalan sebagai pemanggil, sehingga RLS tetap berlaku pada setiap tabel
-- yang ia baca. Akibatnya satu fungsi ini otomatis benar untuk semua peran —
-- Sales melihat angkanya sendiri, Manager melihat seluruh tim — tanpa satu
-- pun percabangan peran di dalam badannya. Kalau ia dibuat DEFINER, setiap
-- cabang itu harus ditulis tangan, dan satu saja yang terlewat berarti Sales
-- melihat angka milik orang lain.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_dashboard(
  p_dari   date DEFAULT (current_date - 29),
  p_sampai date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hasil        jsonb;
  v_hari_ini     date := current_date;
  v_jml_sales    integer;
  v_sudah_lapor  integer;
BEGIN
  -- Pembanding kepatuhan laporan harian. Untuk Sales, RLS membuat
  -- sm_daily_reports hanya berisi miliknya, jadi angkanya jadi 0 atau 1 —
  -- yang memang artinya "saya sudah lapor hari ini atau belum".
  SELECT count(*) INTO v_jml_sales
    FROM public.users WHERE active AND role = 'SALES';

  SELECT count(DISTINCT sales_user_id) INTO v_sudah_lapor
    FROM public.sm_daily_reports WHERE report_date = v_hari_ini;

  SELECT jsonb_build_object(

    'periode', jsonb_build_object('dari', p_dari, 'sampai', p_sampai),

    'daily_report', jsonb_build_object(
      'total_sales',   v_jml_sales,
      'sudah_lapor',   v_sudah_lapor,
      'belum_lapor',   GREATEST(0, v_jml_sales - v_sudah_lapor),
      'dalam_periode', (SELECT count(*) FROM public.sm_daily_reports
                         WHERE report_date BETWEEN p_dari AND p_sampai)
    ),

    'pipeline', (
      SELECT jsonb_build_object(
        'jumlah',      count(*),
        'total_nilai', COALESCE(sum(project_value), 0),
        'total_hpp',   COALESCE(sum(project_hpp),   0),
        'total_gp',    COALESCE(sum(project_gp),    0),
        -- Rata-rata GP% ditimbang nilai proyek, bukan avg(gp_percentage).
        -- Rata-rata polos memperlakukan proyek Rp 5 juta setara proyek
        -- Rp 5 miliar, sehingga satu peluang kecil bermargin tinggi bisa
        -- menaikkan angka tim padahal uangnya tidak ke mana-mana.
        'gp_persen',   CASE WHEN COALESCE(sum(project_value), 0) > 0
                            THEN round(sum(project_gp) / sum(project_value) * 100, 2)
                            ELSE 0 END,
        'akan_closing', count(*) FILTER (
                          WHERE estimated_closing BETWEEN v_hari_ini AND v_hari_ini + 30
                            AND stage NOT IN ('WON', 'LOST'))
      )
      FROM public.sm_pipeline
      WHERE pipeline_date BETWEEN p_dari AND p_sampai
    ),

    'probability', (
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'probability')::int), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
                 'probability', probability,
                 'jumlah',      count(*),
                 'nilai',       COALESCE(sum(project_value), 0)
               ) AS x
        FROM public.sm_pipeline
        WHERE pipeline_date BETWEEN p_dari AND p_sampai
        GROUP BY probability
      ) t
    ),

    'gp_kondisi', (
      SELECT jsonb_build_object(
        'positif', count(*) FILTER (WHERE project_gp >  0),
        'nol',     count(*) FILTER (WHERE project_gp =  0),
        'negatif', count(*) FILTER (WHERE project_gp <  0)
      )
      FROM public.sm_pipeline
      WHERE pipeline_date BETWEEN p_dari AND p_sampai
    ),

    'jadwal', (
      SELECT jsonb_build_object(
        'upcoming',    count(*) FILTER (WHERE status = 'UPCOMING'),
        'berjalan',    count(*) FILTER (WHERE status = 'IN_PROGRESS'),
        'selesai',     count(*) FILTER (WHERE status = 'COMPLETED'),
        'terlewat',    count(*) FILTER (WHERE status = 'MISSED'),
        'dibatalkan',  count(*) FILTER (WHERE status = 'CANCELLED'),
        'hari_ini',    count(*) FILTER (WHERE schedule_date = v_hari_ini
                                          AND status IN ('UPCOMING', 'IN_PROGRESS'))
      )
      FROM public.sm_schedules
      WHERE schedule_date BETWEEN p_dari AND p_sampai
    ),

    'meeting', (
      SELECT jsonb_build_object(
        'total',            count(*),
        'selesai',          count(*) FILTER (WHERE s.status = 'COMPLETED'),
        'belum_mulai',      count(*) FILTER (WHERE a.id IS NULL AND s.status <> 'COMPLETED'),
        'menunggu_foto',    count(*) FILTER (WHERE a.state = 'EVIDENCE_PENDING'),
        'siap_selesai',     count(*) FILTER (WHERE a.state = 'READY_TO_COMPLETE'),
        'exception',        count(*) FILTER (WHERE a.state = 'EXCEPTION')
      )
      FROM public.sm_schedules s
      LEFT JOIN public.sm_attendance a ON a.schedule_id = s.id
      WHERE s.requires_attendance
        AND s.schedule_date BETWEEN p_dari AND p_sampai
    ),

    -- Percobaan check-in yang DITOLAK. Ini angka pengecualian yang jadi inti
    -- dashboard operasional: yang perlu ditindaklanjuti bukan meeting yang
    -- lancar, melainkan yang lokasinya tidak terverifikasi.
    'gps_gagal', (
      SELECT COALESCE(jsonb_object_agg(validation_status, jml), '{}'::jsonb)
      FROM (
        SELECT validation_status, count(*) AS jml
        FROM public.sm_gps_events
        WHERE validation_status <> 'VALID'
          AND created_at::date BETWEEN p_dari AND p_sampai
        GROUP BY validation_status
      ) g
    ),

    -- Tren enam bulan terakhir. generate_series dipakai supaya bulan yang
    -- TIDAK punya data tetap muncul sebagai nol — tanpa itu, grafiknya
    -- melompati bulan kosong dan sumbu waktunya berbohong.
    'tren_bulanan', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'bulan',    to_char(b.bulan, 'Mon'),
               'laporan',  COALESCE(d.jml, 0),
               'pipeline', COALESCE(p.jml, 0),
               'nilai',    COALESCE(p.nilai, 0)
             ) ORDER BY b.bulan), '[]'::jsonb)
      FROM generate_series(
             date_trunc('month', v_hari_ini) - interval '5 months',
             date_trunc('month', v_hari_ini),
             interval '1 month'
           ) AS b(bulan)
      LEFT JOIN (
        SELECT date_trunc('month', report_date) AS bulan, count(*) AS jml
        FROM public.sm_daily_reports GROUP BY 1
      ) d ON d.bulan = b.bulan
      LEFT JOIN (
        SELECT date_trunc('month', pipeline_date) AS bulan,
               count(*) AS jml, sum(project_value) AS nilai
        FROM public.sm_pipeline GROUP BY 1
      ) p ON p.bulan = b.bulan
    )

  ) INTO v_hasil;

  RETURN v_hasil;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_dashboard(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_dashboard(date, date) TO authenticated;


-- ▼▼▼ 010_dashboard_widgets.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 010 — Kartu dashboard yang bisa dinyalakan/dimatikan admin
--
-- Disimpan sebagai satu baris sm_settings, bukan tabel sendiri. Isinya daftar
-- tetap yang pendek dan hanya dibaca satu halaman; membuatkan tabel beserta
-- RLS-nya sendiri untuk enam baris konfigurasi adalah kerumitan yang tidak
-- dibayar apa pun.
--
-- `key` di bawah HARUS cocok dengan konstanta di app/(app)/dashboard/page.tsx.
-- Kartu yang key-nya tidak dikenal akan diabaikan begitu saja — itu disengaja,
-- supaya menghapus sebuah kartu dari kode tidak membuat halamannya rusak bagi
-- pemasangan yang pengaturannya masih menyebut kartu lama.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('dashboard_widgets',
   '[
      {"key":"kepatuhan",   "label":"Kepatuhan Laporan Hari Ini", "aktif":true},
      {"key":"nilai_pipeline","label":"Nilai Pipeline",           "aktif":true},
      {"key":"gross_profit", "label":"Gross Profit",              "aktif":true},
      {"key":"probability",  "label":"Sebaran Probability",       "aktif":true},
      {"key":"status_jadwal","label":"Status Jadwal",             "aktif":true},
      {"key":"tren",         "label":"Aktivitas 6 Bulan Terakhir","aktif":true},
      {"key":"meeting",      "label":"Meeting",                   "aktif":true},
      {"key":"pengecualian", "label":"Perlu Ditindaklanjuti",     "aktif":true}
    ]'::jsonb,
   'Kartu mana yang tampil di Dashboard. Diatur lewat Administrasi → Tampilan.')
ON CONFLICT (key) DO NOTHING;


-- ▼▼▼ 011_activity_feed.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 011 — Riwayat aktivitas Sales (halaman /activity)
--
-- Feed ini TIDAK menyimpan apa pun. Ia menyatukan jejak yang sudah ditulis
-- modul lain — laporan harian, pipeline, jadwal, check-in, foto bukti, dan
-- override — menjadi satu urutan waktu.
--
-- Kenapa view, bukan tabel `sm_activities` yang diisi trigger: tabel seperti
-- itu adalah salinan kedua dari kebenaran yang sama, dan salinan kedua selalu
-- berakhir berbeda dari aslinya — baris yang gagal ditulis karena trigger-nya
-- error, baris lama yang tidak ikut terhapus, atau catatan yang tidak sesuai
-- lagi setelah datanya disunting. View tidak bisa melenceng: ia MEMBACA
-- sumbernya setiap kali dibuka.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.sm_activity_feed;

-- security_invoker = true adalah inti keamanannya. Tanpa itu, view berjalan
-- dengan hak PEMILIKNYA (postgres), sehingga RLS di tabel-tabel sumber
-- dilewati begitu saja dan setiap Sales bisa membaca aktivitas seluruh tim
-- lewat satu SELECT. Dengan opsi ini, tiap cabang UNION di bawah tetap
-- tunduk pada policy yang sama seperti kalau tabelnya dibuka langsung.
CREATE VIEW public.sm_activity_feed
WITH (security_invoker = true) AS

-- ── Laporan harian ──────────────────────────────────────────────────────────
SELECT
  'DAILY_REPORT:' || r.id::text          AS id,
  'DAILY_REPORT'::text                   AS jenis,
  r.created_at                           AS terjadi_pada,
  r.report_date                          AS tanggal_acuan,
  r.sales_user_id                        AS user_id,
  r.customer_name                        AS judul,
  r.activity                             AS keterangan,
  r.result                               AS tambahan,
  'sm_daily_reports'::text               AS entitas,
  r.id                                   AS entitas_id,
  NULL::numeric                          AS nilai,
  NULL::text                             AS status
FROM public.sm_daily_reports r

UNION ALL

-- ── Pipeline ────────────────────────────────────────────────────────────────
SELECT
  'PIPELINE:' || p.id::text,
  'PIPELINE',
  p.created_at,
  p.pipeline_date,
  p.sales_user_id,
  p.customer_name,
  p.project_detail,
  p.next_action,
  'sm_pipeline',
  p.id,
  p.project_value,
  p.probability::text
FROM public.sm_pipeline p

UNION ALL

-- ── Jadwal dibuat / diajukan ────────────────────────────────────────────────
SELECT
  'SCHEDULE:' || s.id::text,
  'SCHEDULE',
  s.created_at,
  s.schedule_date,
  COALESCE(s.assigned_to, s.created_by),
  s.customer_name,
  s.category,
  s.detail,
  'sm_schedules',
  s.id,
  NULL::numeric,
  s.status
FROM public.sm_schedules s

UNION ALL

-- ── Jadwal diselesaikan ─────────────────────────────────────────────────────
--
-- Baris terpisah dari cabang di atas dengan sengaja: pembuatan dan
-- penyelesaian terjadi pada waktu yang berbeda, dan feed yang hanya memuat
-- salah satunya menyembunyikan separuh pekerjaan hari itu.
SELECT
  'COMPLETED:' || s.id::text,
  CASE WHEN s.requires_attendance THEN 'MEETING_SELESAI' ELSE 'SCHEDULE_SELESAI' END,
  s.completed_at,
  s.schedule_date,
  COALESCE(s.assigned_to, s.created_by),
  s.customer_name,
  s.category,
  NULL::text,
  'sm_schedules',
  s.id,
  NULL::numeric,
  'COMPLETED'
FROM public.sm_schedules s
WHERE s.completed_at IS NOT NULL

UNION ALL

-- ── Percobaan check-in, termasuk yang ditolak (§79) ─────────────────────────
SELECT
  'GPS:' || g.id::text,
  'CHECK_IN',
  g.created_at,
  g.created_at::date,
  g.user_id,
  COALESCE(s.customer_name, 'Meeting'),
  COALESCE(l.name, 'Lokasi tidak diketahui'),
  NULL::text,
  'sm_gps_events',
  g.id,
  g.distance_m,
  g.validation_status
FROM public.sm_gps_events g
LEFT JOIN public.sm_schedules s ON s.id = g.schedule_id
LEFT JOIN public.sm_locations l ON l.id = s.location_id

UNION ALL

-- ── Foto bukti ──────────────────────────────────────────────────────────────
SELECT
  'EVIDENCE:' || e.id::text,
  'BUKTI',
  e.captured_at,
  e.captured_at::date,
  e.user_id,
  COALESCE(s.customer_name, 'Meeting'),
  'Foto bukti kehadiran',
  NULL::text,
  'sm_evidence',
  e.id,
  NULL::numeric,
  NULL::text
FROM public.sm_evidence e
LEFT JOIN public.sm_schedules s ON s.id = e.schedule_id

UNION ALL

-- ── Override pengawas (§39) ─────────────────────────────────────────────────
SELECT
  'EXCEPTION:' || x.id::text,
  'OVERRIDE',
  x.approved_at,
  x.approved_at::date,
  x.approved_by,
  COALESCE(s.customer_name, 'Meeting'),
  x.reason,
  x.original_failure,
  'sm_exceptions',
  x.id,
  NULL::numeric,
  x.resulting_status
FROM public.sm_exceptions x
LEFT JOIN public.sm_schedules s ON s.id = x.schedule_id;

-- anon tidak ikut: tanpa sesi tidak ada aktivitas yang sah untuk dibaca.
GRANT SELECT ON public.sm_activity_feed TO authenticated;

COMMENT ON VIEW public.sm_activity_feed IS
  'Riwayat aktivitas gabungan untuk /activity. Hanya membaca; RLS tabel '
  'sumber tetap berlaku lewat security_invoker.';


-- ▼▼▼ 012_branding.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 012 — Identitas visual platform (Administrasi → Tampilan)
--
-- Nama platform, nama perusahaan, logo, dan warna merek disimpan di database,
-- bukan dipaku di kode. Alasannya sederhana: mengganti nama atau warna adalah
-- keputusan pemilik platform, dan menuntut satu siklus deploy untuk setiap
-- perubahan seperti itu membuat hal yang seharusnya sepele jadi mahal.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('branding',
   '{
      "nama_platform":  "Sales Management Platform",
      "nama_pendek":    "Sales MP",
      "nama_portal":    "",
      "nama_perusahaan":"",
      "kredit":         "",
      "kontak_bantuan": "",
      "warna_utama":    "#1d4ed8",
      "warna_utama_2":  "#1e40af",
      "warna_aksen":    "#eda100",
      "logo_url":       "",
      "latar_login_url":"",
      "latar_dashboard_url": ""
    }'::jsonb,
   'Identitas visual: nama, logo, warna, dan gambar latar. Diatur lewat Administrasi → Tampilan.')
ON CONFLICT (key) DO NOTHING;

-- ── Bucket aset merek ───────────────────────────────────────────────────────
--
-- PUBLIK, berbeda dari bucket 'evidence' yang privat — dan bedanya disengaja.
-- Logo serta latar halaman login harus tampil SEBELUM seseorang masuk, jadi
-- tidak ada sesi yang bisa dipakai menandatangani URL-nya. Isinya pun memang
-- untuk dilihat semua orang: tidak ada wajah, lokasi, atau data pribadi di
-- sini. Yang tetap dibatasi rapat adalah siapa yang boleh MENULIS.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding', 'branding', true,
  8388608,                                   -- 8 MB, cukup untuk foto latar
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS branding_unggah ON storage.objects;
CREATE POLICY branding_unggah ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND public.sm_is_admin());

-- Berbeda dari 'evidence' yang haram ditimpa: berkas merek memang diganti
-- berulang kali, dan menumpuk versi lama hanya menyisakan sampah yang tidak
-- pernah dibersihkan siapa pun.
DROP POLICY IF EXISTS branding_ganti ON storage.objects;
CREATE POLICY branding_ganti ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'branding' AND public.sm_is_admin())
  WITH CHECK (bucket_id = 'branding' AND public.sm_is_admin());

DROP POLICY IF EXISTS branding_hapus ON storage.objects;
CREATE POLICY branding_hapus ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'branding' AND public.sm_is_admin());


-- ▼▼▼ 013_audit_performa.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 013 — Perbaikan dari audit performa (§108)
--
-- Dua temuan nyata dari database linter Supabase, keduanya diperbaiki di sini.
-- Temuan ketiga ("unused index") sengaja TIDAK ditindaklanjuti: indeks itu
-- terbaca belum terpakai semata karena platformnya baru berisi data contoh.
-- Membuang indeks yang memang dirancang untuk penyaringan sehari-hari hanya
-- karena belum ada yang menyaring apa pun adalah kesimpulan yang terbalik.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Temuan 1: foreign key tanpa indeks penutup ──────────────────────────────
--
-- Setiap kolom di bawah menunjuk ke tabel lain tanpa indeks di sisi anaknya.
-- Akibatnya bukan hanya join yang lambat: menghapus SATU baris induk memaksa
-- Postgres memindai seluruh tabel anak untuk memastikan tidak ada yang
-- menggantung. Menonaktifkan pengguna memang lazim, tapi menghapusnya — saat
-- salah input, misalnya — akan menyentuh delapan tabel sekaligus.

CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON public.audit_trail (actor_id);

CREATE INDEX IF NOT EXISTS idx_customers_pembuat
  ON public.sm_customers (created_by);

CREATE INDEX IF NOT EXISTS idx_laporan_customer
  ON public.sm_daily_reports (customer_id);

CREATE INDEX IF NOT EXISTS idx_evidence_user
  ON public.sm_evidence (user_id);

CREATE INDEX IF NOT EXISTS idx_exceptions_penyetuju
  ON public.sm_exceptions (approved_by);

CREATE INDEX IF NOT EXISTS idx_gps_attendance
  ON public.sm_gps_events (attendance_id);

CREATE INDEX IF NOT EXISTS idx_locations_pembuat
  ON public.sm_locations (created_by);

CREATE INDEX IF NOT EXISTS idx_schedules_pembuat
  ON public.sm_schedules (created_by);

-- Yang ini paling sering dipakai: halaman Meeting menempelkan sm_locations ke
-- setiap jadwal berkehadiran lewat kolom ini.
CREATE INDEX IF NOT EXISTS idx_schedules_lokasi
  ON public.sm_schedules (location_id);

CREATE INDEX IF NOT EXISTS idx_settings_pengubah
  ON public.sm_settings (updated_by);

-- ── Temuan 2: dua policy permisif untuk SELECT yang sama ────────────────────
--
-- `FOR ALL` mencakup SELECT. Karena tabel-tabel ini juga punya policy baca
-- sendiri, setiap SELECT dievaluasi DUA kali: sekali oleh policy baca, sekali
-- lagi oleh policy kelola yang hasilnya tidak menambah apa pun — pemanggilnya
-- sudah lolos lewat policy pertama.
--
-- Policy kelola dipecah menjadi INSERT/UPDATE/DELETE. Hak yang diberikan sama
-- persis seperti sebelumnya; yang hilang hanya pekerjaan ganda pada SELECT.
-- Ini bukan pelonggaran: kemampuan membaca tabel-tabel ini memang sudah
-- diberikan policy `*_baca` kepada seluruh peran yang login.

-- sm_locations — dikelola Manager & Admin
DROP POLICY IF EXISTS lok_kelola ON public.sm_locations;

CREATE POLICY lok_tambah ON public.sm_locations
  FOR INSERT TO authenticated WITH CHECK (public.sm_is_pengawas());

CREATE POLICY lok_ubah ON public.sm_locations
  FOR UPDATE TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

CREATE POLICY lok_hapus ON public.sm_locations
  FOR DELETE TO authenticated USING (public.sm_is_pengawas());

-- sm_settings — hanya Admin
DROP POLICY IF EXISTS settings_admin ON public.sm_settings;

CREATE POLICY settings_tambah ON public.sm_settings
  FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());

CREATE POLICY settings_ubah ON public.sm_settings
  FOR UPDATE TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

CREATE POLICY settings_hapus ON public.sm_settings
  FOR DELETE TO authenticated USING (public.sm_is_admin());

-- users — hanya Admin
DROP POLICY IF EXISTS users_admin_kelola ON public.users;

CREATE POLICY users_admin_tambah ON public.users
  FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());

CREATE POLICY users_admin_ubah ON public.users
  FOR UPDATE TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

CREATE POLICY users_admin_hapus ON public.users
  FOR DELETE TO authenticated USING (public.sm_is_admin());


-- ▼▼▼ 014_lonceng.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 014 — Satu panggilan untuk seluruh lencana header (§108, temuan performa)
--
-- Sebelum ini, header menembakkan ENAM permintaan HTTP terpisah hanya untuk
-- mengisi angka lencananya, dan mengulanginya tiap tiga menit selama tab
-- terbuka. Di meja kantor itu tidak terasa. Di lapangan, tempat Sales membuka
-- aplikasi ini dengan satu bar sinyal, enam perjalanan bolak-balik berarti
-- header yang angkanya baru lengkap beberapa detik kemudian — kalau semuanya
-- berhasil.
--
-- Fungsi ini menghitung keenamnya dalam satu perjalanan.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_lonceng()
RETURNS jsonb
LANGUAGE plpgsql
-- SECURITY INVOKER (bawaan, ditulis eksplisit supaya niatnya tidak
-- disalahpahami pembaca berikutnya). Fungsi ini berjalan dengan hak
-- PEMANGGIL, sehingga seluruh policy RLS tetap berlaku pada setiap hitungan di
-- bawah. Menjadikannya SECURITY DEFINER akan membuat angka lencana Sales
-- diam-diam menghitung baris milik seluruh tim — kebocoran yang tampil sebagai
-- angka, bukan sebagai data, dan karena itu mudah lolos dari perhatian.
SECURITY INVOKER
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid      uuid    := public.sm_uid();
  v_pengawas boolean := public.sm_is_pengawas();
  v_hari     date    := current_date;
  v_pekan    date    := current_date + 7;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  RETURN jsonb_build_object(
    'laporan_belum', NOT EXISTS (
      SELECT 1 FROM public.sm_daily_reports
       WHERE sales_user_id = v_uid AND report_date = v_hari
    ),

    'jadwal_hari_ini', (
      SELECT count(*) FROM public.sm_schedules
       WHERE schedule_date = v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),

    'meeting_perlu', (
      SELECT count(*) FROM public.sm_schedules
       WHERE requires_attendance
         AND schedule_date = v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),

    'pipeline_dekat', (
      SELECT count(*) FROM public.sm_pipeline
       WHERE estimated_closing BETWEEN v_hari AND v_pekan
         AND stage IN ('OPEN', 'QUOTATION')
         AND (v_pengawas OR sales_user_id = v_uid)
    ),

    'terlewat', (
      SELECT count(*) FROM public.sm_schedules
       WHERE schedule_date < v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),

    -- Hanya bermakna bagi pengawas; bagi Sales selalu nol, karena menugaskan
    -- jadwal memang bukan wewenangnya dan angka yang tidak bisa
    -- ditindaklanjuti hanya menambah kebisingan.
    'belum_ditugaskan', CASE WHEN v_pengawas THEN (
      SELECT count(*) FROM public.sm_schedules
       WHERE assigned_to IS NULL AND status = 'UPCOMING'
    ) ELSE 0 END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_lonceng() FROM public;
GRANT EXECUTE ON FUNCTION public.sm_lonceng() TO authenticated;


-- ▼▼▼ 015_akun_lengkap.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 015 — Data akun lengkap, peran Director & Finance, dan pendaftaran mandiri
--       yang menunggu persetujuan admin
--
-- Tiga hal sekaligus, dan ketiganya saling bergantung sehingga dipisah jadi
-- migrasi terpisah hanya akan membuat salah satunya sempat berjalan tanpa yang
-- lain:
--
-- 1. Kolom identitas organisasi (divisi, sales division, jabatan) supaya
--    profil benar-benar menggambarkan posisi orangnya, bukan sekadar peran
--    teknis di aplikasi.
-- 2. Peran DIRECTOR dan FINANCE, yang dituntut rantai persetujuan GP
--    Calculation — formulir aslinya memang bertanda tangan empat pihak:
--    Sales, Manager Sales, Director, Finance.
-- 3. Pendaftaran mandiri. Akun baru masuk dalam keadaan MENUNGGU dan tidak
--    bisa dipakai masuk sampai admin menyetujuinya.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Peran baru ──────────────────────────────────────────────────────────────
--
-- CHECK diganti, bukan enum di-ALTER — inilah alasan §48 memilih CHECK sejak
-- awal: menambah peran tidak mengunci tabelnya.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SALES', 'MANAGER', 'ADMIN', 'DIRECTOR', 'FINANCE'));

-- ── Identitas organisasi ────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS division       text,
  ADD COLUMN IF NOT EXISTS sales_division text,
  ADD COLUMN IF NOT EXISTS position       text,
  ADD COLUMN IF NOT EXISTS event_code     text,
  ADD COLUMN IF NOT EXISTS joined_at      date;

-- ── Persetujuan akun ────────────────────────────────────────────────────────
--
-- Dipisah dari kolom `active` yang sudah ada, dan pemisahan ini disengaja.
-- Keduanya menjawab pertanyaan berbeda: `approval_status` menjawab "apakah
-- akun ini pernah disetujui", `active` menjawab "apakah akun ini boleh dipakai
-- sekarang". Menonaktifkan sementara seseorang yang sedang cuti panjang tidak
-- boleh menghapus fakta bahwa akunnya dulu sudah diperiksa dan disetujui.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'DISETUJUI',
  ADD COLUMN IF NOT EXISTS approved_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_approval_check;
ALTER TABLE public.users ADD CONSTRAINT users_approval_check
  CHECK (approval_status IN ('MENUNGGU', 'DISETUJUI', 'DITOLAK'));

-- Bawaannya DISETUJUI supaya akun yang sudah ada sebelum migrasi ini tidak
-- tiba-tiba terkunci. Yang mendaftar sendiri disisipkan dengan MENUNGGU secara
-- eksplisit oleh route handler.

CREATE INDEX IF NOT EXISTS idx_users_approval
  ON public.users (approval_status) WHERE approval_status = 'MENUNGGU';

-- ── Daftar pilihan organisasi (§47: bisa diubah admin tanpa deploy) ─────────

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('divisions',
   '["Sales","Marketing","Teknis","Finance","Operasional","Manajemen"]'::jsonb,
   'Pilihan Divisi pada pendaftaran dan profil.'),

  ('sales_divisions',
   '["Corporate","Government","Retail","Project","Channel Partner"]'::jsonb,
   'Pilihan Sales Division. Hanya relevan bagi yang divisinya Sales.'),

  ('positions',
   '["Staff","Senior Staff","Supervisor","Manager","Senior Manager","Director"]'::jsonb,
   'Pilihan Jabatan / Posisi.'),

  ('registration_open',
   'true'::jsonb,
   'Bila false, pendaftaran mandiri ditutup dan akun hanya bisa dibuat admin.')
ON CONFLICT (key) DO NOTHING;

-- ── sm_is_pengawas() ikut mengenal peran baru ──────────────────────────────
--
-- Director dan Finance memang harus melihat data seluruh tim: keduanya
-- menandatangani GP Calculation, dan tanda tangan di atas angka yang tidak
-- boleh ia baca adalah tanda tangan kosong.
--
-- Yang TIDAK berubah: mereka tetap bukan Admin. Pengelolaan akun dan
-- konfigurasi platform tetap tertutup bagi keduanya, karena sm_is_admin()
-- tidak disentuh sama sekali.
CREATE OR REPLACE FUNCTION public.sm_is_pengawas()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.sm_role() IN ('MANAGER', 'ADMIN', 'DIRECTOR', 'FINANCE');
$$;


-- ▼▼▼ 016_gp_calculation.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 016 — GP Calculation Form
--
-- Dibuat mengikuti berkas asli yang dipakai tim (GP_BALAIKOTA.xlsx) — setiap
-- pos biaya, setiap rumus, dan rantai tanda tangannya. Yang berubah hanya
-- tempat rumusnya tinggal: di spreadsheet rumus itu ada di dalam sel yang bisa
-- ditimpa siapa saja; di sini ia ada di kolom GENERATED dan view, tempat yang
-- tidak bisa ditimpa siapa pun.
--
-- Itu bukan kerapian belaka. Pada berkas aslinya, satu sel rumus yang tidak
-- sengaja tertimpa angka ketikan akan menghasilkan GP yang salah tanpa satu
-- pun tanda di layar — dan angka itulah yang dibawa ke rapat.
--
-- ── Catatan penting soal harga ─────────────────────────────────────────────
-- Unit Price pada DETAIL ITEM adalah harga jual BRUTO (sudah termasuk PPN),
-- persis seperti berkas aslinya: di sana Total Selling (DPP) dihitung sebagai
-- H31/1.11, yaitu total item DIBAGI (1 + PPN). Kalau kelak ada yang mengira
-- kolom itu DPP dan mengisinya tanpa PPN, seluruh angka di bawahnya akan
-- meleset ~11% — karena itu diletakkan sebagai catatan, bukan asumsi diam.
-- ════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS public.sm_gp_nomor_seq;

CREATE TABLE IF NOT EXISTS public.sm_gp_calculations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor         text UNIQUE NOT NULL,

  -- Pemiliknya. Inilah kolom yang menjaga data antar-Sales tidak saling
  -- terlihat; seluruh policy di bawah bersandar padanya.
  sales_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Asal-usulnya bila dibuat dari peluang yang sudah deal. SET NULL, bukan
  -- CASCADE: menghapus baris pipeline tidak boleh ikut menghapus perhitungan
  -- GP yang sudah ditandatangani empat pihak.
  pipeline_id   uuid REFERENCES public.sm_pipeline(id) ON DELETE SET NULL,
  customer_id   uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,

  customer_name text NOT NULL,
  project_name  text NOT NULL,
  po_spk_no     text,
  calc_date     date NOT NULL DEFAULT current_date,
  payment_term  text,
  lead_time     text,

  -- Tarif disimpan PER DOKUMEN, bukan diambil dari pengaturan saat dibaca.
  -- Kalau tarif PPN nasional berubah tahun depan, perhitungan yang sudah
  -- disetujui tahun ini harus tetap menunjukkan angka yang dulu disetujui.
  ppn_rate      numeric(6,4) NOT NULL DEFAULT 0.11  CHECK (ppn_rate BETWEEN 0 AND 1),
  pph_rate      numeric(6,4) NOT NULL DEFAULT 0.025 CHECK (pph_rate BETWEEN 0 AND 1),
  gp_target     numeric(6,4) NOT NULL DEFAULT 0.20  CHECK (gp_target BETWEEN 0 AND 1),

  -- COST BREAKDOWN di luar material (material dihitung dari item).
  installation_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (installation_cost >= 0),
  shipping_cost     numeric(18,2) NOT NULL DEFAULT 0 CHECK (shipping_cost     >= 0),
  operational_cost  numeric(18,2) NOT NULL DEFAULT 0 CHECK (operational_cost  >= 0),
  other_cost        numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_cost        >= 0),

  -- Potongan dari sisi penerimaan, bukan biaya proyek. Letaknya di SELLING
  -- SUMMARY pada berkas asli, dan ia mengurangi NET AMOUNT RECEIVED.
  disbursement_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (disbursement_cost >= 0),

  wapu          boolean NOT NULL DEFAULT false,
  currency      text NOT NULL DEFAULT 'IDR',
  notes         text,

  -- ── Rantai persetujuan (empat tanda tangan pada berkas asli) ──
  status text NOT NULL DEFAULT 'DRAFT'
         CHECK (status IN ('DRAFT', 'DIAJUKAN', 'DIPERIKSA',
                           'DISETUJUI', 'DIVERIFIKASI', 'DITOLAK')),

  submitted_at timestamptz,
  checked_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  checked_at   timestamptz,
  approved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  verified_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at  timestamptz,
  rejected_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_at  timestamptz,
  rejection_reason text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gp_sales     ON public.sm_gp_calculations (sales_user_id, calc_date DESC);
CREATE INDEX IF NOT EXISTS idx_gp_status    ON public.sm_gp_calculations (status);
CREATE INDEX IF NOT EXISTS idx_gp_tanggal   ON public.sm_gp_calculations (calc_date DESC);
CREATE INDEX IF NOT EXISTS idx_gp_pipeline  ON public.sm_gp_calculations (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_gp_customer  ON public.sm_gp_calculations (customer_id);
CREATE INDEX IF NOT EXISTS idx_gp_pemeriksa ON public.sm_gp_calculations (checked_by);
CREATE INDEX IF NOT EXISTS idx_gp_penyetuju ON public.sm_gp_calculations (approved_by);
CREATE INDEX IF NOT EXISTS idx_gp_verifikator ON public.sm_gp_calculations (verified_by);
CREATE INDEX IF NOT EXISTS idx_gp_penolak   ON public.sm_gp_calculations (rejected_by);

-- Indeks penutup FK dipasang sejak awal, bukan menunggu advisor menegur —
-- pelajaran dari migrasi 013.

DROP TRIGGER IF EXISTS trg_gp_touch ON public.sm_gp_calculations;
CREATE TRIGGER trg_gp_touch BEFORE UPDATE ON public.sm_gp_calculations
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── Nomor dokumen ───────────────────────────────────────────────────────────
--
-- Memakai sequence, bukan "hitung baris bulan ini lalu tambah satu". Cara
-- kedua terlihat lebih rapi (nomornya mulai dari 1 tiap bulan) tapi dua Sales
-- yang menekan Simpan pada detik yang sama akan memperoleh nomor yang sama,
-- dan yang kalah mendapat error tepat setelah mengetik satu formulir penuh.

CREATE OR REPLACE FUNCTION public.sm_gp_nomor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.nomor IS NULL OR NEW.nomor = '' THEN
    NEW.nomor := 'GP/' || to_char(now(), 'YYYY/MM') || '/' ||
                 lpad(nextval('public.sm_gp_nomor_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gp_nomor ON public.sm_gp_calculations;
CREATE TRIGGER trg_gp_nomor BEFORE INSERT ON public.sm_gp_calculations
  FOR EACH ROW EXECUTE FUNCTION public.sm_gp_nomor();

-- ── DETAIL ITEM ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_gp_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id uuid NOT NULL REFERENCES public.sm_gp_calculations(id) ON DELETE CASCADE,
  urutan         integer NOT NULL DEFAULT 1,

  description    text NOT NULL,
  qty            numeric(14,2) NOT NULL DEFAULT 1 CHECK (qty >= 0),
  vendor         text,
  unit_price     numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit_cost      numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost  >= 0),

  -- Kolom GENERATED, sama seperti project_gp di sm_pipeline: JANGAN dikirim
  -- saat insert maupun update. Inilah yang membuat angka di layar Sales
  -- mustahil berbeda dari angka di layar Director.
  selling_total  numeric(18,2) GENERATED ALWAYS AS (unit_price * qty) STORED,
  costing_total  numeric(18,2) GENERATED ALWAYS AS (unit_cost  * qty) STORED,
  gp_amount      numeric(18,2) GENERATED ALWAYS AS ((unit_price - unit_cost) * qty) STORED,

  -- Pembagian nol dijaga di sini, bukan diserahkan ke pembacanya. Pada berkas
  -- aslinya baris kosong menghasilkan #DIV/0! yang lalu ikut tercetak.
  gp_percentage  numeric(8,4) GENERATED ALWAYS AS (
    CASE WHEN unit_price * qty = 0 THEN 0
         ELSE ((unit_price - unit_cost) * qty) / (unit_price * qty) * 100
    END
  ) STORED,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gp_items_induk
  ON public.sm_gp_items (calculation_id, urutan);

-- ── Ringkasan: seluruh rumus berkas asli, dalam satu view ──────────────────
--
-- security_invoker: view tunduk pada RLS tabel sumbernya, sehingga Sales hanya
-- melihat ringkasan miliknya sendiri. Tanpa opsi ini, satu SELECT ke view ini
-- membuka seluruh angka GP tim — termasuk margin proyek Sales lain.

DROP VIEW IF EXISTS public.sm_gp_ringkasan;

CREATE VIEW public.sm_gp_ringkasan
WITH (security_invoker = true) AS
SELECT
  c.*,

  t.total_qty,
  t.total_selling,                                   -- bruto, termasuk PPN
  t.total_material,
  t.gross_profit,                                    -- Σ GP item

  -- SELLING SUMMARY
  t.dpp,
  t.total_selling - t.dpp                    AS ppn_amount,
  round(t.dpp * c.pph_rate, 2)               AS pph_amount,
  round(t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost, 2)
                                             AS net_amount_received,

  -- COST BREAKDOWN
  t.total_material + c.installation_cost + c.shipping_cost
    + c.operational_cost + c.other_cost      AS total_costing,

  -- PROFIT ANALYSIS
  round(
    (t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
    - (t.total_material + c.installation_cost + c.shipping_cost
       + c.operational_cost + c.other_cost), 2)
                                             AS net_profit,

  CASE WHEN t.dpp = 0 THEN 0 ELSE round(
    ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
     - (t.total_material + c.installation_cost + c.shipping_cost
        + c.operational_cost + c.other_cost)) / t.dpp, 6)
  END                                        AS net_margin,

  -- Status mutu margin — rumus IF bertingkat pada berkas asli, apa adanya.
  -- Ambangnya poin persentase absolut terhadap target, bukan kelipatan.
  -- Ditulis berulang alih-alih lewat CTE karena CASE di dalam daftar SELECT
  -- tidak boleh memuat WITH. Panjang, tapi jujur: yang dibandingkan persis
  -- rumus IF bertingkat pada berkas asli.
  CASE
    WHEN t.dpp = 0 THEN 'TANPA NILAI'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target + 0.15
      THEN 'EXCEPTIONAL'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target + 0.10
      THEN 'EXCELLENT'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target
      THEN 'GOOD'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target - 0.05
      THEN 'REVIEW'
    ELSE 'DIRECTOR APPROVAL'
  END                                        AS mutu_margin,

  t.jumlah_item
FROM public.sm_gp_calculations c
CROSS JOIN LATERAL (
  SELECT
    COALESCE(sum(i.qty), 0)            AS total_qty,
    COALESCE(sum(i.selling_total), 0)  AS total_selling,
    COALESCE(sum(i.costing_total), 0)  AS total_material,
    COALESCE(sum(i.gp_amount), 0)      AS gross_profit,
    count(i.id)                        AS jumlah_item,
    -- DPP = total bruto dibagi (1 + PPN), persis H31/1.11 pada berkas asli.
    round(COALESCE(sum(i.selling_total), 0) / (1 + c.ppn_rate), 2) AS dpp
  FROM public.sm_gp_items i
  WHERE i.calculation_id = c.id
) t;

GRANT SELECT ON public.sm_gp_ringkasan TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_gp_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_gp_items        ENABLE ROW LEVEL SECURITY;

-- Inti permintaan: antar Sales tidak boleh saling melihat. Pengawas
-- (Manager, Admin, Director, Finance) melihat semua karena merekalah yang
-- memeriksa dan menandatangani.
DROP POLICY IF EXISTS gp_baca ON public.sm_gp_calculations;
CREATE POLICY gp_baca ON public.sm_gp_calculations
  FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS gp_buat ON public.sm_gp_calculations;
CREATE POLICY gp_buat ON public.sm_gp_calculations
  FOR INSERT TO authenticated
  -- Tidak bisa dibuat atas nama orang lain, dan tidak bisa lahir langsung
  -- dalam keadaan sudah disetujui.
  WITH CHECK (sales_user_id = public.sm_uid() AND status = 'DRAFT');

-- Hanya selama DRAFT. Begitu diajukan, isinya beku — dokumen yang masih bisa
-- disunting sesudah ditandatangani bukan dokumen yang ditandatangani.
DROP POLICY IF EXISTS gp_sunting ON public.sm_gp_calculations;
CREATE POLICY gp_sunting ON public.sm_gp_calculations
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() AND status = 'DRAFT')
  WITH CHECK (sales_user_id = public.sm_uid() AND status = 'DRAFT');

DROP POLICY IF EXISTS gp_hapus ON public.sm_gp_calculations;
CREATE POLICY gp_hapus ON public.sm_gp_calculations
  FOR DELETE TO authenticated
  USING ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin());

-- Policy di atas membatasi BARIS mana yang boleh disunting, tapi RLS tidak
-- mengenal kolom. Tanpa pembatasan berikut, pemilik dokumen bisa menembakkan
-- UPDATE status='DISETUJUI' pada barisnya sendiri selagi DRAFT dan melompati
-- seluruh rantai tanda tangan dalam satu permintaan.
--
-- Karena itu hak UPDATE dicabut lalu diberikan ulang HANYA pada kolom isian.
-- status, seluruh kolom tanda tangan, dan nomor dokumen tidak ada di daftar.
REVOKE UPDATE ON public.sm_gp_calculations FROM authenticated;
GRANT UPDATE (
  customer_id, customer_name, project_name, po_spk_no, calc_date,
  payment_term, lead_time, ppn_rate, pph_rate, gp_target,
  installation_cost, shipping_cost, operational_cost, other_cost,
  disbursement_cost, wapu, currency, notes, pipeline_id, updated_at
) ON public.sm_gp_calculations TO authenticated;

-- ── Item mengikuti induknya ────────────────────────────────────────────────

DROP POLICY IF EXISTS gp_item_baca ON public.sm_gp_items;
CREATE POLICY gp_item_baca ON public.sm_gp_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id
       AND (c.sales_user_id = public.sm_uid() OR public.sm_is_pengawas())
  ));

DROP POLICY IF EXISTS gp_item_tulis ON public.sm_gp_items;
CREATE POLICY gp_item_tulis ON public.sm_gp_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id
       AND c.sales_user_id = public.sm_uid()
       AND c.status = 'DRAFT'
  ));

DROP POLICY IF EXISTS gp_item_ubah ON public.sm_gp_items;
CREATE POLICY gp_item_ubah ON public.sm_gp_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id AND c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id AND c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT'
  ));

DROP POLICY IF EXISTS gp_item_hapus ON public.sm_gp_items;
CREATE POLICY gp_item_hapus ON public.sm_gp_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id
       AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
  ));

-- ════════════════════════════════════════════════════════════════════════════
-- Rantai persetujuan — satu-satunya jalan status berpindah
-- ════════════════════════════════════════════════════════════════════════════

-- DRAFT → DIAJUKAN. Milik pemiliknya sendiri.
CREATE OR REPLACE FUNCTION public.sm_gp_ajukan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid  uuid := public.sm_uid();
  v_gp   public.sm_gp_calculations%ROWTYPE;
  v_item integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.sales_user_id <> v_uid THEN
    RAISE EXCEPTION 'Hanya pembuatnya yang boleh mengajukan perhitungan ini.'
      USING ERRCODE = '42501';
  END IF;

  IF v_gp.status <> 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BUKAN_DRAFT',
      'message', 'Perhitungan ini sudah diajukan sebelumnya.');
  END IF;

  SELECT count(*) INTO v_item FROM public.sm_gp_items WHERE calculation_id = p_id;
  IF v_item = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TANPA_ITEM',
      'message', 'Tambahkan minimal satu item sebelum mengajukan.');
  END IF;

  UPDATE public.sm_gp_calculations
     SET status = 'DIAJUKAN', submitted_at = now(),
         rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
   WHERE id = p_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_DIAJUKAN', 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor, 'jumlah_item', v_item));

  RETURN jsonb_build_object('ok', true, 'status', 'DIAJUKAN');
END;
$$;

-- Satu fungsi untuk tiga langkah berikutnya. Yang menentukan langkah mana yang
-- terjadi adalah STATUS SAAT INI, bukan apa yang dikirim klien — klien hanya
-- menyebut dokumen mana yang hendak disetujui.
CREATE OR REPLACE FUNCTION public.sm_gp_setujui(p_id uuid, p_catatan text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid   uuid := public.sm_uid();
  v_peran text := public.sm_role();
  v_gp    public.sm_gp_calculations%ROWTYPE;
  v_baru  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  -- Pemeriksaan wewenang per langkah. Admin boleh di setiap langkah bukan
  -- karena ia atasan semua orang, melainkan supaya rantai tidak macet total
  -- ketika Director atau Finance belum punya akun — dan setiap langkahnya
  -- tetap tercatat atas namanya di audit_trail.
  IF v_gp.status = 'DIAJUKAN' THEN
    IF v_peran NOT IN ('MANAGER', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu pemeriksaan Manager Sales.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DIPERIKSA';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, checked_by = v_uid, checked_at = now() WHERE id = p_id;

  ELSIF v_gp.status = 'DIPERIKSA' THEN
    IF v_peran NOT IN ('DIRECTOR', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu persetujuan Director.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DISETUJUI';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, approved_by = v_uid, approved_at = now() WHERE id = p_id;

  ELSIF v_gp.status = 'DISETUJUI' THEN
    IF v_peran NOT IN ('FINANCE', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu verifikasi Finance.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DIVERIFIKASI';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, verified_by = v_uid, verified_at = now() WHERE id = p_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'STATUS_TIDAK_SESUAI',
      'message', 'Perhitungan ini tidak sedang menunggu persetujuan siapa pun.');
  END IF;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_' || v_baru, 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor, 'catatan', p_catatan));

  RETURN jsonb_build_object('ok', true, 'status', v_baru);
END;
$$;

-- Penolakan mengembalikan dokumen ke pembuatnya untuk diperbaiki. Alasannya
-- wajib dan tersimpan permanen — penolakan tanpa alasan hanya memindahkan
-- kebingungan, bukan menyelesaikannya.
CREATE OR REPLACE FUNCTION public.sm_gp_tolak(p_id uuid, p_alasan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := public.sm_uid();
  v_gp  public.sm_gp_calculations%ROWTYPE;
BEGIN
  IF NOT public.sm_is_pengawas() THEN
    RAISE EXCEPTION 'Hanya pemeriksa yang boleh menolak perhitungan.' USING ERRCODE = '42501';
  END IF;

  IF length(trim(COALESCE(p_alasan, ''))) < 10 THEN
    RAISE EXCEPTION 'Alasan penolakan wajib diisi minimal 10 karakter.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.status IN ('DRAFT', 'DITOLAK') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'STATUS_TIDAK_SESUAI',
      'message', 'Perhitungan ini belum diajukan.');
  END IF;

  UPDATE public.sm_gp_calculations
     SET status = 'DITOLAK', rejected_by = v_uid, rejected_at = now(),
         rejection_reason = trim(p_alasan)
   WHERE id = p_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_DITOLAK', 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor, 'dari_status', v_gp.status,
                             'alasan', trim(p_alasan)));

  RETURN jsonb_build_object('ok', true, 'status', 'DITOLAK');
END;
$$;

-- Dokumen yang ditolak kembali bisa disunting pembuatnya.
CREATE OR REPLACE FUNCTION public.sm_gp_buka_ulang(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := public.sm_uid();
  v_gp  public.sm_gp_calculations%ROWTYPE;
BEGIN
  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.sales_user_id <> v_uid AND NOT public.sm_is_admin() THEN
    RAISE EXCEPTION 'Hanya pembuatnya yang boleh membuka ulang perhitungan ini.'
      USING ERRCODE = '42501';
  END IF;

  IF v_gp.status <> 'DITOLAK' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BUKAN_DITOLAK',
      'message', 'Hanya perhitungan yang ditolak yang bisa dibuka ulang.');
  END IF;

  UPDATE public.sm_gp_calculations SET status = 'DRAFT' WHERE id = p_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_DIBUKA_ULANG', 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor));

  RETURN jsonb_build_object('ok', true, 'status', 'DRAFT');
END;
$$;

-- SECURITY DEFINER berarti hak eksekusinya harus dibatasi rapat. `anon`
-- sengaja tidak ikut: tanpa sesi tidak ada dokumen yang sah untuk disetujui.
REVOKE EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)          FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text)   FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)     FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)      FROM public;

GRANT EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)    TO authenticated;


-- ▼▼▼ 017_gp_perketat_eksekusi.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 017 — Menutup dua lubang pada fungsi GP Calculation
--
-- Ditemukan advisor keamanan Supabase segera sesudah migrasi 016 diterapkan.
-- Keduanya nyata, dan keduanya jenis kesalahan yang paling mudah terlewat
-- karena tidak menghasilkan error apa pun saat aplikasi dipakai normal.
--
-- ── Lubang 1: `anon` bisa memanggil keempat fungsi GP ──────────────────────
--
-- Migrasi 016 menutupnya dengan REVOKE ... FROM public, dan itu TIDAK cukup.
-- Supabase memasang default privilege yang memberi EXECUTE kepada `anon` dan
-- `authenticated` secara EKSPLISIT pada setiap fungsi baru di schema public —
-- bukan lewat peran `public`. Mencabut dari `public` tidak menyentuh pemberian
-- eksplisit itu sama sekali.
--
-- Migrasi 008 sudah pernah menangani hal yang sama untuk sm_check_in dan
-- kawan-kawan; pelajaran itu terlewat saat menulis 016.
--
-- ── Lubang 2: sm_gp_buka_ulang() lolos untuk pemanggil tanpa sesi ──────────
--
-- Penjaganya berbunyi:
--
--     IF v_gp.sales_user_id <> v_uid AND NOT public.sm_is_admin() THEN
--
-- Ketika pemanggilnya tidak punya sesi, v_uid bernilai NULL. Di SQL,
-- `sesuatu <> NULL` menghasilkan NULL — bukan TRUE, bukan FALSE. `NULL AND
-- FALSE` menghasilkan FALSE, sehingga IF-nya TIDAK pernah jalan dan
-- pemeriksaan kepemilikannya terlewati begitu saja.
--
-- Akibatnya: siapa pun tanpa sesi yang menebak UUID sebuah dokumen GP yang
-- berstatus DITOLAK bisa mengembalikannya ke DRAFT. Tidak merusak angka, tapi
-- ia menggerakkan status dokumen yang seharusnya hanya bisa digerakkan
-- pemiliknya — persis hal yang dijaga seluruh rancangan ini.
--
-- Perbaikannya: tolak lebih dulu pemanggil tanpa sesi, seperti yang sudah
-- dilakukan tiga fungsi GP lainnya.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_gp_buka_ulang(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := public.sm_uid();
  v_gp  public.sm_gp_calculations%ROWTYPE;
BEGIN
  -- Penjaga yang sebelumnya tidak ada. Tanpa baris ini, seluruh pemeriksaan
  -- kepemilikan di bawah menghasilkan NULL bagi pemanggil tanpa sesi.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.sales_user_id <> v_uid AND NOT public.sm_is_admin() THEN
    RAISE EXCEPTION 'Hanya pembuatnya yang boleh membuka ulang perhitungan ini.'
      USING ERRCODE = '42501';
  END IF;

  IF v_gp.status <> 'DITOLAK' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BUKAN_DITOLAK',
      'message', 'Hanya perhitungan yang ditolak yang bisa dibuka ulang.');
  END IF;

  UPDATE public.sm_gp_calculations SET status = 'DRAFT' WHERE id = p_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_DIBUKA_ULANG', 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor));

  RETURN jsonb_build_object('ok', true, 'status', 'DRAFT');
END;
$$;

-- Pencabutan yang sebenarnya. `anon` disebut namanya, bukan diwakili `public`.
REVOKE EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)    FROM anon;

-- sm_lonceng() tidak ikut dicabut dari authenticated karena memang untuk
-- mereka, tapi anon tetap tidak punya urusan dengannya: tanpa sesi, seluruh
-- hitungannya nol dan fungsinya sudah menolak lebih dulu.
REVOKE EXECUTE ON FUNCTION public.sm_lonceng() FROM anon;

GRANT EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_lonceng()              TO authenticated;


-- ▼▼▼ 018_proyek.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 018 — Proyek sebagai penyatu seluruh modul
--
-- Sampai migrasi ini, setiap modul berdiri sendiri: pipeline punya
-- project_detail, jadwal punya project, GP Calculation punya project_name —
-- ketiganya teks bebas yang kebetulan sering berisi hal yang sama. Akibatnya
-- tidak ada satu tempat pun yang bisa menjawab pertanyaan paling wajar dari
-- seorang atasan: "proyek Balaikota itu sudah sampai mana?"
--
-- Tabel ini menjadi tempat itu. Pipeline, jadwal, laporan harian, dan GP
-- Calculation kini boleh menunjuk ke satu baris proyek, dan view di bawah
-- menyatukan seluruhnya menjadi satu ringkasan.
--
-- ── Kenapa project_id BOLEH KOSONG ─────────────────────────────────────────
--
-- Ini keputusan terpenting di migrasi ini. Kolomnya sengaja nullable.
--
-- Sales bertemu peluang baru di lapangan setiap hari, dan memaksa mereka
-- membuat baris proyek lebih dulu sebelum boleh mencatat apa pun akan
-- berakhir seperti semua kewajiban pencatatan yang mendahului pekerjaannya:
-- laporannya tidak jadi diisi sama sekali. Yang hilang bukan kerapian data,
-- melainkan datanya itu sendiri.
--
-- Jadi menautkan ke proyek adalah TAWARAN, bukan syarat. Yang belum tertaut
-- tetap tercatat dan tetap terhitung; ia hanya belum muncul di ringkasan
-- proyek — dan bisa ditautkan belakangan kapan saja.
-- ════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS public.sm_proyek_nomor_seq;

CREATE TABLE IF NOT EXISTS public.sm_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode          text UNIQUE NOT NULL,

  name          text NOT NULL,
  customer_id   uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,

  -- Pemilik proyek. Dipakai policy untuk menjaga proyek Sales lain tidak
  -- terlihat, sama seperti sales_user_id pada modul lainnya.
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  status        text NOT NULL DEFAULT 'AKTIF'
                CHECK (status IN ('AKTIF', 'SELESAI', 'BATAL')),

  description   text,
  -- Nilai perkiraan yang diisi tangan; angka sesungguhnya tetap dihitung dari
  -- pipeline dan GP yang tertaut, dan itulah yang tampil di ringkasan.
  target_value  numeric(18,2) NOT NULL DEFAULT 0 CHECK (target_value >= 0),

  start_date    date,
  end_date      date,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proyek_pemilik  ON public.sm_projects (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proyek_status   ON public.sm_projects (status);
CREATE INDEX IF NOT EXISTS idx_proyek_customer ON public.sm_projects (customer_id);
CREATE INDEX IF NOT EXISTS idx_proyek_nama     ON public.sm_projects (name);

DROP TRIGGER IF EXISTS trg_proyek_touch ON public.sm_projects;
CREATE TRIGGER trg_proyek_touch BEFORE UPDATE ON public.sm_projects
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

CREATE OR REPLACE FUNCTION public.sm_proyek_kode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.kode IS NULL OR NEW.kode = '' THEN
    NEW.kode := 'PRJ/' || to_char(now(), 'YYYY/MM') || '/' ||
                lpad(nextval('public.sm_proyek_nomor_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proyek_kode ON public.sm_projects;
CREATE TRIGGER trg_proyek_kode BEFORE INSERT ON public.sm_projects
  FOR EACH ROW EXECUTE FUNCTION public.sm_proyek_kode();

-- ── Tautan dari modul yang sudah ada ────────────────────────────────────────
--
-- ON DELETE SET NULL, bukan CASCADE. Menghapus baris proyek tidak boleh ikut
-- menghapus laporan harian, jadwal yang sudah dieksekusi dengan bukti foto,
-- atau GP Calculation yang sudah ditandatangani empat pihak. Yang hilang
-- cukup tautannya.

ALTER TABLE public.sm_pipeline
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

ALTER TABLE public.sm_schedules
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

ALTER TABLE public.sm_daily_reports
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

ALTER TABLE public.sm_gp_calculations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_proyek ON public.sm_pipeline (project_id);
CREATE INDEX IF NOT EXISTS idx_jadwal_proyek   ON public.sm_schedules (project_id);
CREATE INDEX IF NOT EXISTS idx_laporan_proyek  ON public.sm_daily_reports (project_id);
CREATE INDEX IF NOT EXISTS idx_gp_proyek       ON public.sm_gp_calculations (project_id);

-- Kolom project_id pada GP ikut dibuka untuk disunting pemiliknya. Daftar
-- kolom di migrasi 016 ditulis eksplisit, jadi kolom baru harus ditambahkan
-- ke sana — kalau tidak, menautkan GP ke proyek akan ditolak tanpa sebab yang
-- terlihat.
GRANT UPDATE (project_id) ON public.sm_gp_calculations TO authenticated;

-- ── sm_gp_ringkasan WAJIB dibuat ulang ─────────────────────────────────────
--
-- View yang ditulis `SELECT c.*` MEMBEKUKAN daftar kolomnya saat dibuat.
-- Menambahkan project_id ke sm_gp_calculations di atas tidak membuat kolom itu
-- muncul di view yang sudah ada — dan sm_proyek_ringkasan di bawah membacanya
-- lewat r.project_id, jadi tanpa pembuatan ulang ini migrasinya gagal dengan
-- pesan "column r.project_id does not exist".
--
-- Ini bukan kehati-hatian berlebihan: setiap kali kelak ada kolom baru
-- ditambahkan ke sm_gp_calculations, view ini harus ikut dibuat ulang.

DROP VIEW IF EXISTS public.sm_proyek_ringkasan;
DROP VIEW IF EXISTS public.sm_gp_ringkasan;

CREATE VIEW public.sm_gp_ringkasan
WITH (security_invoker = true) AS
SELECT
  c.*,
  t.total_qty,
  t.total_selling,
  t.total_material,
  t.gross_profit,
  t.dpp,
  t.total_selling - t.dpp                    AS ppn_amount,
  round(t.dpp * c.pph_rate, 2)               AS pph_amount,
  round(t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost, 2) AS net_amount_received,
  t.total_material + c.installation_cost + c.shipping_cost
    + c.operational_cost + c.other_cost      AS total_costing,
  round(
    (t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
    - (t.total_material + c.installation_cost + c.shipping_cost
       + c.operational_cost + c.other_cost), 2) AS net_profit,
  CASE WHEN t.dpp = 0 THEN 0 ELSE round(
    ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
     - (t.total_material + c.installation_cost + c.shipping_cost
        + c.operational_cost + c.other_cost)) / t.dpp, 6)
  END                                        AS net_margin,
  CASE
    WHEN t.dpp = 0 THEN 'TANPA NILAI'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target + 0.15
      THEN 'EXCEPTIONAL'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target + 0.10
      THEN 'EXCELLENT'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target
      THEN 'GOOD'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target - 0.05
      THEN 'REVIEW'
    ELSE 'DIRECTOR APPROVAL'
  END                                        AS mutu_margin,
  t.jumlah_item
FROM public.sm_gp_calculations c
CROSS JOIN LATERAL (
  SELECT
    COALESCE(sum(i.qty), 0)            AS total_qty,
    COALESCE(sum(i.selling_total), 0)  AS total_selling,
    COALESCE(sum(i.costing_total), 0)  AS total_material,
    COALESCE(sum(i.gp_amount), 0)      AS gross_profit,
    count(i.id)                        AS jumlah_item,
    round(COALESCE(sum(i.selling_total), 0) / (1 + c.ppn_rate), 2) AS dpp
  FROM public.sm_gp_items i
  WHERE i.calculation_id = c.id
) t;

GRANT SELECT ON public.sm_gp_ringkasan TO authenticated;

-- ── Ringkasan satu proyek ───────────────────────────────────────────────────
--
-- security_invoker: seluruh subquery di bawah tunduk pada RLS tabel sumbernya.
-- Tanpa itu, satu SELECT ke view ini akan membuka nilai pipeline dan margin GP
-- proyek Sales lain — kebocoran yang muncul sebagai angka, bukan sebagai
-- baris, dan karena itu jauh lebih mudah lolos dari perhatian.

CREATE VIEW public.sm_proyek_ringkasan
WITH (security_invoker = true) AS
SELECT
  p.*,

  COALESCE(pl.jml, 0)          AS jumlah_pipeline,
  COALESCE(pl.nilai, 0)        AS nilai_pipeline,
  COALESCE(pl.gp, 0)           AS gp_pipeline,

  COALESCE(sc.jml, 0)          AS jumlah_jadwal,
  COALESCE(sc.selesai, 0)      AS jadwal_selesai,
  COALESCE(sc.meeting, 0)      AS jumlah_meeting,
  COALESCE(sc.meeting_selesai, 0) AS meeting_selesai,

  COALESCE(dr.jml, 0)          AS jumlah_laporan,
  dr.terakhir                  AS laporan_terakhir,

  COALESCE(gp.jml, 0)          AS jumlah_gp,
  COALESCE(gp.nilai, 0)        AS nilai_gp,
  COALESCE(gp.profit, 0)       AS profit_gp,
  COALESCE(gp.disetujui, 0)    AS gp_disetujui,
  COALESCE(gp.menunggu, 0)     AS gp_menunggu

FROM public.sm_projects p

LEFT JOIN LATERAL (
  SELECT count(*) AS jml,
         COALESCE(sum(project_value), 0) AS nilai,
         COALESCE(sum(project_gp), 0)    AS gp
    FROM public.sm_pipeline WHERE project_id = p.id
) pl ON true

LEFT JOIN LATERAL (
  SELECT count(*) AS jml,
         count(*) FILTER (WHERE status = 'COMPLETED')                        AS selesai,
         count(*) FILTER (WHERE requires_attendance)                         AS meeting,
         count(*) FILTER (WHERE requires_attendance AND status = 'COMPLETED') AS meeting_selesai
    FROM public.sm_schedules WHERE project_id = p.id
) sc ON true

LEFT JOIN LATERAL (
  SELECT count(*) AS jml, max(report_date) AS terakhir
    FROM public.sm_daily_reports WHERE project_id = p.id
) dr ON true

LEFT JOIN LATERAL (
  SELECT count(*) AS jml,
         COALESCE(sum(r.total_selling), 0) AS nilai,
         COALESCE(sum(r.net_profit), 0)    AS profit,
         count(*) FILTER (WHERE r.status IN ('DISETUJUI', 'DIVERIFIKASI')) AS disetujui,
         count(*) FILTER (WHERE r.status IN ('DIAJUKAN', 'DIPERIKSA'))     AS menunggu
    FROM public.sm_gp_ringkasan r WHERE r.project_id = p.id
) gp ON true;

GRANT SELECT ON public.sm_proyek_ringkasan TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.sm_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proyek_baca ON public.sm_projects;
CREATE POLICY proyek_baca ON public.sm_projects
  FOR SELECT TO authenticated
  USING (owner_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS proyek_buat ON public.sm_projects;
CREATE POLICY proyek_buat ON public.sm_projects
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS proyek_ubah ON public.sm_projects;
CREATE POLICY proyek_ubah ON public.sm_projects
  FOR UPDATE TO authenticated
  USING (owner_user_id = public.sm_uid() OR public.sm_is_pengawas())
  WITH CHECK (owner_user_id = public.sm_uid() OR public.sm_is_pengawas());

-- Menghapus proyek memutus tautan pada empat tabel sekaligus. Dibatasi ke
-- pemiliknya sendiri dan Admin; Manager yang salah klik pada proyek orang lain
-- akan merusak ringkasan yang bukan miliknya.
DROP POLICY IF EXISTS proyek_hapus ON public.sm_projects;
CREATE POLICY proyek_hapus ON public.sm_projects
  FOR DELETE TO authenticated
  USING (owner_user_id = public.sm_uid() OR public.sm_is_admin());


-- ▼▼▼ 019_dashboard_lengkap.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 019 — Angka dashboard yang belum tercakup
--
-- sm_dashboard() (migrasi 009) dibuat sebelum modul GP Calculation dan Proyek
-- ada, jadi dua hal paling ditunggu atasan justru tidak terwakili di sana:
-- berapa nilai yang sudah masuk tahap GP, dan proyek mana yang jalan.
--
-- Fungsi ini BARU, bukan menimpa yang lama. Menulis ulang sm_dashboard()
-- berarti menyentuh angka yang sudah dipakai dan sudah diuji hanya untuk
-- menambah bagian baru di ujungnya — risiko yang tidak dibayar apa pun.
-- Halaman dashboard memanggil keduanya berdampingan.
--
-- SECURITY INVOKER, sama seperti pendahulunya: seluruh hitungan di bawah
-- tunduk RLS, sehingga Sales melihat angkanya sendiri dan pengawas melihat
-- angka tim. Menjadikannya DEFINER akan membocorkan nilai proyek dan margin
-- seluruh tim ke setiap Sales — dalam bentuk angka, yang justru paling mudah
-- lolos dari perhatian.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_dashboard_plus(
  p_dari   date DEFAULT (current_date - 29),
  p_sampai date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hasil jsonb;
BEGIN
  SELECT jsonb_build_object(

    -- ── GP Calculation ──
    'gp', (
      SELECT jsonb_build_object(
        'jumlah',      count(*),
        'nilai',       COALESCE(sum(total_selling), 0),
        'dpp',         COALESCE(sum(dpp), 0),
        'profit',      COALESCE(sum(net_profit), 0),
        -- Margin rata-rata DITIMBANG DPP, bukan avg(net_margin). Rata-rata
        -- polos memperlakukan dokumen Rp 5 juta setara dokumen Rp 5 miliar,
        -- dan satu dokumen kecil bermargin tinggi bisa menutupi kerugian
        -- besar di dokumen sebelahnya.
        'margin',      CASE WHEN COALESCE(sum(dpp), 0) = 0 THEN 0
                            ELSE round(sum(net_profit) / sum(dpp), 6) END,
        'draft',       count(*) FILTER (WHERE status = 'DRAFT'),
        'menunggu',    count(*) FILTER (WHERE status IN ('DIAJUKAN','DIPERIKSA','DISETUJUI')),
        'selesai',     count(*) FILTER (WHERE status = 'DIVERIFIKASI'),
        'ditolak',     count(*) FILTER (WHERE status = 'DITOLAK'),
        'di_bawah_target', count(*) FILTER (WHERE mutu_margin = 'DIRECTOR APPROVAL')
      )
      FROM public.sm_gp_ringkasan
      WHERE calc_date BETWEEN p_dari AND p_sampai
    ),

    -- Sebaran mutu margin — inilah yang membuat atasan tahu apakah nilai besar
    -- itu datang dengan margin sehat atau tidak.
    'gp_mutu', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'mutu', mutu, 'jumlah', jml, 'nilai', nilai) ORDER BY urut), '[]'::jsonb)
      FROM (
        SELECT mutu_margin AS mutu, count(*) AS jml, sum(total_selling) AS nilai,
               CASE mutu_margin
                 WHEN 'EXCEPTIONAL' THEN 1 WHEN 'EXCELLENT' THEN 2
                 WHEN 'GOOD' THEN 3 WHEN 'REVIEW' THEN 4
                 WHEN 'DIRECTOR APPROVAL' THEN 5 ELSE 6 END AS urut
          FROM public.sm_gp_ringkasan
         WHERE calc_date BETWEEN p_dari AND p_sampai AND jumlah_item > 0
         GROUP BY mutu_margin
      ) x
    ),

    -- ── Proyek ──
    'proyek', (
      SELECT jsonb_build_object(
        'jumlah',         count(*),
        'aktif',          count(*) FILTER (WHERE status = 'AKTIF'),
        'selesai',        count(*) FILTER (WHERE status = 'SELESAI'),
        'nilai_pipeline', COALESCE(sum(nilai_pipeline), 0),
        'profit_gp',      COALESCE(sum(profit_gp), 0),
        -- Proyek yang belum punya satu pun catatan tertaut. Angka ini sengaja
        -- ditampilkan: proyek kosong bukan proyek yang berjalan, dan
        -- menyembunyikannya membuat rekap terlihat lebih ramai dari kenyataan.
        'tanpa_catatan',  count(*) FILTER (
                            WHERE jumlah_pipeline = 0 AND jumlah_jadwal = 0
                              AND jumlah_laporan = 0 AND jumlah_gp = 0)
      )
      FROM public.sm_proyek_ringkasan
    ),

    -- ── Pipeline per tahapan ──
    'stage', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'stage', stage, 'jumlah', jml, 'nilai', nilai) ORDER BY urut), '[]'::jsonb)
      FROM (
        SELECT stage, count(*) AS jml, COALESCE(sum(project_value), 0) AS nilai,
               CASE stage WHEN 'OPEN' THEN 1 WHEN 'QUOTATION' THEN 2
                          WHEN 'WON' THEN 3 ELSE 4 END AS urut
          FROM public.sm_pipeline
         WHERE pipeline_date BETWEEN p_dari AND p_sampai
         GROUP BY stage
      ) x
    ),

    -- ── Corong: berapa yang lolos tiap tahap ──
    --
    -- Dihitung dari dokumen yang ADA, bukan dari persentase yang diketik.
    -- Angkanya boleh terlihat kecil; yang penting ia benar.
    'corong', (
      SELECT jsonb_build_object(
        'laporan',  (SELECT count(*) FROM public.sm_daily_reports
                      WHERE report_date BETWEEN p_dari AND p_sampai),
        'peluang',  (SELECT count(*) FROM public.sm_pipeline
                      WHERE pipeline_date BETWEEN p_dari AND p_sampai),
        'meeting',  (SELECT count(*) FROM public.sm_schedules
                      WHERE requires_attendance AND status = 'COMPLETED'
                        AND schedule_date BETWEEN p_dari AND p_sampai),
        'gp',       (SELECT count(*) FROM public.sm_gp_calculations
                      WHERE calc_date BETWEEN p_dari AND p_sampai),
        'gp_gol',   (SELECT count(*) FROM public.sm_gp_calculations
                      WHERE status IN ('DISETUJUI','DIVERIFIKASI')
                        AND calc_date BETWEEN p_dari AND p_sampai)
      )
    ),

    -- ── Per Sales ──
    --
    -- Bagi Sales, RLS membuat hasilnya berisi satu baris: dirinya sendiri.
    -- Itu bukan cacat melainkan justru yang diinginkan — ia melihat angkanya
    -- sendiri tanpa perlu halaman terpisah, dan tetap tidak melihat angka
    -- rekannya.
    'per_sales', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'user_id',  u.id,
               'nama',     u.full_name,
               'laporan',  COALESCE(d.jml, 0),
               'peluang',  COALESCE(p.jml, 0),
               'nilai',    COALESCE(p.nilai, 0),
               'gp',       COALESCE(g.jml, 0),
               'profit',   COALESCE(g.profit, 0),
               'meeting',  COALESCE(s.jml, 0)
             ) ORDER BY COALESCE(p.nilai, 0) DESC), '[]'::jsonb)
      FROM public.users u
      LEFT JOIN (
        SELECT sales_user_id, count(*) AS jml FROM public.sm_daily_reports
         WHERE report_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) d ON d.sales_user_id = u.id
      LEFT JOIN (
        SELECT sales_user_id, count(*) AS jml, sum(project_value) AS nilai
          FROM public.sm_pipeline
         WHERE pipeline_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) p ON p.sales_user_id = u.id
      LEFT JOIN (
        SELECT sales_user_id, count(*) AS jml, sum(net_profit) AS profit
          FROM public.sm_gp_ringkasan
         WHERE calc_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) g ON g.sales_user_id = u.id
      LEFT JOIN (
        SELECT assigned_to, count(*) AS jml FROM public.sm_schedules
         WHERE requires_attendance AND status = 'COMPLETED'
           AND schedule_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) s ON s.assigned_to = u.id
      WHERE u.active AND u.role = 'SALES'
        AND (COALESCE(d.jml,0) + COALESCE(p.jml,0) + COALESCE(g.jml,0) + COALESCE(s.jml,0)) > 0
    ),

    -- ── Customer teratas ──
    'customer_teratas', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'nama', nama, 'jumlah', jml, 'nilai', nilai) ORDER BY nilai DESC), '[]'::jsonb)
      FROM (
        SELECT customer_name AS nama, count(*) AS jml,
               COALESCE(sum(project_value), 0) AS nilai
          FROM public.sm_pipeline
         WHERE pipeline_date BETWEEN p_dari AND p_sampai
         GROUP BY customer_name
         ORDER BY sum(project_value) DESC NULLS LAST
         LIMIT 6
      ) x
    )

  ) INTO v_hasil;

  RETURN v_hasil;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_dashboard_plus(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_dashboard_plus(date, date) TO authenticated;


-- ▼▼▼ 020_lokasi_dari_proyek.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 020 — Lokasi dipin dari Proyek, dengan persetujuan admin
--
-- Sebelumnya lokasi meeting hanya bisa didaftarkan admin lewat menu terpisah
-- (Admin Panel → Lokasi Meeting), sehingga Sales yang ingin bertemu di
-- customer baru harus minta admin mendaftarkan titiknya dulu sebelum jadwal
-- bisa dibuat. Sekarang Sales bisa pin lokasi langsung saat membuat Proyek.
--
-- Radius GPS TETAP sepenuhnya ditentukan server (lihat app/api/lokasi),
-- bukan oleh kolom di sini — kalau Sales bisa melebarkan radiusnya sendiri,
-- verifikasi kehadiran kehilangan arti (lihat catatan di TabLokasi.tsx).
-- Kolom baru di bawah hanya mencatat SIAPA yang mengajukan dan bagaimana
-- keputusan admin atasnya; lokasi ajuan Sales lahir dengan active=false dan
-- baru bisa dipakai check-in setelah admin menyetujuinya.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_locations
  ADD COLUMN IF NOT EXISTS project_id      uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'DISETUJUI'
    CHECK (approval_status IN ('MENUNGGU', 'DISETUJUI', 'DITOLAK')),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS approved_by     uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz;

COMMENT ON COLUMN public.sm_locations.approval_status IS
  'MENUNGGU = diajukan Sales lewat form Proyek, belum bisa dipilih di jadwal (active masih false) sampai admin menyetujui.';

ALTER TABLE public.sm_projects
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.sm_locations(id) ON DELETE SET NULL;


-- ▼▼▼ 021_multi_laporan_harian.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 021 — Sales boleh mengirim lebih dari satu Daily Report per hari
--
-- idx_daily_report_satu_per_hari (migrasi 002, §14) awalnya menegakkan "satu
-- laporan per Sales per hari". Aturan itu ternyata tidak cocok dengan cara
-- kerja lapangan: seorang Sales bisa mengunjungi beberapa customer dalam
-- sehari, dan tiap kunjungan pantas punya laporannya sendiri — bukan
-- dipaksa digabung ke satu baris atau ditolak dengan "sudah membuat laporan
-- untuk tanggal ini".
--
-- Kepatuhan laporan harian (sm_dashboard_ringkasan, migrasi 009) TIDAK
-- terpengaruh: dihitung dengan count(DISTINCT sales_user_id), bukan
-- count(*), jadi "sudah lapor hari ini" tetap berarti "minimal satu
-- laporan", bukan "tepat satu".
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_daily_report_satu_per_hari;


-- ▼▼▼ 022_hak_edit_hapus.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 022 — Admin bisa edit/hapus data siapa pun; Sales hanya bisa edit miliknya
--        sendiri dan TIDAK BISA menghapusnya
--
-- Sebelum migrasi ini, dua hal terbalik dari yang seharusnya:
--   1. Sales bisa menghapus Daily Report, Pipeline, dan GP Calculation
--      draft miliknya sendiri — padahal begitu tercatat, riwayatnya milik
--      perusahaan, bukan sesuatu yang boleh dihapus orang yang membuatnya.
--   2. Admin justru TIDAK BISA mengedit Daily Report atau Pipeline sama
--      sekali — kebijakan UPDATE-nya hanya mengizinkan sales_user_id = diri
--      sendiri, sehingga "Admin bisa sunting apa pun" belum benar-benar ada
--      di database, baru di kepala.
--
-- Aturan barunya, seragam di tiga tabel ini:
--   - EDIT  : pemilik ATAU sm_is_admin() — Manager TIDAK diikutkan sengaja,
--             supaya "siapa yang boleh mengubah data siapa pun" tetap satu
--             peran saja, bukan dua peran dengan cakupan yang mudah bergeser.
--   - HAPUS : sm_is_admin() saja — pemilik tidak lagi bisa menghapus.
--
-- SELECT tidak disentuh: dr_baca/pl_baca/gp_baca sudah membatasi Sales hanya
-- melihat miliknya sendiri (sales_user_id = sm_uid()), Manager/Admin melihat
-- semua lewat sm_is_pengawas() — itu sudah benar dan tetap seperti itu.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Daily Report ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS dr_ubah ON public.sm_daily_reports;
CREATE POLICY dr_ubah ON public.sm_daily_reports
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin())
  WITH CHECK (sales_user_id = public.sm_uid() OR public.sm_is_admin());

DROP POLICY IF EXISTS dr_hapus ON public.sm_daily_reports;
CREATE POLICY dr_hapus ON public.sm_daily_reports
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── Pipeline ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pl_ubah ON public.sm_pipeline;
CREATE POLICY pl_ubah ON public.sm_pipeline
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin())
  WITH CHECK (sales_user_id = public.sm_uid() OR public.sm_is_admin());

DROP POLICY IF EXISTS pl_hapus ON public.sm_pipeline;
CREATE POLICY pl_hapus ON public.sm_pipeline
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── GP Calculation ───────────────────────────────────────────────────────────
-- Sunting tetap terkunci ke status DRAFT untuk Sales (dokumen yang sudah
-- diajukan beku — lihat migrasi 016); Admin dikecualikan dari batas itu
-- karena "bisa edit apa pun" berarti apa pun statusnya, bukan cuma draft.
DROP POLICY IF EXISTS gp_sunting ON public.sm_gp_calculations;
CREATE POLICY gp_sunting ON public.sm_gp_calculations
  FOR UPDATE TO authenticated
  USING ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin())
  WITH CHECK ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin());

DROP POLICY IF EXISTS gp_hapus ON public.sm_gp_calculations;
CREATE POLICY gp_hapus ON public.sm_gp_calculations
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── Proyek ───────────────────────────────────────────────────────────────────
-- proyek_ubah TIDAK disentuh (owner ATAU pengawas — sudah termasuk Admin).
-- Hanya HAPUS yang dipersempit: pemilik proyek tidak lagi bisa menghapus
-- wadah yang mungkin sudah ditautkan pipeline/jadwal/GP milik orang lain.
DROP POLICY IF EXISTS proyek_hapus ON public.sm_projects;
CREATE POLICY proyek_hapus ON public.sm_projects
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── Schedule (Request Schedule) ──────────────────────────────────────────────
-- Sebelumnya HANYA Manager/Admin yang bisa UPDATE baris sm_schedules sama
-- sekali — bahkan Sales tidak bisa memperbaiki pengajuannya sendiri yang
-- salah ketik. Sekarang Sales boleh menyunting pengajuannya SENDIRI selama
-- masih UPCOMING dan belum ditugaskan (assigned_to IS NULL) — persis syarat
-- yang sudah dipakai sch_ajukan untuk INSERT, supaya "boleh dibuat" dan
-- "boleh disunting sebelum ditugaskan" konsisten. Begitu ditugaskan atau
-- statusnya berubah, kembali terkunci ke Manager/Admin — perubahan sesudah
-- itu menyentuh proses check-in GPS yang tidak boleh diutak-atik klien.
DROP POLICY IF EXISTS sch_kelola ON public.sm_schedules;
CREATE POLICY sch_kelola ON public.sm_schedules
  FOR UPDATE TO authenticated
  USING (
    public.sm_is_pengawas()
    OR (created_by = public.sm_uid() AND assigned_to IS NULL AND status = 'UPCOMING')
  )
  WITH CHECK (
    public.sm_is_pengawas()
    OR (created_by = public.sm_uid() AND assigned_to IS NULL AND status = 'UPCOMING')
  );


-- ▼▼▼ 023_hak_akses_menu_biodata.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 023 — Hak akses menu per peran/akun (tier lisensi) + biodata & atasan
--
-- BAGIAN 1: Hak Akses Menu
--
-- Dulu satu-satunya penyaringan menu adalah "Admin Panel hanya untuk
-- Manager/Admin", ditulis langsung di kode (Shell.tsx, `untuk: isPengawas`).
-- Itu cukup untuk satu aturan, tapi platform ini dijual ke banyak pelanggan
-- dengan paket berbeda — pelanggan A mungkin hanya beli Daily Report,
-- pelanggan B sampai GP Calculation. Aturan sebanyak itu tidak pantas
-- ditulis ulang di kode setiap kali ada pelanggan baru.
--
-- sm_role_menu   : default per PERAN — baris ada berarti peran itu boleh
--                  membuka menu itu.
-- sm_user_menu   : pengecualian per AKUN — begitu satu akun punya baris di
--                  sini, daftar inilah yang berlaku untuknya, MENGGANTIKAN
--                  default perannya (bukan digabung). Akun tanpa baris di
--                  sini mengikuti default perannya seperti biasa.
--
-- Baris di kedua tabel HANYA berisi kunci menu (teks pendek seperti
-- 'daily-report') — tidak ada data sensitif, jadi SELECT dibuka untuk semua
-- yang sudah masuk (dibutuhkan untuk merender sidebar & memblokir halaman
-- sendiri). Menulis tetap dikunci ke Admin, sejalan dengan §022.
--
-- Data awal disamakan PERSIS dengan perilaku sebelum migrasi ini: semua
-- peran melihat semua menu, kecuali Admin Panel yang tetap Manager+Admin —
-- supaya menerapkan migrasi ini tidak mengunci siapa pun secara tiba-tiba.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.sm_role_menu (
  role     text NOT NULL,
  menu_key text NOT NULL,
  PRIMARY KEY (role, menu_key)
);

CREATE TABLE public.sm_user_menu (
  user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  menu_key text NOT NULL,
  PRIMARY KEY (user_id, menu_key)
);

ALTER TABLE public.sm_role_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_user_menu ENABLE ROW LEVEL SECURITY;

CREATE POLICY rm_baca  ON public.sm_role_menu FOR SELECT TO authenticated USING (true);
CREATE POLICY rm_tulis ON public.sm_role_menu FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());
CREATE POLICY rm_ubah  ON public.sm_role_menu FOR UPDATE TO authenticated USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());
CREATE POLICY rm_hapus ON public.sm_role_menu FOR DELETE TO authenticated USING (public.sm_is_admin());

CREATE POLICY um_baca  ON public.sm_user_menu FOR SELECT TO authenticated USING (true);
CREATE POLICY um_tulis ON public.sm_user_menu FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());
CREATE POLICY um_ubah  ON public.sm_user_menu FOR UPDATE TO authenticated USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());
CREATE POLICY um_hapus ON public.sm_user_menu FOR DELETE TO authenticated USING (public.sm_is_admin());

INSERT INTO public.sm_role_menu (role, menu_key)
SELECT r, k
FROM unnest(ARRAY['SALES','MANAGER','ADMIN','DIRECTOR','FINANCE']) AS r
CROSS JOIN unnest(ARRAY['dashboard','daily-report','proyek','pipeline','schedule','meeting','gp','activity']) AS k;

INSERT INTO public.sm_role_menu (role, menu_key) VALUES ('MANAGER', 'admin'), ('ADMIN', 'admin');

-- ── BAGIAN 2: Biodata & atasan ───────────────────────────────────────────────
--
-- NIK, tempat/tanggal lahir, dan alamat adalah biodata milik pegawai sendiri
-- — boleh diisi lewat /api/profil, sama seperti email/telepon sekarang.
-- manager_id ("Atasan") beda sifatnya: itu keputusan struktur organisasi,
-- jadi hanya Admin yang boleh mengisinya (lewat /api/admin/users), bukan
-- kolom yang bisa diisi sendiri.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nik         text,
  ADD COLUMN IF NOT EXISTS birth_place text,
  ADD COLUMN IF NOT EXISTS birth_date  date,
  ADD COLUMN IF NOT EXISTS address     text,
  ADD COLUMN IF NOT EXISTS manager_id  uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.users
  ADD CONSTRAINT users_manager_not_self CHECK (manager_id IS NULL OR manager_id <> id);


-- ▼▼▼ 024_batalkan_nik_lahir.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 024 — Batalkan NIK dan tempat/tanggal lahir dari migrasi 023
--
-- Ditambahkan lalu langsung dibatalkan pada sesi yang sama sebelum dipakai
-- di mana pun — pemilik platform memutuskan dua field itu tidak diperlukan.
-- Alamat dan manager_id (atasan) TETAP, hanya dua kolom ini yang dibuang.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users
  DROP COLUMN IF EXISTS nik,
  DROP COLUMN IF EXISTS birth_place,
  DROP COLUMN IF EXISTS birth_date;


-- ▼▼▼ 025_gp_item_admin.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 025 — Perbaiki celah §022: admin edit GP Calculation orang lain bisa
--        menghapus item tanpa bisa menggantinya
--
-- FormGp.tsx menyunting item dengan cara hapus-semua-lalu-sisipkan-ulang
-- (lihat komentar di sana). gp_item_hapus sudah diberi jalan admin sejak
-- migrasi 022, tapi gp_item_tulis (INSERT) dan gp_item_ubah (UPDATE) — yang
-- keduanya hanya mengizinkan sales_user_id pemilik dokumen berstatus DRAFT —
-- terlewat. Akibatnya: Admin yang menyunting dokumen ORANG LAIN yang sudah
-- bukan DRAFT berhasil menghapus seluruh baris item lama (DELETE lolos),
-- tapi gagal menyisipkan baris baru (INSERT ditolak) — dokumen tertinggal
-- tanpa satu pun item, bukan tersunting. Disamakan dengan pola gp_sunting
-- di sm_gp_calculations: pemilik ATAU admin, tanpa syarat status untuk admin.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS gp_item_tulis ON public.sm_gp_items;
CREATE POLICY gp_item_tulis ON public.sm_gp_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sm_gp_calculations c
      WHERE c.id = sm_gp_items.calculation_id
        AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
    )
  );

DROP POLICY IF EXISTS gp_item_ubah ON public.sm_gp_items;
CREATE POLICY gp_item_ubah ON public.sm_gp_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sm_gp_calculations c
      WHERE c.id = sm_gp_items.calculation_id
        AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sm_gp_calculations c
      WHERE c.id = sm_gp_items.calculation_id
        AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
    )
  );


-- ▼▼▼ 026_zona_waktu_terlewat.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 026 — Zona waktu WIB, jadwal terlewat, dan kepatuhan laporan
--
-- 1. Database berjalan di UTC, sedangkan seluruh pengguna di WIB (UTC+7).
--    `current_date` di server tertinggal satu hari antara 00:00–06:59 WIB.
--    Akibatnya sm_check_in() menolak check-in meeting yang sah pada jam itu
--    dengan SCHEDULE_MISMATCH, dan lencana/dashboard menghitung "hari ini"
--    sebagai kemarin. Ketiga fungsi yang memakai current_date kini dipaksa
--    berjalan di Asia/Jakarta lewat klausa SET.
--
-- 2. Status MISSED tidak pernah diisi oleh apa pun, jadi "Terlewat" di
--    dashboard selalu 0 walau lonceng (yang menghitung dari tanggal) bilang
--    ada. Kini terlewat = MISSED ATAU belum selesai dan tanggalnya lewat.
--
-- 3. Kepatuhan laporan menghitung laporan dari akun non-Sales (mis. Admin)
--    sebagai "Sales sudah lapor". Kini hanya Sales aktif yang dihitung, dan
--    lencana "laporan belum diisi" hanya ditagihkan ke Sales.
-- ════════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) SET "TimeZone" TO 'Asia/Jakarta';

ALTER TABLE public.sm_pipeline        ALTER COLUMN pipeline_date SET DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date;
ALTER TABLE public.sm_gp_calculations ALTER COLUMN calc_date     SET DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date;

CREATE OR REPLACE FUNCTION public.sm_lonceng()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  v_uid      uuid    := public.sm_uid();
  v_pengawas boolean := public.sm_is_pengawas();
  v_hari     date    := current_date;
  v_pekan    date    := current_date + 7;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  RETURN jsonb_build_object(
    'laporan_belum', public.sm_role() = 'SALES' AND NOT EXISTS (
      SELECT 1 FROM public.sm_daily_reports
       WHERE sales_user_id = v_uid AND report_date = v_hari
    ),
    'jadwal_hari_ini', (
      SELECT count(*) FROM public.sm_schedules
       WHERE schedule_date = v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),
    'meeting_perlu', (
      SELECT count(*) FROM public.sm_schedules
       WHERE requires_attendance
         AND schedule_date = v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),
    'pipeline_dekat', (
      SELECT count(*) FROM public.sm_pipeline
       WHERE estimated_closing BETWEEN v_hari AND v_pekan
         AND stage IN ('OPEN', 'QUOTATION')
         AND (v_pengawas OR sales_user_id = v_uid)
    ),
    'terlewat', (
      SELECT count(*) FROM public.sm_schedules
       WHERE schedule_date < v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),
    'belum_ditugaskan', CASE WHEN v_pengawas THEN (
      SELECT count(*) FROM public.sm_schedules
       WHERE assigned_to IS NULL AND status = 'UPCOMING'
    ) ELSE 0 END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_dashboard(p_dari date DEFAULT (CURRENT_DATE - 29), p_sampai date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  v_hasil        jsonb;
  v_hari_ini     date := current_date;
  v_jml_sales    integer;
  v_sudah_lapor  integer;
BEGIN
  SELECT count(*) INTO v_jml_sales
    FROM public.users WHERE active AND role = 'SALES';

  SELECT count(DISTINCT r.sales_user_id) INTO v_sudah_lapor
    FROM public.sm_daily_reports r
    JOIN public.users u ON u.id = r.sales_user_id
   WHERE r.report_date = v_hari_ini AND u.active AND u.role = 'SALES';

  SELECT jsonb_build_object(
    'periode', jsonb_build_object('dari', p_dari, 'sampai', p_sampai),
    'daily_report', jsonb_build_object(
      'total_sales',   v_jml_sales,
      'sudah_lapor',   v_sudah_lapor,
      'belum_lapor',   GREATEST(0, v_jml_sales - v_sudah_lapor),
      'dalam_periode', (SELECT count(*) FROM public.sm_daily_reports
                         WHERE report_date BETWEEN p_dari AND p_sampai)
    ),
    'pipeline', (
      SELECT jsonb_build_object(
        'jumlah',      count(*),
        'total_nilai', COALESCE(sum(project_value), 0),
        'total_hpp',   COALESCE(sum(project_hpp),   0),
        'total_gp',    COALESCE(sum(project_gp),    0),
        'gp_persen',   CASE WHEN COALESCE(sum(project_value), 0) > 0
                            THEN round(sum(project_gp) / sum(project_value) * 100, 2)
                            ELSE 0 END,
        'akan_closing', count(*) FILTER (
                          WHERE estimated_closing BETWEEN v_hari_ini AND v_hari_ini + 30
                            AND stage NOT IN ('WON', 'LOST'))
      )
      FROM public.sm_pipeline
      WHERE pipeline_date BETWEEN p_dari AND p_sampai
    ),
    'probability', (
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'probability')::int), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
                 'probability', probability,
                 'jumlah',      count(*),
                 'nilai',       COALESCE(sum(project_value), 0)
               ) AS x
        FROM public.sm_pipeline
        WHERE pipeline_date BETWEEN p_dari AND p_sampai
        GROUP BY probability
      ) t
    ),
    'gp_kondisi', (
      SELECT jsonb_build_object(
        'positif', count(*) FILTER (WHERE project_gp >  0),
        'nol',     count(*) FILTER (WHERE project_gp =  0),
        'negatif', count(*) FILTER (WHERE project_gp <  0)
      )
      FROM public.sm_pipeline
      WHERE pipeline_date BETWEEN p_dari AND p_sampai
    ),
    'jadwal', (
      SELECT jsonb_build_object(
        'upcoming',    count(*) FILTER (WHERE status = 'UPCOMING' AND schedule_date >= v_hari_ini),
        'berjalan',    count(*) FILTER (WHERE status = 'IN_PROGRESS' AND schedule_date >= v_hari_ini),
        'selesai',     count(*) FILTER (WHERE status = 'COMPLETED'),
        'terlewat',    count(*) FILTER (WHERE status = 'MISSED'
                                          OR (status IN ('UPCOMING', 'IN_PROGRESS') AND schedule_date < v_hari_ini)),
        'dibatalkan',  count(*) FILTER (WHERE status = 'CANCELLED'),
        'hari_ini',    count(*) FILTER (WHERE schedule_date = v_hari_ini
                                          AND status IN ('UPCOMING', 'IN_PROGRESS'))
      )
      FROM public.sm_schedules
      WHERE schedule_date BETWEEN p_dari AND p_sampai
    ),
    'meeting', (
      SELECT jsonb_build_object(
        'total',            count(*),
        'selesai',          count(*) FILTER (WHERE s.status = 'COMPLETED'),
        'belum_mulai',      count(*) FILTER (WHERE a.id IS NULL AND s.status <> 'COMPLETED'),
        'menunggu_foto',    count(*) FILTER (WHERE a.state = 'EVIDENCE_PENDING'),
        'siap_selesai',     count(*) FILTER (WHERE a.state = 'READY_TO_COMPLETE'),
        'exception',        count(*) FILTER (WHERE a.state = 'EXCEPTION')
      )
      FROM public.sm_schedules s
      LEFT JOIN public.sm_attendance a ON a.schedule_id = s.id
      WHERE s.requires_attendance
        AND s.schedule_date BETWEEN p_dari AND p_sampai
    ),
    'gps_gagal', (
      SELECT COALESCE(jsonb_object_agg(validation_status, jml), '{}'::jsonb)
      FROM (
        SELECT validation_status, count(*) AS jml
        FROM public.sm_gps_events
        WHERE validation_status <> 'VALID'
          AND created_at::date BETWEEN p_dari AND p_sampai
        GROUP BY validation_status
      ) g
    ),
    'tren_bulanan', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'bulan',    to_char(b.bulan, 'Mon'),
               'laporan',  COALESCE(d.jml, 0),
               'pipeline', COALESCE(p.jml, 0),
               'nilai',    COALESCE(p.nilai, 0)
             ) ORDER BY b.bulan), '[]'::jsonb)
      FROM generate_series(
             date_trunc('month', v_hari_ini) - interval '5 months',
             date_trunc('month', v_hari_ini),
             interval '1 month'
           ) AS b(bulan)
      LEFT JOIN (
        SELECT date_trunc('month', report_date) AS bulan, count(*) AS jml
        FROM public.sm_daily_reports GROUP BY 1
      ) d ON d.bulan = b.bulan
      LEFT JOIN (
        SELECT date_trunc('month', pipeline_date) AS bulan,
               count(*) AS jml, sum(project_value) AS nilai
        FROM public.sm_pipeline GROUP BY 1
      ) p ON p.bulan = b.bulan
    )
  ) INTO v_hasil;

  RETURN v_hasil;
END;
$function$;


-- ▼▼▼ 027_perketat_hak_kolom.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 027 — Perketat hak baca data pribadi dan hak berlebih
--
-- 1. Policy users_baca = true (sengaja: daftar nama dibutuhkan di mana-mana),
--    tapi itu membuat SETIAP akun — termasuk Sales — bisa membaca email,
--    telepon, alamat, dan alasan penolakan seluruh pengguna langsung lewat
--    PostgREST. RLS menyaring baris, bukan kolom, jadi yang dibatasi di sini
--    adalah hak kolomnya. Kolom sensitif hanya terbaca lewat /api/profil dan
--    /api/admin/users (service role).
--
-- 2. Migrasi 016–023 membuat tabel/view baru tanpa mencabut hak bawaan
--    Supabase untuk anon. RLS/security_invoker sudah membuat anon tidak
--    mendapat satu baris pun, tapi hak itu tetap dicabut sebagai lapisan
--    kedua — termasuk TRUNCATE, satu-satunya hak yang tidak tunduk RLS.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE SELECT ON public.users FROM authenticated, anon;
GRANT SELECT (id, full_name, role, active, division, position, manager_id)
  ON public.users TO authenticated;

REVOKE ALL ON public.sm_gp_calculations, public.sm_gp_items, public.sm_projects,
              public.sm_role_menu, public.sm_user_menu,
              public.sm_activity_feed, public.sm_gp_ringkasan, public.sm_proyek_ringkasan
  FROM anon;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;


-- ▼▼▼ 028_indeks_login_ip.sql ▼▼▼
-- 028 — Indeks untuk batas percobaan login per-IP (app/api/auth/login).
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON public.login_attempts (ip, attempted_at DESC)
  WHERE success = false;


-- ▼▼▼ 029_indeks_fk.sql ▼▼▼
-- 029 — Indeks untuk foreign key yang ditambahkan migrasi 020 & 023.
CREATE INDEX IF NOT EXISTS idx_locations_approved_by ON public.sm_locations (approved_by);
CREATE INDEX IF NOT EXISTS idx_locations_project     ON public.sm_locations (project_id);
CREATE INDEX IF NOT EXISTS idx_projects_location     ON public.sm_projects (location_id);
CREATE INDEX IF NOT EXISTS idx_users_manager         ON public.users (manager_id);


-- ▼▼▼ 030_gp_pemisahan_tugas.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 030 — Pemisahan tugas pada persetujuan GP Calculation
--
-- Sebelumnya Admin boleh bertindak di ketiga tahap (Manager → Director →
-- Finance), jadi satu orang bisa membuat dokumen lalu meloloskannya sendirian
-- sampai DIVERIFIKASI. Kini:
--   1. pembuat dokumen tidak boleh menyetujuinya di tahap mana pun;
--   2. satu orang tidak boleh menyetujui dua tahap berturut-turut.
-- Aturan kedua sengaja bukan "tiga orang berbeda": dengan dua pemeriksa saja
-- (mis. dua Admin) alurnya tetap bisa tuntas, tapi tetap butuh dua pasang mata.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_gp_setujui(p_id uuid, p_catatan text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := public.sm_uid();
  v_peran text := public.sm_role();
  v_gp    public.sm_gp_calculations%ROWTYPE;
  v_baru  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.sales_user_id = v_uid THEN
    RAISE EXCEPTION 'Anda tidak bisa menyetujui perhitungan buatan Anda sendiri.' USING ERRCODE = '42501';
  END IF;

  IF v_gp.status = 'DIAJUKAN' THEN
    IF v_peran NOT IN ('MANAGER', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu pemeriksaan Manager Sales.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DIPERIKSA';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, checked_by = v_uid, checked_at = now() WHERE id = p_id;

  ELSIF v_gp.status = 'DIPERIKSA' THEN
    IF v_peran NOT IN ('DIRECTOR', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu persetujuan Director.' USING ERRCODE = '42501';
    END IF;
    IF v_gp.checked_by = v_uid THEN
      RAISE EXCEPTION 'Anda sudah memeriksa dokumen ini; persetujuan harus oleh orang lain.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DISETUJUI';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, approved_by = v_uid, approved_at = now() WHERE id = p_id;

  ELSIF v_gp.status = 'DISETUJUI' THEN
    IF v_peran NOT IN ('FINANCE', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu verifikasi Finance.' USING ERRCODE = '42501';
    END IF;
    IF v_gp.approved_by = v_uid THEN
      RAISE EXCEPTION 'Anda sudah menyetujui dokumen ini; verifikasi harus oleh orang lain.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DIVERIFIKASI';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, verified_by = v_uid, verified_at = now() WHERE id = p_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'STATUS_TIDAK_SESUAI',
      'message', 'Perhitungan ini tidak sedang menunggu persetujuan siapa pun.');
  END IF;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_' || v_baru, 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor, 'catatan', p_catatan));

  RETURN jsonb_build_object('ok', true, 'status', v_baru);
END;
$function$;


-- ▼▼▼ 031_target_sales.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 031 — Target penjualan per Sales
--
-- Target ditetapkan per Sales per BULAN (periode = tanggal 1 bulan itu), dalam
-- dua ukuran: nilai penjualan dan Gross Profit (opsional). Kuartal dan tahun
-- dihitung dengan menjumlahkan target bulanannya, jadi tidak perlu disimpan
-- terpisah dan tidak bisa saling bertentangan.
--
-- Realisasi = pipeline berstatus WON. Supaya WON bulan lalu tidak dihitung
-- ke bulan ini, sm_pipeline diberi won_at: diisi otomatis saat tahapan
-- berubah menjadi WON dan dikosongkan bila berubah lagi.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tanggal WON ─────────────────────────────────────────────────────────
ALTER TABLE public.sm_pipeline ADD COLUMN IF NOT EXISTS won_at date;

UPDATE public.sm_pipeline
   SET won_at = COALESCE(estimated_closing, (updated_at AT TIME ZONE 'Asia/Jakarta')::date)
 WHERE stage = 'WON' AND won_at IS NULL;

CREATE OR REPLACE FUNCTION public.sm_pipeline_isi_won_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.stage = 'WON' THEN
    IF TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'WON' OR NEW.won_at IS NULL THEN
      NEW.won_at := COALESCE(NEW.won_at, (now() AT TIME ZONE 'Asia/Jakarta')::date);
    END IF;
  ELSE
    NEW.won_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_pipeline_isi_won_at() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pipeline_won_at ON public.sm_pipeline;
CREATE TRIGGER trg_pipeline_won_at
  BEFORE INSERT OR UPDATE OF stage, won_at ON public.sm_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.sm_pipeline_isi_won_at();

CREATE INDEX IF NOT EXISTS idx_pipeline_won ON public.sm_pipeline (sales_user_id, won_at) WHERE stage = 'WON';

-- ── 2. Tabel target ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sm_sales_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  periode       date NOT NULL,
  target_nilai  numeric(18,2) NOT NULL DEFAULT 0 CHECK (target_nilai >= 0),
  target_gp     numeric(18,2) CHECK (target_gp IS NULL OR target_gp >= 0),
  updated_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sm_sales_targets_awal_bulan CHECK (periode = date_trunc('month', periode)::date),
  CONSTRAINT sm_sales_targets_unik UNIQUE (sales_user_id, periode)
);

CREATE INDEX IF NOT EXISTS idx_targets_periode ON public.sm_sales_targets (periode);
CREATE INDEX IF NOT EXISTS idx_targets_updated_by ON public.sm_sales_targets (updated_by);

ALTER TABLE public.sm_sales_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sm_sales_targets FROM anon;
REVOKE TRUNCATE ON public.sm_sales_targets FROM authenticated;

-- Sales melihat targetnya sendiri; hanya pengawas yang menetapkan.
DROP POLICY IF EXISTS tgt_baca ON public.sm_sales_targets;
CREATE POLICY tgt_baca ON public.sm_sales_targets FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS tgt_tulis ON public.sm_sales_targets;
CREATE POLICY tgt_tulis ON public.sm_sales_targets FOR INSERT TO authenticated
  WITH CHECK (public.sm_is_pengawas());

DROP POLICY IF EXISTS tgt_ubah ON public.sm_sales_targets;
CREATE POLICY tgt_ubah ON public.sm_sales_targets FOR UPDATE TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

DROP POLICY IF EXISTS tgt_hapus ON public.sm_sales_targets;
CREATE POLICY tgt_hapus ON public.sm_sales_targets FOR DELETE TO authenticated
  USING (public.sm_is_pengawas());

DROP TRIGGER IF EXISTS trg_targets_touch ON public.sm_sales_targets;
CREATE TRIGGER trg_targets_touch BEFORE UPDATE ON public.sm_sales_targets
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── 3. Pencapaian ──────────────────────────────────────────────────────────
-- SECURITY INVOKER: RLS tabel asal yang menentukan barisnya, jadi Sales
-- hanya mendapat dirinya sendiri dan pengawas mendapat seluruh Sales aktif.
CREATE OR REPLACE FUNCTION public.sm_pencapaian_target(p_dari date, p_sampai date)
 RETURNS TABLE (
   sales_user_id     uuid,
   full_name         text,
   target_nilai      numeric,
   target_gp         numeric,
   realisasi_nilai   numeric,
   realisasi_gp      numeric,
   jumlah_won        integer
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH sales AS (
    SELECT u.id, u.full_name FROM public.users u
     WHERE u.active AND u.role = 'SALES'
       AND (public.sm_is_pengawas() OR u.id = public.sm_uid())
  ),
  tgt AS (
    SELECT t.sales_user_id,
           sum(t.target_nilai) AS nilai,
           CASE WHEN count(t.target_gp) > 0 THEN sum(COALESCE(t.target_gp, 0)) END AS gp
      FROM public.sm_sales_targets t
     WHERE t.periode BETWEEN date_trunc('month', p_dari)::date AND p_sampai
     GROUP BY 1
  ),
  won AS (
    SELECT p.sales_user_id, sum(p.project_value) AS nilai, sum(p.project_gp) AS gp, count(*)::int AS jml
      FROM public.sm_pipeline p
     WHERE p.stage = 'WON' AND p.won_at BETWEEN p_dari AND p_sampai
     GROUP BY 1
  )
  SELECT s.id, s.full_name,
         COALESCE(tgt.nilai, 0), tgt.gp,
         COALESCE(won.nilai, 0), COALESCE(won.gp, 0), COALESCE(won.jml, 0)
    FROM sales s
    LEFT JOIN tgt ON tgt.sales_user_id = s.id
    LEFT JOIN won ON won.sales_user_id = s.id
   ORDER BY s.full_name;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_pencapaian_target(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sm_pencapaian_target(date, date) TO authenticated;

-- ── 4. Kartu dashboard baru bisa diatur dari Dashboard Setting ────────────
UPDATE public.sm_settings
   SET value = value || '[{"key":"target","label":"Pencapaian Target Sales","aktif":true}]'::jsonb
 WHERE key = 'dashboard_widgets'
   AND NOT (value @> '[{"key":"target"}]'::jsonb);


-- ▼▼▼ 032_gps_antipalsu.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 032 — Menolak check-in dari lokasi palsu (fake GPS)
--
-- YANG PERLU DIPAHAMI LEBIH DULU, SUPAYA TIDAK ADA YANG MENGIRA INI MUTLAK:
--
-- Aplikasi web TIDAK BISA membedakan koordinat asli dari koordinat buatan
-- dengan pasti. Di Android, penyedia lokasi tiruan ("mock location provider")
-- menyuntik posisinya di tingkat sistem operasi, sehingga peramban menerima
-- angka itu sebagai lokasi yang sah dan meneruskannya lewat Geolocation API
-- seperti biasa. Bendera `isFromMockProvider` yang dipakai aplikasi native
-- Android TIDAK pernah diteruskan ke peramban — tidak ada padanannya di web.
-- Siapa pun yang menjanjikan "web app anti fake GPS 100%" sedang menjual
-- sesuatu yang tidak ada.
--
-- Yang bisa dilakukan, dan itulah isi migrasi ini: MENGENALI JEJAKNYA.
-- Sinyal GPS sungguhan punya sidik jari fisik yang sulit ditiru aplikasi
-- pemalsu, dan yang dinilai di sini bukan satu-satu nilainya, melainkan
-- PERTENTANGAN di antara mereka:
--
--   * Fix GNSS sungguhan selalu bergoyang. Berdiri diam pun, koordinatnya
--     bergeser 1–5 meter antar sampel. Aplikasi pemalsu mengembalikan angka
--     yang sama persis sampai tujuh desimal, setiap kali.
--   * Fix GNSS sungguhan membawa ketinggian (altitude). Aplikasi pemalsu
--     hampir selalu meninggalkannya kosong.
--   * Fix GNSS sungguhan memberi akurasi pecahan (8,734 m), bukan bulat.
--     Aplikasi pemalsu menyetel angka bulat yang rapi: 1, 5, 10, 20.
--   * Akurasi di bawah 1 meter tidak ada pada perangkat konsumen.
--
-- Satu nilai kosong belum berarti bohong — fix dari wifi/menara seluler juga
-- tidak punya ketinggian dan juga tidak bergoyang. Karena itu yang diberi
-- nilai besar adalah PERTENTANGANNYA: mengaku presisi 5 meter (kelas GNSS)
-- sambil tidak punya satu pun ciri GNSS. Fix wifi yang jujur mengaku akurasi
-- 40 meter tidak akan pernah diblokir oleh aturan ini.
--
-- Keputusannya dibuat DI SINI, di database, bukan di peramban. Peramban hanya
-- melaporkan sampel mentah; ia tidak pernah menyimpulkan sah atau tidak.
--
-- Batas jujur yang tetap ada: pemalsu yang mau bersusah payah bisa menambal
-- sendiri isi laporannya (mengarang sampel yang bergoyang dan ketinggian yang
-- masuk akal). Itu jauh lebih sulit daripada memasang aplikasi dari Play
-- Store, dan seluruh laporannya tetap tersimpan di sm_gps_events sehingga
-- polanya bisa dilihat pengawas. Untuk kepastian mutlak dibutuhkan aplikasi
-- Android native yang membaca isFromMockProvider — itu di luar platform ini.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tempat menyimpan bukti mentahnya ─────────────────────────────────────
--
-- Semua ini disimpan apa adanya, termasuk pada percobaan yang ditolak. Tanpa
-- bahan mentahnya, tuduhan "ini fake GPS" tidak bisa dipertanggungjawabkan ke
-- orang yang dituduh.

ALTER TABLE public.sm_gps_events
  ADD COLUMN IF NOT EXISTS altitude_m          numeric(10,2),
  ADD COLUMN IF NOT EXISTS altitude_accuracy_m numeric(10,2),
  ADD COLUMN IF NOT EXISTS speed_mps           numeric(10,2),
  ADD COLUMN IF NOT EXISTS heading_deg         numeric(6,2),
  ADD COLUMN IF NOT EXISTS client_time         timestamptz,
  ADD COLUMN IF NOT EXISTS samples             jsonb,
  ADD COLUMN IF NOT EXISTS client_signals      jsonb,
  ADD COLUMN IF NOT EXISTS spoof_score         smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spoof_signals       text[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ip_hint             text;

-- Status baru. Dibedakan dari OUTSIDE_RADIUS supaya laporan bisa memisahkan
-- "salah tempat" (bisa jadi jujur) dari "lokasinya tidak masuk akal".
ALTER TABLE public.sm_gps_events DROP CONSTRAINT IF EXISTS sm_gps_events_validation_status_check;
ALTER TABLE public.sm_gps_events ADD CONSTRAINT sm_gps_events_validation_status_check
  CHECK (validation_status IN ('VALID', 'SCHEDULE_MISMATCH', 'ASSIGNMENT_MISMATCH',
                               'LOW_ACCURACY', 'OUTSIDE_RADIUS', 'NO_LOCATION',
                               'ALREADY_CLOSED', 'SUSPECTED_MOCK'));

-- Dipakai pemeriksaan "teleportasi": mencari jejak sah terakhir milik satu
-- orang. Tanpa indeks ini, setiap check-in memindai seluruh tabel jejak.
CREATE INDEX IF NOT EXISTS idx_gps_events_user_waktu
  ON public.sm_gps_events (user_id, created_at DESC);

-- ── 2. Ambang batas, bisa disetel admin tanpa mengubah kode ─────────────────

INSERT INTO public.sm_settings (key, value) VALUES
  ('gps_spoof_block_score', '60'::jsonb),
  ('gps_spoof_warn_score',  '30'::jsonb),
  ('gps_max_kmh',          '300'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sm_angka_setelan(p_key text, p_bawaan numeric)
RETURNS numeric LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::numeric FROM public.sm_settings WHERE key = p_key),
                  p_bawaan);
$$;

-- ── 3. Penilaiannya ─────────────────────────────────────────────────────────
--
-- Mengembalikan {skor, tanda[]}. Tidak memutuskan apa pun sendiri — yang
-- membandingkan skor dengan ambang adalah sm_check_in().

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
  -- Akurasi "kelas GNSS": di bawah nilai ini, perangkat sedang mengaku punya
  -- fix satelit sungguhan — dan karena itu wajib menunjukkan ciri-cirinya.
  v_presisi CONSTANT numeric := 15;
  v_prev   record;
  v_jarak  numeric;
  v_detik  numeric;
  v_kmh    numeric;
BEGIN
  -- ══ a. Laporan tidak ada sama sekali ══════════════════════════════════════
  -- Diperlakukan sebagai sangat mencurigakan, BUKAN sebagai lulus. Aplikasi
  -- ini selalu mengirimkannya; yang memanggil RPC tanpa laporan berarti skrip
  -- atau klien yang sudah diutak-atik. Ketiadaan bukti bukan bukti ketiadaan.
  IF p_signals IS NULL THEN
    RETURN jsonb_build_object('skor', 60, 'tanda', ARRAY['LAPORAN_KOSONG']);
  END IF;

  -- ══ b. Geolocation API sudah ditimpa ═════════════════════════════════════
  -- Menangkap pemalsu termurah dan paling umum di desktop: ekstensi peramban
  -- dan devtools, yang mengganti getCurrentPosition dengan fungsi JavaScript
  -- biasa. Fungsi aslinya selalu melaporkan dirinya sebagai [native code].
  IF COALESCE((p_signals->>'api_asli')::boolean, false) = false THEN
    v_skor := v_skor + 60;
    v_tanda := v_tanda || 'API_LOKASI_DITIMPA';
  END IF;

  IF COALESCE((p_signals->>'objek_asli')::boolean, false) = false THEN
    v_skor := v_skor + 60;
    v_tanda := v_tanda || 'OBJEK_POSISI_PALSU';
  END IF;

  -- ══ c. Goyangan sampel ═══════════════════════════════════════════════════
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
    v_tanda := v_tanda || 'SAMPEL_TERLALU_SEDIKIT';
  ELSIF v_jitter = 0 THEN
    IF p_accuracy IS NOT NULL AND p_accuracy <= v_presisi THEN
      -- Inilah pertentangan yang paling menentukan: mengaku presisi beberapa
      -- meter, tapi tidak bergeser sepersejuta derajat pun selama beberapa
      -- detik. Sinyal satelit sungguhan tidak pernah sediam itu.
      v_skor := v_skor + 45;
      v_tanda := v_tanda || 'TITIK_BEKU_TAPI_MENGAKU_PRESISI';
    ELSE
      -- Fix wifi/menara seluler juga beku, dan itu wajar. Cukup dicatat.
      v_skor := v_skor + 10;
      v_tanda := v_tanda || 'TITIK_BEKU';
    END IF;
  END IF;

  IF v_n >= 3 AND v_akurasi_unik = 1 THEN
    v_skor := v_skor + 10;
    v_tanda := v_tanda || 'AKURASI_TIDAK_BERUBAH';
  END IF;

  -- ══ d. Ciri fisik yang hilang ════════════════════════════════════════════
  IF p_altitude IS NULL THEN
    IF p_accuracy IS NOT NULL AND p_accuracy <= v_presisi THEN
      v_skor := v_skor + 25;
      v_tanda := v_tanda || 'TANPA_KETINGGIAN_TAPI_MENGAKU_PRESISI';
    ELSE
      v_skor := v_skor + 5;
      v_tanda := v_tanda || 'TANPA_KETINGGIAN';
    END IF;
  END IF;

  IF p_accuracy IS NOT NULL AND p_accuracy < 1 THEN
    v_skor := v_skor + 30;
    v_tanda := v_tanda || 'AKURASI_MUSTAHIL';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy <= 20 AND p_accuracy = round(p_accuracy) THEN
    v_skor := v_skor + 10;
    v_tanda := v_tanda || 'AKURASI_BULAT_RAPI';
  END IF;

  -- ══ e. Perangkat ═════════════════════════════════════════════════════════
  -- Kehadiran di lapangan dilakukan dari ponsel. Check-in dari perangkat tanpa
  -- layar sentuh berarti dari komputer — tempat ekstensi pemalsu lokasi hidup.
  IF COALESCE((p_signals->>'sentuh')::boolean, true) = false THEN
    v_skor := v_skor + 25;
    v_tanda := v_tanda || 'BUKAN_PERANGKAT_SENTUH';
  END IF;

  -- Jam perangkat yang jauh menyimpang menandakan posisi yang disodorkan
  -- bukan hasil pembacaan saat itu.
  IF abs(COALESCE((p_signals->>'selisih_jam_ms')::numeric, 0)) > 120000 THEN
    v_skor := v_skor + 20;
    v_tanda := v_tanda || 'JAM_PERANGKAT_MENYIMPANG';
  END IF;

  -- ══ f. Teleportasi ═══════════════════════════════════════════════════════
  -- Satu-satunya sinyal di sini yang TIDAK bisa dikarang klien: ia dihitung
  -- dari jejak yang sudah tersimpan, bukan dari laporan yang baru masuk.
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
      v_tanda := v_tanda || 'PINDAH_TERLALU_CEPAT';
    END IF;
  END IF;

  RETURN jsonb_build_object('skor', LEAST(v_skor, 100), 'tanda', v_tanda);
END;
$$;

-- ── 4. sm_check_in() dengan lapisan barunya ─────────────────────────────────
--
-- Parameter lama tetap di urutan yang sama supaya pemanggil lama tidak pecah;
-- yang baru ditambahkan di belakang dengan DEFAULT NULL. Tapi perhatikan:
-- pemanggil yang tidak mengirim p_signals mendapat skor 60 dari butir (a) dan
-- karena itu DITOLAK. Ini disengaja — bukan celah yang terlupa.

CREATE OR REPLACE FUNCTION public.sm_check_in(
  p_schedule_id uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy    numeric DEFAULT NULL,
  p_altitude    numeric DEFAULT NULL,
  p_alt_acc     numeric DEFAULT NULL,
  p_speed       numeric DEFAULT NULL,
  p_heading     numeric DEFAULT NULL,
  p_client_time timestamptz DEFAULT NULL,
  p_samples     jsonb DEFAULT NULL,
  p_signals     jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := public.sm_uid();
  v_sched     public.sm_schedules%ROWTYPE;
  v_lok       public.sm_locations%ROWTYPE;
  v_status    text;
  v_distance  numeric;
  v_att_id    uuid;
  v_gps_id    uuid;
  v_ambang    numeric := public.sm_ambang_akurasi();
  v_nilai     jsonb;
  v_skor      int;
  v_tanda     text[];
  v_batas     numeric := public.sm_angka_setelan('gps_spoof_block_score', 60);
  v_ip        text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_sched.requires_attendance THEN
    RAISE EXCEPTION 'Jadwal ini tidak memerlukan kehadiran ber-GPS.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_lok FROM public.sm_locations WHERE id = v_sched.location_id;

  v_nilai := public.sm_gps_skor_palsu(v_uid, p_lat, p_lng, p_accuracy, p_altitude,
                                      p_samples, p_signals);
  v_skor  := (v_nilai->>'skor')::int;
  SELECT array_agg(t) INTO v_tanda FROM jsonb_array_elements_text(v_nilai->'tanda') t;
  v_tanda := COALESCE(v_tanda, '{}');

  -- Alamat IP dibaca dari header yang dipasang PostgREST. Tidak dipakai untuk
  -- memutuskan apa pun — hanya dicatat, supaya dua orang yang check-in di dua
  -- kota berbeda dari satu sambungan yang sama bisa terlihat kemudian.
  v_ip := split_part(
            COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
            ',', 1);
  IF v_ip = '' THEN v_ip := NULL; END IF;

  -- Rantai keputusan. Hanya SATU status yang keluar, dan itu yang dicatat.
  -- Dugaan lokasi palsu diperiksa SESUDAH penugasan dan tanggal (pelanggaran
  -- yang lebih pokok tetap dilaporkan apa adanya) tapi SEBELUM radius —
  -- koordinat yang tidak bisa dipercaya tidak layak dibandingkan dengan radius,
  -- dan mengembalikan OUTSIDE_RADIUS untuk lokasi palsu justru mengajari
  -- pemakainya untuk menggeser titik palsunya sampai masuk.
  IF v_sched.assigned_to IS DISTINCT FROM v_uid THEN
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF v_sched.schedule_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  ELSIF v_lok.id IS NULL THEN
    v_status := 'NO_LOCATION';
  ELSIF v_skor >= v_batas THEN
    v_status := 'SUSPECTED_MOCK';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_ambang THEN
    v_status := 'LOW_ACCURACY';
  ELSE
    v_distance := public.sm_distance_meters(p_lat, p_lng, v_lok.latitude, v_lok.longitude);
    IF v_distance > v_lok.gps_radius_m THEN
      v_status := 'OUTSIDE_RADIUS';
    ELSE
      v_status := 'VALID';
    END IF;
  END IF;

  INSERT INTO public.sm_gps_events (
    schedule_id, user_id, event_type, latitude, longitude, accuracy_m,
    expected_latitude, expected_longitude, allowed_radius_m, distance_m,
    validation_status, altitude_m, altitude_accuracy_m, speed_mps, heading_deg,
    client_time, samples, client_signals, spoof_score, spoof_signals, ip_hint
  ) VALUES (
    p_schedule_id, v_uid, 'CHECK_IN', p_lat, p_lng, p_accuracy,
    v_lok.latitude, v_lok.longitude, v_lok.gps_radius_m, v_distance, v_status,
    p_altitude, p_alt_acc, p_speed, p_heading,
    p_client_time, p_samples, p_signals, v_skor, v_tanda, v_ip
  )
  RETURNING id INTO v_gps_id;

  IF v_status = 'SUSPECTED_MOCK' THEN
    -- Dicatat di audit_trail juga: ini bukan kegagalan teknis biasa, ini
    -- kejadian yang perlu dilihat pengawas tanpa harus membuka tabel jejak.
    INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
    VALUES (v_uid, 'MEETING_CHECK_IN_DIDUGA_PALSU', 'sm_schedules', p_schedule_id::text,
            jsonb_build_object('skor', v_skor, 'tanda', v_tanda,
                               'lat', p_lat, 'lng', p_lng, 'accuracy_m', p_accuracy));
  END IF;

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object(
      'validation_status', v_status,
      'distance_m', v_distance,
      'allowed_radius_m', v_lok.gps_radius_m,
      'spoof_score', v_skor,
      'spoof_signals', v_tanda,
      'attendance_id', NULL
    );
  END IF;

  INSERT INTO public.sm_attendance (
    schedule_id, user_id, checkin_at, state, gps_verified, distance_m, accuracy_m
  ) VALUES (
    p_schedule_id, v_uid, now(), 'EVIDENCE_PENDING', true, v_distance, p_accuracy
  )
  ON CONFLICT (schedule_id) DO UPDATE SET
    gps_verified = true,
    distance_m   = EXCLUDED.distance_m,
    accuracy_m   = EXCLUDED.accuracy_m,
    checkin_at   = COALESCE(sm_attendance.checkin_at, EXCLUDED.checkin_at),
    state        = CASE
                     WHEN sm_attendance.state IN ('COMPLETED', 'READY_TO_COMPLETE')
                       THEN sm_attendance.state
                     ELSE 'EVIDENCE_PENDING'
                   END
  RETURNING id INTO v_att_id;

  UPDATE public.sm_gps_events SET attendance_id = v_att_id WHERE id = v_gps_id;

  UPDATE public.sm_schedules
    SET status = 'IN_PROGRESS'
    WHERE id = p_schedule_id AND status = 'UPCOMING';

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_CHECK_IN', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('distance_m', v_distance, 'accuracy_m', p_accuracy,
                             'skor_palsu', v_skor, 'tanda', v_tanda));

  RETURN jsonb_build_object(
    'validation_status', 'VALID',
    'distance_m', v_distance,
    'allowed_radius_m', v_lok.gps_radius_m,
    'spoof_score', v_skor,
    'spoof_signals', v_tanda,
    'attendance_id', v_att_id
  );
END;
$$;

-- ── 5. Hak eksekusi ─────────────────────────────────────────────────────────
--
-- Tanda tangan sm_check_in berubah, jadi fungsi versi 4-parameter yang lama
-- masih ada di database dengan hak lamanya. Ia dihapus supaya tidak menjadi
-- pintu belakang yang melewati seluruh penilaian di atas.

DROP FUNCTION IF EXISTS public.sm_check_in(uuid, numeric, numeric, numeric);

-- Supabase memberi EXECUTE ke anon secara eksplisit, jadi REVOKE FROM public
-- saja tidak cukup — anon harus disebut namanya (pelajaran migrasi 017).
REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.sm_gps_skor_palsu(uuid, numeric, numeric, numeric,
  numeric, jsonb, jsonb) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sm_angka_setelan(text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_angka_setelan(text, numeric) TO authenticated;


-- ▼▼▼ 033_gps_skor_perbaikan.sql ▼▼▼
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


-- ▼▼▼ 034_bersihkan_tak_terpakai.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 034 — buang objek basis data yang tidak dipakai siapa pun.
--
-- Diperiksa sebelum dibuang: tidak dirujuk kode aplikasi, fungsi lain, policy,
-- view, maupun foreign key.
--
-- 1. sm_contacts — dibuat di 002, tidak pernah diisi (0 baris) dan tidak pernah
--    dibaca. Kontak customer disimpan langsung di laporan harian
--    (contact_person, phone_whatsapp) dan pipeline.
-- 2. sm_dashboard_plus() — dari 019. Hook pemanggilnya (useDashboardPlus)
--    tidak pernah dipasang di halaman mana pun, jadi fungsinya berjalan
--    kosong. Angka yang benar-benar tampil di dashboard berasal dari
--    sm_dashboard() dan sm_pencapaian_target().
-- 3. idx_gps_events_user_waktu — kembar persis dengan idx_gps_user dari 003
--    (user_id, created_at DESC). Dua indeks identik hanya memperlambat tulis.
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.sm_contacts;

DROP FUNCTION IF EXISTS public.sm_dashboard_plus(date, date);

DROP INDEX IF EXISTS public.idx_gps_events_user_waktu;


-- ▼▼▼ 035_customer_per_sales.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 035 — daftar customer milik Sales yang menanganinya.
--
-- Aturan dari pemilik platform:
--   • Customer hanya terlihat oleh Sales yang menanganinya.
--   • Sales lain tidak boleh melihatnya — tidak lewat daftar, pencarian
--     header, maupun isian pilihan customer.
--   • Yang boleh ikut melihat hanya ATASAN Sales itu sendiri (garis atasan
--     lewat users.manager_id), plus Admin.
--
-- Sebelum migrasi ini:
--   • customers_baca = true — semua orang melihat semua customer.
--   • created_by tidak punya default dan kode tidak pernah mengisinya, jadi
--     tidak ada satu baris pun yang tercatat pemiliknya.
--   • Nama unik secara GLOBAL. Begitu daftar dipisah per Sales, Sales B tidak
--     akan bisa mencatat "PT X" bila Sales A sudah punya — dan tidak pula bisa
--     melihat milik A. Keunikan dipindah menjadi per pemilik.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Pemilik terisi otomatis ─────────────────────────────────────────────
ALTER TABLE public.sm_customers ALTER COLUMN created_by SET DEFAULT public.sm_uid();

-- Baris lama: pemiliknya ditebak dari catatan pertama yang merujuknya. Baris
-- yang tidak dirujuk apa pun tetap tanpa pemilik — hanya Admin yang melihatnya.
UPDATE public.sm_customers c
   SET created_by = x.pemilik
  FROM (
    SELECT DISTINCT ON (customer_id) customer_id, pemilik
      FROM (
        SELECT customer_id, sales_user_id AS pemilik, created_at FROM public.sm_daily_reports
        UNION ALL
        SELECT customer_id, sales_user_id, created_at FROM public.sm_pipeline
        UNION ALL
        SELECT customer_id, owner_user_id, created_at FROM public.sm_projects
        UNION ALL
        SELECT customer_id, sales_user_id, created_at FROM public.sm_gp_calculations
        UNION ALL
        SELECT customer_id, coalesce(assigned_to, created_by), created_at FROM public.sm_schedules
      ) r
     WHERE customer_id IS NOT NULL AND pemilik IS NOT NULL
     ORDER BY customer_id, created_at
  ) x
 WHERE c.id = x.customer_id AND c.created_by IS NULL;

-- ── 2. Nama unik per pemilik, bukan global ─────────────────────────────────
DROP INDEX IF EXISTS public.idx_customers_name_unik;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_pemilik_nama
  ON public.sm_customers (created_by, lower(btrim(name)));

-- ── 3. Siapa atasan siapa ──────────────────────────────────────────────────
-- Benar bila pemanggil berada di garis atasan p_user (atasan langsung, atau
-- atasan dari atasannya). SECURITY DEFINER supaya tidak bergantung pada hak
-- baca tabel users milik pemanggil; kedalaman dibatasi agar data manager_id
-- yang melingkar tidak membuat kueri berputar tanpa akhir.
CREATE OR REPLACE FUNCTION public.sm_adalah_atasan(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH RECURSIVE garis AS (
    SELECT manager_id, 1 AS tingkat FROM public.users WHERE id = p_user
    UNION ALL
    SELECT u.manager_id, g.tingkat + 1
      FROM garis g JOIN public.users u ON u.id = g.manager_id
     WHERE g.tingkat < 10
  )
  SELECT p_user IS NOT NULL AND public.sm_uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM garis WHERE manager_id = public.sm_uid());
$$;

REVOKE ALL ON FUNCTION public.sm_adalah_atasan(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sm_adalah_atasan(uuid) TO authenticated;

-- ── 4. Policy ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS customers_baca  ON public.sm_customers;
DROP POLICY IF EXISTS customers_tulis ON public.sm_customers;
DROP POLICY IF EXISTS customers_ubah  ON public.sm_customers;

CREATE POLICY customers_baca ON public.sm_customers FOR SELECT TO authenticated
  USING (created_by = public.sm_uid()
         OR public.sm_is_admin()
         OR public.sm_adalah_atasan(created_by));

-- Customer selalu dicatat atas nama pembuatnya; hanya Admin yang boleh
-- mencatatkannya untuk orang lain.
CREATE POLICY customers_tulis ON public.sm_customers FOR INSERT TO authenticated
  WITH CHECK (created_by = public.sm_uid() OR public.sm_is_admin());

-- Menyunting: pemilik sendiri atau Admin — sama dengan aturan data lain.
CREATE POLICY customers_ubah ON public.sm_customers FOR UPDATE TO authenticated
  USING (created_by = public.sm_uid() OR public.sm_is_admin())
  WITH CHECK (created_by = public.sm_uid() OR public.sm_is_admin());

-- customers_hapus (hanya Admin) tidak berubah.


-- ▼▼▼ 036_jenjang_posisi.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 036 — jenjang posisi dan penjaga pohon organisasi.
--
-- Jenjang tetap, dari bawah ke atas:
--   Staff → Supervisor → Manager → General Manager → Direktur
--
-- Setiap akun wajib punya posisi (dipaksa di formulir pendaftaran dan di
-- Admin → Pengguna); pohonnya — siapa membawahi siapa, lewat
-- users.manager_id — dipetakan Admin di Admin → Struktur Organisasi.
--
-- Aturan pohon ditegakkan DI SINI, bukan hanya di tampilan, supaya tidak bisa
-- dilewati lewat pemanggilan API langsung:
--   • tidak ada yang menjadi atasan dirinya sendiri;
--   • atasan harus aktif dan berposisi LEBIH TINGGI dari bawahannya
--     (boleh melompati jenjang: Staff langsung di bawah Manager itu sah);
--   • tidak boleh ada lingkaran (A di bawah B, B di bawah A);
--   • menurunkan posisi seseorang ditolak bila ia masih membawahi orang yang
--     posisinya setara atau lebih tinggi dari posisi barunya.
--
-- Padanan di kode: lib/posisi.ts. Ketiganya (constraint, fungsi peringkat,
-- dan daftar di kode) harus selalu sama.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Rapikan nilai lama ke jenjang baku ─────────────────────────────────
-- Posisi sebelumnya teks bebas dari daftar yang bisa disunting. Yang jelas
-- padanannya dipetakan; sisanya dikosongkan supaya Admin mengisinya.
UPDATE public.users SET position = CASE lower(btrim(position))
    WHEN 'staff'           THEN 'Staff'
    WHEN 'senior staff'    THEN 'Staff'
    WHEN 'sales'           THEN 'Staff'
    WHEN 'supervisor'      THEN 'Supervisor'
    WHEN 'manager'         THEN 'Manager'
    WHEN 'senior manager'  THEN 'Manager'
    WHEN 'general manager' THEN 'General Manager'
    WHEN 'gm'              THEN 'General Manager'
    WHEN 'director'        THEN 'Direktur'
    WHEN 'direktur'        THEN 'Direktur'
    ELSE NULL
  END
 WHERE position IS NOT NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_position_jenjang;
ALTER TABLE public.users ADD CONSTRAINT users_position_jenjang
  CHECK (position IS NULL
         OR position IN ('Staff', 'Supervisor', 'Manager', 'General Manager', 'Direktur'));

-- Pilihan di formulir pendaftaran mengikuti jenjang baku.
UPDATE public.sm_settings
   SET value = '["Staff","Supervisor","Manager","General Manager","Direktur"]'::jsonb,
       updated_at = now()
 WHERE key = 'positions';

-- ── 2. Peringkat ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_peringkat_posisi(p text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE p
    WHEN 'Staff'           THEN 1
    WHEN 'Supervisor'      THEN 2
    WHEN 'Manager'         THEN 3
    WHEN 'General Manager' THEN 4
    WHEN 'Direktur'        THEN 5
    ELSE 0
  END;
$$;

-- ── 3. Penjaga pohon ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_jaga_struktur()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_atasan  record;
  v_bawahan record;
  v_lingkar boolean;
BEGIN
  IF NEW.manager_id IS NOT NULL THEN
    IF NEW.manager_id = NEW.id THEN
      RAISE EXCEPTION 'Seseorang tidak bisa menjadi atasannya sendiri.';
    END IF;

    SELECT id, full_name, position, active INTO v_atasan
      FROM public.users WHERE id = NEW.manager_id;

    IF NOT FOUND OR NOT v_atasan.active THEN
      RAISE EXCEPTION 'Atasan yang dipilih tidak ditemukan atau sudah nonaktif.';
    END IF;

    IF NEW.position IS NULL OR v_atasan.position IS NULL THEN
      RAISE EXCEPTION 'Isi posisi % dan % lebih dulu sebelum memetakan atasan.',
        NEW.full_name, v_atasan.full_name;
    END IF;

    IF sm_peringkat_posisi(v_atasan.position) <= sm_peringkat_posisi(NEW.position) THEN
      RAISE EXCEPTION 'Atasan harus berposisi lebih tinggi: % (%) tidak bisa membawahi % (%).',
        v_atasan.full_name, v_atasan.position, NEW.full_name, NEW.position;
    END IF;

    -- Lingkaran: telusuri garis atasan dari atasan baru; bila bertemu orang
    -- ini sendiri, pemetaannya membentuk lingkaran.
    WITH RECURSIVE garis AS (
      SELECT id, manager_id, 1 AS tingkat FROM public.users WHERE id = NEW.manager_id
      UNION ALL
      SELECT u.id, u.manager_id, g.tingkat + 1
        FROM garis g JOIN public.users u ON u.id = g.manager_id
       WHERE g.tingkat < 20
    )
    SELECT EXISTS (SELECT 1 FROM garis WHERE id = NEW.id) INTO v_lingkar;

    IF v_lingkar THEN
      RAISE EXCEPTION 'Pemetaan ini membuat lingkaran: % sudah berada di bawah %.',
        v_atasan.full_name, NEW.full_name;
    END IF;
  END IF;

  -- Menurunkan posisi tidak boleh meninggalkan bawahan yang setara/lebih tinggi.
  IF TG_OP = 'UPDATE' AND NEW.position IS DISTINCT FROM OLD.position THEN
    SELECT full_name, position INTO v_bawahan
      FROM public.users
     WHERE manager_id = NEW.id
       AND sm_peringkat_posisi(position) >= sm_peringkat_posisi(NEW.position)
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Posisi % terlalu rendah: % masih membawahi % (%). Pindahkan bawahannya dulu.',
        coalesce(NEW.position, '(kosong)'), NEW.full_name, v_bawahan.full_name, v_bawahan.position;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jaga_struktur ON public.users;
CREATE TRIGGER trg_jaga_struktur
  BEFORE INSERT OR UPDATE OF manager_id, position ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sm_jaga_struktur();

REVOKE ALL ON FUNCTION public.sm_jaga_struktur() FROM public, anon, authenticated;


-- ▼▼▼ 037_lisensi.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 037 — Lisensi & hak fitur deployment ini (LICENSE_ARCHITECTURE.md)
--
-- Model komersialnya: SATU pelanggan = SATU deployment (Vercel + Supabase
-- sendiri) = SATU lisensi. Sumber kebenaran lisensi ada di License Authority
-- pusat (license-authority/), BUKAN di database ini.
--
-- Yang tinggal di sini hanya SALINAN TERVERIFIKASI (sm_lisensi, satu baris):
-- token bertanda tangan Ed25519 dari Authority beserta isinya yang sudah
-- diurai. Baris itu hanya ditulis server (service role) SETELAH tanda
-- tangannya lolos pemeriksaan; peran `authenticated`/`anon` tidak punya hak
-- apa pun atasnya — Admin pelanggan tidak bisa menambah fitur, memperpanjang
-- masa berlaku, atau mengubah status.
--
-- Penegakan di database, bukan sekadar menu yang disembunyikan (§12):
--   • sm_fitur_berlisensi(fitur) — cermin evaluasiLisensi() di
--     lib/lisensi/kontrak.ts. Gagal TERTUTUP: tanpa baris, kedaluwarsa,
--     ditangguhkan, dicabut, atau melewati masa tenggang 7 hari ⇒ hanya
--     fitur keadaan-terbatas (admin_settings, notifications) yang hidup.
--   • Policy RESTRICTIVE per tabel bisnis. Policy restrictive di-AND-kan
--     dengan policy permisif yang sudah ada, jadi RLS lama TIDAK dilonggarkan
--     sedikit pun — hanya ditambah satu syarat.
--   • Trigger per pernyataan untuk penulisan. Fungsi SECURITY DEFINER
--     (sm_check_in, sm_gp_setujui, …) melewati RLS; trigger tetap menyala
--     di dalamnya, sehingga jalur RPC juga terkunci.
--
-- TIDAK ADA DATA YANG DIHAPUS. Fitur yang tidak berlisensi hanya ditutup
-- aksesnya; begitu lisensi dipulihkan atau ditingkatkan, datanya kembali
-- terlihat utuh (§45, §46, §80).
--
-- URUTAN PENERAPAN: migrasi ini mengunci modul bisnis sampai lisensi pertama
-- terverifikasi. Siapkan License Authority dan variabel LICENSE_* dulu
-- (lihat LICENSE_ARCHITECTURE.md → Checklist produksi), baru terapkan.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Salinan lisensi terverifikasi ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_lisensi (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode              text NOT NULL DEFAULT 'production' CHECK (mode IN ('production', 'development')),
  deployment_id     text,
  license_id        text,
  -- Token SMPL1 apa adanya; diperiksa ulang tanda tangannya setiap dibaca server.
  token             text,
  company_name      text,
  -- Status dasar dari Authority (PENDING/ACTIVE/SUSPENDED/REVOKED), atau
  -- INVALID bila token gagal pemeriksaan keaslian.
  status            text,
  package           text,
  license_type      text,
  features          jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_at         timestamptz,
  starts_at         timestamptz,
  expires_at        timestamptz,
  grace_period_days integer NOT NULL DEFAULT 7 CHECK (grace_period_days BETWEEN 0 AND 60),
  warning_days      integer NOT NULL DEFAULT 30,
  requests          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Observabilitas (§60)
  last_verified_at  timestamptz,
  last_attempt_at   timestamptz,
  last_failed_at    timestamptz,
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sm_lisensi ENABLE ROW LEVEL SECURITY;
-- Sengaja TANPA policy: hanya service role (server) yang membaca/menulis.
REVOKE ALL ON public.sm_lisensi FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.sm_lisensi FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.sm_lisensi FROM authenticated';
  END IF;
END $$;

-- ── Keputusan fitur ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_fitur_berlisensi(p_fitur text)
RETURNS boolean
LANGUAGE sql
STABLE
-- DEFINER supaya bisa membaca sm_lisensi yang tertutup bagi pemanggil.
-- Yang keluar hanya satu boolean, tidak pernah isi barisnya.
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH l AS (SELECT * FROM public.sm_lisensi WHERE id)
  SELECT CASE
    -- Harus sama dengan FITUR_SAAT_TERBATAS di lib/lisensi/kontrak.ts.
    WHEN NOT EXISTS (SELECT 1 FROM l) THEN p_fitur IN ('admin_settings', 'notifications')
    ELSE (
      SELECT CASE
        WHEN l.mode = 'development' THEN true
        WHEN l.status = 'ACTIVE'
         AND l.expires_at IS NOT NULL AND l.expires_at > now()
         AND l.last_verified_at IS NOT NULL
         AND l.last_verified_at + make_interval(days => l.grace_period_days) > now()
          THEN COALESCE(l.features ->> p_fitur, 'false') = 'true'
        ELSE p_fitur IN ('admin_settings', 'notifications')
      END
      FROM l
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_fitur_berlisensi(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sm_fitur_berlisensi(text) TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sm_fitur_berlisensi(text) TO anon';
  END IF;
END $$;

-- ── Penjaga penulisan (termasuk dari dalam fungsi SECURITY DEFINER) ─────────

CREATE OR REPLACE FUNCTION public.sm_lisensi_jaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  -- Klaim JWT tetap terbaca di dalam fungsi DEFINER, sedangkan current_user
  -- berubah menjadi pemilik fungsi. Karena itu klaim didahulukan.
  v_peran text := COALESCE(NULLIF(public.sm_jwt('role'), ''), current_user::text);
  v_fitur text;
BEGIN
  -- Server (service_role) dan pemilik basis data (migrasi, SQL Editor) tidak
  -- dijaga di sini: route handler memeriksa lisensinya sendiri (lib/lisensi/server.ts).
  IF v_peran NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;

  FOREACH v_fitur IN ARRAY TG_ARGV LOOP
    IF public.sm_fitur_berlisensi(v_fitur) THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'FEATURE_NOT_LICENSED'
    USING ERRCODE = '42501',
          DETAIL  = TG_TABLE_NAME,
          HINT    = 'Fitur ini tidak termasuk dalam lisensi platform saat ini.';
END;
$$;

-- ── Pemasangan per tabel ────────────────────────────────────────────────────
--
-- Pemetaan fitur → tabel (LICENSE_ARCHITECTURE.md §Pemetaan modul):
--   customer        sm_customers, sm_contacts
--   daily_report    sm_daily_reports
--   pipeline        sm_pipeline
--   schedule|meeting sm_schedules (meeting adalah jadwal ber-check-in)
--   meeting         sm_attendance, sm_evidence, sm_gps_events, sm_exceptions
--   meeting|project sm_locations (dipakai check-in dan pin lokasi proyek)
--   project         sm_projects
--   gp_calculation  sm_gp_calculations, sm_gp_items
--   pipeline        sm_sales_targets (realisasi target = pipeline WON)

DO $$
DECLARE
  r record;
  v_syarat text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('sm_customers',       ARRAY['customer']),
      ('sm_contacts',        ARRAY['customer']),
      ('sm_daily_reports',   ARRAY['daily_report']),
      ('sm_pipeline',        ARRAY['pipeline']),
      ('sm_schedules',       ARRAY['schedule', 'meeting']),
      ('sm_attendance',      ARRAY['meeting']),
      ('sm_evidence',        ARRAY['meeting']),
      ('sm_gps_events',      ARRAY['meeting']),
      ('sm_exceptions',      ARRAY['meeting']),
      ('sm_locations',       ARRAY['meeting', 'project']),
      ('sm_projects',        ARRAY['project']),
      ('sm_gp_calculations', ARRAY['gp_calculation']),
      ('sm_gp_items',        ARRAY['gp_calculation']),
      ('sm_sales_targets',   ARRAY['pipeline'])
    ) AS t(tabel, fitur)
  LOOP
    IF to_regclass('public.' || r.tabel) IS NULL THEN
      CONTINUE;
    END IF;

    -- (SELECT …) membuat fungsinya dievaluasi sekali per query (initPlan),
    -- bukan sekali per baris.
    SELECT string_agg(format('(SELECT public.sm_fitur_berlisensi(%L))', f), ' OR ')
      INTO v_syarat FROM unnest(r.fitur) AS f;

    EXECUTE format('DROP POLICY IF EXISTS lisensi_fitur ON public.%I', r.tabel);
    EXECUTE format(
      'CREATE POLICY lisensi_fitur ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      r.tabel, v_syarat, v_syarat);

    EXECUTE format('DROP TRIGGER IF EXISTS lisensi_jaga ON public.%I', r.tabel);
    EXECUTE format(
      'CREATE TRIGGER lisensi_jaga BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.sm_lisensi_jaga(%s)',
      r.tabel, (SELECT string_agg(quote_literal(f), ', ') FROM unnest(r.fitur) AS f));
  END LOOP;
END $$;

-- Foto bukti meeting ikut modul Meeting. Dibungkus pemeriksaan skema supaya
-- migrasi tetap jalan di Postgres tanpa Supabase Storage (uji lokal).
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS lisensi_evidence ON storage.objects';
    EXECUTE $p$
      CREATE POLICY lisensi_evidence ON storage.objects AS RESTRICTIVE
        FOR ALL TO authenticated
        USING (bucket_id <> 'evidence' OR (SELECT public.sm_fitur_berlisensi('meeting')))
        WITH CHECK (bucket_id <> 'evidence' OR (SELECT public.sm_fitur_berlisensi('meeting')))
    $p$;
  END IF;
END $$;


-- ▼▼▼ 038_lisensi_kode_aktivasi.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 038 — Kode Aktivasi lisensi
--
-- Admin pelanggan kini cukup menempel satu Kode Aktivasi dari Kantor Pusat di
-- Admin → Lisensi; tidak perlu lagi mengisi LICENSE_* di Vercel per pelanggan.
-- Kunci deployment dari kode itu disimpan di sini — tabel sm_lisensi tetap
-- tertutup total bagi pengguna aplikasi (tanpa policy, tanpa grant; migrasi 037),
-- hanya server (service role) yang membacanya.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_lisensi ADD COLUMN IF NOT EXISTS deployment_key text;


-- ▼▼▼ 039_aplikasi_android.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 039 — check-in lewat aplikasi Android: laporan lokasi native bertanda tangan.
--
-- Versi web hanya bisa MENEBAK lokasi palsu dari ciri-cirinya (migrasi 032),
-- karena browser tidak pernah menerima penanda "lokasi tiruan" dari Android.
-- Aplikasi Android (android/) membaca lokasi langsung dari sistem dan
-- menerima penanda itu (Location.isMock). Laporannya ditandatangani
-- HMAC-SHA256 dengan kunci yang hanya dimiliki APK deployment ini dan
-- tabel sm_kunci_aplikasi di bawah.
--
-- sm_check_in kini:
--   • laporan aplikasi SAH dan tidak tiruan  → dipercaya (skor tebakan = 0);
--   • laporan aplikasi bertanda tiruan       → SUSPECTED_MOCK;
--   • laporan aplikasi dengan tanda tangan tidak sah / basi / dipakai ulang
--                                            → SUSPECTED_MOCK;
--   • tanpa laporan aplikasi                 → jalur tebakan lama, KECUALI
--     pengaturan checkin_wajib_aplikasi = true → APP_REQUIRED.
--
-- Kunci TIDAK ditulis di berkas ini. Ia dibuat per deployment saat APK
-- dibangun (android/README.md) dan dimasukkan langsung ke tabel.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sm_kunci_aplikasi (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  kunci       text NOT NULL CHECK (length(kunci) >= 32),
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sm_kunci_aplikasi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sm_kunci_aplikasi FROM PUBLIC, anon, authenticated;

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('checkin_wajib_aplikasi', 'false'::jsonb,
   'Bila true, check-in Meeting hanya diterima dari aplikasi Android (pencegahan fake GPS).'),
  ('apk_versi_minimum', '"1.0.0"'::jsonb,
   'Versi aplikasi Android terendah yang masih diizinkan; di bawahnya pengguna diminta memperbarui.')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.sm_gps_events DROP CONSTRAINT IF EXISTS sm_gps_events_validation_status_check;
ALTER TABLE public.sm_gps_events ADD CONSTRAINT sm_gps_events_validation_status_check
  CHECK (validation_status IN ('VALID', 'SCHEDULE_MISMATCH', 'ASSIGNMENT_MISMATCH',
                               'LOW_ACCURACY', 'OUTSIDE_RADIUS', 'NO_LOCATION',
                               'ALREADY_CLOSED', 'SUSPECTED_MOCK', 'APP_REQUIRED'));

-- ── Verifikasi laporan aplikasi ────────────────────────────────────────────
-- Muatan: v1|<id_jadwal>|<lat>|<lng>|<akurasi>|<tiruan 0/1>|<waktu_ms>|<versi>|<nonce>
CREATE OR REPLACE FUNCTION public.sm_verifikasi_aplikasi(
  p_schedule_id uuid, p_lat numeric, p_lng numeric, p_signals jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_native  jsonb := p_signals -> 'native';
  v_muatan  text;
  v_tanda   text;
  v_kunci   text;
  v_bagian  text[];
  v_waktu   bigint;
BEGIN
  IF v_native IS NULL OR jsonb_typeof(v_native) <> 'object' THEN
    RETURN jsonb_build_object('ada', false);
  END IF;

  v_muatan := v_native ->> 'payload';
  v_tanda  := lower(coalesce(v_native ->> 'tanda', ''));
  IF v_muatan IS NULL OR length(v_muatan) > 300 THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_RUSAK');
  END IF;

  SELECT kunci INTO v_kunci FROM public.sm_kunci_aplikasi WHERE id;
  IF v_kunci IS NULL THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_BELUM_DIPASANGKAN');
  END IF;

  IF v_tanda <> encode(hmac(convert_to(v_muatan, 'UTF8'), convert_to(v_kunci, 'UTF8'), 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_TANDA_TANGAN_TIDAK_SAH');
  END IF;

  v_bagian := string_to_array(v_muatan, '|');
  IF array_length(v_bagian, 1) <> 9 OR v_bagian[1] <> 'v1' THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_RUSAK');
  END IF;

  IF v_bagian[2] <> p_schedule_id::text
     OR abs(v_bagian[3]::numeric - p_lat) > 0.000001
     OR abs(v_bagian[4]::numeric - p_lng) > 0.000001 THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_TIDAK_COCOK');
  END IF;

  -- Umur laporan: jam HP boleh sedikit meleset, tapi laporan lama tidak boleh
  -- dipakai lagi di kemudian hari.
  v_waktu := v_bagian[7]::bigint;
  IF abs(extract(epoch FROM now()) * 1000 - v_waktu) > 5 * 60 * 1000 THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_LAPORAN_BASI');
  END IF;

  -- Satu laporan hanya sah sekali.
  IF EXISTS (SELECT 1 FROM public.sm_gps_events
              WHERE client_signals -> 'native' ->> 'tanda' = v_tanda) THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_LAPORAN_DIPAKAI_ULANG');
  END IF;

  RETURN jsonb_build_object('ada', true, 'sah', true, 'mock', v_bagian[6] = '1',
                            'versi', v_bagian[8]);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_RUSAK');
END;
$$;

REVOKE ALL ON FUNCTION public.sm_verifikasi_aplikasi(uuid, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_gps_tanda_aplikasi
  ON public.sm_gps_events ((client_signals -> 'native' ->> 'tanda'))
  WHERE client_signals ? 'native';

-- ── sm_check_in ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_check_in(
  p_schedule_id uuid, p_lat numeric, p_lng numeric,
  p_accuracy numeric DEFAULT NULL, p_altitude numeric DEFAULT NULL, p_alt_acc numeric DEFAULT NULL,
  p_speed numeric DEFAULT NULL, p_heading numeric DEFAULT NULL,
  p_client_time timestamptz DEFAULT NULL, p_samples jsonb DEFAULT NULL, p_signals jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := public.sm_uid();
  v_sched     public.sm_schedules%ROWTYPE;
  v_lok       public.sm_locations%ROWTYPE;
  v_status    text;
  v_distance  numeric;
  v_att_id    uuid;
  v_gps_id    uuid;
  v_ambang    numeric := public.sm_ambang_akurasi();
  v_nilai     jsonb;
  v_skor      int;
  v_tanda     text[];
  v_batas     numeric := public.sm_angka_setelan('gps_spoof_block_score', 60);
  v_ip        text;
  v_app       jsonb;
  v_wajib_app boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_sched.requires_attendance THEN
    RAISE EXCEPTION 'Jadwal ini tidak memerlukan kehadiran ber-GPS.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_lok FROM public.sm_locations WHERE id = v_sched.location_id;

  v_nilai := public.sm_gps_skor_palsu(v_uid, p_lat, p_lng, p_accuracy, p_altitude,
                                      p_samples, p_signals);
  v_skor  := (v_nilai->>'skor')::int;
  SELECT array_agg(t) INTO v_tanda FROM jsonb_array_elements_text(v_nilai->'tanda') t;
  v_tanda := COALESCE(v_tanda, '{}');

  -- Laporan aplikasi Android menggantikan tebakan: bila sah dan tidak tiruan,
  -- ciri-ciri "mencurigakan" versi web (titik beku, akurasi bulat) tidak lagi
  -- relevan — Android sendiri yang menyatakan lokasinya bukan tiruan.
  v_app := public.sm_verifikasi_aplikasi(p_schedule_id, p_lat, p_lng, p_signals);
  IF (v_app->>'ada')::boolean THEN
    IF NOT (v_app->>'sah')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || (v_app->>'alasan');
    ELSIF (v_app->>'mock')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || 'APLIKASI_MENDETEKSI_LOKASI_TIRUAN'::text;
    ELSE
      v_skor  := 0;
      v_tanda := ARRAY['DIVERIFIKASI_APLIKASI']::text[] || v_tanda;
    END IF;
  END IF;

  v_wajib_app := COALESCE((SELECT (value #>> '{}')::boolean FROM public.sm_settings
                            WHERE key = 'checkin_wajib_aplikasi'), false);

  v_ip := split_part(
            COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
            ',', 1);
  IF v_ip = '' THEN v_ip := NULL; END IF;

  IF v_sched.assigned_to IS DISTINCT FROM v_uid THEN
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF v_sched.schedule_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  ELSIF v_lok.id IS NULL THEN
    v_status := 'NO_LOCATION';
  ELSIF v_wajib_app AND NOT (v_app->>'ada')::boolean THEN
    v_status := 'APP_REQUIRED';
  ELSIF v_skor >= v_batas THEN
    v_status := 'SUSPECTED_MOCK';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_ambang THEN
    v_status := 'LOW_ACCURACY';
  ELSE
    v_distance := public.sm_distance_meters(p_lat, p_lng, v_lok.latitude, v_lok.longitude);
    IF v_distance > v_lok.gps_radius_m THEN
      v_status := 'OUTSIDE_RADIUS';
    ELSE
      v_status := 'VALID';
    END IF;
  END IF;

  INSERT INTO public.sm_gps_events (
    schedule_id, user_id, event_type, latitude, longitude, accuracy_m,
    expected_latitude, expected_longitude, allowed_radius_m, distance_m,
    validation_status, altitude_m, altitude_accuracy_m, speed_mps, heading_deg,
    client_time, samples, client_signals, spoof_score, spoof_signals, ip_hint
  ) VALUES (
    p_schedule_id, v_uid, 'CHECK_IN', p_lat, p_lng, p_accuracy,
    v_lok.latitude, v_lok.longitude, v_lok.gps_radius_m, v_distance, v_status,
    p_altitude, p_alt_acc, p_speed, p_heading,
    p_client_time, p_samples, p_signals, v_skor, v_tanda, v_ip
  )
  RETURNING id INTO v_gps_id;

  IF v_status = 'SUSPECTED_MOCK' THEN
    INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
    VALUES (v_uid, 'MEETING_CHECK_IN_DIDUGA_PALSU', 'sm_schedules', p_schedule_id::text,
            jsonb_build_object('skor', v_skor, 'tanda', v_tanda,
                               'lat', p_lat, 'lng', p_lng, 'accuracy_m', p_accuracy));
  END IF;

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object(
      'validation_status', v_status,
      'distance_m', v_distance,
      'allowed_radius_m', v_lok.gps_radius_m,
      'spoof_score', v_skor,
      'spoof_signals', v_tanda,
      'attendance_id', NULL
    );
  END IF;

  INSERT INTO public.sm_attendance (
    schedule_id, user_id, checkin_at, state, gps_verified, distance_m, accuracy_m
  ) VALUES (
    p_schedule_id, v_uid, now(), 'EVIDENCE_PENDING', true, v_distance, p_accuracy
  )
  ON CONFLICT (schedule_id) DO UPDATE SET
    gps_verified = true,
    distance_m   = EXCLUDED.distance_m,
    accuracy_m   = EXCLUDED.accuracy_m,
    checkin_at   = COALESCE(sm_attendance.checkin_at, EXCLUDED.checkin_at),
    state        = CASE
                     WHEN sm_attendance.state IN ('COMPLETED', 'READY_TO_COMPLETE')
                       THEN sm_attendance.state
                     ELSE 'EVIDENCE_PENDING'
                   END
  RETURNING id INTO v_att_id;

  UPDATE public.sm_gps_events SET attendance_id = v_att_id WHERE id = v_gps_id;

  UPDATE public.sm_schedules
    SET status = 'IN_PROGRESS'
    WHERE id = p_schedule_id AND status = 'UPCOMING';

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_CHECK_IN', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('distance_m', v_distance, 'accuracy_m', p_accuracy,
                             'skor_palsu', v_skor, 'tanda', v_tanda,
                             'lewat_aplikasi', (v_app->>'ada')::boolean));

  RETURN jsonb_build_object(
    'validation_status', 'VALID',
    'distance_m', v_distance,
    'allowed_radius_m', v_lok.gps_radius_m,
    'spoof_score', v_skor,
    'spoof_signals', v_tanda,
    'attendance_id', v_att_id
  );
END;
$function$;


-- ▼▼▼ 040_aplikasi_tetap_dinilai_server.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 040 — Check-in lewat aplikasi Android tidak lagi melewati penilaian server
--
-- Di 039, laporan lokasi bertanda tangan sah dari aplikasi membuat skor
-- kecurigaan langsung 0. Kunci tanda tangannya tertanam di APK (yang bisa
-- diunduh setiap pengguna yang masuk), sehingga orang yang membongkar APK bisa
-- memalsukan laporan "sah" dan lolos dari SEMUA pemeriksaan — termasuk
-- "pindah terlalu cepat" yang dihitung dari jejak tersimpan di server.
--
-- Kini untuk laporan aplikasi yang sah hanya sinyal khas peramban yang
-- diabaikan; sinyal yang tidak bisa dikarang klien tetap dinilai, dan
-- "pindah terlalu cepat" cukup untuk menolak. Tidak ada
-- perubahan lain pada sm_check_in (salinan 039 apa adanya selain blok itu).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_check_in(
  p_schedule_id uuid, p_lat numeric, p_lng numeric,
  p_accuracy numeric DEFAULT NULL, p_altitude numeric DEFAULT NULL, p_alt_acc numeric DEFAULT NULL,
  p_speed numeric DEFAULT NULL, p_heading numeric DEFAULT NULL,
  p_client_time timestamptz DEFAULT NULL, p_samples jsonb DEFAULT NULL, p_signals jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := public.sm_uid();
  v_sched     public.sm_schedules%ROWTYPE;
  v_lok       public.sm_locations%ROWTYPE;
  v_status    text;
  v_distance  numeric;
  v_att_id    uuid;
  v_gps_id    uuid;
  v_ambang    numeric := public.sm_ambang_akurasi();
  v_nilai     jsonb;
  v_skor      int;
  v_tanda     text[];
  v_batas     numeric := public.sm_angka_setelan('gps_spoof_block_score', 60);
  v_ip        text;
  v_app       jsonb;
  v_wajib_app boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_sched.requires_attendance THEN
    RAISE EXCEPTION 'Jadwal ini tidak memerlukan kehadiran ber-GPS.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_lok FROM public.sm_locations WHERE id = v_sched.location_id;

  v_nilai := public.sm_gps_skor_palsu(v_uid, p_lat, p_lng, p_accuracy, p_altitude,
                                      p_samples, p_signals);
  v_skor  := (v_nilai->>'skor')::int;
  SELECT array_agg(t) INTO v_tanda FROM jsonb_array_elements_text(v_nilai->'tanda') t;
  v_tanda := COALESCE(v_tanda, '{}');

  -- Laporan aplikasi Android: bila sah dan tidak tiruan, ciri-ciri versi web
  -- (titik beku, akurasi bulat) tidak relevan — tetapi lihat blok ELSE.
  v_app := public.sm_verifikasi_aplikasi(p_schedule_id, p_lat, p_lng, p_signals);
  IF (v_app->>'ada')::boolean THEN
    IF NOT (v_app->>'sah')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || (v_app->>'alasan');
    ELSIF (v_app->>'mock')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || 'APLIKASI_MENDETEKSI_LOKASI_TIRUAN'::text;
    ELSE
      -- Tanda tangan sah hanya membuktikan laporan dibuat dengan kunci yang
      -- ada di APK — dan kunci itu bisa dibongkar dari APK. Karena itu hanya
      -- sinyal khas peramban yang diabaikan; sinyal yang dihitung SERVER dari
      -- jejak tersimpan dan kemustahilan fisik tetap dinilai. Lompatan mustahil
      -- cukup untuk menolak sendiri (bobot 60 = ambang bawaan).
      SELECT COALESCE(array_agg(t), '{}') INTO v_tanda
        FROM unnest(v_tanda) t WHERE t IN ('PINDAH_TERLALU_CEPAT', 'AKURASI_MUSTAHIL');
      v_skor  := CASE WHEN 'PINDAH_TERLALU_CEPAT' = ANY (v_tanda) THEN 60 ELSE 0 END
               + CASE WHEN 'AKURASI_MUSTAHIL' = ANY (v_tanda) THEN 30 ELSE 0 END;
      v_tanda := ARRAY['DIVERIFIKASI_APLIKASI']::text[] || v_tanda;
    END IF;
  END IF;

  v_wajib_app := COALESCE((SELECT (value #>> '{}')::boolean FROM public.sm_settings
                            WHERE key = 'checkin_wajib_aplikasi'), false);

  v_ip := split_part(
            COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
            ',', 1);
  IF v_ip = '' THEN v_ip := NULL; END IF;

  IF v_sched.assigned_to IS DISTINCT FROM v_uid THEN
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF v_sched.schedule_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  ELSIF v_lok.id IS NULL THEN
    v_status := 'NO_LOCATION';
  ELSIF v_wajib_app AND NOT (v_app->>'ada')::boolean THEN
    v_status := 'APP_REQUIRED';
  ELSIF v_skor >= v_batas THEN
    v_status := 'SUSPECTED_MOCK';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_ambang THEN
    v_status := 'LOW_ACCURACY';
  ELSE
    v_distance := public.sm_distance_meters(p_lat, p_lng, v_lok.latitude, v_lok.longitude);
    IF v_distance > v_lok.gps_radius_m THEN
      v_status := 'OUTSIDE_RADIUS';
    ELSE
      v_status := 'VALID';
    END IF;
  END IF;

  INSERT INTO public.sm_gps_events (
    schedule_id, user_id, event_type, latitude, longitude, accuracy_m,
    expected_latitude, expected_longitude, allowed_radius_m, distance_m,
    validation_status, altitude_m, altitude_accuracy_m, speed_mps, heading_deg,
    client_time, samples, client_signals, spoof_score, spoof_signals, ip_hint
  ) VALUES (
    p_schedule_id, v_uid, 'CHECK_IN', p_lat, p_lng, p_accuracy,
    v_lok.latitude, v_lok.longitude, v_lok.gps_radius_m, v_distance, v_status,
    p_altitude, p_alt_acc, p_speed, p_heading,
    p_client_time, p_samples, p_signals, v_skor, v_tanda, v_ip
  )
  RETURNING id INTO v_gps_id;

  IF v_status = 'SUSPECTED_MOCK' THEN
    INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
    VALUES (v_uid, 'MEETING_CHECK_IN_DIDUGA_PALSU', 'sm_schedules', p_schedule_id::text,
            jsonb_build_object('skor', v_skor, 'tanda', v_tanda,
                               'lat', p_lat, 'lng', p_lng, 'accuracy_m', p_accuracy));
  END IF;

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object(
      'validation_status', v_status,
      'distance_m', v_distance,
      'allowed_radius_m', v_lok.gps_radius_m,
      'spoof_score', v_skor,
      'spoof_signals', v_tanda,
      'attendance_id', NULL
    );
  END IF;

  INSERT INTO public.sm_attendance (
    schedule_id, user_id, checkin_at, state, gps_verified, distance_m, accuracy_m
  ) VALUES (
    p_schedule_id, v_uid, now(), 'EVIDENCE_PENDING', true, v_distance, p_accuracy
  )
  ON CONFLICT (schedule_id) DO UPDATE SET
    gps_verified = true,
    distance_m   = EXCLUDED.distance_m,
    accuracy_m   = EXCLUDED.accuracy_m,
    checkin_at   = COALESCE(sm_attendance.checkin_at, EXCLUDED.checkin_at),
    state        = CASE
                     WHEN sm_attendance.state IN ('COMPLETED', 'READY_TO_COMPLETE')
                       THEN sm_attendance.state
                     ELSE 'EVIDENCE_PENDING'
                   END
  RETURNING id INTO v_att_id;

  UPDATE public.sm_gps_events SET attendance_id = v_att_id WHERE id = v_gps_id;

  UPDATE public.sm_schedules
    SET status = 'IN_PROGRESS'
    WHERE id = p_schedule_id AND status = 'UPCOMING';

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_CHECK_IN', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('distance_m', v_distance, 'accuracy_m', p_accuracy,
                             'skor_palsu', v_skor, 'tanda', v_tanda,
                             'lewat_aplikasi', (v_app->>'ada')::boolean));

  RETURN jsonb_build_object(
    'validation_status', 'VALID',
    'distance_m', v_distance,
    'allowed_radius_m', v_lok.gps_radius_m,
    'spoof_score', v_skor,
    'spoof_signals', v_tanda,
    'attendance_id', v_att_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) TO authenticated;


-- ▼▼▼ 041_zona_waktu_check_in.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 041 — Check-in kembali memakai tanggal WIB
--
-- Migrasi 026 memasang `SET "TimeZone" TO 'Asia/Jakarta'` pada sm_check_in()
-- karena database berjalan di UTC: tanpa itu `current_date` tertinggal satu
-- hari antara 00:00–06:59 WIB, dan check-in meeting yang sah pada jam itu
-- ditolak dengan SCHEDULE_MISMATCH ("Jadwal ini bukan untuk hari ini").
--
-- Klausa itu melekat pada tanda tangan fungsi lama (4 parameter). Ketika
-- sm_check_in() ditulis ulang dengan 11 parameter (032, 039, 040), fungsi
-- barunya lahir tanpa klausa tersebut — regresi yang baru terlihat saat
-- check-in dicoba sebelum pukul 07.00 WIB.
-- ════════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb)
  SET "TimeZone" TO 'Asia/Jakarta';

-- Penyelesaian dan override tidak membandingkan tanggal hari ini, tetapi
-- ikut disetel supaya setiap fungsi alur meeting membaca waktu yang sama.
ALTER FUNCTION public.sm_complete_schedule(uuid) SET "TimeZone" TO 'Asia/Jakarta';
ALTER FUNCTION public.sm_override_completion(uuid, text) SET "TimeZone" TO 'Asia/Jakarta';


-- ▼▼▼ 042_menu_customer.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- 042 — Menu Customer
--
-- Modul lisensi "customer" (Data customer dan kontaknya) sudah ada sejak awal,
-- tetapi belum punya halaman: baris customer hanya lahir diam-diam dari isian
-- PilihCustomer di formulir lain, dan tidak ada tempat untuk melihat satu
-- pelanggan beserta seluruh riwayatnya. Migrasi ini menyiapkan datanya:
--
--   1. Kolom kontak di sm_customers (kontak utama, jabatan, email, segmen,
--      catatan) — semuanya opsional, baris lama tetap sah.
--   2. View sm_customer_ringkasan: satu baris per customer dengan hitungan
--      pipeline, nilai terbuka & menang, laporan, jadwal, proyek, kontak
--      terakhir dari laporan harian, dan tanggal aktivitas terakhir.
--      security_invoker → setiap subquery tunduk pada RLS tabel sumbernya,
--      jadi Sales hanya menghitung catatannya sendiri dan atasan melihat
--      timnya, persis seperti modul lain.
--   3. Menu 'customer' bawaan untuk semua peran.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_customers
  ADD COLUMN IF NOT EXISTS contact_person   text,
  ADD COLUMN IF NOT EXISTS contact_position text,
  ADD COLUMN IF NOT EXISTS email            text,
  ADD COLUMN IF NOT EXISTS segment          text,
  ADD COLUMN IF NOT EXISTS notes            text;

DROP VIEW IF EXISTS public.sm_customer_ringkasan;
CREATE VIEW public.sm_customer_ringkasan
WITH (security_invoker = true) AS
SELECT
  c.id, c.name, c.address, c.city, c.phone, c.contact_person, c.contact_position,
  c.email, c.segment, c.notes, c.created_by, c.created_at, c.updated_at,
  COALESCE(pl.jumlah, 0)        AS jumlah_pipeline,
  COALESCE(pl.nilai_terbuka, 0) AS nilai_terbuka,
  COALESCE(pl.jumlah_won, 0)    AS jumlah_won,
  COALESCE(pl.nilai_won, 0)     AS nilai_won,
  COALESCE(dr.jumlah, 0)        AS jumlah_laporan,
  dr.terakhir                   AS laporan_terakhir,
  dr.kontak                     AS kontak_terakhir,
  dr.jabatan                    AS jabatan_terakhir,
  dr.telepon                    AS telepon_terakhir,
  COALESCE(sc.jumlah, 0)        AS jumlah_jadwal,
  COALESCE(sc.selesai, 0)       AS jadwal_selesai,
  sc.berikutnya                 AS jadwal_berikutnya,
  COALESCE(pr.jumlah, 0)        AS jumlah_proyek,
  GREATEST(dr.terakhir, pl.terakhir, sc.terakhir) AS aktivitas_terakhir
FROM public.sm_customers c
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah,
         sum(p.project_value) FILTER (WHERE p.stage NOT IN ('WON', 'LOST')) AS nilai_terbuka,
         count(*) FILTER (WHERE p.stage = 'WON') AS jumlah_won,
         sum(p.project_value) FILTER (WHERE p.stage = 'WON') AS nilai_won,
         max(p.pipeline_date) AS terakhir
  FROM public.sm_pipeline p WHERE p.customer_id = c.id
) pl ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah,
         max(d.report_date) AS terakhir,
         (array_agg(d.contact_person ORDER BY d.report_date DESC, d.created_at DESC)
            FILTER (WHERE NULLIF(btrim(d.contact_person), '') IS NOT NULL))[1] AS kontak,
         (array_agg(d.position ORDER BY d.report_date DESC, d.created_at DESC)
            FILTER (WHERE NULLIF(btrim(d.position), '') IS NOT NULL))[1] AS jabatan,
         (array_agg(d.phone_whatsapp ORDER BY d.report_date DESC, d.created_at DESC)
            FILTER (WHERE NULLIF(btrim(d.phone_whatsapp), '') IS NOT NULL))[1] AS telepon
  FROM public.sm_daily_reports d WHERE d.customer_id = c.id
) dr ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah,
         count(*) FILTER (WHERE s.status = 'COMPLETED') AS selesai,
         min(s.schedule_date) FILTER (WHERE s.status IN ('UPCOMING', 'IN_PROGRESS')
                                        AND s.schedule_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date) AS berikutnya,
         max(s.schedule_date) FILTER (WHERE s.status = 'COMPLETED') AS terakhir
  FROM public.sm_schedules s WHERE s.customer_id = c.id
) sc ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah FROM public.sm_projects j WHERE j.customer_id = c.id
) pr ON true;

GRANT SELECT ON public.sm_customer_ringkasan TO authenticated;

-- Indeks penghubung yang dipakai view di atas.
CREATE INDEX IF NOT EXISTS idx_pipeline_customer ON public.sm_pipeline (customer_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_customer ON public.sm_daily_reports (customer_id);
CREATE INDEX IF NOT EXISTS idx_schedules_customer ON public.sm_schedules (customer_id);

-- Menu bawaan: semua peran boleh membuka Customer (isinya tetap dibatasi RLS).
INSERT INTO public.sm_role_menu (role, menu_key)
SELECT r, 'customer' FROM unnest(ARRAY['SALES', 'MANAGER', 'DIRECTOR', 'FINANCE', 'ADMIN']) AS r
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════════════════════
-- Akun Admin pertama (dilewati bila sudah ada Admin)
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL search_path = public, extensions;

DO $admin$
DECLARE
  a  record;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM _admin_awal LIMIT 1;
  IF a.username IS NULL OR a.username !~ '^[a-z0-9._-]{3,40}$' THEN
    RAISE EXCEPTION 'Username Admin tidak sah: huruf kecil, angka, titik, garis bawah, strip (3–40 karakter).';
  END IF;
  IF coalesce(length(a.sandi), 0) < 8 THEN
    RAISE EXCEPTION 'Kata sandi Admin minimal 8 karakter.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE role = 'ADMIN') THEN
    RAISE NOTICE 'Sudah ada akun Admin — pembuatan Admin dilewati.';
    RETURN;
  END IF;

  INSERT INTO public.users (username, full_name, role, active, approval_status)
  VALUES (a.username, coalesce(nullif(trim(a.nama), ''), 'Administrator'), 'ADMIN', true, 'DISETUJUI')
  RETURNING id INTO v_id;
  INSERT INTO public.user_credentials (user_id, password_hash, must_change)
  VALUES (v_id, crypt(a.sandi, gen_salt('bf', 10)), true);
END
$admin$;

COMMIT;

SELECT username, full_name, role, approval_status, 'Login lalu ganti kata sandi' AS langkah_berikutnya
FROM public.users WHERE role = 'ADMIN';
