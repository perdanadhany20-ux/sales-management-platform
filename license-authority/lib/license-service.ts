import crypto from 'crypto';
import {
  KUNCI_FITUR, adalahKunciFitur, adalahPaket, fiturDariPaket, normalisasiFitur, statusEfektif,
  type KunciFitur, type Paket, type RingkasanPermintaan,
} from '@kontrak/kontrak.ts';
import { hashKunciDeployment } from '@kontrak/tanda-tangan.ts';
import { db, rpc } from './db';
import {
  kirimKeDeveloper, papanPermintaan, teksHasil, teksKedaluwarsa, teksPermintaanBaru,
} from './telegram';
import type { HasilAksi, HasilVerifikasi, InfoLisensi, Pelaku } from './types';

export interface PermintaanMenunggu {
  id: string;
  kind: string;
  requested_package: Paket;
  requested_features: unknown;
  duration_days: number | null;
  notes: string | null;
  requested_by: string | null;
  requested_at: string;
  licenses: { license_code: string } | null;
  deployments: { deployment_code: string; company_name: string } | null;
}

export interface BarisAudit {
  id: number;
  action: string;
  previous_state: unknown;
  new_state: unknown;
  performed_by: string;
  performed_via: string;
  reason: string | null;
  created_at: string;
}

export type BarisDaftar = InfoLisensi & { status_efektif: string; jumlah_fitur: number; pending_request: string | null };

/**
 * LicenseService — SATU-SATUNYA jalur perubahan lisensi (§48).
 *
 *   Telegram APPROVE ─┐
 *                     ├─► LicenseService.approve() ─► la_approve_request() ─► DB + audit ─► notifikasi
 *   Web APPROVE ──────┘
 *
 * Aturan transisi, penguncian baris, dan idempotensi hidup di fungsi SQL
 * (migrasi 001). Layanan ini menurunkan peta fitur dari preset paket (kontrak
 * bersama) dan mengirim pemberitahuan Telegram setelah perubahan berhasil.
 */

async function beritahu(h: HasilAksi): Promise<HasilAksi> {
  if (h.ok && !h.duplicate && !h.unchanged) {
    const t = teksHasil(h);
    if (t) await kirimKeDeveloper(t);
  }
  return h;
}

function fiturUntuk(paket: Paket, custom: unknown): Record<KunciFitur, boolean> {
  return fiturDariPaket(paket, paket === 'CUSTOM' ? normalisasiFitur(custom) : undefined);
}

export const LicenseService = {
  /* ── Jalur deployment ───────────────────────────────────────────────── */

  async verify(deployment: string, license: string, kunci: string, versi: string): Promise<HasilVerifikasi> {
    return rpc<HasilVerifikasi>('la_verify', {
      p_deployment: deployment, p_license: license, p_key_hash: hashKunciDeployment(kunci), p_app_version: versi,
    });
  },

  async createRequest(
    deployment: string, license: string, kunci: string,
    m: { kind: string; requested_package: Paket; requested_features?: unknown; duration_days: number | null; notes: string | null; requested_by: string | null },
  ): Promise<{ ok: boolean; code?: string; request_id?: string; license?: InfoLisensi }> {
    const h = await rpc<{ ok: boolean; code?: string; request_id?: string; license?: InfoLisensi }>('la_create_request', {
      p_deployment: deployment, p_license: license, p_key_hash: hashKunciDeployment(kunci),
      p_kind: m.kind, p_package: m.requested_package,
      p_features: m.requested_package === 'CUSTOM' ? normalisasiFitur(m.requested_features) : null,
      p_duration: m.duration_days, p_notes: m.notes, p_requested_by: m.requested_by,
    });
    if (h.ok && h.request_id && h.license) {
      const msg = await kirimKeDeveloper(
        teksPermintaanBaru(h.license, { id: h.request_id, ...m }),
        papanPermintaan(h.request_id),
      );
      if (msg) await db().from('license_requests').update({ telegram_message_id: msg }).eq('id', h.request_id);
    }
    return h;
  },

  async cancelRequest(deployment: string, license: string, kunci: string, requestId: string) {
    return rpc<{ ok: boolean; code?: string }>('la_cancel_request', {
      p_deployment: deployment, p_license: license, p_key_hash: hashKunciDeployment(kunci), p_request: requestId,
    });
  },

  /* ── Tindakan developer ─────────────────────────────────────────────── */

  async approve(requestId: string, pelaku: Pelaku, kunciAksi: string | null = null): Promise<HasilAksi> {
    const { data: r } = await db().from('license_requests')
      .select('kind, requested_package, requested_features').eq('id', requestId).maybeSingle();
    if (!r) return { ok: false, code: 'REQUEST_NOT_FOUND' };
    const fitur = r.kind === 'EXTENSION' ? {} : fiturUntuk(r.requested_package as Paket, r.requested_features);
    return beritahu(await rpc<HasilAksi>('la_approve_request', {
      p_request: requestId, p_features: fitur, p_actor: pelaku.nama, p_via: pelaku.via, p_action_key: kunciAksi,
    }));
  },

  async reject(requestId: string, alasan: string | null, pelaku: Pelaku, kunciAksi: string | null = null): Promise<HasilAksi> {
    return beritahu(await rpc<HasilAksi>('la_reject_request', {
      p_request: requestId, p_reason: alasan, p_actor: pelaku.nama, p_via: pelaku.via, p_action_key: kunciAksi,
    }));
  },

  async extend(licenseCode: string, hari: number, pelaku: Pelaku, kunciAksi: string | null = null, alasan: string | null = null): Promise<HasilAksi> {
    return beritahu(await rpc<HasilAksi>('la_extend', {
      p_license_code: licenseCode, p_days: hari, p_actor: pelaku.nama, p_via: pelaku.via,
      p_action_key: kunciAksi, p_reason: alasan,
    }));
  },

  async suspend(licenseCode: string, pelaku: Pelaku, kunciAksi: string | null = null, alasan: string | null = null) {
    return this.setStatus(licenseCode, 'SUSPEND', pelaku, kunciAksi, alasan);
  },
  async reactivate(licenseCode: string, pelaku: Pelaku, kunciAksi: string | null = null) {
    return this.setStatus(licenseCode, 'REACTIVATE', pelaku, kunciAksi, null);
  },
  async revoke(licenseCode: string, pelaku: Pelaku, kunciAksi: string | null = null, alasan: string | null = null) {
    return this.setStatus(licenseCode, 'REVOKE', pelaku, kunciAksi, alasan);
  },

  async setStatus(licenseCode: string, aksi: 'SUSPEND' | 'REACTIVATE' | 'REVOKE', pelaku: Pelaku, kunciAksi: string | null, alasan: string | null): Promise<HasilAksi> {
    return beritahu(await rpc<HasilAksi>('la_set_status', {
      p_license_code: licenseCode, p_action: aksi, p_actor: pelaku.nama, p_via: pelaku.via,
      p_action_key: kunciAksi, p_reason: alasan,
    }));
  },

  /** Upgrade/downgrade ke preset paket. Data pelanggan tidak disentuh (§45). */
  async setPackage(licenseCode: string, paket: Paket, pelaku: Pelaku, kunciAksi: string | null = null, custom?: unknown): Promise<HasilAksi> {
    if (!adalahPaket(paket)) return { ok: false, code: 'INVALID_PACKAGE' };
    return beritahu(await rpc<HasilAksi>('la_set_package', {
      p_license_code: licenseCode, p_package: paket, p_features: fiturUntuk(paket, custom),
      p_actor: pelaku.nama, p_via: pelaku.via, p_action_key: kunciAksi, p_reason: null,
    }));
  },

  /** Ubah satu fitur. Lisensi otomatis menjadi CUSTOM — paket hanyalah preset (§9). */
  async setFeature(licenseCode: string, fitur: string, aktif: boolean, pelaku: Pelaku, kunciAksi: string | null = null): Promise<HasilAksi> {
    if (!adalahKunciFitur(fitur)) return { ok: false, code: 'INVALID_FEATURE' };
    const info = await this.get(licenseCode);
    if (!info) return { ok: false, code: 'LICENSE_NOT_FOUND' };
    const peta = { ...normalisasiFitur(info.features), [fitur]: aktif };
    return beritahu(await rpc<HasilAksi>('la_set_package', {
      p_license_code: licenseCode, p_package: 'CUSTOM', p_features: peta,
      p_actor: pelaku.nama, p_via: pelaku.via, p_action_key: kunciAksi, p_reason: `${fitur}=${aktif ? 'on' : 'off'}`,
    }));
  },

  /* ── Registrasi (§41) ───────────────────────────────────────────────── */

  async register(m: {
    company: string; environment: 'production' | 'staging' | 'development';
    paket: Paket; hari: number; aktifkan: boolean; custom?: unknown;
  }, pelaku: Pelaku): Promise<{ ok: boolean; code?: string; deployment_code?: string; license_code?: string; deployment_key?: string }> {
    // Kunci deployment hanya ada di keluaran fungsi ini — pusat menyimpan hash-nya.
    const kunci = crypto.randomBytes(32).toString('base64url');
    const h = await rpc<{ ok: boolean; deployment_code: string; license_code: string }>('la_register_deployment', {
      p_company: m.company, p_environment: m.environment, p_key_hash: hashKunciDeployment(kunci),
      p_package: m.paket, p_features: fiturUntuk(m.paket, m.custom), p_duration_days: m.hari,
      p_activate: m.aktifkan, p_actor: pelaku.nama, p_via: pelaku.via,
    });
    return { ...h, deployment_key: h.ok ? kunci : undefined };
  },

  /* ── Baca ───────────────────────────────────────────────────────────── */

  /** Cari lisensi dari kode lisensi ATAU kode deployment. */
  async get(kode: string): Promise<InfoLisensi | null> {
    const k = kode.trim().toUpperCase();
    const { data: l } = await db().from('licenses').select('id').eq('license_code', k).maybeSingle();
    let id = l?.id as string | undefined;
    if (!id) {
      const { data: d } = await db().from('deployments').select('id').eq('deployment_code', k).maybeSingle();
      if (d) {
        const { data: l2 } = await db().from('licenses').select('id').eq('deployment_id', d.id).maybeSingle();
        id = l2?.id;
      }
    }
    if (!id) return null;
    return rpc<InfoLisensi>('la_license_info', { p_license: id });
  },

  async list(): Promise<BarisDaftar[]> {
    const { data: semua } = await db().from('licenses').select('id').order('created_at', { ascending: false }).limit(500);
    const { data: menunggu } = await db().from('license_requests').select('id, license_id').eq('status', 'PENDING_APPROVAL');
    const peta = new Map(((menunggu ?? []) as { id: string; license_id: string }[]).map((r) => [r.license_id, r.id]));
    const hasil: BarisDaftar[] = [];
    for (const r of (semua ?? []) as { id: string }[]) {
      const info = await rpc<InfoLisensi>('la_license_info', { p_license: r.id });
      hasil.push({
        ...info,
        status_efektif: statusEfektif(info.status, info.expires_at, new Date(), info.warning_days),
        jumlah_fitur: KUNCI_FITUR.filter((k) => info.features?.[k]).length,
        pending_request: peta.get(r.id) ?? null,
      });
    }
    return hasil;
  },

  async pendingRequests(): Promise<PermintaanMenunggu[]> {
    const { data } = await db().from('license_requests')
      .select('id, kind, requested_package, requested_features, duration_days, notes, requested_by, requested_at, licenses(license_code), deployments(deployment_code, company_name)')
      .eq('status', 'PENDING_APPROVAL').order('requested_at');
    return (data ?? []) as unknown as PermintaanMenunggu[];
  },

  async auditLog(licenseCode: string): Promise<BarisAudit[]> {
    const { data: l } = await db().from('licenses').select('id').eq('license_code', licenseCode).maybeSingle();
    if (!l) return [];
    const { data } = await db().from('license_audit_logs')
      .select('id, action, previous_state, new_state, performed_by, performed_via, reason, created_at')
      .eq('license_id', l.id).order('created_at', { ascending: false }).limit(100);
    return (data ?? []) as BarisAudit[];
  },

  async requestsFor(licenseCode: string): Promise<RingkasanPermintaan[]> {
    const { data: l } = await db().from('licenses').select('id').eq('license_code', licenseCode).maybeSingle();
    if (!l) return [];
    const { data } = await db().from('license_requests')
      .select('id, kind, requested_package, duration_days, status, reason, notes, requested_at, processed_at')
      .eq('license_id', l.id).order('requested_at', { ascending: false }).limit(20);
    return (data ?? []) as RingkasanPermintaan[];
  },

  /** Peringatan 30/7 hari & kedaluwarsa — tiap tahap sekali (§24). */
  async runExpiryNotices(): Promise<number> {
    const daftar = await rpc<(InfoLisensi & { stage: string })[]>('la_expiry_notices', {});
    for (const l of daftar) await kirimKeDeveloper(teksKedaluwarsa(l));
    return daftar.length;
  },
};
