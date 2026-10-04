// Membuat pasangan kunci VAPID untuk notifikasi push.
//   npm run vapid
// Salin ketiga baris ke Vercel → Settings → Environment Variables lalu Redeploy.
// Kunci privat jangan di-commit; satu pasang per platform (deployment).
import webpush from 'web-push';
const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:admin@perusahaan-anda.co.id');
