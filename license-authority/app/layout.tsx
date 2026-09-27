import './globals.css';

export const metadata = {
  title: 'License Authority — Sales Management Platform',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <header className="top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" />
          <b>License Authority</b>
          <span className="muted">Kendali lisensi · bukan data bisnis pelanggan</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <a href="/">Lisensi</a>
            <a href="/register">Registrasi deployment</a>
          </span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
