'use client';

import { useState } from 'react';
import {
  KUNCI_FITUR, LABEL_PAKET, PAKET, REGISTRY_FITUR, fiturDariPaket, type KunciFitur, type Paket,
} from '@kontrak/kontrak.ts';

/**
 * Pilihan paket + fitur. Paket selain Custom adalah PRESET: fiturnya langsung
 * tercentang sesuai matriks paket dan tidak bisa diubah. Hanya Custom yang
 * fiturnya dipilih satu per satu. Nama input (`paket`, `fitur_<key>`) sama
 * dengan yang dibaca server action.
 */
export function PilihPaketFitur({ awalPaket = 'STARTER', awalFitur }: {
  awalPaket?: Paket;
  awalFitur?: Partial<Record<KunciFitur, boolean>>;
}) {
  const [paket, setPaket] = useState<Paket>(awalPaket);
  const [custom, setCustom] = useState<Record<KunciFitur, boolean>>(
    fiturDariPaket('CUSTOM', awalFitur ?? fiturDariPaket(awalPaket)),
  );
  const isCustom = paket === 'CUSTOM';
  const tampil = isCustom ? custom : fiturDariPaket(paket);

  function gantiPaket(p: Paket) {
    // Beralih ke Custom mulai dari fitur paket sebelumnya, bukan dari kosong.
    if (p === 'CUSTOM' && !isCustom) setCustom(fiturDariPaket(paket));
    setPaket(p);
  }

  return (
    <>
      <label>Paket<br />
        <select name="paket" value={paket} onChange={(e) => gantiPaket(e.target.value as Paket)}>
          {PAKET.map((p) => <option key={p} value={p}>{LABEL_PAKET[p]}</option>)}
        </select>
      </label>
      <p className="muted">
        {isCustom
          ? 'Custom: centang fitur yang diberikan.'
          : `Fitur paket ${LABEL_PAKET[paket]} (otomatis sesuai paket — pilih Custom untuk mengatur sendiri):`}
      </p>
      <div className="grid">
        {KUNCI_FITUR.map((k) => (
          <label key={k} style={{ opacity: isCustom || tampil[k] ? 1 : 0.45 }}>
            <input
              type="checkbox"
              name={`fitur_${k}`}
              checked={tampil[k]}
              disabled={!isCustom}
              onChange={(e) => setCustom((c) => ({ ...c, [k]: e.target.checked }))}
            />{' '}
            {REGISTRY_FITUR.find((f) => f.key === k)?.display_name}
          </label>
        ))}
      </div>
    </>
  );
}
