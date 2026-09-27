-- ════════════════════════════════════════════════════════════════════════════
-- Uji License Authority pusat — jalankan sebagai pemilik DB (diakhiri ROLLBACK).
-- Kolom `nyata` harus sama persis dengan `harapan` di setiap baris.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
CREATE TEMP TABLE ctx(k text PRIMARY KEY, v text) ON COMMIT DROP;

-- Registrasi: kunci deployment disimpan sebagai hash saja.
WITH r AS (
  SELECT public.la_register_deployment('PT ABC Sejahtera', 'production', encode(digest('kunci-rahasia', 'sha256'), 'hex'),
    'STARTER', '{"dashboard":true,"daily_report":true,"pipeline":false}', 365, false, 'uji', 'web') AS j)
INSERT INTO ctx SELECT 'dep', j->>'deployment_code' FROM r
UNION ALL SELECT 'lic', j->>'license_code' FROM r;

INSERT INTO hasil SELECT 1, 'Kode deployment berpola SMA-XXX-YYYY-NNN', 'cocok',
  CASE WHEN v ~ '^SMA-ABC-\d{4}-\d{3}$' THEN 'cocok' ELSE v END FROM ctx WHERE k = 'dep';
INSERT INTO hasil SELECT 2, 'Lisensi baru berstatus PENDING', 'PENDING', status
  FROM public.licenses WHERE license_code = (SELECT v FROM ctx WHERE k = 'lic');

-- Verifikasi
INSERT INTO hasil SELECT 3, 'Kunci salah → UNAUTHORIZED (tanpa bocor ada/tidaknya)', 'UNAUTHORIZED',
  public.la_verify((SELECT v FROM ctx WHERE k='dep'), (SELECT v FROM ctx WHERE k='lic'),
    encode(digest('salah', 'sha256'), 'hex'), '1.0.0')->>'code';
INSERT INTO hasil SELECT 4, 'Kode tak dikenal → jawaban yang sama', 'UNAUTHORIZED',
  public.la_verify('SMA-XXX-2026-999', 'LIC-SMA-2026-9999', encode(digest('kunci-rahasia', 'sha256'), 'hex'), '1.0.0')->>'code';
INSERT INTO hasil SELECT 5, 'Kunci benar → ok + fitur', 'true / true',
  (x->>'ok') || ' / ' || (x->'license'->'features'->>'daily_report')
  FROM (SELECT public.la_verify((SELECT v FROM ctx WHERE k='dep'), (SELECT v FROM ctx WHERE k='lic'),
    encode(digest('kunci-rahasia', 'sha256'), 'hex'), '1.0.0') AS x) s;

-- Permintaan
WITH r AS (SELECT public.la_create_request((SELECT v FROM ctx WHERE k='dep'), (SELECT v FROM ctx WHERE k='lic'),
  encode(digest('kunci-rahasia', 'sha256'), 'hex'), 'NEW', 'PROFESSIONAL', NULL, 365, 'Mohon aktivasi', 'Admin ABC') AS j)
INSERT INTO ctx SELECT 'req', j->>'request_id' FROM r;
INSERT INTO hasil SELECT 6, 'Permintaan tercatat PENDING_APPROVAL', 'PENDING_APPROVAL', status
  FROM public.license_requests WHERE id = (SELECT v FROM ctx WHERE k='req')::uuid;
INSERT INTO hasil SELECT 7, 'Permintaan kedua saat masih menunggu ditolak', 'REQUEST_ALREADY_PENDING',
  public.la_create_request((SELECT v FROM ctx WHERE k='dep'), (SELECT v FROM ctx WHERE k='lic'),
    encode(digest('kunci-rahasia', 'sha256'), 'hex'), 'NEW', 'PROFESSIONAL', NULL, 365, NULL, 'Admin ABC')->>'code';

-- Persetujuan + idempotensi
INSERT INTO hasil SELECT 8, 'APPROVE → lisensi ACTIVE', 'true ACTIVE PROFESSIONAL',
  (x->>'ok') || ' ' || (x->'license'->>'status') || ' ' || (x->'license'->>'package')
  FROM (SELECT public.la_approve_request((SELECT v FROM ctx WHERE k='req')::uuid,
    '{"dashboard":true,"daily_report":true,"pipeline":true,"meeting":true,"schedule":true}', 'dev', 'telegram', 'tg:u:1') AS x) s;
INSERT INTO hasil SELECT 9, 'Update Telegram yang sama terkirim ulang → duplikat, tak diterapkan dua kali', 'true',
  public.la_approve_request((SELECT v FROM ctx WHERE k='req')::uuid, '{}', 'dev', 'telegram', 'tg:u:1')->>'duplicate';
INSERT INTO hasil SELECT 10, 'Tombol APPROVE diketuk lagi → REQUEST_NOT_PENDING', 'REQUEST_NOT_PENDING',
  public.la_approve_request((SELECT v FROM ctx WHERE k='req')::uuid, '{}', 'dev', 'telegram', 'tg:u:2')->>'code';
INSERT INTO hasil SELECT 11, 'Fitur tidak tertimpa oleh ketukan kedua', 'true',
  public.la_features(id)->>'pipeline' FROM public.licenses WHERE license_code = (SELECT v FROM ctx WHERE k='lic');

-- Perpanjangan idempoten
INSERT INTO ctx SELECT 'exp0', expires_at::text FROM public.licenses WHERE license_code = (SELECT v FROM ctx WHERE k='lic');
SELECT public.la_extend((SELECT v FROM ctx WHERE k='lic'), 30, 'dev', 'telegram', 'tg:ex:abc123', NULL);
SELECT public.la_extend((SELECT v FROM ctx WHERE k='lic'), 30, 'dev', 'telegram', 'tg:ex:abc123', NULL);
INSERT INTO hasil SELECT 12, 'EXTEND +30 diketuk dua kali → hanya +30', '30 days',
  (expires_at - (SELECT v FROM ctx WHERE k='exp0')::timestamptz)::text
  FROM public.licenses WHERE license_code = (SELECT v FROM ctx WHERE k='lic');

-- Status
INSERT INTO hasil SELECT 13, 'SUSPEND', 'SUSPENDED',
  public.la_set_status((SELECT v FROM ctx WHERE k='lic'), 'SUSPEND', 'dev', 'web', NULL, 'uji')->'license'->>'status';
INSERT INTO hasil SELECT 14, 'REACTIVATE', 'ACTIVE',
  public.la_set_status((SELECT v FROM ctx WHERE k='lic'), 'REACTIVATE', 'dev', 'web', NULL, NULL)->'license'->>'status';
INSERT INTO hasil SELECT 15, 'REACTIVATE saat tidak ditangguhkan → ditolak', 'NOT_SUSPENDED',
  public.la_set_status((SELECT v FROM ctx WHERE k='lic'), 'REACTIVATE', 'dev', 'web', NULL, NULL)->>'code';

-- Downgrade tercatat
INSERT INTO hasil SELECT 16, 'Perubahan paket menurun → DOWNGRADED', 'DOWNGRADED',
  public.la_set_package((SELECT v FROM ctx WHERE k='lic'), 'STARTER',
    '{"pipeline":false,"meeting":false,"schedule":false}', 'dev', 'web', NULL, NULL)->>'action';

-- Peringatan kedaluwarsa hanya sekali per tahap
UPDATE public.licenses SET expires_at = now() + interval '5 days' WHERE license_code = (SELECT v FROM ctx WHERE k='lic');
INSERT INTO hasil SELECT 17, 'Tahap D7 dikirim sekali', '1 lalu 0',
  jsonb_array_length(public.la_expiry_notices())::text || ' lalu ' || jsonb_array_length(public.la_expiry_notices())::text;

-- Pencabutan permanen
INSERT INTO hasil SELECT 18, 'REVOKE', 'REVOKED',
  public.la_set_status((SELECT v FROM ctx WHERE k='lic'), 'REVOKE', 'dev', 'web', NULL, 'uji')->'license'->>'status';
INSERT INTO hasil SELECT 19, 'Lisensi dicabut tidak bisa diperpanjang', 'LICENSE_REVOKED',
  public.la_extend((SELECT v FROM ctx WHERE k='lic'), 365, 'dev', 'web', NULL, NULL)->>'code';
INSERT INTO hasil SELECT 20, 'Lisensi dicabut tidak bisa diaktifkan lagi', 'LICENSE_REVOKED',
  public.la_set_status((SELECT v FROM ctx WHERE k='lic'), 'REACTIVATE', 'dev', 'web', NULL, NULL)->>'code';

-- Audit hanya-tambah
DO $x$ BEGIN
  BEGIN
    DELETE FROM public.license_audit_logs;
    INSERT INTO hasil VALUES (21, 'Audit tidak bisa dihapus', 'ditolak', 'DITERIMA');
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO hasil VALUES (21, 'Audit tidak bisa dihapus', 'ditolak', 'ditolak');
  END;
END $x$;
INSERT INTO hasil SELECT 22, 'Setiap perubahan tercatat di audit', 'CREATED,REQUESTED,APPROVED,EXTENDED,SUSPENDED,REACTIVATED,DOWNGRADED,REVOKED',
  string_agg(action, ',' ORDER BY id) FROM public.license_audit_logs
  WHERE license_id = (SELECT id FROM public.licenses WHERE license_code = (SELECT v FROM ctx WHERE k='lic'));

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
