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
        /**
         * Ambang munculnya sidebar. Sengaja MURNI lebar, tanpa syarat
         * `pointer: fine`.
         *
         * Chrome di ponsel punya mode "Situs desktop" yang melaporkan
         * viewport ~980px lalu mengecilkan seluruh halaman agar muat di layar
         * fisik. Dengan ambang lg (1024px), lebar 980px itu jatuh ke tata
         * letak ponsel — sehingga yang didapat justru gabungan terburuk:
         * bilah navigasi bawah dan teks ponsel, tapi diperkecil 0,7x sampai
         * nyaris tidak terbaca. Pada 900px ke atas ruangnya memang cukup
         * untuk sidebar, apa pun alat penunjuknya.
         */
        sidebar: { raw: '(min-width: 900px)' },
        /**
         * Layar sentuh yang melaporkan diri selebar desktop — persis yang
         * terjadi pada mode "Situs desktop" Chrome ponsel. Di sana peramban
         * mengecilkan halaman sekitar 0,73x, sehingga teks 11px mendarat di
         * sekitar 8px fisik. Ukuran huruf pada bilah header dinaikkan khusus
         * untuk kondisi ini; tingginya sengaja TIDAK diubah supaya offset
         * sticky sidebar tetap cocok.
         */
        sentuhlebar: { raw: '(pointer: coarse) and (min-width: 900px)' },
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
        /**
         * Aksen platform. Nilainya TIDAK dipaku di sini melainkan menunjuk ke
         * variabel CSS yang dipasang lib/branding.ts, supaya warna yang
         * dipilih admin di Administrasi → Tampilan langsung berlaku di
         * seluruh aplikasi tanpa satu pun komponen diubah. Nilai bawaannya
         * ada di app/globals.css.
         */
        aksen: {
          50:  'rgb(var(--aksen-50)  / <alpha-value>)',
          100: 'rgb(var(--aksen-100) / <alpha-value>)',
          200: 'rgb(var(--aksen-200) / <alpha-value>)',
          300: 'rgb(var(--aksen-300) / <alpha-value>)',
          400: 'rgb(var(--aksen-400) / <alpha-value>)',
          500: 'rgb(var(--aksen-500) / <alpha-value>)',
          600: 'rgb(var(--aksen-600) / <alpha-value>)',
          700: 'rgb(var(--aksen-700) / <alpha-value>)',
          800: 'rgb(var(--aksen-800) / <alpha-value>)',
          900: 'rgb(var(--aksen-900) / <alpha-value>)',
          DEFAULT: 'rgb(var(--aksen-700) / <alpha-value>)',
        },
        /** Warna aksen merek (nama portal), terpisah dari biru utama. */
        merek: 'rgb(var(--merek-aksen) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

export default config;
