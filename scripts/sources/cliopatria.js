'use strict';

/**
 * Cliopatria(Seshat 프로젝트, CC BY 4.0) — 기원전 3400년~2024년 세계 정치체의 지도 데이터.
 *
 * 주의: 연도는 '그 정치체를 지도에 그린 해'의 범위다. 건국·멸망 연도와 같지 않을 수 있다
 * (예: 백제는 347년부터 그려져 있다). 그래서 건국·멸망 대조가 아니라 '그때 있었나' 보조 확인에 쓴다.
 * 레코드마다 Wikidata 번호가 있어 Wikidata 대조와 바로 이어진다.
 *
 * 파일이 크므로(압축 46MB, 풀면 170MB) 지도 다각형은 읽지 않고 properties 만 뽑는다.
 */

const { spawnSync } = require('child_process');
const { download } = require('./http');

const URL = 'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/main/cliopatria.geojson.zip';
const LICENSE = 'CC-BY-4.0';
const CREDIT = 'Cliopatria (Seshat Global History Databank), CC BY 4.0 — https://github.com/Seshat-Global-History-Databank/cliopatria';

/** @returns { byQid: { Q…: { qid, names:[], from, to, rows } }, file, rows } */
function load() {
  const zip = download(URL, 'cliopatria.geojson.zip');
  const r = spawnSync('unzip', ['-p', zip], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('Cliopatria 압축 풀기 실패: ' + r.stderr);
  const text = r.stdout;
  const re = /"properties"\s*:\s*(\{[^{}]*\})/g;
  const byQid = {};
  let m;
  let rows = 0;
  while ((m = re.exec(text))) {
    const p = JSON.parse(m[1]);
    if (p.Type && p.Type !== 'POLITY') continue;
    rows += 1;
    const key = p.Wikidata || ('name:' + p.Name);
    const a = byQid[key] || (byQid[key] = { qid: p.Wikidata || null, names: [], from: Infinity, to: -Infinity, rows: 0 });
    if (a.names.indexOf(p.Name) < 0) a.names.push(p.Name);
    a.from = Math.min(a.from, p.FromYear);
    a.to = Math.max(a.to, p.ToYear);
    a.rows += 1;
  }
  return { byQid: byQid, rows: rows, license: LICENSE, credit: CREDIT, url: URL };
}

module.exports = { load, LICENSE, CREDIT, URL };
