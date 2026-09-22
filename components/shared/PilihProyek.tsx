'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { rupiahRingkas } from '@/lib/format';

/**
 * components/shared/PilihProyek.tsx — menautkan catatan ke sebuah proyek.
 *
 * Tiga jalan sekaligus, dan ketiganya perlu:
 *
 *   1. PILIH dari proyek yang sudah ada — inilah yang membuat pipeline,
 *      jadwal, meeting, laporan, dan GP Calculation satu proyek menyatu jadi
 *      satu ringkasan.
 *   2. BUAT proyek baru di tempat, tanpa berpindah halaman. Memaksa orang
 *      membuka menu lain di tengah pengisian formulir adalah cara paling
 *      pasti membuat formulirnya ditinggalkan.
 *   3. BIARKAN KOSONG. Ini bukan kelalaian melainkan pilihan yang sah:
 *      banyak catatan memang belum jelas menyangkut proyek yang mana, dan
 *      memaksanya ditentukan lebih dulu hanya akan menghasilkan proyek-proyek
 *      karangan yang mengotori ringkasan.
 *
 * Yang belum tertaut tetap tercatat dan tetap terhitung di modulnya sendiri;
 * ia hanya belum muncul di ringkasan proyek, dan bisa ditautkan kapan saja.
 */

export interface ProyekRingkas {
  id: string;
  kode: string;
  name: string;
  customer_name: string;
  status: string;
  nilai_pipeline?: number;
}

export function PilihProyek({
  id, nilai, onUbah, customerId, customerName, ownerId, disabled,
}: {
  id?: string;
  nilai: string | null;
  onUbah: (proyekId: string | null, proyek: ProyekRingkas | null) => void;
  /** Dipakai saat membuat proyek baru dari sini. */
  customerId?: string | null;
  customerName?: string;
  ownerId?: string;
  disabled?: boolean;
}) {
  const [daftar, setDaftar] = useState<ProyekRingkas[]>([]);
  const [terpilih, setTerpilih] = useState<ProyekRingkas | null>(null);
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState('');
  const [membuat, setMembuat] = useState(false);
  const [namaBaru, setNamaBaru] = useState('');
  const [galat, setGalat] = useState<string | null>(null);

  const wadahRef = useRef<HTMLDivElement>(null);

  const muat = useCallback(async (kata: string) => {
    let q = supabase
      .from('sm_proyek_ringkasan')
      .select('id, kode, name, customer_name, status, nilai_pipeline')
      .order('created_at', { ascending: false })
      .limit(12);

    if (kata.trim().length >= 2) {
      const k = kata.trim();
      q = q.or(`name.ilike.%${k}%,customer_name.ilike.%${k}%,kode.ilike.%${k}%`);
    }

    const { data } = await q;
    setDaftar((data ?? []) as ProyekRingkas[]);
  }, []);

  useEffect(() => {
    if (!buka) return;
    const t = setTimeout(() => void muat(cari), 250);
    return () => clearTimeout(t);
  }, [buka, cari, muat]);

  // Nama proyek yang sudah tertaut dimuat sekali supaya tombolnya menampilkan
  // nama, bukan UUID — termasuk saat formulir dibuka untuk menyunting.
  useEffect(() => {
    if (!nilai) { setTerpilih(null); return; }
    if (terpilih?.id === nilai) return;
    (async () => {
      const { data } = await supabase
        .from('sm_projects')
        .select('id, kode, name, customer_name, status')
        .eq('id', nilai).maybeSingle();
      if (data) setTerpilih(data as ProyekRingkas);
    })();
  }, [nilai, terpilih?.id]);

  useEffect(() => {
    function klikLuar(e: MouseEvent) {
      if (!wadahRef.current?.contains(e.target as Node)) { setBuka(false); setMembuat(false); }
    }
    document.addEventListener('mousedown', klikLuar);
    return () => document.removeEventListener('mousedown', klikLuar);
  }, []);

  function pilih(p: ProyekRingkas | null) {
    setTerpilih(p);
    onUbah(p?.id ?? null, p);
    setBuka(false);
    setMembuat(false);
    setCari('');
  }

  async function buatProyek() {
    const nama = namaBaru.trim();
    if (!nama || !ownerId) return;

    setGalat(null);
    const { data, error } = await supabase.from('sm_projects').insert({
      name: nama,
      customer_id: customerId ?? null,
      customer_name: (customerName ?? '').trim() || nama,
      owner_user_id: ownerId,
    }).select('id, kode, name, customer_name, status').single();

    if (error) { setGalat(error.message); return; }

    setNamaBaru('');
    pilih(data as ProyekRingkas);
  }

  return (
    <div ref={wadahRef} className="relative">
      <button
        type="button" id={id} disabled={disabled}
        onClick={() => setBuka((b) => !b)}
        aria-expanded={buka}
        className={`w-full flex items-center gap-2 border rounded-kontrol px-3.5 py-2.5 text-left
                    text-[13px] transition-colors
                    ${disabled
                      ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-white border-slate-200 hover:border-slate-300'}`}
      >
        <span aria-hidden="true" className="text-slate-400">📁</span>
        <span className="flex-1 min-w-0 truncate">
          {terpilih ? (
            <>
              <span className="font-semibold text-slate-800">{terpilih.name}</span>
              <span className="text-slate-400"> · {terpilih.kode}</span>
            </>
          ) : (
            <span className="text-slate-400">Tanpa proyek — boleh dikosongkan</span>
          )}
        </span>
        {terpilih && !disabled && (
          <span
            role="button" tabIndex={0} aria-label="Lepas tautan proyek"
            onClick={(e) => { e.stopPropagation(); pilih(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); pilih(null); } }}
            className="flex-shrink-0 text-slate-400 hover:text-[#e34948] text-[13px] px-1"
          >
            ✕
          </span>
        )}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"
          className={`flex-shrink-0 text-slate-400 transition-transform ${buka ? 'rotate-180' : ''}`}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {buka && (
        <div className="absolute z-40 left-0 right-0 top-[calc(100%+4px)] bg-white rounded-kartu
                        border border-slate-200 shadow-dropdown overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              value={cari} onChange={(e) => setCari(e.target.value)} autoFocus
              placeholder="Cari proyek, customer, atau kode…"
              aria-label="Cari proyek"
              className="w-full border border-slate-200 rounded-kontrol px-3 py-2 text-[13px]
                         outline-none focus:border-aksen-600"
            />
          </div>

          <ul className="max-h-[220px] overflow-y-auto">
            <li>
              <button type="button" onClick={() => pilih(null)}
                className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[12px] text-slate-500 border-b border-slate-100">
                — Tanpa proyek —
              </button>
            </li>
            {daftar.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => pilih(p)}
                  className="w-full text-left px-3.5 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <span className="block text-[13px] font-semibold text-slate-800 truncate">{p.name}</span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {p.customer_name} · {p.kode}
                    {p.nilai_pipeline ? ` · ${rupiahRingkas(p.nilai_pipeline)}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {daftar.length === 0 && (
              <li className="px-3.5 py-3 text-[12px] text-slate-400 text-center">
                {cari.trim().length >= 2 ? 'Tidak ada proyek yang cocok.' : 'Belum ada proyek.'}
              </li>
            )}
          </ul>

          {ownerId && (
            <div className="border-t border-slate-100 p-2 bg-slate-50/70">
              {membuat ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    value={namaBaru} onChange={(e) => setNamaBaru(e.target.value)} autoFocus
                    placeholder="Nama proyek baru"
                    aria-label="Nama proyek baru"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buatProyek(); } }}
                    className="w-full border border-slate-200 rounded-kontrol px-3 py-2 text-[13px]
                               outline-none focus:border-aksen-600 bg-white"
                  />
                  {galat && <p className="text-[11px] text-[#e34948]">{galat}</p>}
                  <div className="flex justify-end gap-1.5">
                    <button type="button" onClick={() => { setMembuat(false); setGalat(null); }}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 rounded-kecil">
                      Batal
                    </button>
                    <button type="button" onClick={buatProyek} disabled={!namaBaru.trim()}
                      className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-aksen-700 rounded-kecil
                                 hover:bg-aksen-800 disabled:opacity-50">
                      Buat &amp; Pilih
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button"
                  onClick={() => { setMembuat(true); setNamaBaru(cari.trim()); }}
                  className="w-full text-left px-2 py-1.5 text-[12px] font-semibold text-aksen-700 hover:bg-white rounded-kecil">
                  + Buat proyek baru{cari.trim() ? ` "${cari.trim()}"` : ''}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
