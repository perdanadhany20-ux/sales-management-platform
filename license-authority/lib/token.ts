import { normalisasiFitur, type MuatanLisensi } from '@kontrak/kontrak.ts';
import { tandatangani } from '@kontrak/tanda-tangan.ts';
import type { InfoLisensi } from './types';
import type { RingkasanPermintaan } from '@kontrak/kontrak.ts';

/**
 * Susun dan tandatangani muatan lisensi (§14, §15). Hanya berisi yang
 * dibutuhkan deployment — tidak ada ID internal, hash kunci, atau data pusat lain.
 */
export function terbitkanToken(info: InfoLisensi, requests: RingkasanPermintaan[], nonce: string): string {
  const privat = process.env.LICENSE_PRIVATE_KEY;
  if (!privat) throw new Error('LICENSE_PRIVATE_KEY belum diset.');

  const muatan: MuatanLisensi = {
    v: 1,
    deployment_id: info.deployment_code,
    license_id: info.license_code,
    company_name: info.company_name,
    status: info.status,
    package: info.package,
    license_type: info.license_type,
    issued_at: info.issued_at,
    starts_at: info.starts_at,
    expires_at: info.expires_at,
    grace_period_days: info.grace_period_days,
    warning_days: info.warning_days,
    features: normalisasiFitur(info.features),
    min_version: info.min_version,
    max_version: info.max_version,
    requests,
    verified_at: new Date().toISOString(),
    nonce,
  };
  return tandatangani(muatan, privat);
}
