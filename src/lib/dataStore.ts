/**
 * Isomorphic data store — works at both SERVER TIME (Astro frontmatter / SSR)
 * and RUNTIME (client-side <script>).
 *
 * Single source of truth: Supabase.
 * SSR mode: every request fetches fresh data from Supabase (no build-time cache).
 */

// ---- Supabase config ---------------------------------------------------- //
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export { SUPABASE_URL, SUPABASE_ANON_KEY };

/** No-op in SSR mode — caching is disabled, every request fetches fresh data. */
export function invalidateCache(): void {
  // Intentionally empty: SSR mode has no cache to invalidate.
}

// ---- Types -------------------------------------------------------------- //
export interface TermEntry {
  id: string;
  term: string;
  full_name: string;
  category: string;
  subcategory: string;
  description: string;
  tags: string[];
}

export interface CategoryEntry {
  code: string;
  name: string;
  order: number;
  description: string;
}

// ---- Helpers ------------------------------------------------------------ //
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

function normalizeTerm(row: Record<string, unknown>): TermEntry {
  return {
    id: (row.id as string) ?? '',
    term: (row.term as string) ?? '',
    full_name: (row.full_name as string) ?? '',
    category: (row.category as string) ?? '',
    subcategory: (row.subcategory as string) ?? '',
    description: (row.description as string) ?? '',
    tags: (row.tags as string[]) ?? [],
  };
}

function normalizeCategory(row: Record<string, unknown>): CategoryEntry {
  return {
    code: (row.code as string) ?? '',
    name: (row.name as string) ?? '',
    order: (row.order as number) ?? 0,
    description: (row.description as string) ?? '',
  };
}

// ---- Public API --------------------------------------------------------- //

/**
 * Fetch all terms from Supabase.
 * In SSR mode, always fetches fresh data (no caching).
 * Client-side scripts also call this directly.
 */
export async function fetchTerms(): Promise<TermEntry[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/terms?select=*&order=id`,
      { headers },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return (rows as Record<string, unknown>[]).map(normalizeTerm);
  } catch (err) {
    console.error('[dataStore] Supabase terms fetch failed:', err);
    return [];
  }
}

/**
 * Fetch all categories from Supabase.
 */
export async function fetchCategories(): Promise<CategoryEntry[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/categories?select=*&order=order`,
      { headers },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return (rows as Record<string, unknown>[]).map(normalizeCategory);
  } catch (err) {
    console.error('[dataStore] Supabase categories fetch failed:', err);
    return [];
  }
}

// ---- Subcategory helpers ------------------------------------------------ //
export interface SubcategoryGroup {
  subcategory: string;
  anchorId: string;
  termCount: number;
}

export function slugifySubcategory(catCode: string, sub: string): string {
  if (!sub) return '';
  return `${catCode}--${sub.replace(/\s+/g, '-')}`;
}

export function buildSubcategoryMap(
  terms: TermEntry[],
  categories: CategoryEntry[],
): Map<string, SubcategoryGroup[]> {
  const map = new Map<string, SubcategoryGroup[]>();
  for (const cat of categories) {
    const catTerms = terms.filter((t) => t.category === cat.code);
    const groups: SubcategoryGroup[] = [];
    const seen = new Set<string>();
    for (const t of catTerms) {
      const key = t.subcategory ?? '';
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({
          subcategory: key,
          anchorId: key ? slugifySubcategory(cat.code, key) : '',
          termCount: 0,
        });
      }
      groups.find((g) => g.subcategory === key)!.termCount++;
    }
    if (groups.length > 0 && groups.some((g) => g.subcategory !== '')) {
      map.set(cat.code, groups);
    }
  }
  return map;
}
