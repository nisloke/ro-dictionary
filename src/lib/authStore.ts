/**
 * Reactive auth state — tracks admin login status.
 * Other modules subscribe via onAdminChange().
 */
import { supabase } from './supabaseClient';
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
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Listen for auth state changes (login, logout, token refresh)
supabase.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  isAdmin = session?.user?.user_metadata?.is_admin === true;
  notifyListeners();
});

// Check for existing session on load
supabase.auth.getSession().then(({ data: { session } }) => {
  currentSession = session;
  isAdmin = session?.user?.user_metadata?.is_admin === true;
  notifyListeners();
});
