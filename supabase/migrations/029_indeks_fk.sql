-- 029 — Indeks untuk foreign key yang ditambahkan migrasi 020 & 023.
CREATE INDEX IF NOT EXISTS idx_locations_approved_by ON public.sm_locations (approved_by);
CREATE INDEX IF NOT EXISTS idx_locations_project     ON public.sm_locations (project_id);
CREATE INDEX IF NOT EXISTS idx_projects_location     ON public.sm_projects (location_id);
CREATE INDEX IF NOT EXISTS idx_users_manager         ON public.users (manager_id);
