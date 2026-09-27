import { FormRegistrasi } from './FormRegistrasi';

export const dynamic = 'force-dynamic';

export default function HalamanRegistrasi() {
  return (
    <>
      <h1>Registrasi deployment</h1>
      <p className="muted">
        Satu pelanggan = satu deployment (Vercel + Supabase sendiri) = satu lisensi. Registrasi menerbitkan
        Deployment ID, License ID, dan kunci deployment. Tidak ada perubahan kode sumber per pelanggan.
      </p>
      <FormRegistrasi />
    </>
  );
}
