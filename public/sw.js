/*
 * Service worker minimal — syarat "dapat dipasang" untuk PWA/TWA.
 *
 * SENGAJA tidak menyimpan halaman, API, maupun data apa pun: aplikasi ini
 * memuat data bisnis per pengguna dan status lisensi yang harus selalu
 * segar. Satu-satunya yang disimpan adalah halaman luring dan logonya,
 * supaya membuka aplikasi tanpa sinyal menampilkan pesan yang jelas, bukan
 * layar dinosaurus peramban.
 */
const CACHE = 'smp-luring-v1';
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
