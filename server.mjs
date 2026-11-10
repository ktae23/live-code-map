#!/usr/bin/env node
// Code Map 서버. Claude 세션마다 고친 클래스·메서드·호출 관계를 브라우저에 실시간으로 그린다.
//   node server.mjs --daemon          플러그인 훅이 자동으로 띄우는 모드(세션은 훅이 등록)
//   node server.mjs <프로젝트 경로>    훅 없이 폴더 하나를 지켜보는 모드
//   node server.mjs --demo            예제 Spring 프로젝트로 데모
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Project, findRoot } from './lib/project.mjs';
import { Session } from './lib/session.mjs';
import { syncWorkspace, runScenario } from './demo/scenario.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const port = Number(opt('--port', process.env.CODE_MAP_PORT ?? 4747));
const daemon = flag('--daemon');
const demo = flag('--demo');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');

const projects = new Map(); // 루트 → Project
const sessions = new Map(); // 세션 id → Session
const claims = new Map(); // `${루트}:${rel}` → { sid, ts } — PostToolUse로 확인된 "누가 고친 파일"
let lastActivity = Date.now();

function projectFor(root) {
  let p = projects.get(root);
  if (p) return p;
  p = new Project(root);
  projects.set(root, p);
  const t0 = Date.now();
  p.scan();
  console.log(`[${p.name}] ${p.files.size}개 파일, ${p.cur.size}개 클래스를 ${Date.now() - t0}ms에 읽었어요.`);
  p.watch((rels) => onFiles(p, rels));
  return p;
}

function addSession(id, root, meta) {
  const p = projectFor(root);
  const s = new Session(id, p, meta);
  p.sessions.add(s);
  sessions.set(id, s);
  s.startTurn('', 'start');
  return s;
}

// 파일 변경을 어느 세션 몫으로 볼지: 방금 그 파일을 고친 세션 → 작업 중인 세션들
function owners(p, rel) {
  const c = claims.get(`${p.root}:${rel}`);
  if (c && Date.now() - c.ts < 5000 && sessions.has(c.sid)) return [sessions.get(c.sid)];
  return [...p.sessions].filter((s) => s.busy);
}

function onFiles(p, rels, only = null) {
  const deltas = rels.map((rel) => p.load(rel)).filter(Boolean);
  if (!deltas.length) return;
  p.rebuild();
  const bySession = new Map();
  for (const d of deltas) {
    for (const s of only ? [only] : owners(p, d.rel)) {
      if (!bySession.has(s)) bySession.set(s, []);
      bySession.get(s).push(d);
    }
  }
  for (const [s, list] of bySession) s.applyBatch(list);
}

// ---- 훅 이벤트 ----
function onHook(h) {
  lastActivity = Date.now();
  const id = h.session_id;
  if (!id) return {};
  let s = sessions.get(id);
  const cwd = h.cwd || process.cwd();
  if (!s) {
    if (h.hook_event_name === 'SessionEnd') return {};
    s = addSession(id, findRoot(cwd), { title: h.session_title ?? '' });
  }
  s.lastActive = Date.now();
  if (h.session_title) s.title = h.session_title;
  const p = s.project;
  const rel = h.file_path ? p.relOf(h.file_path) : null;
  switch (h.hook_event_name) {
    case 'SessionStart':
      s.closed = false;
      break;
    case 'UserPromptSubmit':
      s.startTurn(String(h.prompt ?? '').slice(0, 400));
      break;
    case 'PreToolUse':
      if (rel) {
        claims.set(`${p.root}:${rel}`, { sid: id, ts: Date.now() });
        s.intent(rel);
      }
      break;
    case 'PostToolUse':
      // 도구가 고친 파일은 감시보다 먼저 바로 반영하고 이 세션 몫으로 표시한다
      if (rel) {
        claims.set(`${p.root}:${rel}`, { sid: id, ts: Date.now() });
        onFiles(p, [rel], s);
      }
      break;
    case 'Stop':
      s.endTurn();
      break;
    case 'SessionEnd':
      s.endTurn();
      s.closed = true;
      break;
  }
  return { url: `http://127.0.0.1:${port}/s/${s.short}` };
}

function findSession(short) {
  if (!short) return null;
  return sessions.get(short) ?? [...sessions.values()].find((s) => s.short === short) ?? null;
}

function sessionList() {
  return [...sessions.values()]
    .sort((a, b) => b.lastActive - a.lastActive)
    .map((s) => ({ ...s.summary(), counts: s.payload([]).counts }));
}

// 오래된 세션·프로젝트 정리, 데몬은 할 일이 없으면 스스로 끝난다
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.manual || s.id === 'demo') continue;
    if ((s.closed && now - s.lastActive > 6 * 3600e3) || now - s.lastActive > 24 * 3600e3) {
      sessions.delete(id);
      s.project.sessions.delete(s);
    }
  }
  for (const [root, p] of projects) if (!p.sessions.size) { p.close(); projects.delete(root); }
  for (const [k, c] of claims) if (now - c.ts > 60e3) claims.delete(k);
  if (daemon && !sessions.size && !clients.size && now - lastActivity > 30 * 60e3) process.exit(0);
}, 60e3).unref();

// ---- HTTP ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const clients = new Set();
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000).unref();

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 262144) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  // 소스 코드가 오가는 서버라 DNS 리바인딩·다른 사이트의 요청을 막는다
  const origin = req.headers.origin?.replace(/^https?:\/\//, '');
  if (!allowedHosts.has(req.headers.host) || (origin && !allowedHosts.has(origin))) {
    res.writeHead(403).end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = (k) => url.searchParams.get(k);
  const json = (obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'GET' && url.pathname === '/api/ping') return json({ app: 'code-map', version: VERSION });
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const cwd = q('cwd');
    const root = cwd ? findRoot(cwd) : null;
    return json({ sessions: sessionList().filter((s) => !root || s.root === root) });
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    const s = findSession(q('s'));
    if (!s) return json({ error: 'no session' }, 404);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
    send(s.payload([]));
    s.listeners.add(send);
    clients.add(res);
    req.on('close', () => { s.listeners.delete(send); clients.delete(res); });
    return;
  }
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/hook') {
    const s = findSession(q('s'));
    if (!s && url.pathname !== '/api/demo') return json({ error: 'no session' }, 404);
    if (req.method === 'GET' && url.pathname === '/api/state') return json(s.payload([]));
    if (req.method === 'GET' && url.pathname === '/api/frames') return json({ frames: s.frames });
    if (req.method === 'GET' && url.pathname === '/api/diff') {
      const d = s.diffText(q('id'), q('key'));
      return d ? json(d) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') { s.startTurn('', 'reset'); return json({ ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/demo' && demo) {
      const d = sessions.get('demo');
      runScenario(d, d.project.root).catch((e) => console.error(e));
      return json({ ok: true });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/hook') {
    const h = await readJson(req);
    try {
      return json(onHook(h));
    } catch (e) {
      console.error('hook 처리 실패', e);
      return json({ error: e.message }, 500);
    }
  }
  if (req.method === 'GET') {
    const file = url.pathname === '/' || url.pathname.startsWith('/s/') ? 'index.html' : url.pathname.slice(1);
    const abs = path.join(HERE, 'public', path.normalize(file));
    if (abs.startsWith(path.join(HERE, 'public')) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(abs).pipe(res);
      return;
    }
  }
  res.writeHead(404).end();
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `${port} 포트를 이미 쓰고 있어요. --port 로 다른 포트를 지정하세요.` : e.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${port}`;
  let first = base;
  if (demo) {
    const root = path.join(HERE, 'demo', '.workspace', 'shop');
    syncWorkspace(path.join(HERE, 'demo', 'shop'), root);
    addSession('demo', root, { title: '데모 · 주문 결제 기능', manual: true });
    first = `${base}/s/demo`;
  } else if (!daemon) {
    const root = path.resolve(positional[0] ?? '.');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      console.error(`폴더를 찾을 수 없어요: ${root}`);
      process.exit(1);
    }
    addSession('local', root, { title: path.basename(root), manual: true });
    first = `${base}/s/local`;
  }
  console.log(`Code Map ${VERSION}: ${first}`);
  if (flag('--open')) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [first], () => {});
});
