-- 004: Add status workflow to unknown_terms + RLS policies
-- Round 2: 미확인 용어 승인 플로우

-- ---- New columns --------------------------------------------------------- --
ALTER TABLE unknown_terms
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN reviewed_at TIMESTAMPTZ;

-- Index for admin panel filtering by status
CREATE INDEX idx_unknown_terms_status ON unknown_terms(status);

-- ---- RLS ----------------------------------------------------------------- --
ALTER TABLE unknown_terms ENABLE ROW LEVEL SECURITY;

-- Admin can read all unknown terms
CREATE POLICY "admin_read_unknown_terms" ON unknown_terms
  FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

-- Admin can update unknown terms (status changes, edit suggestions)
CREATE POLICY "admin_update_unknown_terms" ON unknown_terms
  FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

-- Admin can delete unknown terms
CREATE POLICY "admin_delete_unknown_terms" ON unknown_terms
  FOR DELETE
  USING (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

-- NOTE: No anon INSERT policy needed.
-- upsert_unknown_term() is SECURITY DEFINER and bypasses RLS.
-- Edge functions (translate-sentence) call it with service_role key.
