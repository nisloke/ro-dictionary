#!/usr/bin/env node
/**
 * Git pre-commit hook 설치 스크립트
 * 실행: npm run setup-hooks
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hooksDir = join(__dirname, '../.git/hooks');
const src = join(__dirname, 'pre-commit-sync.sh');
const dest = join(hooksDir, 'pre-commit');

if (!existsSync(hooksDir)) {
  mkdirSync(hooksDir, { recursive: true });
}

copyFileSync(src, dest);
try { chmodSync(dest, 0o755); } catch { /* Windows doesn't need chmod */ }

console.log('✅ Git pre-commit hook 설치 완료!');
console.log('');
console.log('사용법:');
console.log('  1. SUPABASE_SERVICE_KEY 환경변수를 설정하세요');
console.log('     Windows: set SUPABASE_SERVICE_KEY=eyJ...');
console.log('');
console.log('  2. terms.json 수정 후 git commit 하면 자동 동기화됩니다');
console.log('');
console.log('  수동 동기화: npm run sync-db');
