'use client';

/**
 * components/shared/Tabel.tsx — daftar sebagai baris tabel, bukan kartu yang
 * ditumpuk vertikal.
 *
 * Sebelumnya setiap modul (Daily Report, Pipeline, dst.) merender daftarnya
 * sebagai kartu: judul di atas, detail menumpuk di bawahnya begitu diklik.
 * Itu memboroskan tinggi layar begitu barisnya lebih dari beberapa — orang
 * harus scroll jauh untuk membandingkan dua baris yang berdekatan. Tabel ini
 * meletakkan setiap kolom berdampingan, jadi satu layar bisa menampung lebih
 * banyak baris dan lebih mudah dipindai.
 *
 * Detail yang dulunya menumpuk di bawah kartu sekarang tidak dihilangkan —
 * dipindah ke modal yang dibuka lewat ikon mata di kolom Aksi.
 */

export interface KolomTabel<T> {
  label: string;
  /** Kelas lebar/alignment untuk <th> dan <td>, mis. "w-32" atau "text-right". */
  className?: string;
  render: (baris: T) => React.ReactNode;
}

export function Tabel<T>({
  kolom, data, kunci, aksi, lebarAksi = 'w-24',
}: {
  kolom: KolomTabel<T>[];
  data: T[];
  kunci: (baris: T) => string;
  /** Ikon-ikon aksi per baris (lihat TombolIkon), dirender rata kanan. */
  aksi?: (baris: T) => React.ReactNode;
  /** Lebar kolom Aksi — perbesar (mis. "w-64") kalau isinya bukan cuma ikon,
   *  ada juga tombol berlabel seperti "Reset Sandi". */
  lebarAksi?: string;
}) {
  return (
    <div className="bg-white rounded-kartu border border-slate-200 overflow-x-auto">
      {/*
        table-fixed: tanpa ini, browser memberi SISA lebar penuh ke kolom
        yang tidak diberi lebar eksplisit (biasanya kolom nama/deskripsi),
        sehingga selnya jauh lebih lebar daripada isinya dan sisanya tampak
        seperti area kosong di tengah tabel. Dengan table-fixed, lebar tiap
        kolom murni mengikuti className yang diberikan di pemanggil —
        karena itu kolom utama SETIAP tabel di sini selalu diberi w-[n%],
        bukan dibiarkan tanpa lebar.
      */}
      <table className="w-full table-fixed border-collapse min-w-[760px]">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide w-10">
              No
            </th>
            {kolom.map((k, i) => (
              <th key={i}
                className={`px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide ${k.className ?? ''}`}>
                {k.label}
              </th>
            ))}
            {aksi && (
              <th className={`px-3 py-2.5 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wide ${lebarAksi}`}>
                Aksi
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((baris, i) => (
            <tr key={kunci(baris)} id={`baris-${kunci(baris)}`}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
              <td className="px-3 py-3 text-[12px] text-slate-400 tabular-nums align-top">{i + 1}</td>
              {kolom.map((k, ki) => (
                <td key={ki} className={`px-3 py-3 text-[12.5px] text-slate-700 align-top ${k.className ?? ''}`}>
                  {k.render(baris)}
                </td>
              ))}
              {aksi && (
                <td className="px-3 py-3 align-top">
                  <div className="flex items-center justify-end gap-1">{aksi(baris)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RupaIkon = 'lihat' | 'sunting' | 'hapus' | 'sandi' | 'nonaktif' | 'aktif';

const WARNA_IKON: Record<RupaIkon, string> = {
  lihat:    'text-[#2a78d6] hover:bg-[#e3edfb]',
  sunting:  'text-[#c17d0e] hover:bg-[#fef3d9]',
  hapus:    'text-[#e34948] hover:bg-[#fce3e3]',
  sandi:    'text-slate-500 hover:bg-slate-100',
  nonaktif: 'text-[#e34948] hover:bg-[#fce3e3]',
  aktif:    'text-[#008300] hover:bg-[#e0f2e0]',
};

/** Tombol ikon bulat kecil untuk kolom Aksi; label tampil sebagai tooltip. */
export function TombolIkon({
  rupa, label, onClick,
}: {
  rupa: RupaIkon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} title={label}
      className={`w-8 h-8 rounded-full grid place-items-center transition-colors flex-shrink-0 ${WARNA_IKON[rupa]}`}
    >
      {rupa === 'lihat' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      )}
      {rupa === 'sunting' && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 20h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {rupa === 'hapus' && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {rupa === 'sandi' && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="8" cy="15" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10.8 12.2 20 3m-3 3 2.5 2.5M15 8l2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {(rupa === 'nonaktif' || rupa === 'aktif') && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
