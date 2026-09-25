'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, Circle } from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * components/shared/PetaLokasi.tsx — peta interaktif untuk menentukan titik
 * acuan GPS sebuah lokasi meeting.
 *
 * Menggantikan pasangan lat/lng yang HANYA bisa diketik manual + pratinjau
 * peta statis (iframe, tak bisa disentuh). Dua kelemahan itu berarti admin
 * harus tahu koordinat sebuah tempat SEBELUM membuka formulir ini — padahal
 * yang biasanya ia tahu justru sebaliknya: namanya, bukan angkanya. Peta ini
 * membalik urutannya: ketik alamat untuk MENEMUKAN koordinatnya, atau klik
 * langsung di peta untuk MENUNJUKNYA.
 *
 * Leaflet dipilih mengikuti FieldServices Platform (baseline kedua), yang
 * sudah memakainya untuk kebutuhan identik. Diimpor dinamis oleh pemanggil
 * (`next/dynamic` dengan `ssr:false`) karena Leaflet menyentuh `window` saat
 * dimuat — merender di server akan gagal.
 */

export interface HasilPencarian {
  label: string;
  lat: number;
  lng: number;
}

export function PetaLokasi({
  lat, lng, radiusM, onUbahTitik,
}: {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  onUbahTitik: (lat: number, lng: number) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const petaRef = useRef<LeafletMap | null>(null);
  const penandaRef = useRef<Marker | null>(null);
  const lingkaranRef = useRef<Circle | null>(null);
  const onUbahRef = useRef(onUbahTitik);
  onUbahRef.current = onUbahTitik;

  const [cari, setCari] = useState('');
  const [hasil, setHasil] = useState<HasilPencarian[]>([]);
  const [mencari, setMencari] = useState(false);
  const [galatCari, setGalatCari] = useState<string | null>(null);

  // Jakarta sebagai titik tengah bawaan saat belum ada koordinat sama sekali
  // — jauh lebih berguna daripada (0,0) yang jatuh di Samudra Atlantik.
  const pusatBawaan: [number, number] = [-6.2088, 106.8456];

  useEffect(() => {
    let batal = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (batal || !divRef.current || petaRef.current) return;

      // Ikon bawaan Leaflet menunjuk ke jalur gambar relatif yang tidak
      // pernah cocok dengan cara Next.js membundel aset — tanpa ini, penanda
      // tampil sebagai kotak biru rusak alih-alih pin merah. Diarahkan ke
      // CDN yang sama persis dengan versi paket yang terpasang.
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const peta = L.map(divRef.current, {
        center: lat != null && lng != null ? [lat, lng] : pusatBawaan,
        zoom: lat != null && lng != null ? 16 : 11,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(peta);

      // Klik di mana pun pada peta memindahkan titik ke situ — cara paling
      // langsung menunjuk lokasi tanpa perlu tahu koordinatnya sama sekali.
      peta.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        onUbahRef.current(
          Number(e.latlng.lat.toFixed(7)),
          Number(e.latlng.lng.toFixed(7)),
        );
      });

      petaRef.current = peta;

      if (lat != null && lng != null) {
        penandaRef.current = L.marker([lat, lng], { draggable: true }).addTo(peta);
        penandaRef.current.on('dragend', () => {
          const p = penandaRef.current!.getLatLng();
          onUbahRef.current(Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7)));
        });
        lingkaranRef.current = L.circle([lat, lng], {
          radius: radiusM, color: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 0.12, weight: 1.5,
        }).addTo(peta);
      }
    })();

    return () => {
      batal = true;
      petaRef.current?.remove();
      petaRef.current = null;
      penandaRef.current = null;
      lingkaranRef.current = null;
    };
    // Peta dibuat SEKALI saat dipasang. Perubahan lat/lng/radius sesudahnya
    // ditangani efek terpisah di bawah, yang menggeser penanda/lingkaran yang
    // sudah ada — membuat ulang seluruh peta pada setiap ketikan koordinat
    // akan membuang posisi zoom dan pan yang sedang dilihat orangnya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Titik berubah (lewat klik peta, drag penanda, hasil pencarian, atau
  // ketikan manual di kolom lat/lng) — penanda & lingkaran mengikuti tanpa
  // membuat ulang peta.
  useEffect(() => {
    (async () => {
      const peta = petaRef.current;
      if (!peta || lat == null || lng == null) return;
      const L = (await import('leaflet')).default;

      if (!penandaRef.current) {
        penandaRef.current = L.marker([lat, lng], { draggable: true }).addTo(peta);
        penandaRef.current.on('dragend', () => {
          const p = penandaRef.current!.getLatLng();
          onUbahRef.current(Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7)));
        });
      } else {
        penandaRef.current.setLatLng([lat, lng]);
      }

      if (!lingkaranRef.current) {
        lingkaranRef.current = L.circle([lat, lng], {
          radius: radiusM, color: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 0.12, weight: 1.5,
        }).addTo(peta);
      } else {
        lingkaranRef.current.setLatLng([lat, lng]);
        lingkaranRef.current.setRadius(radiusM);
      }

      peta.setView([lat, lng], Math.max(peta.getZoom(), 15));
    })();
  }, [lat, lng, radiusM]);

  // Pencarian alamat lewat Nominatim OpenStreetMap — tanpa kunci API, sama
  // seperti urlPetaKecil() yang sudah dipakai di lib/gps.ts. Ditunda 500 ms
  // supaya tidak mengirim satu permintaan per huruf yang diketik.
  useEffect(() => {
    const kata = cari.trim();
    if (kata.length < 3) { setHasil([]); return; }

    const timer = setTimeout(async () => {
      setMencari(true);
      setGalatCari(null);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=id&q=${encodeURIComponent(kata)}`,
          { headers: { 'Accept-Language': 'id' } },
        );
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
        setHasil(data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) })));
      } catch {
        setGalatCari('Pencarian gagal. Periksa koneksi lalu coba lagi.');
        setHasil([]);
      } finally {
        setMencari(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [cari]);

  function pilihHasil(h: HasilPencarian) {
    onUbahTitik(Number(h.lat.toFixed(7)), Number(h.lng.toFixed(7)));
    setCari('');
    setHasil([]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          type="text" value={cari} onChange={(e) => setCari(e.target.value)}
          placeholder="Ketik alamat atau nama tempat untuk mencari…"
          autoComplete="off"
          className="w-full rounded-kontrol border border-slate-300 bg-white px-3 py-2.5 text-sm
                     outline-none transition-colors placeholder:text-slate-400
                     focus:border-aksen-600 focus:ring-2 focus:ring-aksen-600/15"
        />
        {(hasil.length > 0 || mencari || galatCari) && (
          <div className="absolute z-[400] mt-1 w-full rounded-kontrol border border-slate-200 bg-white shadow-dropdown overflow-hidden">
            {mencari ? (
              <p className="px-3 py-2.5 text-[12px] text-slate-400">Mencari…</p>
            ) : galatCari ? (
              <p className="px-3 py-2.5 text-[12px] text-[#c93c3b]">{galatCari}</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {hasil.map((h, i) => (
                  <li key={i}>
                    <button
                      type="button" onClick={() => pilihHasil(h)}
                      className="w-full text-left px-3 py-2 text-[12px] text-slate-700 hover:bg-aksen-50 transition-colors border-b border-slate-100 last:border-0"
                    >
                      {h.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div
        ref={divRef}
        // z-0 mengunci peta di bawah modal & dropdown lain: pustaka peta
        // biasa memakai z-index tinggi untuk tombol zoom-nya sendiri, yang
        // tanpa ini bisa menembus ke atas elemen antarmuka lain.
        className="w-full h-72 rounded-kontrol border border-slate-200 overflow-hidden relative z-0"
      />

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Klik di peta untuk menunjuk titik, atau seret penanda yang sudah ada. Lingkaran biru
        menunjukkan radius yang akan dipakai memverifikasi kehadiran.
      </p>
    </div>
  );
}
