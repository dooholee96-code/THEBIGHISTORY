'use strict';

/**
 * 외부 데이터 받기 — curl 로 부른다(이 환경의 HTTPS 프록시·인증서 설정을 그대로 쓰려고).
 *
 *   · 모든 요청에 프로젝트를 밝히는 User-Agent 를 단다(Wikimedia 정책)
 *   · 429·5xx 는 Retry-After 만큼 기다렸다 다시(최대 6번). 조회 시간 초과는 다시 보내지 않는다
 *   · 받은 응답은 .cache/sources/ 에 저장해 같은 요청을 다시 보내지 않는다(--fresh 로 무시)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'sources');
const USER_AGENT = 'BigHistoryTimeline/0.2 (https://github.com/dooholee96-code/thebighistory; open-data timeline, batch import)';
const FRESH = process.argv.includes('--fresh');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cachePath(key) {
  return path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');
}

/**
 * @param url
 * @param o { form: {k: v} 이면 POST(urlencoded), headers: {}, accept, cache: true, minGapMs }
 * @returns 응답 본문(문자열)
 */
let lastAt = 0;
function request(url, o) {
  o = o || {};
  const key = url + '\n' + JSON.stringify(o.form || null);
  const file = cachePath(key);
  if (o.cache !== false && !FRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).body;

  const gap = o.minGapMs == null ? 1200 : o.minGapMs;   // 같은 곳을 연달아 두드리지 않게
  const wait = lastAt + gap - Date.now();
  if (wait > 0) sleep(wait);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const args = ['-sS', '-m', '120', '-A', USER_AGENT, '-D', '-', '-o', '-'];
    if (o.accept) args.push('-H', 'Accept: ' + o.accept);
    Object.keys(o.headers || {}).forEach((h) => args.push('-H', h + ': ' + o.headers[h]));
    if (o.form) Object.keys(o.form).forEach((k) => args.push('--data-urlencode', k + '=' + o.form[k]));
    args.push(url);
    const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    lastAt = Date.now();
    if (r.status !== 0) {
      console.warn(`  [http] curl 실패(${attempt}/6): ${(r.stderr || '').trim()}`);
      sleep(3000 * attempt);
      continue;
    }
    // 프록시가 앞에 붙이는 'Connection Established' 머리까지 건너뛰고 마지막 응답 머리를 읽는다
    const out = r.stdout;
    let headEnd = -1;
    let statusLine = '';
    let pos = 0;
    while (out.startsWith('HTTP/', pos)) {
      headEnd = out.indexOf('\r\n\r\n', pos);
      if (headEnd < 0) break;
      statusLine = out.slice(pos, out.indexOf('\r\n', pos));
      pos = headEnd + 4;
    }
    const head = out.slice(0, pos);
    const body = out.slice(pos);
    const status = Number((statusLine.match(/ (\d{3})/) || [])[1] || 0);
    // 조회 서비스의 시간 초과(60초)는 같은 질의를 다시 보내도 또 넘으므로 바로 알린다
    if (status >= 500 && /TimeoutException/.test(body)) {
      const e = new Error(`${new URL(url).host} 질의가 시간 제한을 넘었습니다 — 질의를 가볍게 해야 합니다`);
      e.timeout = true;
      throw e;
    }
    if (status === 429 || status >= 500) {
      const ra = Number((head.match(/retry-after:\s*(\d+)/i) || [])[1] || 0);
      // 오래 기다리라고 하면(공용 IP 가 통째로 제한된 경우 등) 붙잡고 있지 말고 알린다
      if (ra > 180) {
        const e = new Error(`${new URL(url).host} 가 요청을 제한했습니다 — ${ra}초(약 ${Math.ceil(ra / 60)}분) 뒤에 다시 하거나 다른 네트워크에서 실행하세요. 받은 것은 캐시에 남아 이어서 할 수 있습니다.`);
        e.retryAfter = ra;
        throw e;
      }
      const ms = Math.min(120, Math.max(ra, 5 * attempt)) * 1000;
      console.warn(`  [http] ${status} — ${Math.round(ms / 1000)}초 기다렸다 다시(${attempt}/6)`);
      sleep(ms);
      continue;
    }
    if (status !== 200) throw new Error(`${url} → HTTP ${status}\n${body.slice(0, 300)}`);
    if (o.cache !== false) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ url, at: new Date().toISOString(), body }));
    }
    return body;
  }
  throw new Error(`${url} — 여러 번 시도했지만 받지 못했습니다`);
}

function getJSON(url, o) {
  return JSON.parse(request(url, Object.assign({ accept: 'application/json' }, o)));
}

/** 파일을 그대로 내려받는다(큰 파일, 캐시 폴더에 저장). 이미 있으면 그대로 쓴다 */
function download(url, name) {
  const file = path.join(CACHE_DIR, name);
  if (!FRESH && fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const r = spawnSync('curl', ['-sS', '-L', '-m', '600', '-A', USER_AGENT, '-o', file, '-w', '%{http_code}', url], { encoding: 'utf8' });
  if (r.status !== 0 || r.stdout.trim() !== '200') {
    try { fs.unlinkSync(file); } catch (e) { /* 없음 */ }
    throw new Error(`${url} 내려받기 실패: ${r.stdout} ${r.stderr}`);
  }
  return file;
}

module.exports = { request, getJSON, download, sleep, CACHE_DIR, USER_AGENT };
