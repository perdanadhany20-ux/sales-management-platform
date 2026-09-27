'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { KUNCI_FITUR, LABEL_PAKET, PAKET, REGISTRY_FITUR } from '@kontrak/kontrak.ts';
import { aksiRegistrasi, type HasilRegistrasi } from '../actions';

function Kirim() {
  const { pending } = useFormStatus();
  return <button className="primary" disabled={pending}>{pending ? 'Memproses…' : 'Registrasi'}</button>;
}

export function FormRegistrasi() {
  const [hasil, aksi] = useFormState<HasilRegistrasi, FormData>(aksiRegistrasi, {});

  if (hasil.deployment_key) {
    return (
      <div className="card">
        <h2>✓ Deployment terdaftar</h2>
        <div className="notice">
          Salin nilai di bawah ke Environment Variables proyek Vercel pelanggan <b>sekarang</b>. Kunci deployment
          tidak akan ditampilkan lagi — pusat hanya menyimpan hash-nya.
        </div>
        <pre className="secret">{[
          `LICENSE_AUTHORITY_URL=${typeof window !== 'undefined' ? window.location.origin : ''}`,
          `LICENSE_DEPLOYMENT_ID=${hasil.deployment_code}`,
          `LICENSE_ID=${hasil.license_code}`,
          `LICENSE_DEPLOYMENT_KEY=${hasil.deployment_key}`,
          'LICENSE_PUBLIC_KEY=<kunci publik dari npm run keys>',
        ].join('\n')}</pre>
        <p><a href={`/l/${hasil.license_code}`}>Buka lisensi {hasil.license_code} →</a></p>
      </div>
    );
  }

  return (
    <form action={aksi} className="card">
      {hasil.galat && <div className="notice">{hasil.galat}</div>}
      <div className="grid">
        <label>Nama perusahaan<br /><input name="company" required minLength={2} maxLength={160} placeholder="PT ABC" /></label>
        <label>Lingkungan<br />
          <select name="environment" defaultValue="production">
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
          </select>
        </label>
        <label>Paket awal<br />
          <select name="paket" defaultValue="STARTER">
            {PAKET.map((p) => <option key={p} value={p}>{LABEL_PAKET[p]}</option>)}
          </select>
        </label>
        <label>Durasi (hari)<br /><input name="hari" type="number" min={1} max={3660} defaultValue={365} required /></label>
      </div>
      <p className="muted">Fitur CUSTOM (hanya dipakai bila paket = Custom):</p>
      <div className="grid">
        {KUNCI_FITUR.map((k) => (
          <label key={k}><input type="checkbox" name={`fitur_${k}`} /> {REGISTRY_FITUR.find((f) => f.key === k)?.display_name}</label>
        ))}
      </div>
      <p><label><input type="checkbox" name="aktifkan" /> Langsung aktifkan (tanpa menunggu permintaan dari Admin pelanggan)</label></p>
      <Kirim />
    </form>
  );
}
