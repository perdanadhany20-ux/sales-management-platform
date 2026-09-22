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
