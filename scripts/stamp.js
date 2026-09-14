#!/usr/bin/env node
'use strict';

/**
 * 배포 버전 스탬프 찍기.
 *
 * index.html 의 css/js 참조에 `?v=<해시>` 를 붙이고, sw.js 의 CACHE_VERSION 을
 * 같은 해시로 맞춘다. 해시는 앱 소스 내용에서 계산하므로, 코드가 바뀌면 URL 이
 * 바뀌고 브라우저·서비스워커 캐시가 자동으로 무시된다.
 *
 * 이게 없으면 예전 서비스워커가 캐시에 있는 옛 js 를 계속 돌려주어,
 * 배포를 해도 사용자 화면이 그대로인 일이 생긴다.
 *
 *   node scripts/stamp.js        # npm run build 안에서 자동 실행됨
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// 해시 계산에 쓰는 파일들 (= 스탬프를 붙일 대상)
const ASSETS = [
  'css/styles.css',
  'js/data.js',
  'js/chapters.js',
  'js/app.js'
];

const hash = crypto.createHash('sha1');
for (const rel of ASSETS) {
  hash.update(fs.readFileSync(path.join(ROOT, rel)));
}
// 구조가 바뀌어도 갱신되도록 index.html 도 섞되, 기존 스탬프는 지우고 계산한다.
const indexPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
hash.update(html.replace(/\?v=[0-9a-f]+/g, ''));

const stamp = hash.digest('hex').slice(0, 8);

// 1) index.html 의 참조에 ?v= 붙이기
const assetPattern = new RegExp(
  '((?:href|src)=")(' + ASSETS.map((a) => a.replace(/[.]/g, '\\.')).join('|') + ')(\\?v=[0-9a-f]+)?(")',
  'g'
);
html = html.replace(assetPattern, (m, pre, file, old, post) => pre + file + '?v=' + stamp + post);
fs.writeFileSync(indexPath, html);

// 2) sw.js 의 캐시 이름과 미리 캐시 목록도 같은 스탬프로
const swPath = path.join(ROOT, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = 'bighistory-${stamp}';`);
for (const rel of ASSETS) {
  sw = sw.replace(
    new RegExp("'\\./" + rel.replace(/[.]/g, '\\.') + "(\\?v=[0-9a-f]+)?'"),
    "'./" + rel + '?v=' + stamp + "'"
  );
}
fs.writeFileSync(swPath, sw);

console.log(`버전 스탬프 ${stamp} — index.html 참조 ${ASSETS.length}개, sw.js CACHE_VERSION 갱신`);
