/**
 * Isomorphic data store — works at both BUILD TIME (Astro frontmatter)
 * and RUNTIME (client-side <script>).
 *
 * Single source of truth: Supabase.
 * Client-side fallback: embedded <template> tags (for offline resilience).
 */

// ---- Supabase config ---------------------------------------------------- //
const SUPABASE_URL = 'https://nyftkqzrbanrxcoaxzke.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55ZnRrcXpyYmFucnhjb2F4emtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NzEyNzUsImV4cCI6MjA5MDI0NzI3NX0.j7tmgGPOB7L6Zm3SnegJsE69xD-szUvpDMTFOUouCEY';

export { SUPABASE_URL, SUPABASE_ANON_KEY };

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

// ---- Cache (per-environment) -------------------------------------------- //
let _termsPromise: Promise<TermEntry[]> | null = null;
let _categoriesPromise: Promise<CategoryEntry[]> | null = null;

// ---- Public API --------------------------------------------------------- //

/**
 * Fetch all terms from Supabase (cached after first call).
 * Works at build time (Node) and runtime (browser).
 */
export function fetchTerms(): Promise<TermEntry[]> {
  if (!_termsPromise) {
    _termsPromise = (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/terms?select=*&order=id`,
          { headers },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        return (rows as Record<string, unknown>[]).map(normalizeTerm);
      } catch (err) {
        console.warn('[dataStore] Supabase terms fetch failed', err);
        // Client-side fallback: try embedded <template> tags
        if (typeof document !== 'undefined') {
          return parseFallback<TermEntry>('terms-data', 'terms-for-translator');
        }
        return [];
      }
    })();
  }
  return _termsPromise;
}

/**
 * Fetch all categories from Supabase (cached after first call).
 */
export function fetchCategories(): Promise<CategoryEntry[]> {
  if (!_categoriesPromise) {
    _categoriesPromise = (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/categories?select=*&order=order`,
          { headers },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        return (rows as Record<string, unknown>[]).map(normalizeCategory);
      } catch (err) {
        console.warn('[dataStore] Supabase categories fetch failed', err);
        if (typeof document !== 'undefined') {
          return parseFallback<CategoryEntry>('categories-data');
        }
        return [];
      }
    })();
  }
  return _categoriesPromise;
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

/** Client-side only: parse build-time embedded JSON from <template> tags */
function parseFallback<T>(...ids: string[]): T[] {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el?.innerHTML) {
      try {
        return JSON.parse(el.innerHTML);
      } catch { /* try next */ }
    }
  }
  return [];
}
