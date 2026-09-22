'use client';

/**
 * components/shared/Bento.tsx — kerangka tata letak bento.
 *
 * KENAPA GRID EKSPLISIT, BUKAN MASONRY: FieldServices punya Masonry.tsx yang
 * mengukur tinggi kartu lalu menatanya sendiri. Itu tepat untuk kartu
 * selebar sama yang tingginya tak terduga. Dashboard ini persoalannya
 * kebalikan — komposisinya justru harus DISENGAJA: kartu mana yang lebar,
 * mana yang tinggi, mana yang jadi jangkar visual. Grid 12 kolom dengan
 * rentang yang ditentukan per kartu memberi kendali itu; masonry akan
 * meratakannya kembali jadi kolom-kolom seragam — persis kesan monoton yang
 * ingin dihindari.
 *
 * Empat `rupa` di bawah ada supaya kartu bertetangga tidak tampak kembar.
 * Aturan pakainya: `sorot` dan `gelap` masing-masing paling banyak satu per
 * layar. Kalau semua kartu menonjol, tidak ada yang menonjol.
 */

type Rentang = 2 | 3 | 4 | 6 | 8 | 12;
type Tinggi = 'pendek' | 'sedang' | 'tinggi' | 'auto';
type Rupa = 'polos' | 'sorot' | 'gelap' | 'garis';

const TINGGI: Record<Tinggi, string> = {
  pendek: 'min-h-[132px]',
  sedang: 'min-h-[208px]',
  tinggi: 'min-h-[296px]',
  auto:   '',
};

/**
 * Rentang ditulis lengkap, bukan dirangkai `col-span-${n}`. Tailwind memindai
 * kode sumber sebagai teks biasa: kelas yang baru terbentuk saat program
 * berjalan tidak pernah ia lihat, jadi CSS-nya tidak ikut dibuat dan seluruh
 * tata letaknya runtuh jadi satu kolom di build produksi.
 *
 * Memakai `lg:`, bukan breakpoint kustom `satulayar`. `satulayar` ditulis
 * sebagai media query `raw`, yang tidak bisa Tailwind urutkan berdasarkan
 * lebar — letaknya di CSS mengikuti urutan konfigurasi, bukan urutan ukuran
 * layar. Untuk padanan `sm:`/`lg:` yang saling menimpa seperti di sini, salah
 * urut berarti rentang tablet menang di layar desktop. `satulayar` tetap
 * dipakai di tempat asalnya: tata letak formulir, yang tidak berpasangan
 * dengan breakpoint lain.
 */
const RENTANG: Record<Rentang, string> = {
  2:  'sm:col-span-2 lg:col-span-2',
  3:  'sm:col-span-3 lg:col-span-3',
  4:  'sm:col-span-3 lg:col-span-4',
  6:  'sm:col-span-6 lg:col-span-6',
  8:  'sm:col-span-6 lg:col-span-8',
  12: 'sm:col-span-6 lg:col-span-12',
};

const RUPA: Record<Rupa, string> = {
  polos: 'bg-white border border-slate-200/80 shadow-bento',
  sorot: 'bg-gradient-to-br from-aksen-700 via-aksen-600 to-aksen-500 text-white shadow-bento border border-aksen-700/20',
  gelap: 'bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-bento border border-slate-900/20',
  garis: 'bg-slate-50/70 border border-dashed border-slate-300',
};

export function BentoGrid({ children, className = '' }: {
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-6 lg:grid-cols-12 gap-3 sm:gap-4 ${className}`}>
      {children}
    </div>
  );
}

export function BentoCard({
  children, rentang = 4, tinggi = 'auto', rupa = 'polos',
  judul, ikon, aksi, className = '',
}: {
  children: React.ReactNode;
  rentang?: Rentang;
  tinggi?: Tinggi;
  rupa?: Rupa;
  judul?: string;
  ikon?: React.ReactNode;
  /** Tombol kecil di pojok kanan header, mis. "Lihat semua". */
  aksi?: React.ReactNode;
  className?: string;
}) {
  const gelapTeks = rupa === 'sorot' || rupa === 'gelap';

  return (
    <section
      className={`${RENTANG[rentang]} ${TINGGI[tinggi]} ${RUPA[rupa]}
                  rounded-kartu p-4 sm:p-5 flex flex-col gap-3 overflow-hidden
                  transition-shadow duration-200 ${className}`}
    >
      {(judul || aksi) && (
        <header className="flex items-center justify-between gap-2 flex-shrink-0">
          <p className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5
                         ${gelapTeks ? 'text-white/70' : 'text-slate-500'}`}>
            {ikon}
            {judul}
          </p>
          {aksi}
        </header>
      )}
      <div className="flex-1 min-h-0 flex flex-col justify-center">{children}</div>
    </section>
  );
}

/**
 * Angka besar sebagai jangkar visual — dipakai kartu KPI yang isinya memang
 * satu bilangan, bukan grafik.
 *
 * tabular-nums penting di sini: tanpa itu, angka yang berubah tiap penyegaran
 * data akan menggeser lebar teksnya sendiri dan kartunya terlihat "bergoyang".
 */
export function AngkaJangkar({
  nilai, satuan, keterangan, tren, terang = false,
}: {
  nilai: string | number;
  satuan?: string;
  keterangan?: string;
  tren?: React.ReactNode;
  /** true bila kartunya berlatar gelap. */
  terang?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className={`text-[30px] sm:text-[34px] font-black leading-none tracking-tight tabular-nums
                          ${terang ? 'text-white' : 'text-slate-900'}`}>
          {nilai}
        </span>
        {satuan && (
          <span className={`text-sm font-bold ${terang ? 'text-white/60' : 'text-slate-400'}`}>
            {satuan}
          </span>
        )}
        {tren}
      </div>
      {keterangan && (
        <p className={`text-[11px] leading-snug ${terang ? 'text-white/60' : 'text-slate-500'}`}>
          {keterangan}
        </p>
      )}
    </div>
  );
}

/**
 * Baris ringkas di dalam kartu bento — dipakai daftar pendek seperti "meeting
 * hari ini" atau "pipeline paling dekat closing".
 */
export function BarisBento({
  kiri, kanan, warna, onClick,
}: {
  kiri: React.ReactNode;
  kanan?: React.ReactNode;
  /** Garis warna tipis di sisi kiri sebagai penanda status. */
  warna?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`w-full flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-kontrol text-left
                  ${onClick ? 'hover:bg-slate-50 transition-colors' : ''}`}
    >
      {warna && <span className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: warna }} />}
      <div className="flex-1 min-w-0">{kiri}</div>
      {kanan && <div className="flex-shrink-0 text-right">{kanan}</div>}
    </Tag>
  );
}
