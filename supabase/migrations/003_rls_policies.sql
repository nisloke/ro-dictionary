-- Enable Row Level Security on core tables
ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Public read access (anon key)
CREATE POLICY "anon_read_terms" ON terms
  FOR SELECT USING (true);

CREATE POLICY "anon_read_categories" ON categories
  FOR SELECT USING (true);

-- Admin write access (authenticated + user_metadata.is_admin)
CREATE POLICY "admin_insert_terms" ON terms
  FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

CREATE POLICY "admin_update_terms" ON terms
  FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

CREATE POLICY "admin_delete_terms" ON terms
  FOR DELETE
  USING (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

CREATE POLICY "admin_insert_categories" ON categories
  FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

CREATE POLICY "admin_update_categories" ON categories
  FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

CREATE POLICY "admin_delete_categories" ON categories
  FOR DELETE
  USING (
    auth.jwt() ->> 'role' = 'authenticated'
    AND (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );
