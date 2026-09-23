'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LABEL_PERAN, type Peran } from '@/lib/constants';
import { MENU_KEYS, LABEL_MENU, type MenuKey } from '@/lib/menu-akses';
import { PilihCari } from '@/components/shared/PilihCari';
import { Tombol, Lencana } from '@/components/shared/FormParts';
import { KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';

const PERAN: Peran[] = ['SALES', 'MANAGER', 'DIRECTOR', 'FINANCE', 'ADMIN'];

interface Pengguna { id: string; full_name: string; username: string; role: string }

/**
 * Hak Akses Menu — tier lisensi platform ini (§023).
 *
 * Dua lapis: default per PERAN (sm_role_menu) berlaku untuk semua akun
 * berperan itu, dan pengecualian per AKUN (sm_user_menu) yang begitu ada
 * satu baris pun, MENGGANTIKAN default perannya untuk akun itu — bukan
 * ditambahkan ke atasnya. Menu yang dihapus dari sini tidak sekadar
 * hilang dari sidebar: Shell.tsx juga memblokir halamannya kalau URL-nya
 * dibuka langsung.
 */
export function TabHakAkses() {
  const toast = useToast();

  const [roleMenu, setRoleMenu] = useState<Record<string, Set<string>>>({});
  const [pengguna, setPengguna] = useState<Pengguna[]>([]);
  const [userOverride, setUserOverride] = useState<Record<string, Set<string>>>({});
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);

  const [akunDipilih, setAkunDipilih] = useState('');
  const [draftAkun, setDraftAkun] = useState<Set<string> | null>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const [rm, um, us] = await Promise.all([
        supabase.from('sm_role_menu').select('role, menu_key'),
        supabase.from('sm_user_menu').select('user_id, menu_key'),
        fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (rm.error) throw new Error(rm.error.message);
      if (um.error) throw new Error(um.error.message);

      const rmPeta: Record<string, Set<string>> = {};
      for (const p of PERAN) rmPeta[p] = new Set();
      for (const row of rm.data ?? []) (rmPeta[row.role] ??= new Set()).add(row.menu_key);
      setRoleMenu(rmPeta);

      const umPeta: Record<string, Set<string>> = {};
      for (const row of um.data ?? []) (umPeta[row.user_id] ??= new Set()).add(row.menu_key);
      setUserOverride(umPeta);

      setPengguna((us.users ?? []) as Pengguna[]);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal memuat.');
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  async function ubahRoleMenu(role: string, kunci: MenuKey, aktif: boolean) {
    const id = `${role}:${kunci}`;
    setSibuk(id);
    const { error } = aktif
      ? await supabase.from('sm_role_menu').insert({ role, menu_key: kunci })
      : await supabase.from('sm_role_menu').delete().eq('role', role).eq('menu_key', kunci);
    setSibuk(null);
    if (error) { toast('galat', error.message); return; }
    setRoleMenu((p) => {
      const baru = { ...p, [role]: new Set(p[role]) };
      if (aktif) baru[role].add(kunci); else baru[role].delete(kunci);
      return baru;
    });
  }

  const akun = pengguna.find((u) => u.id === akunDipilih) ?? null;
  const punyaOverride = akunDipilih ? (userOverride[akunDipilih]?.size ?? 0) > 0 : false;

  function pilihAkun(id: string) {
    setAkunDipilih(id);
    const u = pengguna.find((x) => x.id === id);
    const ov = userOverride[id];
    if (ov && ov.size > 0) setDraftAkun(new Set(ov));
    else if (u) setDraftAkun(new Set(roleMenu[u.role] ?? []));
    else setDraftAkun(null);
  }

  async function simpanOverride() {
    if (!akunDipilih || !draftAkun) return;
    setSibuk('simpan-akun');
    try {
      const { error: galatHapus } = await supabase.from('sm_user_menu').delete().eq('user_id', akunDipilih);
      if (galatHapus) throw new Error(galatHapus.message);
      if (draftAkun.size > 0) {
        const { error: galatIsi } = await supabase.from('sm_user_menu')
          .insert([...draftAkun].map((menu_key) => ({ user_id: akunDipilih, menu_key })));
        if (galatIsi) throw new Error(galatIsi.message);
      }
      toast('sukses', 'Pengecualian akun disimpan.');
      void muat();
    } catch (err) {
      toast('galat', err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSibuk(null);
    }
  }

  async function hapusOverride() {
    if (!akunDipilih) return;
    setSibuk('hapus-akun');
    const { error } = await supabase.from('sm_user_menu').delete().eq('user_id', akunDipilih);
    setSibuk(null);
    if (error) { toast('galat', error.message); return; }
    toast('sukses', 'Pengecualian dihapus — akun ini kembali mengikuti default perannya.');
    if (akun) setDraftAkun(new Set(roleMenu[akun.role] ?? []));
    void muat();
  }

  const akunDenganOverride = useMemo(
    () => pengguna.filter((u) => (userOverride[u.id]?.size ?? 0) > 0),
    [pengguna, userOverride],
  );

  if (memuat) return <KerangkaBaris jumlah={4} />;
  if (galat) return <PanelGalat pesan={galat} onCoba={muat} />;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Default per peran ── */}
      <section className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Default per Peran</p>
        <p className="text-[12px] text-slate-500 mb-3 leading-relaxed">
          Menu yang tercentang tersedia untuk semua akun berperan itu, kecuali akun tersebut
          punya pengecualian sendiri di bagian bawah.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[560px]">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-2 py-2">Menu</th>
                {PERAN.map((p) => (
                  <th key={p} className="text-center text-[10px] font-bold text-slate-500 uppercase tracking-wide px-2 py-2">
                    {LABEL_PERAN[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MENU_KEYS.map((kunci) => (
                <tr key={kunci} className="border-t border-slate-100">
                  <td className="px-2 py-2 text-[12.5px] font-semibold text-slate-700">{LABEL_MENU[kunci]}</td>
                  {PERAN.map((p) => {
                    const aktif = roleMenu[p]?.has(kunci) ?? false;
                    const id = `${p}:${kunci}`;
                    return (
                      <td key={p} className="text-center px-2 py-2">
                        <input
                          type="checkbox" checked={aktif} disabled={sibuk === id}
                          onChange={(e) => void ubahRoleMenu(p, kunci, e.target.checked)}
                          className="w-4 h-4 accent-aksen-700 cursor-pointer disabled:opacity-40"
                          aria-label={`${LABEL_MENU[kunci]} untuk ${LABEL_PERAN[p]}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Pengecualian per akun ── */}
      <section className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Pengecualian per Akun</p>
        <p className="text-[12px] text-slate-500 mb-3 leading-relaxed">
          Untuk mengecualikan satu akun dari default perannya — mis. satu Sales tertentu
          diberi akses GP Calculation walau perannya umumnya tidak.
        </p>

        {akunDenganOverride.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {akunDenganOverride.map((u) => (
              <button key={u.id} type="button" onClick={() => pilihAkun(u.id)}
                className="inline-flex">
                <Lencana label={`${u.full_name} (kustom)`} color="#7c3aed" bg="#ede9fe" />
              </button>
            ))}
          </div>
        )}

        <div className="max-w-sm mb-3">
          <PilihCari
            nilai={akunDipilih} onUbah={pilihAkun}
            bolehKosong labelKosong="Pilih akun…"
            opsi={pengguna.map((u) => ({ value: u.id, label: `${u.full_name} (${LABEL_PERAN[u.role as Peran] ?? u.role})` }))}
          />
        </div>

        {akun && draftAkun && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {punyaOverride
                ? <Lencana label="Memakai daftar kustom" color="#7c3aed" bg="#ede9fe" />
                : <Lencana label={`Memakai default ${LABEL_PERAN[akun.role as Peran] ?? akun.role}`} color="#64748b" bg="#f1f5f9" />}
            </div>

            <div className="grid grid-cols-2 formulir:grid-cols-3 gap-2">
              {MENU_KEYS.map((kunci) => {
                const aktif = draftAkun.has(kunci);
                return (
                  <label key={kunci}
                    className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox" checked={aktif}
                      onChange={(e) => setDraftAkun((d) => {
                        const baru = new Set(d);
                        if (e.target.checked) baru.add(kunci); else baru.delete(kunci);
                        return baru;
                      })}
                      className="w-4 h-4 accent-aksen-700 cursor-pointer"
                    />
                    {LABEL_MENU[kunci]}
                  </label>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Tombol className="text-[12px] py-2" memuat={sibuk === 'simpan-akun'} onClick={simpanOverride}>
                Simpan sebagai Daftar Kustom
              </Tombol>
              {punyaOverride && (
                <Tombol rupa="kedua" className="text-[12px] py-2" memuat={sibuk === 'hapus-akun'} onClick={hapusOverride}>
                  Hapus Pengecualian
                </Tombol>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
