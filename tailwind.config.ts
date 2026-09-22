import type { Config } from 'tailwindcss';

/**
 * Token diadaptasi dari kedua baseline (tailwind.config.ts Work Management &
 * FieldServices) supaya platform ini terasa satu keluarga produk (§60).
 *
 * Nilai radius & bayangan sengaja dipertahankan sama persis dengan baseline —
 * memindahkan komponen ke sini tidak mengubah tampilannya sedikit pun.
 */
const config: Config = {
  content: [
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      screens: {
        /**
         * Dibawa utuh dari baseline. Yang membedakan laptop dari ponsel bukan
         * lebar viewport melainkan alat penunjuknya: `pointer: fine` berarti
         * ada mouse/trackpad dan itu tidak berubah walau halaman di-zoom.
         * Tanpa ini, zoom Chrome 125% pada laptop 1366px melaporkan 1092px
         * dan tata letak tiga kolom jatuh jadi satu kolom — padahal layarnya
         * laptop yang sama, hanya tulisannya diperbesar.
         */
        satulayar: { raw: '(min-width: 1280px), ((pointer: fine) and (min-width: 900px))' },
        formulir: { raw: '(min-width: 900px), ((pointer: fine) and (min-width: 640px))' },
      },
      borderRadius: {
        kecil: '0.5rem',    // lencana, chip, tombol ikon
        kontrol: '0.75rem', // input, tombol, baris daftar
        kartu: '1rem',      // kartu, panel, badan modal
        panel: '1.5rem',    // panel besar: kartu login
      },
      boxShadow: {
        kartu: '0 4px 24px rgba(0,0,0,0.10)',
        dropdown: '0 8px 32px rgba(0,0,0,0.18)',
        modal: '0 8px 40px rgba(0,0,0,0.18)',
        toast: '0 4px 32px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
        // Khusus bento: bayangan lebih rendah supaya kartu yang bersebelahan
        // tidak saling "menumpuk" secara visual saat rapat-rapat.
        bento: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px -12px rgba(15,23,42,0.18)',
      },
      colors: {
        /** Aksen biru profesional — warna utama platform. */
        aksen: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          DEFAULT: '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
};

export default config;
