/**
 * Shared runtime data store — fetches terms & categories from Supabase REST API.
 * Falls back to embedded JSON (build-time data) when the network is unavailable.
 *
 * Both Search.astro and SentenceTranslator.astro import from here so the data
 * is fetched only once and cached for the lifetime of the page.
 */

// ---- Supabase config ---------------------------------------------------- //
const SUPABASE_URL = 'https://nyftkqzrbanrxcoaxzke.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55ZnRrcXpyYmFucnhjb2F4emtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NzEyNzUsImV4cCI6MjA5MDI0NzI3NX0.j7tmgGPOB7L6Zm3SnegJsE69xD-szUvpDMTFOUouCEY';

// ---- Types -------------------------------------------------------------- //
export interface TermEntry {
  id: string;
  term: string;
  fullName: string;
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

// ---- Supabase row shapes (snake_case) ----------------------------------- //
interface SupabaseTerm {
  id: string;
  term: string;
  full_name: string | null;
  category: string;
  subcategory: string | null;
  description: string | null;
  tags: string[] | null;
}

interface SupabaseCategory {
  code: string;
  name: string;
  order: number;
  description: string | null;
}

// ---- Helpers ------------------------------------------------------------ //
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

function mapTerm(row: SupabaseTerm): TermEntry {
  return {
    id: row.id,
    term: row.term,
    fullName: row.full_name ?? '',
    category: row.category,
    subcategory: row.subcategory ?? '',
    description: row.description ?? '',
    tags: row.tags ?? [],
  };
}

function mapCategory(row: SupabaseCategory): CategoryEntry {
  return {
    code: row.code,
    name: row.name,
    order: row.order,
    description: row.description ?? '',
  };
}

// ---- Cache -------------------------------------------------------------- //
let _termsPromise: Promise<TermEntry[]> | null = null;
let _categoriesPromise: Promise<CategoryEntry[]> | null = null;

// ---- Public API --------------------------------------------------------- //

/**
 * Fetch all terms from Supabase (cached after first call).
 * Falls back to the embedded `<template id="terms-data">` if present.
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
        const rows: SupabaseTerm[] = await res.json();
        return rows.map(mapTerm);
      } catch (err) {
        console.warn('[dataStore] Supabase terms fetch failed, using fallback', err);
        return parseFallback<TermEntry>('terms-data', 'terms-for-translator');
      }
    })();
  }
  return _termsPromise;
}

/**
 * Fetch all categories from Supabase (cached after first call).
 * Falls back to `<template id="categories-data">` if present.
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
        const rows: SupabaseCategory[] = await res.json();
        return rows.map(mapCategory);
      } catch (err) {
        console.warn('[dataStore] Supabase categories fetch failed, using fallback', err);
        return parseFallback<CategoryEntry>('categories-data');
      }
    })();
  }
  return _categoriesPromise;
}

/** Try to parse build-time embedded JSON from <template> tags */
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
