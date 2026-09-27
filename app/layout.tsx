import type { Metadata, Viewport } from 'next';
import { PenyediaToast } from '@/components/shared/Feedback';
import { DaftarSW } from '@/components/shared/DaftarSW';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sales Management Platform',
  description: 'Daily Report, Pipeline, Request Schedule, dan Meeting dengan verifikasi GPS.',
  applicationName: 'Sales Management Platform',
  // Ikon (favicon.ico, icon.png, apple-icon.png) dan manifest.webmanifest
  // dibaca otomatis oleh Next.js dari folder app/.
  appleWebApp: { capable: true, title: 'Sales MP', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom TIDAK dikunci. Alur meeting dipakai di lapangan, kerap di bawah
  // matahari terang, dan mengunci maximum-scale memaksa orang membaca teks
  // kecil tanpa bisa memperbesarnya.
  themeColor: '#1d4ed8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <DaftarSW />
        <PenyediaToast>{children}</PenyediaToast>
      </body>
    </html>
  );
}
