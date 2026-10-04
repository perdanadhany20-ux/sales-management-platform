// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Enc, base32Dec, kodePadaLangkah, periksaKode, langkahSekarang, enkripsi, dekripsi,
  buatTiket, bacaTiket, kodeCadanganBaru, hashCadangan, rahasiaBaru,
} from '../lib/totp.ts';

process.env.SUPABASE_JWT_SECRET = 'rahasia-uji-totp-0123456789abcdef';

// RFC 6238 lampiran B: kunci ASCII "12345678901234567890", SHA1, 8 digit.
// Kode 6 digit = 6 digit terakhir dari vektor resmi.
const RFC = base32Enc(Buffer.from('12345678901234567890'));
const VEKTOR: [number, string][] = [
  [59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
  [1234567890, '005924'], [2000000000, '279037'],
];

test('TOTP sesuai vektor RFC 6238', () => {
  for (const [detik, kode] of VEKTOR) {
    assert.equal(kodePadaLangkah(RFC, Math.floor(detik / 30)), kode, `t=${detik}`);
  }
});

test('base32 bolak-balik', () => {
  const b = Buffer.from('halo dunia 2fa');
  assert.deepEqual(base32Dec(base32Enc(b)), b);
  assert.equal(rahasiaBaru().length, 32);
});

test('periksaKode: toleransi ±1 langkah, tolak replay & format salah', () => {
  const r = rahasiaBaru();
  const ms = 1_800_000_000_000;
  const l = langkahSekarang(ms);
  assert.equal(periksaKode(r, kodePadaLangkah(r, l), 0, ms), l);
  assert.equal(periksaKode(r, kodePadaLangkah(r, l - 1), 0, ms), l - 1);
  assert.equal(periksaKode(r, kodePadaLangkah(r, l - 2), 0, ms), null);
  assert.equal(periksaKode(r, kodePadaLangkah(r, l), l, ms), null, 'langkah sudah dipakai');
  assert.equal(periksaKode(r, '12345', 0, ms), null);
  assert.equal(periksaKode(r, 'abcdef', 0, ms), null);
});

test('enkripsi rahasia: bolak-balik dan tahan ubahan', () => {
  const s = enkripsi('JBSWY3DPEHPK3PXP');
  assert.notEqual(s, 'JBSWY3DPEHPK3PXP');
  assert.equal(dekripsi(s), 'JBSWY3DPEHPK3PXP');
  const p = s.split('.'); p[3] = p[3].slice(0, -2) + (p[3].endsWith('A') ? 'B' : 'A') + p[3].slice(-1);
  assert.throws(() => dekripsi(p.join('.')));
});

test('tiket langkah kedua: sah, kedaluwarsa, dipalsukan', () => {
  const ms = Date.now();
  const t = buatTiket('uid-1', ms);
  assert.equal(bacaTiket(t, ms + 1000), 'uid-1');
  assert.equal(bacaTiket(t, ms + 6 * 60_000), null);
  const [isi, tt] = t.split('.');
  const palsu = Buffer.from('uid-2.' + (ms + 300_000)).toString('base64url');
  assert.equal(bacaTiket(`${palsu}.${tt}`, ms), null);
  assert.equal(bacaTiket(`${isi}.x`, ms), null);
});

test('kode cadangan unik dan hash tidak peka huruf/spasi', () => {
  const k = kodeCadanganBaru();
  assert.equal(new Set(k).size, 8);
  assert.match(k[0], /^[0-9a-f]{5}-[0-9a-f]{5}$/);
  assert.equal(hashCadangan(k[0].toUpperCase() + ' '), hashCadangan(k[0]));
});
