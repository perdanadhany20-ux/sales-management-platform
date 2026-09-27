import { LABEL_PAKET } from '@kontrak/kontrak.ts';
import { LicenseService } from '@/lib/license-service';
import { aksiPermintaan } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Panel kendali lisensi (§47). Bukan CRM: hanya perusahaan, deployment,
 * lisensi, paket, status, masa berlaku, jumlah fitur, dan pemeriksaan terakhir.
 */

const SARING = ['ACTIVE', 'PENDING', 'EXPIRING_SOON', 'EXPIRED', 'SUSPENDED', 'REVOKED'] as const;
const LABEL_SARING: Record<string, string> = {
  ACTIVE: 'Active', PENDING: 'Pending', EXPIRING_SOON: 'Expiring', EXPIRED: 'Expired', SUSPENDED: 'Suspended', REVOKED: 'Revoked',
};

function tgl(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function sisa(iso: string | null) {
  if (!iso) return '—';
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return h > 0 ? `${h}` : '0';
}

export default async function Dashboard({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  const [semua, menunggu] = await Promise.all([LicenseService.list(), LicenseService.pendingRequests()]);
  const status = SARING.includes(searchParams.status as typeof SARING[number]) ? searchParams.status : '';
  const q = (searchParams.q ?? '').trim().toLowerCase();

  const baris = semua.filter((l) =>
    (!status || l.status_efektif === status || (status === 'PENDING' && l.pending_request))
    && (!q || [l.company_name, l.deployment_code, l.license_code].some((v) => v.toLowerCase().includes(q))));

  return (
    <>
      <h1>Lisensi</h1>
      <p className="muted">{semua.length} deployment terdaftar · {menunggu.length} permintaan menunggu</p>

      {menunggu.length > 0 && (
        <section className="card">
          <h2>Permintaan menunggu persetujuan</h2>
          <table>
            <thead><tr><th>Perusahaan</th><th>Jenis</th><th>Paket</th><th>Durasi</th><th>Diajukan</th><th>Catatan</th><th /></tr></thead>
            <tbody>
              {menunggu.map((r) => {
                const d = r.deployments;
                const l = r.licenses;
                return (
                  <tr key={r.id}>
                    <td><b>{d?.company_name}</b><br /><span className="muted">{d?.deployment_code}</span></td>
                    <td>{r.kind}</td>
                    <td>{LABEL_PAKET[r.requested_package]}</td>
                    <td>{r.duration_days ? `${r.duration_days} hari` : '—'}</td>
                    <td>{tgl(r.requested_at)}<br /><span className="muted">{r.requested_by ?? ''}</span></td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{r.notes ?? ''}</td>
                    <td>
                      <form action={aksiPermintaan} className="inline">
                        <input type="hidden" name="request_id" value={r.id} />
                        <input type="hidden" name="license_code" value={l?.license_code ?? ''} />
                        <button className="primary" name="keputusan" value="approve">Approve</button>
                      </form>
                      <form action={aksiPermintaan} className="inline">
                        <input type="hidden" name="request_id" value={r.id} />
                        <input type="hidden" name="license_code" value={l?.license_code ?? ''} />
                        <input name="alasan" placeholder="Alasan (opsional)" maxLength={500} />
                        <button name="keputusan" value="reject">Reject</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="filters">
          <a href={`/?q=${encodeURIComponent(q)}`} className={!status ? 'on' : ''}>Semua</a>
          {SARING.map((s) => (
            <a key={s} href={`/?status=${s}&q=${encodeURIComponent(q)}`} className={status === s ? 'on' : ''}>{LABEL_SARING[s]}</a>
          ))}
          <form method="get" style={{ marginLeft: 'auto' }}>
            {status && <input type="hidden" name="status" value={status} />}
            <input name="q" defaultValue={q} placeholder="Cari perusahaan / deployment / lisensi" />
          </form>
        </div>
        <table>
          <thead>
            <tr><th>Perusahaan</th><th>Deployment</th><th>Lisensi</th><th>Paket</th><th>Status</th><th>Mulai</th><th>Berakhir</th><th>Sisa hari</th><th>Fitur</th><th>Pemeriksaan terakhir</th></tr>
          </thead>
          <tbody>
            {baris.map((l) => (
              <tr key={l.license_code}>
                <td><a href={`/l/${l.license_code}`}><b>{l.company_name}</b></a>{l.pending_request && <> <span className="badge PENDING">permintaan</span></>}</td>
                <td>{l.deployment_code}</td>
                <td>{l.license_code}</td>
                <td>{LABEL_PAKET[l.package]}</td>
                <td><span className={`badge ${l.status_efektif}`}>{l.status_efektif.replace('_', ' ')}</span></td>
                <td>{tgl(l.starts_at)}</td>
                <td>{tgl(l.expires_at)}</td>
                <td>{sisa(l.expires_at)}</td>
                <td>{l.jumlah_fitur}</td>
                <td>{l.last_verified_at ? new Date(l.last_verified_at).toLocaleString('id-ID') : '—'}</td>
              </tr>
            ))}
            {baris.length === 0 && <tr><td colSpan={10} className="muted">Tidak ada lisensi yang cocok.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
