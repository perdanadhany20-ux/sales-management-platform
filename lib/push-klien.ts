// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

/**
 * lib/push-klien.ts — berlangganan notifikasi push di perangkat ini.
 * Kunci publik VAPID diambil dari server (/api/push), bukan NEXT_PUBLIC_*.
 */

export type StatusPush = 'tidak_didukung' | 'belum_diatur_server' | 'ditolak' | 'mati' | 'menyala';

function didukung(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keUint8(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function registrasi(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

async function infoServer(): Promise<{ tersedia: boolean; kunci: string | null }> {
  const r = await fetch('/api/push', { credentials: 'include' });
  return r.ok ? r.json() : { tersedia: false, kunci: null };
}

export async function statusPush(): Promise<StatusPush> {
  if (!didukung()) return 'tidak_didukung';
  const info = await infoServer().catch(() => ({ tersedia: false, kunci: null }));
  if (!info.tersedia) return 'belum_diatur_server';
  if (Notification.permission === 'denied') return 'ditolak';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'menyala' : 'mati';
}

/** Harus dipanggil dari klik pengguna (izin notifikasi). */
export async function nyalakanPush(): Promise<StatusPush> {
  if (!didukung()) return 'tidak_didukung';
  const info = await infoServer();
  if (!info.tersedia || !info.kunci) return 'belum_diatur_server';
  const izin = await Notification.requestPermission();
  if (izin !== 'granted') return izin === 'denied' ? 'ditolak' : 'mati';
  const reg = await registrasi();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keUint8(info.kunci) });
  const res = await fetch('/api/push', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ langganan: sub.toJSON() }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Gagal mendaftarkan perangkat.');
  await fetch('/api/push', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uji: true, endpoint: sub.endpoint }),
  }).catch(() => {});
  return 'menyala';
}

export async function matikanPush(): Promise<StatusPush> {
  if (!didukung()) return 'tidak_didukung';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push', {
      method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => false);
  }
  return 'mati';
}
