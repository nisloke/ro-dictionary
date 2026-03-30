/**
 * Authenticated CRUD operations for admin.
 * Uses Supabase JS client with user JWT — RLS enforces is_admin check.
 */
import { getSupabase } from './supabaseClient';
import type { TermEntry, CategoryEntry } from './dataStore';

// ---- Terms -------------------------------------------------------------- //

export async function updateTerm(
  id: string,
  data: Partial<Pick<TermEntry, 'term' | 'full_name' | 'description' | 'category' | 'subcategory' | 'tags'>>,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.from('terms').update(data).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTerm(id: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.from('terms').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function createTerm(
  data: Omit<TermEntry, 'tags'> & { tags?: string[] },
): Promise<TermEntry> {
  const supabase = await getSupabase();
  const row = { ...data, tags: data.tags ?? [] };
  const { data: result, error } = await supabase
    .from('terms')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result as TermEntry;
}

// ---- Categories --------------------------------------------------------- //

export async function updateCategory(
  code: string,
  data: Partial<Pick<CategoryEntry, 'name' | 'order' | 'description'>>,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.from('categories').update(data).eq('code', code);
  if (error) throw new Error(error.message);
}

export async function deleteCategory(code: string): Promise<void> {
  const supabase = await getSupabase();
  // Delete all terms in this category first
  const { error: termsErr } = await supabase.from('terms').delete().eq('category', code);
  if (termsErr) throw new Error(termsErr.message);
  const { error } = await supabase.from('categories').delete().eq('code', code);
  if (error) throw new Error(error.message);
}

export async function createCategory(data: CategoryEntry): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.from('categories').insert(data);
  if (error) throw new Error(error.message);
}

// ---- Subcategory operations --------------------------------------------- //

export async function renameSubcategory(
  categoryCode: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('terms')
    .update({ subcategory: newName })
    .eq('category', categoryCode)
    .eq('subcategory', oldName);
  if (error) throw new Error(error.message);
}

export async function deleteSubcategory(
  categoryCode: string,
  subcategoryName: string,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('terms')
    .delete()
    .eq('category', categoryCode)
    .eq('subcategory', subcategoryName);
  if (error) throw new Error(error.message);
}

export async function moveTerms(
  termIds: string[],
  newCategory: string,
  newSubcategory: string,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('terms')
    .update({ category: newCategory, subcategory: newSubcategory })
    .in('id', termIds);
  if (error) throw new Error(error.message);
}

// ---- Unknown Terms ------------------------------------------------------ //

export interface UnknownTermEntry {
  id: number;
  term: string;
  suggested_full_name: string | null;
  suggested_description: string | null;
  suggested_category: string | null;
  search_count: number;
  first_seen_at: string;
  last_seen_at: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: string | null;
}

export async function fetchUnknownTerms(
  status?: 'pending' | 'approved' | 'rejected',
): Promise<UnknownTermEntry[]> {
  const supabase = await getSupabase();
  let query = supabase
    .from('unknown_terms')
    .select('*')
    .order('search_count', { ascending: false })
    .order('last_seen_at', { ascending: false });
  if (status) {
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as UnknownTermEntry[];
}

export async function approveUnknownTerm(
  id: number,
  termData: Omit<TermEntry, 'tags'> & { tags?: string[] },
): Promise<void> {
  await createTerm(termData);
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('unknown_terms')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function rejectUnknownTerm(id: number): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('unknown_terms')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteUnknownTerm(id: number): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.from('unknown_terms').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateUnknownTerm(
  id: number,
  data: Partial<Pick<UnknownTermEntry, 'suggested_full_name' | 'suggested_description' | 'suggested_category'>>,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.from('unknown_terms').update(data).eq('id', id);
  if (error) throw new Error(error.message);
}
