#!/usr/bin/env node
'use strict';

/**
 * data/*.json → data/bundle.js 생성기.
 *
 * 브라우저에서 index.html 을 file:// 로 바로 열면 보안 정책 때문에 fetch 로
 * JSON 을 읽을 수 없습니다. 이때 쓰이는 사본이 data/bundle.js 입니다.
 * JSON 이 항상 원본이고 bundle.js 는 파생물이므로, 데이터를 고친 뒤에는
 *   npm run build
 * 를 한 번 실행해 주세요. (로컬 서버로 띄워 쓸 때는 없어도 동작합니다.)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'bundle.js');

const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
const files = {};
let entryCount = 0;

for (const ds of manifest.datasets || []) {
  const file = path.join(DATA_DIR, ds.file);
  if (!fs.existsSync(file)) {
    console.error(`✗ data/${ds.file} 이 없습니다. 매니페스트를 확인하세요.`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  files[ds.file] = doc;
  entryCount += (doc.entries || []).length;
}

const payload = {
  generated_at: new Date().toISOString(),
  manifest,
  files
};

const banner = [
  '/* 자동 생성 파일 — 직접 수정하지 마세요.',
  ' * 원본: data/index.json 및 data/*.json',
  ' * 재생성: npm run build',
  ' *',
  ' * file:// 로 index.html 을 열었을 때 fetch 대신 사용되는 데이터 사본입니다.',
  ' */'
].join('\n');

fs.writeFileSync(
  OUT,
  `${banner}\nwindow.BIG_HISTORY_BUNDLE = ${JSON.stringify(payload)};\n`
);

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`data/bundle.js 생성 완료 — 데이터셋 ${Object.keys(files).length}개, 항목 ${entryCount}개 (${kb} KB)`);
