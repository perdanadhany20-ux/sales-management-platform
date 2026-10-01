// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bacaTanggal, bacaJam, bacaAngka, bacaPersen, bacaPilihan, petakanJudul, validasiBaris, kunciDuplikat, TAHAPAN,
} from '../lib/impor-data.ts';

const konteks = {
  cariSales: (t: string) => (['rina', 'rina.wulandari', 'rina wulandari'].includes(t.toLowerCase()) ? 'uid-rina' : null),
  salesBawaan: null,
  hariIni: '2026-10-01',
};

test('bacaTanggal menerima format umum spreadsheet Indonesia', () => {
  assert.equal(bacaTanggal('01/09/2026'), '2026-09-01');
  assert.equal(bacaTanggal('1-9-26'), '2026-09-01');
  assert.equal(bacaTanggal('2026-09-01'), '2026-09-01');
  assert.equal(bacaTanggal('1 Okt 2026'), '2026-10-01');
  assert.equal(bacaTanggal('12 Agustus 2026'), '2026-08-12');
  assert.equal(bacaTanggal(new Date(Date.UTC(2026, 8, 1))), '2026-09-01');
  assert.equal(bacaTanggal(46266), '2026-09-01'); // nomor seri Excel
  assert.equal(bacaTanggal('31/02/2026'), null);
  assert.equal(bacaTanggal('besok'), null);
});

test('bacaJam, bacaAngka, bacaPersen', () => {
  assert.equal(bacaJam('9.30'), '09:30');
  assert.equal(bacaJam(0.5), '12:00');
  assert.equal(bacaJam('25:00'), null);
  assert.equal(bacaAngka('Rp 1.250.000'), 1250000);
  assert.equal(bacaAngka('1.250.000,50'), 1250000.5);
  assert.equal(bacaAngka('1,250,000'), 1250000);
  assert.equal(bacaAngka('2,5'), 2.5);
  assert.equal(bacaAngka(150000000), 150000000);
  assert.equal(bacaAngka('abc'), null);
  assert.equal(bacaPersen('50%'), 50);
  assert.equal(bacaPersen(0.75), 75);
  assert.equal(bacaPersen(90), 90);
});

test('bacaPilihan mengenali sinonim tahapan', () => {
  assert.equal(bacaPilihan('Menang', TAHAPAN), 'WON');
  assert.equal(bacaPilihan('penawaran', TAHAPAN), 'QUOTATION');
  assert.equal(bacaPilihan('LOST', TAHAPAN), 'LOST');
  assert.equal(bacaPilihan('entah', TAHAPAN), null);
});

test('petakanJudul mengenali sebutan lain', () => {
  const peta = petakanJudul(['No', 'Tgl', 'Nama Sales', 'Perusahaan', 'Kegiatan', 'Hasil Kunjungan', 'Tindak Lanjut'], 'daily_report');
  assert.deepEqual(Object.values(peta).sort(), ['activity', 'customer_name', 'next_action', 'report_date', 'result', 'sales'].sort());
});

test('validasiBaris pipeline: bawaan & penolakan', () => {
  const ok = validasiBaris('pipeline', { sales: 'Rina', customer_name: 'PT A', project_detail: 'LED', project_value: 'Rp 100.000.000', stage: 'Menang', estimated_closing: '30/09/2026' }, konteks);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.baris.sales_user_id, 'uid-rina');
    assert.equal(ok.baris.data.stage, 'WON');
    assert.equal(ok.baris.data.probability, 100);
    assert.equal(ok.baris.data.won_at, '2026-09-30');
    assert.equal(ok.baris.data.pipeline_date, '2026-10-01');
    assert.equal(ok.baris.data.next_action, '-');
  }
  const gagal = validasiBaris('pipeline', { sales: 'Budi', customer_name: '', project_detail: 'LED', project_value: 'seratus' }, konteks);
  assert.equal(gagal.ok, false);
  if (!gagal.ok) assert.equal(gagal.galat.length, 3);
});

test('validasiBaris schedule: riwayat tanpa kewajiban bukti, status mengikuti tanggal', () => {
  const lalu = validasiBaris('schedule', { sales: 'rina', schedule_date: '12/08/2026', customer_name: 'PT A' }, konteks);
  assert.equal(lalu.ok && lalu.baris.data.status, 'COMPLETED');
  assert.equal(lalu.ok && lalu.baris.data.requires_attendance, false);
  const depan = validasiBaris('schedule', { schedule_date: '12/12/2026', customer_name: 'PT A' }, { ...konteks, salesBawaan: 'uid-x' });
  assert.equal(depan.ok && depan.baris.data.status, 'UPCOMING');
  assert.equal(depan.ok && depan.baris.sales_user_id, 'uid-x');
});

test('kunciDuplikat mengabaikan beda huruf & spasi', () => {
  assert.equal(
    kunciDuplikat('daily_report', 'u', { report_date: '2026-09-01', customer_name: 'PT  Maju', activity: 'Presentasi' }),
    kunciDuplikat('daily_report', 'u', { report_date: '2026-09-01', customer_name: 'pt maju', activity: 'presentasi ' }),
  );
});
