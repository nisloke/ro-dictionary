/**
 * Browser-only Supabase client singleton for authentication and admin writes.
 * Read operations continue to use raw fetch in dataStore.ts.
 *
 * Uses dynamic import so @supabase/supabase-js (~191KB) is only loaded
 * when an admin action is first triggered — not on every page visit.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './dataStore';

let instance: SupabaseClient | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  if (!instance) {
    const { createClient } = await import('@supabase/supabase-js');
    instance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return instance;
}
