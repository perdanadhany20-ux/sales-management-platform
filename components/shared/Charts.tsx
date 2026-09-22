'use client';

import { useId, useState } from 'react';

/**
 * components/shared/Charts.tsx — kumpulan bentuk grafik untuk tata letak bento.
 *
 * SENGAJA BANYAK BENTUK, dan itu bukan soal selera. Donat menjawab "komposisi
 * sekarang berapa"; ia tidak bisa menjawab "membaik atau memburuk", dan
 * memaksakannya untuk corong penjualan justru menyesatkan karena tahapan
 * corong itu berurutan, bukan potongan dari satu keseluruhan. Setiap bentuk di
 * bawah menjawab satu jenis pertanyaan:
 *
 *   Donat + legenda  → komposisi, dan bisa diklik untuk menyaring
 *   Cincin radial    → satu capaian terhadap targetnya
 *   Corong bertingkat→ tahapan berurutan (probability Pipeline)
 *   Batang periode   → tren antarwaktu
 *   Sparkline        → tren mungil untuk diselipkan di baris tabel
 *   Meter            → satu rasio, sesempit mungkin
 *   TrendBadge       → perbandingan terhadap periode sebelumnya
 *
 * Semua digambar tangan dengan SVG. Itu mengikuti pola dominan kedua baseline
 * (20+ berkas memakai SVG langsung, hanya satu memakai pustaka grafik) dan
 * memberi kendali penuh atas bentuk kartu bento — yang justru jadi inti
 * permintaan desainnya.
 */

// ── Donat berlegenda ────────────────────────────────────────────────────────

export interface IrisanData {
  label: string;
  value: number;
  color: string;
}

/**
 * Donat dengan legenda di sampingnya, angka total di tengah, dan irisan yang
 * bisa diklik untuk menyaring halaman.
 *
 * Legenda dibatasi lebarnya dan boleh turun ke bawah donat (flex-wrap). Tanpa
 * itu, pada kartu sempit legenda menyusut sampai nyaris nol sementara donatnya
 * tetap 120px — yang tersisa di layar cuma lingkaran warna tanpa keterangan,
 * alias grafik yang tidak bisa dibaca.
 */
export function DonutLegenda({
  data, judul, ikon, filterAktif, onKlikIrisan,
  nilaiTengah, labelTengah, akhiranNilai, ukuran = 120,
}: {
  data: IrisanData[];
  judul: string;
  ikon?: React.ReactNode;
  filterAktif?: string | null;
  onKlikIrisan?: (label: string) => void;
  nilaiTengah?: string | number;
  labelTengah?: string;
  akhiranNilai?: string;
  ukuran?: number;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex flex-col gap-2">
        <JudulKartu ikon={ikon}>{judul}</JudulKartu>
        <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>
      </div>
    );
  }

  const cx = 60, cy = 60, r = 50, ir = 30;
  let sudut = -Math.PI / 2;

  const irisan = data.map((d, i) => {
    const lebarSudut = (d.value / total) * 2 * Math.PI;
    // Satu kategori mengisi penuh: busur 360° punya titik awal dan akhir yang
    // sama persis, sehingga path arc-nya menggambar NOL derajat, bukan
    // lingkaran penuh. Kasus ini harus digambar sebagai dua lingkaran.
    if (data.length === 1) return { ...d, path: '', penuh: true, i };
    const x1 = cx + r * Math.cos(sudut),  y1 = cy + r * Math.sin(sudut);
    const x2 = cx + r * Math.cos(sudut + lebarSudut), y2 = cy + r * Math.sin(sudut + lebarSudut);
    const xi1 = cx + ir * Math.cos(sudut), yi1 = cy + ir * Math.sin(sudut);
    const xi2 = cx + ir * Math.cos(sudut + lebarSudut), yi2 = cy + ir * Math.sin(sudut + lebarSudut);
    const besar = lebarSudut > Math.PI ? 1 : 0;
    const path = `M ${xi1} ${yi1} L ${x1} ${y1} A ${r} ${r} 0 ${besar} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ir} ${ir} 0 ${besar} 0 ${xi1} ${yi1} Z`;
    sudut += lebarSudut;
    return { ...d, path, penuh: false, i };
  });

  const bisaKlik = Boolean(onKlikIrisan);

  return (
    <div className="flex flex-col gap-3">
      <JudulKartu ikon={ikon}>{judul}</JudulKartu>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <svg
          width={ukuran} height={ukuran} viewBox="0 0 120 120"
          className="flex-shrink-0 w-[92px] h-[92px] sm:w-[120px] sm:h-[120px]"
          role="img"
          aria-label={`${judul}: ${data.map(d => `${d.label} ${d.value}`).join(', ')}`}
        >
          {irisan.map((s) => (
            s.penuh ? (
              <g key={s.i}>
                <circle cx={cx} cy={cy} r={r} fill={s.color} />
                <circle cx={cx} cy={cy} r={ir} fill="white" />
              </g>
            ) : (
              <path
                key={s.i} d={s.path} fill={s.color}
                opacity={hov === null || hov === s.i ? 1 : 0.4}
                style={{
                  cursor: bisaKlik ? 'pointer' : 'default',
                  transition: 'opacity .15s',
                  filter: hov === s.i || filterAktif === s.label
                    ? `drop-shadow(0 0 4px ${s.color})` : 'none',
                }}
                onMouseEnter={() => setHov(s.i)}
                onMouseLeave={() => setHov(null)}
                onClick={() => onKlikIrisan?.(s.label)}
              />
            )
          ))}
          <text x={cx} y={cy + 1} textAnchor="middle" fontSize="19" fontWeight="800" fill="#0f172a">
            {nilaiTengah ?? total}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#94a3b8">
            {labelTengah ?? 'TOTAL'}
          </text>
        </svg>

        <ul className="flex flex-col gap-1 flex-1 basis-[120px] min-w-[120px] sm:basis-[150px] max-w-[220px] max-h-[130px] overflow-y-auto m-0 p-0 list-none">
          {irisan.map((s) => {
            const aktif = filterAktif === s.label;
            return (
              <li key={s.i}>
                <button
                  type="button"
                  disabled={!bisaKlik}
                  onMouseEnter={() => setHov(s.i)}
                  onMouseLeave={() => setHov(null)}
                  onClick={() => onKlikIrisan?.(s.label)}
                  className="w-full flex items-center gap-1.5 rounded-kecil px-1.5 py-1 transition-all text-left disabled:cursor-default"
                  style={{
                    background: hov === s.i || aktif ? `${s.color}1a` : 'transparent',
                    outline: aktif ? `1px solid ${s.color}` : 'none',
                  }}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-[11px] font-semibold text-slate-600 truncate flex-1">{s.label}</span>
                  <span className="text-[11px] font-bold flex-shrink-0" style={{ color: s.color }}>
                    {s.value}{akhiranNilai ?? ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ── Cincin radial ───────────────────────────────────────────────────────────

/**
 * Satu capaian terhadap targetnya, misalnya kepatuhan laporan harian.
 *
 * Busurnya berhenti di 270°, bukan lingkaran penuh — celah di bawah membuat
 * titik awal dan akhir terbaca jelas, sehingga 95% tidak tampak sama dengan
 * 100% seperti yang kerap terjadi pada cincin penuh.
 */
export function CincinCapaian({
  nilai, maksimum = 100, warna = '#1d4ed8', ukuran = 132, tebal = 12, label, sublabel,
}: {
  nilai: number; maksimum?: number; warna?: string;
  ukuran?: number; tebal?: number; label?: string; sublabel?: string;
}) {
  const gradId = useId();
  const rasio = maksimum > 0 ? Math.min(1, Math.max(0, nilai / maksimum)) : 0;
  const r = (ukuran - tebal) / 2;
  const kelilingPenuh = 2 * Math.PI * r;
  const busur = kelilingPenuh * 0.75;               // 270°
  const terisi = busur * rasio;

  return (
    <div className="relative flex-shrink-0 mx-auto" style={{ width: ukuran, height: ukuran }}>
      <svg
        width={ukuran} height={ukuran}
        style={{ transform: 'rotate(135deg)' }}
        role="img"
        aria-label={`${label ?? 'Capaian'}: ${Math.round(rasio * 100)} persen`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor={warna} stopOpacity="0.55" />
            <stop offset="100%" stopColor={warna} />
          </linearGradient>
        </defs>
        <circle
          cx={ukuran / 2} cy={ukuran / 2} r={r} fill="none"
          stroke="#eef2f7" strokeWidth={tebal} strokeLinecap="round"
          strokeDasharray={`${busur} ${kelilingPenuh}`}
        />
        <circle
          cx={ukuran / 2} cy={ukuran / 2} r={r} fill="none"
          stroke={`url(#${gradId})`} strokeWidth={tebal} strokeLinecap="round"
          strokeDasharray={`${terisi} ${kelilingPenuh}`}
          style={{ transition: 'stroke-dasharray .6s cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[26px] font-black text-slate-900 leading-none tracking-tight">
          {Math.round(rasio * 100)}<span className="text-[15px] text-slate-400">%</span>
        </span>
        {label && <span className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wider">{label}</span>}
        {sublabel && <span className="text-[10px] text-slate-400 mt-0.5">{sublabel}</span>}
      </div>
    </div>
  );
}

// ── Corong bertingkat ───────────────────────────────────────────────────────

/**
 * Tahapan berurutan — dipakai sebaran probability Pipeline.
 *
 * Bukan donat, dan itu disengaja: irisan donat menyiratkan bagian-dari-satu
 * keseluruhan yang setara, sedangkan 10% dan 90% adalah tingkatan yang
 * berurutan. Batang mendatar membuat urutannya terbaca, dan nilai rupiah
 * per tingkat muat di sampingnya — hal yang mustahil pada legenda donat.
 */
export function CorongTingkat({
  data,
}: {
  data: { label: string; jumlah: number; nilai?: string; color: string }[];
}) {
  const maks = Math.max(...data.map(d => d.jumlah), 1);
  if (data.every(d => d.jumlah === 0)) {
    return <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold text-slate-500 w-9 text-right flex-shrink-0 tabular-nums">
            {d.label}
          </span>
          <div className="flex-1 h-7 rounded-kecil bg-slate-100 overflow-hidden relative min-w-0">
            <div
              className="h-full rounded-kecil flex items-center px-2"
              style={{
                width: `${Math.max(6, (d.jumlah / maks) * 100)}%`,
                background: `linear-gradient(90deg, ${d.color}dd, ${d.color})`,
                transition: 'width .6s cubic-bezier(.22,1,.36,1)',
              }}
            >
              <span className="text-[11px] font-bold text-white drop-shadow-sm tabular-nums">
                {d.jumlah}
              </span>
            </div>
          </div>
          {d.nilai && (
            <span className="text-[11px] font-bold text-slate-600 flex-shrink-0 tabular-nums w-[74px] text-right">
              {d.nilai}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Batang antarperiode ─────────────────────────────────────────────────────

/**
 * Tren antarwaktu. Periode berjalan diberi warna penuh dan sisanya diredupkan,
 * supaya mata menemukan "sekarang" tanpa harus membaca label satu per satu.
 */
export function BatangPeriode({
  data, warna = '#1d4ed8', tinggi = 92, indeksSorot,
}: {
  data: { label: string; value: number }[];
  warna?: string; tinggi?: number; indeksSorot?: number;
}) {
  const maks = Math.max(...data.map(d => d.value), 1);
  const sorot = indeksSorot ?? data.length - 1;

  return (
    <div className="flex items-end gap-1.5" style={{ height: tinggi }}>
      {data.map((d, i) => {
        // Batang bernilai nol tetap diberi 4px. Tanpa itu kolomnya hilang sama
        // sekali dan deretnya terbaca seolah periode itu tidak ada, bukan
        // "periode itu nol".
        const t = d.value === 0 ? 4 : Math.max(8, (d.value / maks) * (tinggi - 26));
        const kini = i === sorot;
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
            {d.value > 0 && (
              <span className="text-[9px] font-bold text-slate-500 leading-none tabular-nums">{d.value}</span>
            )}
            <div
              className="w-full rounded-t-kecil"
              style={{
                height: t,
                background: kini ? warna : `${warna}33`,
                transition: 'height .5s cubic-bezier(.22,1,.36,1)',
              }}
              title={`${d.label}: ${d.value}`}
            />
            <span className="text-[9px] text-slate-400 leading-none truncate w-full text-center">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────

/** Tren mungil untuk diselipkan di dalam baris tabel atau kartu KPI. */
export function Sparkline({
  values, color = '#1d4ed8', width = 64, height = 20,
}: {
  values: number[]; color?: string; width?: number; height?: number;
}) {
  if (values.length === 0) return <svg width={width} height={height} aria-hidden="true" />;
  const maks = Math.max(...values, 1);
  const w = Math.max(2, Math.floor(width / values.length) - 1);

  return (
    <svg width={width} height={height} className="flex-shrink-0"
      role="img" aria-label={`Tren ${values.length} periode terakhir`}>
      {values.map((v, i) => {
        const h = Math.max(2, (v / maks) * height);
        return (
          <rect
            key={i} x={i * (w + 1)} y={height - h} width={w} height={h} rx={1}
            fill={color}
            // Kepekatan naik dari kiri ke kanan supaya arah waktu terbaca
            // tanpa perlu sumbu: batang paling pekat adalah yang terbaru.
            opacity={0.3 + (i / Math.max(1, values.length - 1)) * 0.7}
          />
        );
      })}
    </svg>
  );
}

// ── Meter ───────────────────────────────────────────────────────────────────

/** Satu rasio dalam bentuk paling ringkas — muat di dalam baris daftar. */
export function Meter({
  nilai, maksimum, warna = '#1d4ed8', label,
}: {
  nilai: number; maksimum: number; warna?: string; label?: string;
}) {
  const rasio = maksimum > 0 ? Math.min(1, nilai / maksimum) : 0;
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-500 truncate">{label}</span>
          <span className="text-[11px] font-bold text-slate-700 tabular-nums flex-shrink-0">
            {nilai}<span className="text-slate-400">/{maksimum}</span>
          </span>
        </div>
      )}
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full"
          style={{ width: `${rasio * 100}%`, background: warna, transition: 'width .5s ease' }} />
      </div>
    </div>
  );
}

// ── Lencana tren ────────────────────────────────────────────────────────────

/**
 * Selisih terhadap periode sebelumnya. "82%" tidak berarti apa-apa sampai
 * diketahui bulan lalu berapa.
 *
 * `turunItuBaik` untuk metrik yang justru bagus kalau mengecil — meeting gagal
 * GPS, laporan telat. Tanpa itu, penurunan yang bagus akan diwarnai merah.
 */
export function LencanaTren({
  delta, turunItuBaik = false, akhiran = '%',
}: {
  delta: number; turunItuBaik?: boolean; akhiran?: string;
}) {
  const abs = Math.abs(delta);
  if (abs < 0.05) {
    return <span className="text-[10px] text-slate-400 font-semibold">— 0{akhiran}</span>;
  }
  const baik = turunItuBaik ? delta < 0 : delta > 0;
  return (
    <span
      className="text-[10px] font-bold flex-shrink-0 tabular-nums"
      style={{ color: baik ? '#008300' : '#e34948' }}
      title={`${baik ? 'Membaik' : 'Memburuk'} ${abs.toFixed(1)}${akhiran} dibanding periode sebelumnya`}
    >
      {delta > 0 ? '▲' : '▼'} {abs.toFixed(1)}{akhiran}
    </span>
  );
}

// ── Judul kartu ─────────────────────────────────────────────────────────────

export function JudulKartu({ ikon, children }: { ikon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
      {ikon}
      {children}
    </p>
  );
}
