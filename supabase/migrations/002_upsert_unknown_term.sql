-- upsert_unknown_term RPC function
-- Called by translate-sentence edge function to record unknown terms
CREATE OR REPLACE FUNCTION upsert_unknown_term(
  _term TEXT,
  _suggested_full_name TEXT DEFAULT NULL,
  _suggested_description TEXT DEFAULT NULL,
  _suggested_category TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO unknown_terms (term, suggested_full_name, suggested_description, suggested_category)
  VALUES (_term, _suggested_full_name, _suggested_description, _suggested_category)
  ON CONFLICT (term) DO UPDATE SET
    search_count = unknown_terms.search_count + 1,
    last_seen_at = NOW(),
    suggested_full_name = COALESCE(EXCLUDED.suggested_full_name, unknown_terms.suggested_full_name),
    suggested_description = COALESCE(EXCLUDED.suggested_description, unknown_terms.suggested_description),
    suggested_category = COALESCE(EXCLUDED.suggested_category, unknown_terms.suggested_category),
    notified = FALSE;
END;
$$;
