import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kehangatan, nomorWhatsApp } from '../lib/customer.ts';

test('nomorWhatsApp mengubah nomor lokal ke format wa.me', () => {
  assert.equal(nomorWhatsApp('0812-8765-4321'), '6281287654321');
  assert.equal(nomorWhatsApp('+62 812 8765 4321'), '6281287654321');
  assert.equal(nomorWhatsApp('81287654321'), '6281287654321');
  assert.equal(nomorWhatsApp('021'), null);
  assert.equal(nomorWhatsApp(''), null);
  assert.equal(nomorWhatsApp(null), null);
});

test('kehangatan mengikuti umur aktivitas terakhir', () => {
  const hari = new Date('2026-10-01T10:00:00');
  assert.equal(kehangatan({ aktivitas_terakhir: null }, hari), 'BARU');
  assert.equal(kehangatan({ aktivitas_terakhir: '2026-09-25' }, hari), 'AKTIF');
  assert.equal(kehangatan({ aktivitas_terakhir: '2026-09-01' }, hari), 'SAPA');
  assert.equal(kehangatan({ aktivitas_terakhir: '2026-07-01' }, hari), 'DINGIN');
});
