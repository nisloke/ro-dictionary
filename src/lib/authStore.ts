/**
 * Reactive auth state — tracks admin login status.
 * Other modules subscribe via onAdminChange().
 *
 * Supabase JS (~191KB)는 기존 세션이 있거나 로그인 시도 시에만 로드됨.
 * 일반 방문자는 Supabase JS를 다운로드하지 않음.
 */
import type { Session } from '@supabase/supabase-js';

type AuthListener = (isAdmin: boolean) => void;

let currentSession: Session | null = null;
let isAdmin = false;
const listeners = new Set<AuthListener>();
let initialized = false;

export function getIsAdmin(): boolean {
  return isAdmin;
}

export function getSession(): Session | null {
  return currentSession;
}

export function onAdminChange(fn: AuthListener): () => void {
  listeners.add(fn);
  // 이미 초기화된 경우 현재 상태를 즉시 전달
  if (initialized) {
    fn(isAdmin);
  }
  return () => listeners.delete(fn);
}

function notifyListeners() {
  for (const fn of listeners) fn(isAdmin);
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  await ensureInitialized();
  const { getSupabase } = await import('./supabaseClient');
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOut(): Promise<void> {
  const { getSupabase } = await import('./supabaseClient');
  const supabase = await getSupabase();
  await supabase.auth.signOut();
}

/**
 * localStorage에 Supabase 세션이 있는지 가볍게 확인.
 * Supabase JS를 로드하지 않고 판별 가능.
 */
function hasStoredSession(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    // Supabase JS는 `sb-<ref>-auth-token` 키로 세션을 저장함
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (raw) return true;
      }
    }
  } catch {
    // localStorage 접근 불가 (private browsing 등)
  }
  return false;
}

/** Supabase 초기화 — 기존 세션 복원 및 auth 리스너 등록 */
async function init() {
  if (initialized) return;
  initialized = true;

  const { getSupabase } = await import('./supabaseClient');
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

/**
 * 외부에서 호출 가능한 초기화 보장 함수.
 * 기존 세션이 있을 때만 Supabase JS를 로드함.
 */
export async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  await init();
}

// 기존 세션이 localStorage에 있을 때만 자동 초기화 (Supabase JS 로드)
// 세션이 없으면 로그인 시도 시까지 로드를 지연함
if (typeof window !== 'undefined' && hasStoredSession()) {
  init();
}
