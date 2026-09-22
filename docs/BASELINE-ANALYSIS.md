# Baseline Analysis & Architecture Decision

Dokumen ini adalah keluaran **PHASE 1–3** dari spesifikasi build (PROMPT §4, §5, §112).
Ditulis **sebelum** implementasi, berdasarkan inspeksi kode nyata pada kedua baseline —
bukan asumsi.

Status inspeksi:

| Baseline | Sumber | Terbaca |
|---|---|---|
| Work Management PTS IVP | `WorkManagementPTSIVP.zip` | ✅ penuh |
| FieldServices Platform | `filedservicesplatform.zip` | ✅ penuh |

---

## 1. Baseline A — Work Management PTS IVP

**Framework.** Next.js 14.2.35 (App Router) · React 18.3.1 · TypeScript 5.7.2 ·
Tailwind 3.4.17 · `@supabase/supabase-js` 2.39.0 · Recharts 2.12.7 · lucide-react.

**Skala.** ~14 modul bisnis, 24 komponen shared, 60+ file `lib/`, 100+ skrip SQL.
Ini platform paling matang dari dua baseline dilihat dari cakupan fitur.

**Modul yang relevan untuk Sales Platform:**

| Modul | Kegunaan bagi kita |
|---|---|
| `app/daily-report/` | Pola Daily Report — langsung relevan |
| `app/reminder-schedule/` | **Request Schedule + assignment + approval** — inti modul Schedule kita |
| `app/ticketing/` | `DonutCards.tsx`, `StatsSection.tsx`, `FilterBar.tsx`, pola list+detail+modal |
| `app/kpi-team/` | Drill-down modal (`DrillModal.tsx`) — pola analitik yang bisa diklik |
| `app/incentive-pts/` | Kalkulasi finansial + ekspor Excel |

**Auth.** Custom, **bukan Supabase Auth**: tabel `users` + `user_credentials`
(bcrypt) + `user_sessions` (menyimpan `token_hash`, bukan token mentah) +
cookie httpOnly `ivp_session`. Ada OTP lupa-password, ganti password,
login attempts, dan session expiry banner.

**Reusable components (`components/shared/`).** `MiniPieChart`, `Charts`,
`StatCard`, `Modal`, `ModalPortal`, `FormParts`, `PageHeader`, `Paginasi`,
`Toast`, `EmptyState`, `LoadingScreen`, `MobileListCard`, `AuditTrailPanel`,
`ConfirmDialog`, `FlowSteps`, `MultiDatePicker`, `ConfirmDialog`, `SalesPicker`.

**Kekuatan unik.** Ekspor Excel berkualitas produksi (`exceljs` +
`xlsx-js-style` + `lib/xlsx-loader.ts` untuk dynamic import), notifikasi
multi-kanal (`lib/notifikasi/router.ts` → WhatsApp / Telegram / Web Push),
PWA + service worker, katalog notifikasi yang bisa dikonfigurasi admin.

**Kelemahan.** Migrasi database berantakan — 100+ file di `sql/` dengan nama
deskriptif (`kunci-tabel-lanjutan-4.sql`, `rapikan-policy.sql`) yang urutan
penerapannya harus dibaca manual dari `sql/urutan-penerapan.sql`. Hanya 12
file yang benar-benar ada di `supabase/migrations/`. **Tidak ada GPS sama
sekali** (dikonfirmasi lewat grep menyeluruh: nol hasil).

---

## 2. Baseline B — FieldServices Platform

**Framework.** Identik dengan Baseline A: Next.js 14.2.35, React 18.3.1,
Tailwind 3.4.17, Supabase JS 2.39.0, Recharts 2.12.7. Tambahan: `leaflet`
(peta), Capacitor (bungkus Android), Playwright.

**Skala.** Lebih fokus — 3 modul besar, tapi rekayasanya lebih rapi.

**Kekuatan unik — inilah alasan baseline ini ada:**

**a. GPS terverifikasi server-side.** Ini implementasi terbaik di kedua
baseline dan jadi fondasi modul Meeting kita:

```sql
-- supabase/migrations/005_field_service_functions.sql
CREATE FUNCTION fs_distance_meters(lat1, lng1, lat2, lng2)
  RETURNS numeric LANGUAGE sql IMMUTABLE
  SET search_path TO 'public','pg_temp'
AS $$ SELECT 6371000 * acos(LEAST(1.0, GREATEST(-1.0, ... ))) $$;   -- Haversine
```

`fs_check_in()` adalah **SECURITY DEFINER** dan memutuskan sendiri:
`SCHEDULE_MISMATCH` → `ASSIGNMENT_MISMATCH` → `LOW_ACCURACY` (>100 m) →
`OUTSIDE_RADIUS` → `VALID`. Klien **tidak pernah** menghitung atau mengklaim
keabsahan. Setiap percobaan — termasuk yang ditolak — masuk ke `fs_gps_events`,
jadi auditabel. Fungsinya idempotent.

**b. Migrasi bersih & berurutan.** 30 file `001_…` → `030_…` di
`supabase/migrations/`, terpisah rapi: schema → functions → RLS.

**c. Penerbit JWT PostgREST (`lib/db-token.ts`).** Ini jembatan yang membuat
auth custom tetap bisa memakai **RLS asli**. Login menerbitkan JWT HS256
bertanda tangan `SUPABASE_JWT_SECRET` berisi klaim identitas; klien Supabase
menyuntikkannya lewat override `global.fetch`, dan policy RLS membaca
`request.jwt.claims ->> 'username'`. Tanpa ini, `auth.uid()` selalu NULL dan
policy terpaksa berbunyi `USING (true)` — alias RLS palsu.

**d. `Masonry.tsx`.** Masonry sungguhan berbasis pengukuran DOM
(ResizeObserver + greedy shortest-column-first), bukan tebakan CSS `columns`.
Kartu terakhir tiap kolom diregangkan supaya semua kolom berakhir rata.
**Ini fondasi layout bento kita.**

**e. Evidence pipeline.** `lib/image-compress.ts` + `lib/evidence-url.ts` +
thumbnail otomatis (migrasi 029/030) + kamera lewat `<input capture>`.

**f. Alur mobile teknisi (`app/teknisi/page.tsx`).** Wizard check-in 2 langkah
yang mobile-first — persis bentuk yang dibutuhkan Sales untuk eksekusi Meeting.

**g. Palet sadar buta warna.** `lib/fs-status.ts` mencatat bahwa pasangan
merah/hijau lama gagal uji CVD (ΔE 4.2, ambang 8) dan sudah diperbaiki.

**Kelemahan.** Tidak ada ekspor Excel. Tidak ada modul Daily Report maupun
Request Schedule.

---

## 3. Tabel Perbandingan & Pola Terpilih

| Area | Work Management | FieldServices | **Pola Terpilih** |
|---|---|---|---|
| Framework | Next.js 14.2.35 App Router | sama persis | **Sama** — tidak ada alasan berubah |
| Authentication | bcrypt + `user_sessions` + cookie httpOnly | sama + `db-token.ts` | **FieldServices** — superset; JWT PostgREST wajib untuk RLS nyata |
| Authorization | `access_level`, `allowed_menus` | + `fs_role` terpisah | **Gabungan** — `role` global + `sm_role` khusus Sales |
| Supabase client | singleton + anon key | singleton + override `fetch` bawa JWT | **FieldServices** |
| Database & migrasi | 100+ SQL lepas, urutan manual | 30 migrasi berurutan, terpisah rapi | **FieldServices** — jelas lebih sehat |
| RLS | policy nyata, banyak skrip perbaikan | helper `jwt_claim()` + fungsi predikat | **FieldServices** |
| UI design system | 24 komponen shared | 22 komponen + `Masonry`, `SearchableSelect`, `PanelOperasional` | **Gabungan** — ambil superset |
| Forms | `FormParts.tsx` matang | `FormParts.tsx` + `SearchableSelect` | **Gabungan** |
| Tables | `Paginasi` + `MobileListCard` | `PanelOperasional` | **Work Management** untuk tabel, FS untuk panel |
| Dashboard | `PermissionAwareDashboard` + widget | idem + `ControlRoomWidget` (exception-first) | **FieldServices** — lebih operasional |
| Charts | `MiniPieChart` (donat + legenda + klik-filter) | idem + `MiniSpark`, `MonthBarChart`, `DonutChart`, `TrendBadge` | **Gabungan** — semua bentuk dipakai untuk bento |
| Request Schedule | `reminder-schedule/` lengkap (assign, approve, reschedule, reject) | tidak ada | **Work Management** |
| Daily Report | `daily-report/` ada | tidak ada | **Work Management** |
| GPS | **tidak ada** | Haversine SQL + RPC SECURITY DEFINER | **FieldServices** — satu-satunya sumber |
| Photo Evidence | upload biasa | kompresi + thumbnail + kamera + RLS storage | **FieldServices** |
| Storage | pola dasar | + policy thumbnail (029/030) | **FieldServices** |
| Audit Log | `lib/audit.ts` | `lib/audit.ts` + migrasi 014 immutable | **FieldServices** |
| Mobile | responsif | mobile-first + wizard + Capacitor | **FieldServices** |
| Excel Export | `exceljs`+`xlsx-js-style`, dynamic import | tidak ada | **Work Management** |
| Notifikasi | router WA/Telegram/Push + katalog | router WA/Telegram | **Work Management** |
| Security | banyak audit doc + hardening SQL | audit doc + RLS ketat | **Gabungan** |

**Ringkasan keputusan.** Tulang punggung teknis (auth, migrasi, RLS, GPS,
evidence, mobile, layout) diambil dari **FieldServices**. Modul bisnis
(Daily Report, Request Schedule, ekspor Excel, notifikasi) diadaptasi dari
**Work Management**. Design system adalah gabungan superset keduanya.

---

## 4. Arsitektur Platform Baru

### 4.1 Struktur folder

```text
sales-management-platform/
├── app/
│   ├── api/auth/{login,logout,session,register,change-password,forgot-password,verify-otp}/
│   ├── api/admin/users/
│   ├── dashboard/            # KPI + bento chart, beda per peran
│   ├── daily-report/         # Daily Sales Report
│   ├── pipeline/             # Sales Pipeline + GP otomatis
│   ├── schedule/             # Request Schedule + assignment
│   ├── meeting/              # Eksekusi Meeting (mobile-first)
│   ├── activity/             # Riwayat aktivitas Sales
│   └── admin/                # Konfigurasi, Users, Audit Log
├── components/shared/        # design system (superset dua baseline)
├── lib/                      # auth, supabase, db-token, audit, gps, format
└── supabase/migrations/      # 001_… berurutan, ala FieldServices
```

### 4.2 Entitas database

Prefix `sm_` (sales management), mengikuti konvensi `fs_` FieldServices.

```text
users                 ← inti, pola baseline (+ kolom sm_role)
user_credentials      ← bcrypt
user_sessions         ← token_hash + expires_at
login_attempts
password_reset_otps

sm_customers          ← id, name, address, phone, created_by
sm_contacts           ← customer_id, name, position, phone_whatsapp
sm_daily_reports      ← sales_user_id, report_date, customer_id, activity,
                        lead_project, result, next_action
                        UNIQUE (sales_user_id, report_date)   ← §14
sm_pipeline           ← sales_user_id, pipeline_date, customer_id, project_detail,
                        quantity, unit, project_value, project_hpp,
                        project_gp (GENERATED), gp_percentage (GENERATED),
                        probability, estimated_closing, next_action
sm_locations          ← name, address, latitude, longitude, gps_radius_m, active
sm_schedules          ← schedule_date, schedule_time, customer_id, category,
                        detail, assigned_to, location_id, status, notes
sm_attendance         ← schedule_id, user_id, checkin_at, checkout_at,
                        state (state machine §36)
sm_evidence           ← attendance_id, schedule_id, user_id, storage_path,
                        thumb_path, captured_at, latitude, longitude
sm_gps_events         ← schedule_id, attendance_id, user_id, event_type,
                        latitude, longitude, accuracy_m, distance_m,
                        validation_status          ← mencatat SEMUA percobaan
sm_exceptions         ← schedule_id, original_failure, reason, approved_by,
                        approved_at, resulting_status        ← §39, §84
sm_settings           ← kategori, opsi probability, radius default, unit
audit_trail           ← immutable (pola migrasi 014 FieldServices)
```

**GP dihitung di database, bukan di frontend** (§19, §73):

```sql
project_gp    numeric GENERATED ALWAYS AS (project_value - project_hpp) STORED,
gp_percentage numeric GENERATED ALWAYS AS (
  CASE WHEN project_value > 0
       THEN ROUND((project_value - project_hpp) / project_value * 100, 2)
       ELSE 0 END) STORED
```

`CASE WHEN project_value > 0` menutup kasus pembagian nol — inilah yang
mencegah `NaN`/`Infinity` pernah muncul di layar (§20).

### 4.3 Model peran

```text
SALES     → data miliknya sendiri + jadwal yang ditugaskan padanya
MANAGER   → lihat semua, assign jadwal, setujui exception
ADMIN     → semua di atas + konfigurasi + kelola user
```

Ditegakkan di **tiga lapis**: RLS Postgres (utama) → RPC `SECURITY DEFINER`
untuk transisi status → pemeriksaan route handler. Penyembunyian di frontend
hanya kosmetik (§7).

### 4.4 Alur Meeting (§26)

```text
Jadwal dibuat (Admin/Manager)
        ↓ category = Meeting, assigned_to = Sales
Sales membuka jadwal (mobile)
        ↓
sm_check_in(schedule_id, lat, lng, accuracy)   ← RPC SECURITY DEFINER
        ├─ bukan tanggalnya?      → SCHEDULE_MISMATCH
        ├─ bukan yang ditugaskan? → ASSIGNMENT_MISMATCH
        ├─ akurasi > 100 m?       → LOW_ACCURACY
        ├─ jarak > radius?        → OUTSIDE_RADIUS
        └─ lolos semua            → VALID  → state = GPS_VERIFIED
        ↓ (setiap percobaan dicatat ke sm_gps_events, lolos maupun gagal)
Foto evidence lewat kamera → dikompres → Storage + thumbnail
        ↓ state = READY_TO_COMPLETE
sm_complete_meeting(schedule_id)               ← RPC SECURITY DEFINER
        └─ verifikasi ulang: assignment + attendance + GPS VALID + evidence ada
        ↓
sm_schedules.status = COMPLETED
```

**Aturan keamanan inti (§37).** `UPDATE sm_schedules SET status='completed'`
dari klien akan **ditolak RLS**. Satu-satunya jalan menuju `COMPLETED` untuk
kategori Meeting adalah lewat RPC di atas, yang memverifikasi ulang semua
prasyarat dari database — bukan dari klaim klien.

### 4.5 Desain visual — bento, bukan kotak seragam

Permintaan eksplisit: profesional, bento menarik, **tidak monoton kotak, tidak
seragam**. Rencananya:

- **Layout**: `Masonry.tsx` (FieldServices) — tinggi kartu mengikuti isinya,
  jadi barisnya tidak pernah rata seperti grid biasa. Kartu diberi rentang
  kolom berbeda (1/2/3 kolom) sesuai bobot informasinya.
- **Bentuk chart bervariasi per pertanyaan bisnis**, bukan donat di mana-mana:
  - komposisi → donat berlegenda (`MiniPieChart`)
  - kemajuan menuju target → cincin radial (`DonutChart`)
  - tren waktu → batang bulanan (`MonthBarChart`) / sparkline (`MiniSpark`)
  - perbandingan periode → `TrendBadge`
  - corong probabilitas Pipeline → bar horizontal bertingkat
  - beban per Sales → bar stack
- **Radius & bayangan bertingkat** dari token Tailwind baseline: `kecil`
  (0.5rem) · `kontrol` (0.75rem) · `kartu` (1rem) · `panel` (1.5rem).
- **Aksen biru profesional** sebagai warna utama.
- Setiap chart **wajib menjawab pertanyaan bisnis nyata**, memakai data
  database sungguhan, dan **ikut filter aktif** (§10). Chart dekoratif dilarang.

---

## 5. Rencana Implementasi

| Fase | Isi | Status |
|---|---|---|
| 1 | Inspeksi baseline | ✅ selesai |
| 2 | Perbandingan arsitektur | ✅ selesai (dokumen ini) |
| 3 | Desain arsitektur baru | ✅ selesai (dokumen ini) |
| 4 | Fondasi: struktur, auth, Supabase, RLS, layout, navigasi | berikutnya |
| 5 | Daily Report end-to-end | |
| 6 | Pipeline end-to-end | |
| 7 | Request Schedule end-to-end | |
| 8 | Meeting: attendance, GPS, radius, evidence, state machine | |
| 9 | Dashboard: KPI + bento chart per peran | |
| 10 | Admin & konfigurasi | |
| 11 | Audit keamanan (RLS, IDOR, bypass) | |
| 12 | Audit mobile | |
| 13 | Audit performa | |
| 14 | QA akhir + laporan audit | |

---

## 6. Asumsi yang Diambil

Didokumentasikan sesuai §90 — bukan aturan bisnis yang diam-diam dikarang:

1. **Satu Daily Report per Sales per hari**, ditegakkan lewat constraint UNIQUE.
   Dasar: §14 menyebutnya sebagai aturan yang mungkin; constraint database
   disebut eksplisit sebagai cara yang benar.
2. **Ambang akurasi GPS 100 meter** mengikuti nilai yang sudah terbukti dipakai
   FieldServices, bukan angka baru.
3. **Radius default 50 meter**, dapat dikonfigurasi per lokasi — mengikuti pola
   `fs_effective_gps_radius()` yang sudah ada.
4. **Opsi probability 10/25/50/75/90** disimpan di `sm_settings`, bukan
   di-hardcode, supaya admin bisa mengubahnya nanti (§21).
5. **Bahasa antarmuka Indonesia**, mengikuti kedua baseline.
6. **Mata uang Rupiah** dengan pemisah titik; nilai disimpan sebagai `numeric`,
   bukan string terformat (§72).

---

## 7. Baseline Tidak Dimodifikasi

Sesuai §91: kedua ZIP hanya diekstrak ke direktori sementara untuk dibaca.
Tidak ada file baseline yang diubah, dihapus, di-commit, atau di-push.
Repositori ini berdiri sendiri (§92) dengan project Supabase terpisah (§94)
dan project Vercel terpisah (§93).
