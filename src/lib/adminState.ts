/**
 * Tracks pending admin changes for batch save/cancel.
 * All admin edits queue here; nothing hits Supabase until commitAll().
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
  /** Unique key for dedup — e.g. "update_term::드나" or "delete_term::abc123" */
  key: string;
  payload: Record<string, unknown>;
  /** Called when this change is cancelled to restore DOM to its previous state. */
  undo?: () => void;
}

type ChangeListener = (count: number) => void;

const pending: PendingChange[] = [];
const listeners = new Set<ChangeListener>();

function notify() {
  const count = pending.length;
  for (const fn of listeners) fn(count);
}

/**
 * Add a change to the pending queue.
 * If a change with the same `key` already exists, the old one is replaced
 * (its undo is NOT called — only cancelAll/cancelChange invoke undo).
 */
export function addChange(change: PendingChange): void {
  const idx = pending.findIndex((c) => c.key === change.key);
  if (idx !== -1) {
    // Replace existing — keep the new undo (which should restore to original state)
    pending[idx] = change;
  } else {
    pending.push(change);
  }
  notify();
}

/**
 * Remove a single pending change by key, executing its undo callback.
 */
export function cancelChange(key: string): void {
  const idx = pending.findIndex((c) => c.key === key);
  if (idx !== -1) {
    const removed = pending.splice(idx, 1)[0];
    removed.undo?.();
    notify();
  }
}

export function getPendingChanges(): PendingChange[] {
  return [...pending];
}

export function getPendingCount(): number {
  return pending.length;
}

/** Clear all pending changes WITHOUT running undo callbacks. */
export function clearAll(): void {
  pending.length = 0;
  notify();
}

/** Cancel all pending changes, running every undo callback to restore DOM. */
export function cancelAll(): void {
  // Run undos in reverse order so nested changes unwind correctly
  for (let i = pending.length - 1; i >= 0; i--) {
    pending[i].undo?.();
  }
  pending.length = 0;
  notify();
}

export function onPendingChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function commitAll(): Promise<{ success: boolean; errors: string[] }> {
  const {
    updateTerm, deleteTerm, createTerm,
    updateCategory, deleteCategory, createCategory,
    renameSubcategory, deleteSubcategory, moveTerms,
  } = await import('./adminApi');

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
