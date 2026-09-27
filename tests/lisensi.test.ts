/**
 * Uji unit lisensi — jalankan: npm test
 * (node --test --experimental-strip-types, Node ≥ 22.6; tanpa dependensi tambahan)
 *
 * Uji database (RLS, trigger, tenggang) ada di supabase/tests/keamanan-lisensi.sql.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FITUR_SAAT_TERBATAS, KUNCI_FITUR, bolehMenu, evaluasiLisensi, fiturDariPaket, normalisasiFitur,
  peristiwaPerubahan, statusEfektif, versiDidukung,
  type MuatanLisensi, type Paket, type StatusDasar,
} from '../lib/lisensi/kontrak.ts';
import {
  bacaKodeAktivasi, buatKodeAktivasi, buatPasanganKunci, periksaToken, sidikPlatform, tandatangani,
} from '../lib/lisensi/tanda-tangan.ts';

const SEKARANG = new Date('2026-09-27T10:00:00Z');
const HARI = 86_400_000;
const iso = (ms: number) => new Date(SEKARANG.getTime() + ms).toISOString();

function muatan(ubah: Partial<MuatanLisensi> & { paket?: Paket } = {}): MuatanLisensi {
  const paket = ubah.paket ?? 'PROFESSIONAL';
  return {
    v: 1, deployment_id: 'SMA-ABC-2026-001', license_id: 'LIC-SMA-2026-0001', company_name: 'PT ABC',
    status: 'ACTIVE', package: paket, license_type: 'STANDARD',
    issued_at: iso(-10 * HARI), starts_at: iso(-10 * HARI), expires_at: iso(355 * HARI),
    grace_period_days: 7, warning_days: 30, features: fiturDariPaket(paket),
    min_version: null, max_version: null, requests: [], verified_at: SEKARANG.toISOString(), nonce: 'n',
    ...ubah,
  };
}

const evalu = (m: MuatanLisensi | null, o: { sah?: boolean; terverifikasi?: string; sekarang?: Date } = {}) =>
  evaluasiLisensi({
    muatan: m, tandaTanganSah: o.sah ?? true,
    terakhirTerverifikasi: o.terverifikasi ?? SEKARANG.toISOString(), sekarang: o.sekarang ?? SEKARANG,
  });

/* ── Hak fitur ────────────────────────────────────────────────────────────── */

test('STARTER: pipeline tidak tersedia', () => {
  const h = evalu(muatan({ paket: 'STARTER' }));
  assert.equal(h.berlaku, true);
  assert.ok(h.fitur.includes('daily_report'));
  assert.ok(!h.fitur.includes('pipeline'));
  assert.ok(!h.fitur.includes('gp_calculation'));
});

test('PROFESSIONAL: pipeline, meeting, schedule tersedia; GP tidak', () => {
  const h = evalu(muatan({ paket: 'PROFESSIONAL' }));
  for (const f of ['pipeline', 'meeting', 'schedule'] as const) assert.ok(h.fitur.includes(f), f);
  assert.ok(!h.fitur.includes('gp_calculation'));
});

test('BUSINESS: GP, proyek, advanced reporting tersedia; approval tidak', () => {
  const h = evalu(muatan({ paket: 'BUSINESS' }));
  for (const f of ['gp_calculation', 'project', 'advanced_reporting'] as const) assert.ok(h.fitur.includes(f), f);
  assert.ok(!h.fitur.includes('approval'));
});

test('ENTERPRISE: seluruh fitur', () => {
  assert.deepEqual(evalu(muatan({ paket: 'ENTERPRISE' })).fitur, [...KUNCI_FITUR]);
});

test('CUSTOM: persis fitur yang dipilih (§79), bukan preset paket', () => {
  const custom = fiturDariPaket('CUSTOM', {
    dashboard: true, customer: true, sales_activity: true, daily_report: true, pipeline: true,
    meeting: false, schedule: true, project: false, gp_calculation: true, advanced_reporting: false,
    approval: false, notifications: true,
  });
  const h = evalu(muatan({ paket: 'CUSTOM', features: custom }));
  assert.ok(h.fitur.includes('pipeline'));
  assert.ok(h.fitur.includes('gp_calculation'));
  assert.ok(!h.fitur.includes('meeting'));
  assert.ok(!h.fitur.includes('project'));
  assert.ok(!h.fitur.includes('admin_settings'));
});

test('Nama paket tidak menentukan akses — hanya peta fitur', () => {
  // Paket bertuliskan ENTERPRISE tapi fiturnya hanya daily_report.
  const f = normalisasiFitur({ daily_report: true, fitur_palsu: true });
  const h = evalu(muatan({ paket: 'ENTERPRISE', features: f }));
  assert.deepEqual(h.fitur, ['daily_report']);
});

/* ── Status ───────────────────────────────────────────────────────────────── */

test('Status efektif untuk setiap keadaan', () => {
  const kasus: [StatusDasar, number, string][] = [
    ['PENDING', 100, 'PENDING'],
    ['ACTIVE', 100, 'ACTIVE'],
    ['ACTIVE', 20, 'EXPIRING_SOON'],
    ['ACTIVE', -1, 'EXPIRED'],
    ['SUSPENDED', 100, 'SUSPENDED'],
    ['REVOKED', 100, 'REVOKED'],
  ];
  for (const [dasar, hari, harap] of kasus) {
    assert.equal(statusEfektif(dasar, iso(hari * HARI), SEKARANG), harap, `${dasar} ${hari}`);
  }
});

test('PENDING, SUSPENDED, REVOKED, EXPIRED → keadaan terbatas dengan kode masing-masing', () => {
  const kode = {
    PENDING: 'LICENSE_PENDING', SUSPENDED: 'LICENSE_SUSPENDED', REVOKED: 'LICENSE_REVOKED',
  } as const;
  for (const [s, k] of Object.entries(kode)) {
    const h = evalu(muatan({ status: s as StatusDasar, paket: 'ENTERPRISE' }));
    assert.equal(h.kode, k);
    assert.equal(h.berlaku, false);
    assert.deepEqual(h.fitur, [...FITUR_SAAT_TERBATAS]);
  }
  const kedaluwarsa = evalu(muatan({ expires_at: iso(-HARI), paket: 'ENTERPRISE' }));
  assert.equal(kedaluwarsa.kode, 'LICENSE_EXPIRED');
  assert.deepEqual(kedaluwarsa.fitur, [...FITUR_SAAT_TERBATAS]);
});

test('Belum ada lisensi → LICENSE_NOT_FOUND, terbatas', () => {
  const h = evalu(null);
  assert.equal(h.kode, 'LICENSE_NOT_FOUND');
  assert.deepEqual(h.fitur, [...FITUR_SAAT_TERBATAS]);
});

/* ── Kedaluwarsa & tenggang ───────────────────────────────────────────────── */

test('Sebelum dan sesudah tanggal berakhir', () => {
  const m = muatan({ expires_at: iso(HARI) });
  assert.equal(evalu(m).berlaku, true);
  assert.equal(evalu(m, { sekarang: new Date(SEKARANG.getTime() + 2 * HARI), terverifikasi: iso(2 * HARI) }).kode, 'LICENSE_EXPIRED');
});

test('Authority tak terjangkau 3 hari: status terakhir tetap dipakai', () => {
  const h = evalu(muatan(), { terverifikasi: iso(-3 * HARI) });
  assert.equal(h.berlaku, true);
  assert.equal(h.dalamTenggang, true);
  assert.ok(h.fitur.includes('pipeline'));
});

test('Lewat tenggang 7 hari: terbatas, TIDAK membuka semua fitur', () => {
  const h = evalu(muatan({ paket: 'ENTERPRISE' }), { terverifikasi: iso(-8 * HARI) });
  assert.equal(h.kode, 'LICENSE_AUTHORITY_UNAVAILABLE');
  assert.deepEqual(h.fitur, [...FITUR_SAAT_TERBATAS]);
});

test('Tenggang tidak memperpanjang lisensi yang sudah berakhir', () => {
  const h = evalu(muatan({ expires_at: iso(-HARI) }), { terverifikasi: iso(-2 * HARI) });
  assert.equal(h.kode, 'LICENSE_EXPIRED');
});

/* ── Peran + lisensi ──────────────────────────────────────────────────────── */

test('Peran berwenang + fitur berlisensi → boleh', () => {
  assert.equal(bolehMenu('pipeline', ['pipeline', 'dashboard'], ['pipeline']), true);
});
test('Peran berwenang + fitur tak berlisensi → tidak', () => {
  assert.equal(bolehMenu('pipeline', ['pipeline'], ['dashboard']), false);
});
test('Peran tak berwenang + fitur berlisensi → tidak (lisensi tidak melampaui peran)', () => {
  assert.equal(bolehMenu('gp', ['dashboard'], ['gp_calculation']), false);
});

/* ── Keaslian token ───────────────────────────────────────────────────────── */

test('Token sah lolos; isi yang diubah ditolak', () => {
  const { publik, privat } = buatPasanganKunci();
  const token = tandatangani(muatan({ paket: 'STARTER' }), privat);
  const ok = periksaToken(token, publik);
  assert.equal(ok.sah, true);

  const [awal, isi, sig] = token.split('.');
  const diubah = JSON.parse(Buffer.from(isi.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  diubah.features.gp_calculation = true;
  const isiBaru = Buffer.from(JSON.stringify(diubah)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const palsu = periksaToken(`${awal}.${isiBaru}.${sig}`, publik);
  assert.equal(palsu.sah, false);
});

test('Token dari kunci privat lain ditolak', () => {
  const asli = buatPasanganKunci();
  const penyerang = buatPasanganKunci();
  const token = tandatangani(muatan({ paket: 'ENTERPRISE' }), penyerang.privat);
  assert.equal(periksaToken(token, asli.publik).sah, false);
});

test('Format sembarang ditolak', () => {
  const { publik } = buatPasanganKunci();
  for (const t of ['', 'abc', 'SMPL1.a.b', '{"status":"ACTIVE"}']) assert.equal(periksaToken(t, publik).sah, false);
});

test('Tanda tangan tidak sah → evaluasi terbatas walau isinya ENTERPRISE', () => {
  const h = evalu(muatan({ paket: 'ENTERPRISE' }), { sah: false });
  assert.equal(h.kode, 'LICENSE_VERIFICATION_FAILED');
  assert.deepEqual(h.fitur, [...FITUR_SAAT_TERBATAS]);
});

/* ── Upgrade / downgrade tanpa redeploy ───────────────────────────────────── */

test('STARTER → PROFESSIONAL: pipeline muncul pada verifikasi berikutnya', () => {
  const lama = muatan({ paket: 'STARTER' });
  const baru = muatan({ paket: 'PROFESSIONAL' });
  assert.ok(!evalu(lama).fitur.includes('pipeline'));
  assert.ok(evalu(baru).fitur.includes('pipeline'));
  const p = peristiwaPerubahan(lama, baru);
  assert.equal(p[0].aksi, 'license_upgraded');
  assert.deepEqual((p[0].detail.added as string[]).sort(), ['meeting', 'pipeline', 'schedule']);
});

test('Downgrade tercatat sebagai license_downgraded dan menjanjikan data tetap tersimpan', () => {
  const p = peristiwaPerubahan(muatan({ paket: 'BUSINESS' }), muatan({ paket: 'PROFESSIONAL' }));
  assert.equal(p[0].aksi, 'license_downgraded');
  assert.match(p[0].keterangan, /tetap tersimpan/);
});

test('Perpanjangan terdeteksi', () => {
  const p = peristiwaPerubahan(muatan(), muatan({ expires_at: iso(720 * HARI) }));
  assert.deepEqual(p.map((x) => x.aksi), ['license_extended']);
});

test('Penolakan tanpa alasan tidak dikarang (§68)', () => {
  const req = { id: 'r1', kind: 'NEW' as const, requested_package: 'STARTER' as const, duration_days: 365, notes: null, requested_at: iso(0), processed_at: null };
  const lama = muatan({ status: 'PENDING', requests: [{ ...req, status: 'PENDING_APPROVAL', reason: null }] });
  const baru = muatan({ status: 'PENDING', requests: [{ ...req, status: 'REJECTED', reason: null, processed_at: iso(0) }] });
  const p = peristiwaPerubahan(lama, baru);
  assert.equal(p[0].aksi, 'license_rejected');
  assert.equal(p[0].keterangan, 'Tidak ada alasan yang dicantumkan.');
});

test('Persetujuan permintaan menghasilkan satu license_approved', () => {
  const req = { id: 'r1', kind: 'NEW' as const, requested_package: 'PROFESSIONAL' as const, duration_days: 365, notes: null, reason: null, requested_at: iso(0), processed_at: null };
  const lama = muatan({ status: 'PENDING', requests: [{ ...req, status: 'PENDING_APPROVAL' }] });
  const baru = muatan({ status: 'ACTIVE', requests: [{ ...req, status: 'APPROVED', processed_at: iso(0) }] });
  const p = peristiwaPerubahan(lama, baru).filter((x) => x.aksi === 'license_approved');
  assert.equal(p.length, 1);
});

/* ── Mode pengembangan & versi ────────────────────────────────────────────── */

test('Mode pengembangan hanya bila pemanggil menyatakannya (server menolaknya di produksi)', () => {
  const h = evaluasiLisensi({ muatan: null, tandaTanganSah: false, terakhirTerverifikasi: null, sekarang: SEKARANG, modePengembangan: true });
  assert.equal(h.kode, 'LICENSE_DEVELOPMENT');
  assert.equal(evaluasiLisensi({ muatan: null, tandaTanganSah: false, terakhirTerverifikasi: null, sekarang: SEKARANG }).kode, 'LICENSE_NOT_FOUND');
});

test('Rentang versi', () => {
  assert.equal(versiDidukung('1.2.0', '1.0.0', '2.0.0'), true);
  assert.equal(versiDidukung('0.9.9', '1.0.0', null), false);
  assert.equal(versiDidukung('2.1', null, '2.0.0'), false);
});

/* ── Kode Aktivasi ────────────────────────────────────────────────────────── */

test('Kode Aktivasi: bolak-balik utuh, toleran spasi/baris baru saat ditempel', () => {
  const k = { deploymentId: 'SMA-ABC-2026-001', licenseId: 'LIC-SMA-2026-0001', deploymentKey: 'x'.repeat(43) };
  const kode = buatKodeAktivasi(k);
  assert.match(kode, /^SMPA1-/);
  assert.deepEqual(bacaKodeAktivasi(kode), k);
  assert.deepEqual(bacaKodeAktivasi(`  ${kode.slice(0, 20)}\n${kode.slice(20)}  `), k);
});

test('Kode Aktivasi rusak/karangan ditolak', () => {
  for (const t of ['', 'SMPA1-', 'SMPA1-abc', 'LICENSE_ID=LIC-1', buatKodeAktivasi({ deploymentId: 'x', licenseId: 'LIC-SMA-2026-0001', deploymentKey: 'k'.repeat(40) })]) {
    assert.equal(bacaKodeAktivasi(t), null, t);
  }
});

test('Sidik platform stabil dan berbeda per Supabase', () => {
  assert.equal(sidikPlatform('https://a.supabase.co/'), sidikPlatform('https://A.supabase.co'));
  assert.notEqual(sidikPlatform('https://a.supabase.co'), sidikPlatform('https://b.supabase.co'));
});

/* ── Trial & lisensi pengganti ────────────────────────────────────────────── */

test('Lisensi yang sudah DIGANTI tidak bisa dipakai lagi (terbatas, kode LICENSE_REPLACED)', () => {
  const h = evalu(muatan({ status: 'REPLACED', paket: 'ENTERPRISE' }));
  assert.equal(h.kode, 'LICENSE_REPLACED');
  assert.equal(h.berlaku, false);
  assert.deepEqual(h.fitur, [...FITUR_SAAT_TERBATAS]);
});

test('Trial: tetap berlaku sampai tanggalnya, dan selalu diberi peringatan sisa hari', async () => {
  const { peringatanLisensi } = await import('../lib/lisensi/kontrak.ts');
  const h = evalu(muatan({ license_type: 'TRIAL', expires_at: iso(10 * HARI) }));
  assert.equal(h.berlaku, true);
  assert.equal(h.trial, true);
  assert.match(peringatanLisensi(h)[0].judul, /trial berakhir 10 hari/);
  assert.equal(evalu(muatan({ license_type: 'TRIAL', expires_at: iso(-HARI) })).kode, 'LICENSE_EXPIRED');
});
