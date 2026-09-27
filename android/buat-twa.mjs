#!/usr/bin/env node
/**
 * Susun android/twa-manifest.json untuk SATU deployment pelanggan, lalu
 * bangun APK/AAB dengan Bubblewrap (lihat android/README.md).
 *
 *   node android/buat-twa.mjs <domain> <package-id> [nama-aplikasi] [versionCode]
 *   node android/buat-twa.mjs sales.ptabc.co.id id.co.ptabc.sales "Sales PT ABC" 1
 *
 * Tidak ada nilai pelanggan yang ditulis ke kode sumber — hanya ke berkas
 * keluaran ini (yang tidak perlu di-commit per pelanggan).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [, , host, packageId, nama = 'Sales Management Platform', kode = '1'] = process.argv;
if (!host || !packageId || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId)) {
  console.error('Pakai: node android/buat-twa.mjs <domain> <package-id> [nama-aplikasi] [versionCode]');
  process.exit(1);
}
const domain = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const versi = Number(kode);

const manifest = {
  packageId,
  host: domain,
  name: nama,
  launcherName: nama.length > 12 ? 'Sales MP' : nama,
  display: 'standalone',
  orientation: 'portrait',
  themeColor: '#1D4ED8',
  themeColorDark: '#1E3A8A',
  navigationColor: '#FFFFFF',
  navigationColorDark: '#0F172A',
  navigationDividerColor: '#E2E8F0',
  navigationDividerColorDark: '#1E293B',
  backgroundColor: '#FFFFFF',
  enableNotifications: true,
  startUrl: '/?sumber=pwa',
  iconUrl: `https://${domain}/icon-512.png`,
  maskableIconUrl: `https://${domain}/icon-maskable-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: './android.keystore', alias: 'android' },
  appVersionName: `1.${versi}.0`,
  appVersionCode: versi,
  shortcuts: [
    { name: 'Daily Report', shortName: 'Laporan', url: '/daily-report', chosenIconUrl: `https://${domain}/icon-192.png` },
    { name: 'Meeting', shortName: 'Meeting', url: '/meeting', chosenIconUrl: `https://${domain}/icon-192.png` },
  ],
  generatorApp: 'bubblewrap-cli',
  webManifestUrl: `https://${domain}/manifest.webmanifest`,
  fallbackType: 'customtabs',
  features: { locationDelegation: { enabled: true } },
  enableSiteSettingsShortcut: true,
  isChromeOSOnly: false,
  isMetaQuest: false,
  fullScopeUrl: `https://${domain}/`,
  minSdkVersion: 21,
};

const tujuan = join(dirname(fileURLToPath(import.meta.url)), 'twa-manifest.json');
writeFileSync(tujuan, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Tertulis: ${tujuan}`);
console.log('Berikutnya: cd android && npx @bubblewrap/cli build');
