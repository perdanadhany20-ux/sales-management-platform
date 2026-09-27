import type { KunciFitur, Paket, RingkasanPermintaan, StatusDasar } from '@kontrak/kontrak.ts';

export type Via = 'telegram' | 'web' | 'api' | 'system';

export interface Pelaku {
  /** Identitas yang tercatat di audit, mis. `telegram:123456` atau `web:developer`. */
  nama: string;
  via: Via;
}

export interface InfoLisensi {
  license_code: string;
  deployment_code: string;
  company_name: string;
  package: Paket;
  status: StatusDasar;
  license_type: 'STANDARD' | 'TRIAL';
  issued_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
  grace_period_days: number;
  warning_days: number;
  min_version: string | null;
  max_version: string | null;
  last_verified_at: string | null;
  application_version: string | null;
  features: Partial<Record<KunciFitur, boolean>>;
}

export interface HasilAksi {
  ok: boolean;
  code?: string;
  action?: string;
  duplicate?: boolean;
  unchanged?: boolean;
  status?: string;
  request_id?: string;
  kind?: string;
  requested_package?: Paket;
  days?: number;
  license?: InfoLisensi;
}

export interface HasilVerifikasi {
  ok: boolean;
  code?: string;
  license?: InfoLisensi;
  requests?: RingkasanPermintaan[];
}
