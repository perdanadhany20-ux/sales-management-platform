# Alur Kerja Platform

Diagram di bawah memakai sintaks Mermaid, yang dirender langsung oleh GitHub.
Setiap diagram menggambarkan alur yang **benar-benar berjalan di kode**, bukan
rancangan yang belum terwujud; di bawah tiap diagram disebutkan berkas dan
fungsi yang menegakkannya.

Satu pola berulang di seluruh dokumen ini dan perlu dipahami sekali di awal:

> **Yang menolak adalah database, bukan tampilan.**
> Tombol yang disembunyikan hanya merapikan layar. Kalau seseorang memanggil
> endpoint-nya langsung dari luar aplikasi, yang menghentikannya adalah RLS dan
> fungsi `SECURITY DEFINER` — bukan tombol yang tidak ia lihat.

---

## 1. Masuk & pendaftaran akun

```mermaid
flowchart TD
    A([Orang membuka platform]) --> B{Punya akun?}

    B -- Belum --> C[Isi formulir pendaftaran]
    C --> D["/api/auth/register<br/>peran dipaksa SALES<br/>active=false, status=MENUNGGU"]
    D --> E[Menunggu verifikasi admin]

    E --> F{Keputusan admin<br/>Administrasi → Persetujuan Akun}
    F -- Setujui --> G[approval_status=DISETUJUI<br/>active=true]
    F -- Tolak --> H[approval_status=DITOLAK<br/>alasan wajib ≥10 karakter]

    B -- Sudah --> I[Isi username + kata sandi]
    G --> I
    I --> J{Cocok?}
    J -- Tidak --> K["Pesan seragam:<br/>username atau sandi salah"]
    J -- Ya --> L{approval_status}
    L -- MENUNGGU --> M[Pesan: menunggu verifikasi admin]
    L -- DITOLAK --> N[Pesan: pendaftaran ditolak]
    L -- DISETUJUI --> O[Cookie httpOnly + JWT PostgREST]
    O --> P([Dashboard])

    H --> N
```

**Kenapa pesannya dibedakan hanya setelah sandi benar.** Orang yang baru
mendaftar dan tidak bisa masuk tanpa penjelasan akan mengira pendaftarannya
gagal, lalu mendaftar lagi berulang kali dengan username berbeda. Sedangkan
penyerang yang belum memegang sandinya tidak memperoleh petunjuk apa pun dari
cabang itu — ia tetap hanya melihat "username atau kata sandi salah".

Berkas: `app/api/auth/register/route.ts`, `app/api/auth/login/route.ts`,
`app/(app)/admin/_components/TabPersetujuan.tsx`.

---

## 2. Meeting — check-in GPS, foto bukti, penyelesaian

Ini inti platform, dan satu-satunya alur yang tidak punya jalan pintas.

```mermaid
flowchart TD
    A([Jadwal kategori Meeting<br/>requires_attendance=true]) --> B[Sales membuka /meeting]
    B --> C[Tekan Mulai Check-in]
    C --> D[lib/gps.ts membaca koordinat<br/>enableHighAccuracy, maximumAge=0]
    D --> E[["sm_check_in(jadwal, lat, lng, akurasi)"]]

    E --> F{Rantai pemeriksaan<br/>di database}
    F -- bukan yang ditugaskan --> G1[ASSIGNMENT_MISMATCH]
    F -- bukan hari ini --> G2[SCHEDULE_MISMATCH]
    F -- lokasi belum diatur --> G3[NO_LOCATION]
    F -- akurasi di atas ambang --> G4[LOW_ACCURACY]
    F -- di luar radius --> G5[OUTSIDE_RADIUS]
    F -- semua lolos --> H[VALID]

    G1 & G2 & G3 & G4 & G5 --> T[(sm_gps_events<br/>percobaan GAGAL ikut dicatat)]
    H --> T

    H --> I[sm_attendance: EVIDENCE_PENDING<br/>jadwal: IN_PROGRESS]
    I --> J[Ambil foto di tempat]
    J --> K[siapkanFoto: kecilkan + thumbnail<br/>di perangkat]
    K --> L[Unggah ke bucket privat 'evidence'<br/>jalur user_id/schedule_id/]
    L --> M[(INSERT sm_evidence)]
    M --> N[Trigger menaikkan state:<br/>READY_TO_COMPLETE]

    N --> O[["sm_complete_schedule(jadwal)"]]
    O --> P{Periksa ULANG dari database}
    P -- belum check-in --> Q1[NO_ATTENDANCE]
    P -- GPS belum terverifikasi --> Q2[GPS_NOT_VERIFIED]
    P -- belum ada foto --> Q3[NO_EVIDENCE]
    P -- lengkap --> R([COMPLETED])

    S[Manager / Admin] -. jalan keluar sah .-> U[["sm_override_completion<br/>alasan wajib ≥10 karakter"]]
    U --> V[(sm_exceptions — permanen)]
    V --> R
```

**Tiga hal yang mudah disalahpahami dari diagram ini:**

1. **Percobaan yang GAGAL ikut dicatat.** Tabel yang hanya berisi keberhasilan
   tidak bisa menjawab "apakah orang ini berkali-kali mencoba check-in dari
   luar radius" — padahal justru itu yang ingin diketahui.
2. **Syaratnya diperiksa dua kali**, saat check-in dan lagi saat penyelesaian.
   Bukan karena ragu, melainkan karena keduanya terjadi pada waktu berbeda dan
   keadaannya bisa berubah di antaranya.
3. **Override bukan bypass.** Ia menuntut alasan tertulis, mencatat siapa yang
   menyetujui, dan meninggalkan baris permanen di `sm_exceptions`.

Berkas: `supabase/migrations/004_functions.sql`, `lib/gps.ts`,
`lib/image-compress.ts`, `app/(app)/meeting/_components/PanelMeeting.tsx`.

---

## 3. Request Schedule — pengajuan & penugasan

```mermaid
flowchart LR
    A([Sales mengajukan jadwal]) --> B[assigned_to WAJIB kosong<br/>status WAJIB UPCOMING]
    B --> C[(sm_schedules)]

    D([Manager/Admin membuat jadwal]) --> E[Boleh langsung menugaskan]
    E --> C

    C --> F{requires_attendance?}
    F -- Ya --> G[Dieksekusi di /meeting<br/>lihat alur 2]
    F -- Tidak --> H[["sm_complete_schedule()"]]
    H --> I([COMPLETED])
    G --> I
```

`requires_attendance` disalin dari pengaturan kategori **saat jadwal dibuat**,
bukan dicocokkan ulang lewat nama kategori. Kalau penjaganya mencocokkan string
`category = 'Meeting'`, admin yang mengganti nama kategori itu jadi "Meeting
Client" akan diam-diam mematikan seluruh syarat GPS + foto — tanpa satu pun
pesan error.

---

## 4. Pipeline → GP Calculation

```mermaid
flowchart TD
    A([Peluang dicatat di /pipeline]) --> B[GP & margin = kolom GENERATED<br/>tidak pernah dihitung di browser]
    B --> C{Stage}
    C -- WON / deal --> D([Sales membuat GP Calculation])
    C -- OPEN / QUOTATION --> E[Muncul di lencana Closing<br/>bila ≤7 hari menuju estimasi]

    D --> F[Isi item, biaya, tarif]
    F --> G[(sm_gp_calculations + sm_gp_items)]
    G --> H[[view sm_gp_ringkasan<br/>DPP, PPN, Pph, net profit, margin]]
    H --> I{mutu_margin}
    I -- ≥ target+15pp --> I1[EXCEPTIONAL]
    I -- ≥ target+10pp --> I2[EXCELLENT]
    I -- ≥ target --> I3[GOOD]
    I -- ≥ target−5pp --> I4[REVIEW]
    I -- di bawah itu --> I5[DIRECTOR APPROVAL]
```

Rumus `mutu_margin` disalin apa adanya dari berkas GP asli tim. `DIRECTOR
APPROVAL` di sini **bukan status persetujuan** melainkan peringatan mutu:
marginnya lebih dari 5 poin di bawah target.

---

## 5. Rantai persetujuan GP Calculation

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Sales membuat

    DRAFT --> DIAJUKAN : sm_gp_ajukan()<br/>pemilik, minimal 1 item
    DIAJUKAN --> DIPERIKSA : sm_gp_setujui()<br/>MANAGER / ADMIN
    DIPERIKSA --> DISETUJUI : sm_gp_setujui()<br/>DIRECTOR / ADMIN
    DISETUJUI --> DIVERIFIKASI : sm_gp_setujui()<br/>FINANCE / ADMIN
    DIVERIFIKASI --> [*]

    DIAJUKAN --> DITOLAK : sm_gp_tolak()
    DIPERIKSA --> DITOLAK : sm_gp_tolak()
    DISETUJUI --> DITOLAK : sm_gp_tolak()
    DITOLAK --> DRAFT : sm_gp_buka_ulang()<br/>pemilik

    note right of DRAFT
        Hanya di sini dokumen
        bisa disunting.
    end note

    note right of DITOLAK
        Alasan wajib ≥10 karakter,
        tersimpan permanen.
    end note
```

**Status tidak bisa ditembak langsung.** RLS membatasi *baris*, bukan *kolom*;
tanpa penjagaan tambahan, pemilik dokumen bisa menembakkan
`UPDATE status='DIVERIFIKASI'` pada barisnya sendiri selagi DRAFT dan melompati
seluruh rantai dalam satu permintaan. Karena itu hak `UPDATE` dicabut lalu
diberikan ulang hanya pada kolom isian — `status`, nomor dokumen, dan seluruh
kolom tanda tangan tidak ada dalam daftar.

Berkas: `supabase/migrations/016_gp_calculation.sql`,
`supabase/tests/keamanan-gp.sql` (uji 17–25).

---

## 6. Siapa melihat apa

```mermaid
flowchart TD
    subgraph SALES
      S1[Data miliknya sendiri]
      S2[Jadwal yang ditugaskan kepadanya]
      S3[GP Calculation miliknya]
    end

    subgraph "MANAGER · DIRECTOR · FINANCE"
      P1[Seluruh data tim]
      P2[Menugaskan jadwal — Manager]
      P3[Override meeting]
      P4[Langkah tanda tangan GP<br/>sesuai perannya]
    end

    subgraph ADMIN
      A1[Semua wewenang di atas]
      A2[Kelola akun & persetujuan]
      A3[Konfigurasi & identitas platform]
    end

    SALES --> P1
    P1 --> A1
```

Penegakannya ada pada tiga fungsi kecil di database, bukan pada kode tampilan:

| Fungsi | Isi | Dipakai |
|--------|-----|---------|
| `sm_uid()` | UUID dari klaim JWT | Seluruh policy "miliknya sendiri" |
| `sm_is_pengawas()` | MANAGER, ADMIN, DIRECTOR, FINANCE | Policy "boleh lihat semua" |
| `sm_is_admin()` | ADMIN saja | Kelola akun, pengaturan, identitas |

Director dan Finance masuk `sm_is_pengawas()` karena keduanya menandatangani GP
Calculation — tanda tangan di atas angka yang tidak boleh ia baca adalah tanda
tangan kosong. Keduanya tetap **bukan** Admin: `sm_is_admin()` tidak disentuh.

---

## 7. Perjalanan satu permintaan

```mermaid
sequenceDiagram
    participant B as Peramban
    participant N as Next.js route handler
    participant P as PostgREST
    participant D as Postgres + RLS

    B->>N: POST /api/auth/login
    N->>D: cek users + user_credentials (service role)
    D-->>N: baris pengguna
    N-->>B: cookie httpOnly + db_token (JWT)

    Note over B: token disimpan di sessionStorage,<br/>ikut hilang saat tab ditutup

    B->>P: SELECT sm_gp_ringkasan (Authorization: Bearer)
    P->>D: query dengan request.jwt.claims terpasang
    D->>D: policy gp_baca: sales_user_id = sm_uid()<br/>OR sm_is_pengawas()
    D-->>P: HANYA baris yang boleh dilihat
    P-->>B: JSON

    B->>P: RPC sm_gp_setujui(id)
    P->>D: SECURITY DEFINER, periksa peran & status
    D-->>B: ok / alasan penolakan
```

Kunci yang membuat seluruh model ini bekerja: **identitas dibawa JWT terbitan
server**, bukan dikirim klien sebagai parameter biasa. `auth.uid()` bawaan
Supabase selalu NULL di platform ini karena autentikasinya tabel sendiri, jadi
`sm_uid()` membaca klaim `sub` dari token yang ditandatangani server.

---

## 8. Peta modul

```mermaid
flowchart LR
    L([Login]) --> D[Dashboard]
    D --> DR[Daily Report]
    D --> PL[Pipeline]
    D --> SC[Request Schedule]
    SC --> MT[Meeting]
    PL --> GP[GP Calculation]
    D --> AC[Activity]
    D --> PR[Profil]
    D --> AD[Admin Panel]

    DR -.-> AC
    PL -.-> AC
    SC -.-> AC
    MT -.-> AC
    GP -.-> AC

    AD --> AD1[Pengguna]
    AD --> AD2[Persetujuan Akun]
    AD --> AD3[Lokasi Meeting]
    AD --> AD4[Dashboard Setting]
    AD --> AD5[Nilai Bisnis]
    AD --> AD6[Audit Log]
```

Garis putus-putus menuju Activity bukan aliran data melainkan pembacaan:
`sm_activity_feed` adalah view yang **membaca** tabel modul lain setiap kali
dibuka. Tidak ada tabel aktivitas terpisah yang bisa melenceng dari sumbernya.
