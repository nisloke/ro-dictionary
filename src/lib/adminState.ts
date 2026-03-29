/**
 * Tracks pending admin changes for batch save/cancel.
 */

export type ChangeType =
  | 'update_term'
  | 'delete_term'
  | 'create_term'
  | 'update_category'
  | 'delete_category'
  | 'create_category'
  | 'rename_subcategory'
  | 'delete_subcategory'
  | 'move_terms';

export interface PendingChange {
  type: ChangeType;
  payload: Record<string, unknown>;
}

type ChangeListener = (count: number) => void;

const pending: PendingChange[] = [];
const listeners = new Set<ChangeListener>();

function notify() {
  const count = pending.length;
  for (const fn of listeners) fn(count);
}

export function addChange(change: PendingChange): void {
  pending.push(change);
  notify();
}

export function getPendingChanges(): PendingChange[] {
  return [...pending];
}

export function getPendingCount(): number {
  return pending.length;
}

export function clearAll(): void {
  pending.length = 0;
  notify();
}

export function onPendingChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function commitAll(): Promise<{ success: boolean; errors: string[] }> {
  const { updateTerm, deleteTerm, createTerm, updateCategory, deleteCategory, createCategory, renameSubcategory, deleteSubcategory, moveTerms } = await import('./adminApi');

  const errors: string[] = [];

  for (const change of pending) {
    try {
      const p = change.payload;
      switch (change.type) {
        case 'update_term':
          await updateTerm(p.id as string, p.data as Parameters<typeof updateTerm>[1]);
          break;
        case 'delete_term':
          await deleteTerm(p.id as string);
          break;
        case 'create_term':
          await createTerm(p.data as Parameters<typeof createTerm>[0]);
          break;
        case 'update_category':
          await updateCategory(p.code as string, p.data as Parameters<typeof updateCategory>[1]);
          break;
        case 'delete_category':
          await deleteCategory(p.code as string);
          break;
        case 'create_category':
          await createCategory(p.data as Parameters<typeof createCategory>[0]);
          break;
        case 'rename_subcategory':
          await renameSubcategory(p.categoryCode as string, p.oldName as string, p.newName as string);
          break;
        case 'delete_subcategory':
          await deleteSubcategory(p.categoryCode as string, p.subcategoryName as string);
          break;
        case 'move_terms':
          await moveTerms(p.termIds as string[], p.newCategory as string, p.newSubcategory as string);
          break;
      }
    } catch (err) {
      errors.push(`${change.type}: ${(err as Error).message}`);
    }
  }

  if (errors.length === 0) {
    pending.length = 0;
    notify();
    return { success: true, errors: [] };
  }
  return { success: false, errors };
}
