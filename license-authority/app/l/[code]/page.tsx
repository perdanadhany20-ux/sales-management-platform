import crypto from 'crypto';
import { notFound } from 'next/navigation';
import { LABEL_PAKET, statusEfektif } from '@kontrak/kontrak.ts';
import { PilihPaketFitur } from '../../PilihPaketFitur';
import { LicenseService } from '@/lib/license-service';
import { aksiLisensi } from '../../actions';

export const dynamic = 'force-dynamic';

function tgl(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

/** Setiap formulir mendapat aksi_id baru per render → kiriman ganda aman (§49). */
function Tersembunyi({ lic, aksi }: { lic: string; aksi: string }) {
  return (
    <>
      <input type="hidden" name="license_code" value={lic} />
      <input type="hidden" name="aksi" value={aksi} />
      <input type="hidden" name="aksi_id" value={crypto.randomUUID()} />
    </>
  );
}

export default async function DetailLisensi({ params, searchParams }: { params: { code: string }; searchParams: { pesan?: string } }) {
  const info = await LicenseService.get(decodeURIComponent(params.code));
  if (!info) notFound();
  const [audit, permintaan] = await Promise.all([
    LicenseService.auditLog(info.license_code), LicenseService.requestsFor(info.license_code),
  ]);
  const status = statusEfektif(info.status, info.expires_at, new Date(), info.warning_days);
  const lic = info.license_code;
  const dicabut = info.status === 'REVOKED';

  return (
    <>
      <p><a href="/">← Semua lisensi</a></p>
      {searchParams.pesan && <div className="notice">{searchParams.pesan}</div>}
      <h1>{info.company_name} <span className={`badge ${status}`}>{status.replace('_', ' ')}</span></h1>

      <section className="card">
        <dl className="grid kv">
          <div><dt>Deployment</dt><dd>{info.deployment_code}</dd></div>
          <div><dt>Lisensi</dt><dd>{lic}</dd></div>
          <div><dt>Paket</dt><dd>{LABEL_PAKET[info.package]} ({info.license_type})</dd></div>
          <div><dt>Diterbitkan</dt><dd>{tgl(info.issued_at)}</dd></div>
          <div><dt>Mulai</dt><dd>{tgl(info.starts_at)}</dd></div>
          <div><dt>Berakhir</dt><dd>{tgl(info.expires_at)}</dd></div>
          <div><dt>Tenggang</dt><dd>{info.grace_period_days} hari</dd></div>
          <div><dt>Pemeriksaan terakhir</dt><dd>{tgl(info.last_verified_at)}</dd></div>
          <div><dt>Versi aplikasi</dt><dd>{info.application_version ?? '—'}</dd></div>
        </dl>
      </section>

      {!dicabut && (
        <section className="card">
          <h2>Tindakan</h2>
          {[30, 90, 365].map((h) => (
            <form key={h} action={aksiLisensi} className="inline">
              <Tersembunyi lic={lic} aksi="extend" />
              <input type="hidden" name="hari" value={h} />
              <button>+{h === 365 ? '1 tahun' : `${h} hari`}</button>
            </form>
          ))}
          {info.status === 'SUSPENDED' ? (
            <form action={aksiLisensi} className="inline">
              <Tersembunyi lic={lic} aksi="reactivate" />
              <button className="primary">Aktifkan kembali</button>
            </form>
          ) : (
            <form action={aksiLisensi} className="inline">
              <Tersembunyi lic={lic} aksi="suspend" />
              <input name="alasan" placeholder="Alasan penangguhan" maxLength={500} />
              <button>Tangguhkan</button>
            </form>
          )}
          <form action={aksiLisensi} className="inline">
            <Tersembunyi lic={lic} aksi="revoke" />
            <input name="konfirmasi" placeholder={`ketik ${lic}`} />
            <input name="alasan" placeholder="Alasan" maxLength={500} />
            <button className="danger">Cabut permanen</button>
          </form>
        </section>
      )}

      {!dicabut && (
        <section className="card">
          <h2>Paket &amp; fitur</h2>
          <form action={aksiLisensi}>
            <Tersembunyi lic={lic} aksi="package" />
            <PilihPaketFitur awalPaket={info.package} awalFitur={info.features} />
            <p><button className="primary">Simpan paket/fitur</button></p>
          </form>
          <p className="muted">Downgrade hanya menutup akses. Data pelanggan tidak pernah dihapus.</p>
        </section>
      )}

      <section className="card">
        <h2>Permintaan</h2>
        <table>
          <thead><tr><th>Diajukan</th><th>Jenis</th><th>Paket</th><th>Durasi</th><th>Status</th><th>Alasan</th></tr></thead>
          <tbody>
            {permintaan.map((r) => (
              <tr key={r.id}><td>{tgl(r.requested_at)}</td><td>{r.kind}</td><td>{LABEL_PAKET[r.requested_package]}</td>
                <td>{r.duration_days ?? '—'}</td><td>{r.status}</td><td>{r.reason ?? ''}</td></tr>
            ))}
            {permintaan.length === 0 && <tr><td colSpan={6} className="muted">Belum ada.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Audit</h2>
        <table>
          <thead><tr><th>Waktu</th><th>Tindakan</th><th>Oleh</th><th>Lewat</th><th>Alasan</th></tr></thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}><td>{tgl(a.created_at)}</td><td>{a.action}</td>
                <td>{a.performed_by}</td><td>{a.performed_via}</td>
                <td style={{ whiteSpace: 'normal' }}>{a.reason ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
