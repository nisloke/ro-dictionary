/**
 * Admin DOM Enhancer — injects edit controls into the static HTML
 * when an admin is logged in. Strips them on logout.
 */
import { onAdminChange } from './authStore';
import * as api from './adminApi';
import { addChange } from './adminState';
import type { TermEntry } from './dataStore';
import { fetchTerms, fetchCategories, buildSubcategoryMap, invalidateCache } from './dataStore';

let enhanced = false;

export function initAdminEnhancer(): void {
  onAdminChange(async (isAdmin) => {
    if (isAdmin && !enhanced) {
      enhanced = true;
      await refreshTablesFromSupabase();
      enhanceTables();
      enhanceCategoryHeadings();
    }
    // On logout, page will be reloaded from AdminLogin.astro
  });
}

// ---- Refresh static HTML from Supabase (admin sees latest data) --------- //

async function refreshTablesFromSupabase(): Promise<void> {
  try {
    invalidateCache();
    const freshTerms = await fetchTerms();
    const freshMap = new Map(freshTerms.map((t) => [t.id, t]));

    // Track which term IDs exist in the DOM
    const domIds = new Set<string>();
    // Terms that moved to a different category/subcategory and need re-adding
    const termsToAdd: TermEntry[] = [];

    document
      .querySelectorAll<HTMLTableRowElement>('main table tbody tr[id]')
      .forEach((row) => {
        domIds.add(row.id);
        const fresh = freshMap.get(row.id);
        if (!fresh) {
          row.remove();
          return;
        }
        // Check if term moved to a different category
        const section = row.closest('section');
        if (section && section.id !== fresh.category) {
          row.remove();
          termsToAdd.push(fresh);
          return;
        }
        // Check if term moved to a different subcategory within same category
        const wrapper = row.closest('div.mb-6');
        const subH3 = wrapper?.querySelector<HTMLElement>('h3[data-subcategory]');
        const currentSub = subH3?.getAttribute('data-subcategory') ?? '';
        if (currentSub !== (fresh.subcategory ?? '')) {
          row.remove();
          termsToAdd.push(fresh);
          return;
        }
        // Update cell content in-place
        const cells = row.querySelectorAll<HTMLTableCellElement>('td');
        if (cells.length < 3) return;
        cells[0].textContent = fresh.term;
        cells[1].textContent = fresh.full_name;
        cells[2].textContent = fresh.description;
      });

    // Add moved terms to their new sections
    for (const term of termsToAdd) {
      addTermRowToSection(term);
    }

    // Add terms that exist in Supabase but not yet in DOM (newly created)
    for (const term of freshTerms) {
      if (!domIds.has(term.id)) {
        addTermRowToSection(term);
      }
    }
  } catch (err) {
    console.warn('[adminEnhancer] Failed to refresh from Supabase', err);
  }
}

/** Create a term row and append it to the correct section/subcategory table. */
function addTermRowToSection(term: TermEntry): void {
  const targetSection = document.getElementById(term.category);
  if (!targetSection || targetSection.tagName !== 'SECTION') return;

  let tbody: HTMLTableSectionElement | null = null;

  // Try to find the subcategory's specific table
  if (term.subcategory) {
    const subH3 = targetSection.querySelector<HTMLElement>(
      `h3[data-subcategory="${CSS.escape(term.subcategory)}"]`,
    );
    if (subH3) {
      const wrapper = subH3.closest('div.mb-6');
      tbody = wrapper?.querySelector('tbody') ?? null;
    }
  }

  // Fallback: first table in the section
  if (!tbody) {
    tbody = targetSection.querySelector('tbody');
  }

  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.id = term.id;
  tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors';

  const tdTerm = document.createElement('td');
  tdTerm.className = 'px-3 py-2 font-medium whitespace-nowrap text-gray-900 dark:text-gray-100';
  tdTerm.textContent = term.term;

  const tdFullName = document.createElement('td');
  tdFullName.className = 'px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap';
  tdFullName.textContent = term.full_name;

  const tdDesc = document.createElement('td');
  tdDesc.className = 'px-3 py-2 text-gray-600 dark:text-gray-400';
  tdDesc.textContent = term.description;

  tr.appendChild(tdTerm);
  tr.appendChild(tdFullName);
  tr.appendChild(tdDesc);
  tbody.appendChild(tr);
}

// ---- Term table enhancement --------------------------------------------- //

function enhanceTables(): void {
  // Add action column header to each table
  document.querySelectorAll<HTMLTableElement>(
    'main table',
  ).forEach((table) => {
    const thead = table.querySelector('thead tr');
    if (!thead) return;
    const th = document.createElement('th');
    th.className = 'px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300 w-[160px]';
    th.textContent = '관리';
    thead.appendChild(th);

    // Enhance each row
    table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
      enhanceTermRow(row);
    });
  });
}

function enhanceTermRow(row: HTMLTableRowElement): void {
  const termId = row.id;
  if (!termId) return;

  const cells = row.querySelectorAll<HTMLTableCellElement>('td');
  if (cells.length < 3) return;

  const termCell = cells[0];
  const fullNameCell = cells[1];
  const descCell = cells[2];

  // Make cells editable on click
  makeEditable(termCell, termId, 'term');
  makeEditable(fullNameCell, termId, 'full_name');
  makeEditable(descCell, termId, 'description');

  // Add action buttons column
  const actionTd = document.createElement('td');
  actionTd.className = 'px-3 py-2 whitespace-nowrap';
  actionTd.innerHTML = `
    <div class="flex gap-1">
      <button class="admin-save-row-btn rounded px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors hidden" title="저장">저장</button>
      <button class="admin-move-row-btn rounded px-2 py-1 text-xs font-medium text-white bg-purple-500 hover:bg-purple-600 transition-colors" title="이동">이동</button>
      <button class="admin-delete-row-btn rounded px-2 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 transition-colors" title="삭제">삭제</button>
    </div>
  `;
  row.appendChild(actionTd);

  // Save button — immediate save for this row
  const saveBtn = actionTd.querySelector<HTMLButtonElement>('.admin-save-row-btn')!;
  saveBtn.addEventListener('click', async () => {
    const changes = getRowChanges(row);
    if (!changes) return;
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
      await api.updateTerm(termId, changes);
      // Update original data attributes
      if (changes.term !== undefined) termCell.setAttribute('data-original', changes.term);
      if (changes.full_name !== undefined) fullNameCell.setAttribute('data-original', changes.full_name);
      if (changes.description !== undefined) descCell.setAttribute('data-original', changes.description);
      row.classList.remove('admin-row-modified');
      saveBtn.classList.add('hidden');
      showToast('저장되었습니다');
    } catch (err) {
      showToast(`오류: ${(err as Error).message}`, true);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });

  // Move button
  const moveBtn = actionTd.querySelector<HTMLButtonElement>('.admin-move-row-btn')!;
  moveBtn.addEventListener('click', () => {
    const section = row.closest('section');
    const currentCategory = section?.id ?? '';
    const subcategoryH3 = row.closest('div.mb-6')?.querySelector<HTMLElement>('h3[data-subcategory]');
    const currentSubcategory = subcategoryH3?.getAttribute('data-subcategory') ?? '';
    showMoveTermDialog(termId, termCell.textContent?.trim() ?? '', currentCategory, currentSubcategory, row);
  });

  // Delete button
  const deleteBtn = actionTd.querySelector<HTMLButtonElement>('.admin-delete-row-btn')!;
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`"${termCell.textContent?.trim()}" 용어를 삭제하시겠습니까?`)) return;
    try {
      deleteBtn.disabled = true;
      deleteBtn.textContent = '삭제 중...';
      await api.deleteTerm(termId);
      row.style.transition = 'opacity 0.3s';
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 300);
      showToast('삭제되었습니다');
    } catch (err) {
      showToast(`오류: ${(err as Error).message}`, true);
      deleteBtn.disabled = false;
      deleteBtn.textContent = '삭제';
    }
  });
}

function makeEditable(
  cell: HTMLTableCellElement,
  termId: string,
  field: string,
): void {
  const original = cell.textContent?.trim() ?? '';
  cell.setAttribute('data-original', original);
  cell.setAttribute('data-field', field);
  cell.style.cursor = 'pointer';
  cell.title = '클릭하여 수정';

  cell.addEventListener('click', () => {
    // Already editing?
    if (cell.querySelector('input, textarea')) return;

    const currentValue = cell.textContent?.trim() ?? '';
    const isDesc = field === 'description';

    if (isDesc) {
      const textarea = document.createElement('textarea');
      textarea.value = currentValue;
      textarea.className =
        'w-full min-h-[60px] rounded border border-blue-400 px-2 py-1 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 dark:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y';
      cell.textContent = '';
      cell.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const finish = () => {
        const newValue = textarea.value.trim();
        cell.textContent = newValue;
        if (newValue !== cell.getAttribute('data-original')) {
          markRowModified(cell.closest('tr')!);
        }
      };
      textarea.addEventListener('blur', finish);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          cell.textContent = cell.getAttribute('data-original') ?? '';
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish();
        }
      });
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentValue;
      input.className =
        'w-full rounded border border-blue-400 px-2 py-1 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 dark:border-blue-500 focus:ring-1 focus:ring-blue-500';
      cell.textContent = '';
      cell.appendChild(input);
      input.focus();
      input.select();

      const finish = () => {
        const newValue = input.value.trim();
        cell.textContent = newValue;
        if (newValue !== cell.getAttribute('data-original')) {
          markRowModified(cell.closest('tr')!);
        }
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          cell.textContent = cell.getAttribute('data-original') ?? '';
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          finish();
        }
      });
    }
  });
}

function markRowModified(row: HTMLTableRowElement): void {
  row.classList.add('admin-row-modified');
  const saveBtn = row.querySelector<HTMLButtonElement>('.admin-save-row-btn');
  if (saveBtn) saveBtn.classList.remove('hidden');
}

function getRowChanges(
  row: HTMLTableRowElement,
): Record<string, string> | null {
  const changes: Record<string, string> = {};
  row.querySelectorAll<HTMLTableCellElement>('td[data-field]').forEach((cell) => {
    const field = cell.getAttribute('data-field')!;
    const original = cell.getAttribute('data-original') ?? '';
    const current = cell.textContent?.trim() ?? '';
    if (current !== original) {
      changes[field] = current;
    }
  });
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Batch-save all modified rows. Called from AdminToolbar. */
export async function saveAllModifiedRows(): Promise<{ saved: number; errors: number }> {
  const rows = document.querySelectorAll<HTMLTableRowElement>('main table tbody tr.admin-row-modified');
  let saved = 0;
  let errors = 0;

  for (const row of rows) {
    const termId = row.id;
    const changes = getRowChanges(row);
    if (!termId || !changes) continue;
    try {
      await api.updateTerm(termId, changes);
      // Update data-original attributes
      row.querySelectorAll<HTMLTableCellElement>('td[data-field]').forEach((cell) => {
        cell.setAttribute('data-original', cell.textContent?.trim() ?? '');
      });
      row.classList.remove('admin-row-modified');
      const saveBtn = row.querySelector<HTMLButtonElement>('.admin-save-row-btn');
      if (saveBtn) saveBtn.classList.add('hidden');
      saved++;
    } catch {
      errors++;
    }
  }
  return { saved, errors };
}

// ---- Category/Subcategory heading enhancement --------------------------- //

function enhanceCategoryHeadings(): void {
  // Category headings (h2 inside section[id])
  document.querySelectorAll<HTMLElement>('main section[id] > h2').forEach((h2) => {
    const section = h2.closest('section')!;
    const catCode = section.id;
    addEditIcon(h2, async (newName) => {
      try {
        await api.updateCategory(catCode, { name: newName });
        showToast('카테고리 이름이 변경되었습니다');
      } catch (err) {
        showToast(`오류: ${(err as Error).message}`, true);
        h2.childNodes[0].textContent = h2.getAttribute('data-original') ?? '';
      }
    });

    // Add delete button for category
    const delBtn = document.createElement('button');
    delBtn.className = 'admin-cat-delete ml-2 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors';
    delBtn.innerHTML = '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>';
    delBtn.title = '카테고리 삭제';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`"${h2.textContent?.trim()}" 카테고리와 모든 용어를 삭제하시겠습니까?`)) return;
      try {
        await api.deleteCategory(catCode);
        section.style.transition = 'opacity 0.3s';
        section.style.opacity = '0';
        setTimeout(() => section.remove(), 300);
        showToast('카테고리가 삭제되었습니다');
      } catch (err) {
        showToast(`오류: ${(err as Error).message}`, true);
      }
    });
    h2.appendChild(delBtn);

    // "소분류 추가" button below category heading
    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'admin-add-sub mt-1 mb-3 block rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors';
    addSubBtn.textContent = '+ 소분류 추가';
    addSubBtn.addEventListener('click', () => showAddSubcategoryDialog(catCode, section));
    h2.insertAdjacentElement('afterend', addSubBtn);
  });

  // Subcategory headings (h3[data-subcategory])
  document.querySelectorAll<HTMLElement>('main h3[data-subcategory]').forEach((h3) => {
    const subName = h3.getAttribute('data-subcategory')!;
    const section = h3.closest('section')!;
    const catCode = section.id;
    enhanceSubcategoryHeading(h3, catCode, subName);
  });

  // Add "new category" button at bottom of main
  const mainEl = document.querySelector('main');
  if (mainEl) {
    const addCatBtn = document.createElement('button');
    addCatBtn.className = 'mt-4 w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors';
    addCatBtn.textContent = '+ 새 카테고리 추가';
    addCatBtn.addEventListener('click', () => showNewCategoryDialog());
    mainEl.appendChild(addCatBtn);
  }
}

function addEditIcon(
  heading: HTMLElement,
  onSave: (newName: string) => Promise<void>,
): void {
  const originalText = heading.childNodes[0]?.textContent?.trim() ?? '';
  heading.setAttribute('data-original', originalText);
  heading.style.cursor = 'pointer';
  heading.classList.add('group');

  const editBtn = document.createElement('button');
  editBtn.className = 'admin-edit-icon ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all';
  editBtn.innerHTML = '<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>';
  editBtn.title = '이름 변경';

  // Insert after the first text node
  const firstChild = heading.childNodes[0];
  if (firstChild && firstChild.nextSibling) {
    heading.insertBefore(editBtn, firstChild.nextSibling);
  } else {
    heading.appendChild(editBtn);
  }

  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const current = heading.childNodes[0]?.textContent?.trim() ?? '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className =
      'rounded border border-blue-400 px-2 py-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100 dark:bg-gray-700 dark:border-blue-500 focus:ring-1 focus:ring-blue-500';

    // Hide everything except the input temporarily
    const children = Array.from(heading.childNodes);
    children.forEach((c) => {
      if (c instanceof HTMLElement) c.style.display = 'none';
      else if (c.nodeType === Node.TEXT_NODE) (c as Text).textContent = '';
    });
    heading.insertBefore(input, heading.firstChild);
    input.focus();
    input.select();

    const finish = async (save: boolean) => {
      const newValue = input.value.trim();
      input.remove();
      children.forEach((c) => {
        if (c instanceof HTMLElement) c.style.display = '';
      });
      if (save && newValue && newValue !== current) {
        heading.childNodes[0].textContent = newValue;
        await onSave(newValue);
      } else {
        heading.childNodes[0].textContent = current;
      }
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') finish(false);
    });
  });
}

// ---- Move Term Dialog --------------------------------------------------- //

async function showMoveTermDialog(
  termId: string,
  termName: string,
  currentCategory: string,
  currentSubcategory: string,
  row: HTMLTableRowElement,
): Promise<void> {
  let categories: { code: string; name: string }[];
  let terms: { category: string; subcategory: string }[];
  try {
    [categories, terms] = await Promise.all([fetchCategories(), fetchTerms()]);
  } catch (err) {
    showToast(`데이터 로드 실패: ${(err as Error).message}`, true);
    return;
  }

  // Build subcategory list per category
  const subcatByCat = new Map<string, string[]>();
  for (const t of terms) {
    if (!t.subcategory) continue;
    const list = subcatByCat.get(t.category) ?? [];
    if (!list.includes(t.subcategory)) list.push(t.subcategory);
    subcatByCat.set(t.category, list);
  }

  function buildSubcatOptions(catCode: string, selected: string): string {
    const subs = subcatByCat.get(catCode) ?? [];
    let html = '<option value="">(없음)</option>';
    for (const s of subs) {
      html += `<option value="${s}"${s === selected ? ' selected' : ''}>${s}</option>`;
    }
    return html;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4';

  const catOptionsHtml = categories
    .map(
      (c) =>
        `<option value="${c.code}"${c.code === currentCategory ? ' selected' : ''}>${c.name} (${c.code})</option>`,
    )
    .join('');

  backdrop.innerHTML = `
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">"${termName}" 이동</h3>
      <form class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">카테고리</label>
          <select name="category"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
            ${catOptionsHtml}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">소분류</label>
          <select name="subcategory"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
            ${buildSubcatOptions(currentCategory, currentSubcategory)}
          </select>
        </div>
        <div class="flex gap-2 pt-1">
          <button type="submit" class="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors">이동</button>
          <button type="button" class="admin-dialog-cancel flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">취소</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(backdrop);

  const form = backdrop.querySelector('form')!;
  const catSelect = form.querySelector<HTMLSelectElement>('select[name="category"]')!;
  const subSelect = form.querySelector<HTMLSelectElement>('select[name="subcategory"]')!;
  const cancelBtn = backdrop.querySelector('.admin-dialog-cancel')!;

  // Update subcategory dropdown when category changes
  catSelect.addEventListener('change', () => {
    subSelect.innerHTML = buildSubcatOptions(catSelect.value, '');
  });

  cancelBtn.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newCategory = catSelect.value;
    const newSubcategory = subSelect.value;

    if (newCategory === currentCategory && newSubcategory === currentSubcategory) {
      backdrop.remove();
      return;
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = '이동 중...';
      await api.moveTerms([termId], newCategory, newSubcategory);
      backdrop.remove();
      // Remove row from old table and add to new section immediately
      const termData = row.querySelectorAll<HTMLTableCellElement>('td');
      row.remove();
      addTermRowToSection({
        id: termId,
        term: termData[0]?.textContent?.trim() ?? '',
        full_name: termData[1]?.textContent?.trim() ?? '',
        category: newCategory,
        subcategory: newSubcategory,
        description: termData[2]?.textContent?.trim() ?? '',
        tags: [],
      });
      // Enhance the newly added row with admin controls
      const newRow = document.getElementById(termId) as HTMLTableRowElement | null;
      if (newRow) enhanceTermRow(newRow);
      showToast('용어가 이동되었습니다.');
    } catch (err) {
      showToast(`오류: ${(err as Error).message}`, true);
      submitBtn.disabled = false;
      submitBtn.textContent = '이동';
    }
  });
}

// ---- New Category Dialog ------------------------------------------------ //

function showNewCategoryDialog(): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4';

  backdrop.innerHTML = `
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">새 카테고리 추가</h3>
      <form class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">이름</label>
          <input name="name" type="text" required placeholder="카테고리 이름"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">순서</label>
          <input name="order" type="number" required value="99"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
        </div>
        <div class="flex gap-2 pt-1">
          <button type="submit" class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">추가</button>
          <button type="button" class="admin-dialog-cancel flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">취소</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(backdrop);

  const form = backdrop.querySelector('form')!;
  const cancelBtn = backdrop.querySelector('.admin-dialog-cancel')!;

  cancelBtn.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = (fd.get('name') as string).trim();
    const code = `cat-${Date.now()}`;
    try {
      await api.createCategory({
        code,
        name,
        order: Number(fd.get('order')),
        description: '',
      });
      backdrop.remove();
      showToast('카테고리가 추가되었습니다. 페이지를 새로고침하면 반영됩니다.');
    } catch (err) {
      showToast(`오류: ${(err as Error).message}`, true);
    }
  });
}

// ---- Subcategory heading enhancement -------------------------------------- //

function enhanceSubcategoryHeading(h3: HTMLElement, catCode: string, subName: string): void {
  // Edit icon that opens dialog with name + order
  h3.classList.add('group');
  h3.style.cursor = 'pointer';

  const editBtn = document.createElement('button');
  editBtn.className = 'admin-edit-icon ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all';
  editBtn.innerHTML = '<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>';
  editBtn.title = '소분류 수정';

  const firstChild = h3.childNodes[0];
  if (firstChild?.nextSibling) {
    h3.insertBefore(editBtn, firstChild.nextSibling);
  } else {
    h3.appendChild(editBtn);
  }

  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showSubcategoryEditDialog(h3, catCode, h3.getAttribute('data-subcategory') ?? subName);
  });

  // Delete subcategory button
  const delBtn = document.createElement('button');
  delBtn.className = 'admin-sub-delete ml-2 p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors';
  delBtn.innerHTML = '<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>';
  delBtn.title = '소분류 삭제';
  delBtn.addEventListener('click', async () => {
    const currentSubName = h3.getAttribute('data-subcategory') ?? subName;
    if (!confirm(`"${currentSubName}" 소분류의 모든 용어를 삭제하시겠습니까?`)) return;
    try {
      await api.deleteSubcategory(catCode, currentSubName);
      const wrapper = h3.closest('div.mb-6');
      if (wrapper) {
        wrapper.style.transition = 'opacity 0.3s';
        wrapper.style.opacity = '0';
        setTimeout(() => wrapper.remove(), 300);
      }
      showToast('소분류가 삭제되었습니다');
    } catch (err) {
      showToast(`오류: ${(err as Error).message}`, true);
    }
  });
  h3.appendChild(delBtn);
}

// ---- Subcategory Edit Dialog ---------------------------------------------- //

function showSubcategoryEditDialog(heading: HTMLElement, catCode: string, currentName: string): void {
  const section = heading.closest('section')!;
  const wrappers = Array.from(section.querySelectorAll<HTMLElement>(':scope > div.mb-6'));
  const currentWrapper = heading.closest<HTMLElement>('div.mb-6')!;
  const currentPos = wrappers.indexOf(currentWrapper) + 1;
  const totalSubs = wrappers.length;

  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4';
  backdrop.innerHTML = `
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">소분류 수정</h3>
      <form class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">이름</label>
          <input name="name" type="text" required
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">순서 (1~${totalSubs})</label>
          <input name="order" type="number" required min="1" max="${totalSubs}"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
        </div>
        <div class="flex gap-2 pt-1">
          <button type="submit" class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">저장</button>
          <button type="button" class="admin-dialog-cancel flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">취소</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(backdrop);

  const form = backdrop.querySelector('form')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  const orderInput = form.querySelector<HTMLInputElement>('input[name="order"]')!;
  nameInput.value = currentName;
  orderInput.value = String(currentPos);
  nameInput.focus();

  const cancelBtn = backdrop.querySelector('.admin-dialog-cancel')!;
  cancelBtn.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = nameInput.value.trim();
    const newOrder = Number(orderInput.value);
    if (!newName) return;

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = '저장 중...';

      // Rename if name changed
      if (newName !== currentName) {
        await api.renameSubcategory(catCode, currentName, newName);
        heading.childNodes[0].textContent = newName;
        heading.setAttribute('data-subcategory', newName);
      }

      // Reorder if position changed
      if (newOrder !== currentPos && newOrder >= 1 && newOrder <= totalSubs) {
        const target = wrappers[newOrder - 1];
        if (newOrder < currentPos) {
          section.insertBefore(currentWrapper, target);
        } else {
          section.insertBefore(currentWrapper, target.nextSibling);
        }
      }

      backdrop.remove();
      showToast('소분류가 수정되었습니다');
    } catch (err) {
      showToast(`오류: ${(err as Error).message}`, true);
      submitBtn.disabled = false;
      submitBtn.textContent = '저장';
    }
  });
}

// ---- Add Subcategory Dialog ----------------------------------------------- //

function showAddSubcategoryDialog(catCode: string, section: HTMLElement): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4';
  backdrop.innerHTML = `
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">소분류 추가</h3>
      <form class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">소분류 이름</label>
          <input name="name" type="text" required placeholder="소분류 이름"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
        </div>
        <div class="flex gap-2 pt-1">
          <button type="submit" class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">추가</button>
          <button type="button" class="admin-dialog-cancel flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">취소</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(backdrop);

  const form = backdrop.querySelector('form')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  nameInput.focus();

  const cancelBtn = backdrop.querySelector('.admin-dialog-cancel')!;
  cancelBtn.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;

    if (section.querySelector(`h3[data-subcategory="${CSS.escape(name)}"]`)) {
      showToast('이미 존재하는 소분류입니다', true);
      return;
    }

    createSubcategoryDOMSection(section, catCode, name);
    backdrop.remove();
    showToast('소분류가 추가되었습니다');
  });
}

function createSubcategoryDOMSection(section: HTMLElement, catCode: string, subName: string): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'mb-6 scroll-mt-6';
  wrapper.id = `${catCode}--${subName.replace(/\s+/g, '-')}`;

  const h3 = document.createElement('h3');
  h3.className = 'text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2';
  h3.setAttribute('data-subcategory', subName);
  h3.textContent = subName;

  const tableWrap = document.createElement('div');
  tableWrap.className = 'relative';
  tableWrap.innerHTML = `
    <div class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-thin">
      <table class="min-w-[540px] w-full text-sm border-collapse rounded-lg border border-gray-200 dark:border-gray-700">
        <thead>
          <tr class="bg-gray-50 dark:bg-gray-800">
            <th class="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300 w-[100px]">용어</th>
            <th class="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300 w-[140px]">풀네임</th>
            <th class="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">설명</th>
            <th class="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300 w-[160px]">관리</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800"></tbody>
      </table>
    </div>
  `;

  wrapper.appendChild(h3);
  wrapper.appendChild(tableWrap);
  section.appendChild(wrapper);

  enhanceSubcategoryHeading(h3, catCode, subName);
}

// ---- Toast notification ------------------------------------------------- //

function showToast(message: string, isError = false): void {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-opacity duration-300 ${
    isError
      ? 'bg-red-600 text-white'
      : 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
