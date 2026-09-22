import type { Metadata, Viewport } from 'next';
import { PenyediaToast } from '@/components/shared/Feedback';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sales Management Platform',
  description: 'Daily Report, Pipeline, Request Schedule, dan Meeting dengan verifikasi GPS.',
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
        <PenyediaToast>{children}</PenyediaToast>
      </body>
    </html>
  );
}
