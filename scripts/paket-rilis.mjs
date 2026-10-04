// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
//
// Paket rilis untuk repo/server pelanggan lain (mis. demo): HANYA berkas yang
// berubah sejak versi yang terpasang di sana, plus SQL susulan & panduan.
//
//   npm run rilis -- <commit-terpasang> [commit-baru=HEAD]
//   contoh: npm run rilis -- 0f364a6
//
// Hasil: rilis/rilis-<lama>-<baru>.zip berisi
//   • berkas yang berubah/ditambah (susunan folder sama dengan repo)
//   • RILIS/HAPUS.txt          berkas yang harus DIHAPUS di repo tujuan
//   • RILIS/SQL_SUSULAN.sql    migrasi baru dalam satu transaksi
//   • RILIS/CARA_UPDATE.md     langkah git & Supabase
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const [lama, baru = 'HEAD'] = process.argv.slice(2);
if (!lama) {
  console.error('Pakai: npm run rilis -- <commit-yang-terpasang-di-tujuan> [commit-baru]');
  process.exit(1);
}
const pendek = (r) => git('rev-parse', '--short=7', r);
const [a, b] = [pendek(lama), pendek(baru)];

const baris = git('diff', '--name-status', '--no-renames', `${a}..${b}`).split('\n').filter(Boolean);
const ubah = [], hapus = [];
for (const l of baris) {
  const [st, f] = l.split('\t');
  (st === 'D' ? hapus : ubah).push(f);
}
// Berkas yang tidak boleh ikut ke repo pelanggan lain.
const LEWATI = [/^\.github\//, /^android\/pelanggan\.properties$/, /\.jks$|\.keystore$/];
const kirim = ubah.filter((f) => !LEWATI.some((r) => r.test(f)));
if (kirim.length === 0 && hapus.length === 0) { console.log(`Tidak ada perubahan ${a}..${b}.`); process.exit(0); }

const migrasi = kirim.filter((f) => /^supabase\/migrations\/\d{3}_.+\.sql$/.test(f)).sort();
const keluar = 'rilis';
const kerja = join(keluar, '.kerja', 'RILIS');
rmSync(join(keluar, '.kerja'), { recursive: true, force: true });
mkdirSync(kerja, { recursive: true });

writeFileSync(join(kerja, 'HAPUS.txt'), hapus.length ? hapus.join('\n') + '\n' : '(tidak ada)\n');
writeFileSync(join(kerja, 'SQL_SUSULAN.sql'), migrasi.length
  ? [`-- SQL susulan ${a} → ${b}. Jalankan SEKALI di SQL Editor Supabase tujuan.`,
     '-- Satu transaksi: bila ada yang gagal, tidak ada yang tersimpan.', 'BEGIN;',
     ...migrasi.map((m) => `\n-- ▼▼▼ ${m.split('/').pop()} ▼▼▼\n${git('show', `${b}:${m}`)}\n`), 'COMMIT;', ''].join('\n')
  : '-- Tidak ada migrasi baru pada rilis ini.\n');

const log = git('log', '--no-merges', '--format=- %s', `${a}..${b}`);
writeFileSync(join(kerja, 'CARA_UPDATE.md'), `# Update ${a} → ${b}

## Perubahan
${log || '- (lihat daftar berkas)'}

## Langkah
1. **Database dulu** — ${migrasi.length
  ? `Supabase tujuan → SQL Editor → tempel seluruh \`RILIS/SQL_SUSULAN.sql\` → Run (${migrasi.length} migrasi: ${migrasi.map((m) => m.split('/').pop().slice(0, 3)).join(', ')}).`
  : 'tidak ada migrasi baru.'}
2. Ekstrak ZIP ini, salin semua isinya **kecuali folder \`RILIS\`** ke folder repo tujuan → *Replace* bila ditanya.
3. ${hapus.length ? `Hapus berkas di \`RILIS/HAPUS.txt\` (${hapus.length} berkas).` : 'Tidak ada berkas yang perlu dihapus.'}
4. Di folder repo tujuan:
   \`\`\`
   git status        # harus ±${kirim.length + hapus.length} berkas, bukan ratusan
   git add -A
   git commit -m "Update ${a} → ${b}"
   git push
   \`\`\`
5. Vercel men-deploy otomatis. ${kirim.includes('package.json') ? '**package.json berubah** — Vercel memasang ulang dependensi (build sedikit lebih lama).' : ''}
6. Catat commit terpasang yang baru: **${b}** (dipakai untuk rilis berikutnya).
`);

const zip = join(keluar, `rilis-${a}-${b}.zip`);
const tambahan = ['HAPUS.txt', 'SQL_SUSULAN.sql', 'CARA_UPDATE.md'].flatMap((f) => ['--add-file', join(kerja, f)]);
// --add-file menaruh berkas di akar arsip; --prefix mengatur foldernya.
execFileSync('git', ['archive', '--format=zip', '-o', zip, '--prefix=RILIS/', ...tambahan, '--prefix=', b, '--', ...(kirim.length ? kirim : ['package.json'])]);
rmSync(join(keluar, '.kerja'), { recursive: true, force: true });

console.log(`✅ ${zip}`);
console.log(`   ${kirim.length} berkas berubah · ${hapus.length} dihapus · ${migrasi.length} migrasi baru`);
