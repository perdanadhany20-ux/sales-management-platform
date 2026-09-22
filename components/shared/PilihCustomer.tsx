'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * components/shared/PilihCustomer.tsx — isian customer dengan saran dari data
 * yang sudah ada.
 *
 * Bentuknya ketik-bebas, BUKAN dropdown tertutup, dan itu disengaja: Sales
 * sering bertemu calon pelanggan yang memang belum ada di database, dan
 * memaksa mereka membuat baris customer dulu lewat menu lain akan membuat
 * laporan harian tidak jadi diisi sama sekali. Nama tetap disimpan apa adanya
 * sebagai teks; `customer_id` ikut terisi HANYA bila namanya benar-benar
 * cocok dengan baris yang sudah ada — sehingga riwayat satu pelanggan tetap
 * menyatu tanpa memaksa siapa pun memelihara data master lebih dulu.
 */

export interface Customer { id: string; name: string }

export function PilihCustomer({
  id, nilai, onUbah, invalid, disabled, placeholder = 'Nama perusahaan / instansi',
}: {
  id?: string;
  nilai: { customer_id: string | null; customer_name: string };
  onUbah: (v: { customer_id: string | null; customer_name: string }) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [saran, setSaran] = useState<Customer[]>([]);
  const [buka, setBuka] = useState(false);
  const wadahRef = useRef<HTMLDivElement>(null);

  // Pencarian ditunda 250 ms sesudah ketukan terakhir. Tanpa jeda ini,
  // mengetik "PT Sumber Makmur" mengirim 16 query — persis pemborosan yang
  // §68 minta dihindari.
  useEffect(() => {
    const kata = nilai.customer_name.trim();
    if (kata.length < 2) { setSaran([]); return; }

    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('sm_customers')
        .select('id, name')
        .ilike('name', `%${kata}%`)
        .limit(6);
      setSaran(data ?? []);
    }, 250);

    return () => clearTimeout(timer);
  }, [nilai.customer_name]);

  useEffect(() => {
    function klikLuar(e: MouseEvent) {
      if (!wadahRef.current?.contains(e.target as Node)) setBuka(false);
    }
    document.addEventListener('mousedown', klikLuar);
    return () => document.removeEventListener('mousedown', klikLuar);
  }, []);

  const cocokPersis = saran.find(
    (s) => s.name.trim().toLowerCase() === nilai.customer_name.trim().toLowerCase(),
  );

  return (
    <div ref={wadahRef} className="relative">
      <input
        id={id}
        type="text"
        value={nilai.customer_name}
        disabled={disabled}
        aria-invalid={invalid}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setBuka(true)}
        onChange={(e) => {
          const nama = e.target.value;
          const cocok = saran.find((s) => s.name.trim().toLowerCase() === nama.trim().toLowerCase());
          // customer_id dilepas setiap kali teksnya berubah dan tidak lagi
          // cocok persis. Tanpa itu, mengganti nama setelah memilih dari saran
          // akan menyimpan nama baru yang masih menunjuk pelanggan lama.
          onUbah({ customer_name: nama, customer_id: cocok?.id ?? null });
          setBuka(true);
        }}
        className="w-full rounded-kontrol border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800
                   placeholder:text-slate-400 outline-none transition-colors
                   focus:border-aksen-600 focus:ring-2 focus:ring-aksen-600/15
                   disabled:bg-slate-50
                   aria-[invalid=true]:border-[#e34948]"
      />

      {buka && saran.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white rounded-kontrol shadow-dropdown border border-slate-200 py-1 max-h-52 overflow-y-auto">
          {saran.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  onUbah({ customer_id: s.id, customer_name: s.name });
                  setBuka(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-aksen-50 transition-colors"
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {nilai.customer_name.trim().length >= 2 && !cocokPersis && (
        <p className="text-[10.5px] text-slate-400 mt-1">
          Pelanggan baru — akan ditambahkan ke daftar saat disimpan.
        </p>
      )}
    </div>
  );
}

/**
 * Pastikan baris customer ada, lalu kembalikan id-nya.
 *
 * Indeks unik pada `lower(trim(name))` (migrasi 002) yang menjadikan ini aman
 * dari lomba antar-pengguna: dua Sales yang menyimpan "PT Maju" pada detik
 * yang sama tidak menghasilkan dua baris — yang kedua kena konflik, lalu
 * dibaca ulang di bawah. Itulah sebabnya langkah ini tidak cukup dikerjakan
 * dengan "cek dulu, baru sisipkan".
 */
export async function pastikanCustomer(
  nama: string,
  idAda: string | null,
): Promise<string | null> {
  if (idAda) return idAda;

  const bersih = nama.trim();
  if (!bersih) return null;

  const { data: baru, error } = await supabase
    .from('sm_customers')
    .insert({ name: bersih })
    .select('id')
    .single();

  if (!error && baru) return baru.id;

  const { data: lama } = await supabase
    .from('sm_customers')
    .select('id')
    .ilike('name', bersih)
    .maybeSingle();

  return lama?.id ?? null;
}
