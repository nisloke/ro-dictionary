/**
 * Reactive auth state — tracks admin login status.
 * Other modules subscribe via onAdminChange().
 */
import { getSupabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

type AuthListener = (isAdmin: boolean) => void;

let currentSession: Session | null = null;
let isAdmin = false;
const listeners = new Set<AuthListener>();

export function getIsAdmin(): boolean {
  return isAdmin;
}

export function getSession(): Session | null {
  return currentSession;
}

export function onAdminChange(fn: AuthListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  for (const fn of listeners) fn(isAdmin);
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
}

// Initialise auth listener and check existing session.
// Called eagerly on module load — the dynamic import of supabase-js
// happens here, but only in the browser context where this module is imported.
async function init() {
  const supabase = await getSupabase();

  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    isAdmin = session?.user?.user_metadata?.is_admin === true;
    notifyListeners();
  });

  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;
  isAdmin = session?.user?.user_metadata?.is_admin === true;
  notifyListeners();
}

init();
