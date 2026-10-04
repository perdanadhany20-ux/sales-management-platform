#!/usr/bin/env bash
# Hak Cipta © 2026 DWP. Seluruh hak dilindungi.
# Jalankan seluruh migrasi + uji keamanan SQL pada Postgres kosong (CI / lokal).
# Pakai: PGHOST=… PGPORT=… PGUSER=postgres PGDATABASE=postgres scripts/uji-sql.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
LOG=$(mktemp)

"${PSQL[@]}" -f supabase/ci/supabase-shim.sql >/dev/null
for m in supabase/migrations/[0-9][0-9][0-9]_*.sql; do
  "${PSQL[@]}" -f "$m" >/dev/null 2>"$LOG" || { echo "❌ Migrasi gagal: $m"; cat "$LOG"; exit 1; }
done
echo "✅ Migrasi $(ls supabase/migrations/[0-9][0-9][0-9]_*.sql | wc -l) berkas terpasang"

gagal=0
jalankan() {
  local t=$1 out lulus salah
  out=$("${PSQL[@]}" -A -t -F'|' -f "$t" 2>&1) || { echo "❌ $t error:"; echo "$out" | tail -5; gagal=1; return; }
  lulus=$(grep -cE '\|t$' <<<"$out" || true)
  salah=$(grep -E '\|f$' <<<"$out" || true)
  if [[ -n "$salah" || "$lulus" -eq 0 ]]; then
    echo "❌ $t"; echo "${salah:-(tidak ada baris hasil)}"; gagal=1
  else
    echo "✅ $t — $lulus/$lulus lulus"
  fi
}

# Uji lisensi menyusun sendiri baris sm_lisensi-nya → jalankan saat tabel kosong.
jalankan supabase/tests/keamanan-lisensi.sql

# Uji lain menguji RLS per peran, bukan lisensi: buka semua fitur dengan
# lisensi mode development (hanya di database CI ini).
"${PSQL[@]}" -c "INSERT INTO public.sm_lisensi (mode, status) VALUES ('development', 'ACTIVE')" >/dev/null
for t in supabase/tests/*.sql; do
  [[ $t == *keamanan-lisensi.sql ]] && continue
  jalankan "$t"
done
exit $gagal
