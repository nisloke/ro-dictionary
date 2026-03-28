-- Table for storing unknown terms found during sentence translation
CREATE TABLE unknown_terms (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL,
  suggested_full_name TEXT,
  suggested_description TEXT,
  suggested_category TEXT,
  search_count INTEGER DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  notified BOOLEAN DEFAULT FALSE
);

-- Unique index for upsert on same term
CREATE UNIQUE INDEX idx_unknown_terms_term ON unknown_terms(term);

-- pg_cron: run send-term-report every 3 hours
-- NOTE: Replace <project-ref> with actual Supabase project reference
SELECT cron.schedule(
  'notify-unknown-terms',
  '0 */3 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-term-report',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
