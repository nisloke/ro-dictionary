#!/usr/bin/env node
/**
 * sync-to-supabase.mjs
 * 로컬 terms.json / categories.json → Supabase 단방향 동기화
 *
 * 동작:
 *  1. 로컬 JSON을 읽는다
 *  2. Supabase에서 현재 데이터를 가져온다
 *  3. diff를 계산한다 (추가 / 수정 / 삭제)
 *  4. upsert + delete로 동기화한다
 *
 * 환경변수:
 *  SUPABASE_SERVICE_KEY — service_role 키 (필수)
 *
 * 사용:
 *  node scripts/sync-to-supabase.mjs
 *  또는 pre-commit hook에서 자동 호출
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Config ----
const SB_URL = 'https://nyftkqzrbanrxcoaxzke.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SB_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY 환경변수가 설정되지 않았습니다.');
  console.error('   set SUPABASE_SERVICE_KEY=your-service-role-key');
  process.exit(1);
}

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

// ---- Load local data ----
function loadLocalTerms() {
  const raw = JSON.parse(readFileSync(join(__dirname, '../src/data/terms.json'), 'utf-8'));
  // terms.json now uses snake_case (full_name), matching Supabase directly
  return raw.map((t) => ({
    id: t.id,
    term: t.term,
    full_name: t.full_name || null,
    category: t.category,
    subcategory: t.subcategory || null,
    description: t.description || null,
    tags: t.tags || [],
  }));
}

function loadLocalCategories() {
  const raw = JSON.parse(readFileSync(join(__dirname, '../src/data/categories.json'), 'utf-8'));
  return raw.map((c) => ({
    code: c.code,
    name: c.name,
    order: c.order,
    description: c.description || null,
  }));
}

// ---- Fetch remote data ----
async function fetchRemote(table, keyField) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?select=*`, { headers });
  if (!res.ok) throw new Error(`Fetch ${table}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return new Map(rows.map((r) => [r[keyField], r]));
}

// ---- Deep compare (JSON stringify for simplicity) ----
function rowChanged(local, remote) {
  // Compare only synced fields
  for (const key of Object.keys(local)) {
    if (JSON.stringify(local[key]) !== JSON.stringify(remote[key])) {
      return true;
    }
  }
  return false;
}

// ---- Upsert batch ----
async function upsertBatch(table, rows) {
  if (rows.length === 0) return;
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`Upsert ${table} batch ${i}: ${res.status} ${await res.text()}`);
    }
  }
}

// ---- Delete rows ----
async function deleteRows(table, keyField, ids) {
  if (ids.length === 0) return;
  // URL-encode the filter: id=in.(val1,val2,...)
  const filter = `${keyField}=in.(${ids.map((id) => `"${id}"`).join(',')})`;
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal' },
  });
  if (!res.ok) {
    throw new Error(`Delete ${table}: ${res.status} ${await res.text()}`);
  }
}

// ---- Sync one table ----
async function syncTable(table, keyField, localRows) {
  const remoteMap = await fetchRemote(table, keyField);
  const localMap = new Map(localRows.map((r) => [r[keyField], r]));

  const toUpsert = [];
  const toDelete = [];

  // Find new or changed rows
  for (const [key, localRow] of localMap) {
    const remoteRow = remoteMap.get(key);
    if (!remoteRow || rowChanged(localRow, remoteRow)) {
      toUpsert.push(localRow);
    }
  }

  // Find deleted rows (in remote but not in local)
  for (const key of remoteMap.keys()) {
    if (!localMap.has(key)) {
      toDelete.push(key);
    }
  }

  // Apply changes
  if (toUpsert.length > 0) {
    await upsertBatch(table, toUpsert);
  }
  if (toDelete.length > 0) {
    await deleteRows(table, keyField, toDelete);
  }

  return { upserted: toUpsert.length, deleted: toDelete.length };
}

// ---- Main ----
async function main() {
  console.log('🔄 Supabase 동기화 시작...');

  const localTerms = loadLocalTerms();
  const localCategories = loadLocalCategories();

  const catResult = await syncTable('categories', 'code', localCategories);
  const termResult = await syncTable('terms', 'id', localTerms);

  const totalChanges = catResult.upserted + catResult.deleted + termResult.upserted + termResult.deleted;

  if (totalChanges === 0) {
    console.log('✅ 변경 없음 — Supabase가 이미 최신 상태입니다.');
  } else {
    console.log(`✅ 동기화 완료:`);
    if (catResult.upserted > 0) console.log(`   📁 categories: ${catResult.upserted}개 추가/수정`);
    if (catResult.deleted > 0)  console.log(`   📁 categories: ${catResult.deleted}개 삭제`);
    if (termResult.upserted > 0) console.log(`   📖 terms: ${termResult.upserted}개 추가/수정`);
    if (termResult.deleted > 0)  console.log(`   📖 terms: ${termResult.deleted}개 삭제`);
  }
}

main().catch((err) => {
  console.error('❌ 동기화 실패:', err.message);
  process.exit(1);
});
