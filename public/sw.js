// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
/*
 * Service worker minimal — syarat "dapat dipasang" untuk PWA/TWA.
 *
 * SENGAJA tidak menyimpan halaman, API, maupun data apa pun: aplikasi ini
 * memuat data bisnis per pengguna dan status lisensi yang harus selalu
 * segar. Satu-satunya yang disimpan adalah halaman luring dan logonya,
 * supaya membuka aplikasi tanpa sinyal menampilkan pesan yang jelas, bukan
 * layar dinosaurus peramban.
 *
 * Juga menerima notifikasi push (lib/push.ts): isinya hanya judul, kalimat
 * ringkas, dan halaman tujuan — bukan data bisnis.
 */
const CACHE = 'smp-luring-v2';
const ASET = ['/offline.html', '/brand/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASET)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  const url = new URL(req.url);
  if (url.origin === self.location.origin && ASET.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { isi: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.judul || 'Sales Management', {
    body: d.isi || '',
    icon: '/brand/logo.png',
    badge: '/brand/logo.png',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const tujuan = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (tujuan.origin !== self.location.origin) return;
  e.waitUntil((async () => {
    const semua = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // focus() bisa ditolak peramban dan navigate() hanya berlaku untuk tab
    // yang dikendalikan service worker ini — masing-masing dicoba terpisah
    // supaya satu kegagalan tidak membatalkan perpindahan halaman.
    for (const c of semua) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      try { await c.focus(); } catch { /* lanjut */ }
      try { if (await c.navigate(tujuan.href)) return; } catch { /* coba tab lain */ }
    }
    await self.clients.openWindow(tujuan.href);
  })());
});
