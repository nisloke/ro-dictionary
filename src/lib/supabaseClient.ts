/**
 * Browser-only Supabase client singleton for authentication and admin writes.
 * Read operations continue to use raw fetch in dataStore.ts.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './dataStore';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
