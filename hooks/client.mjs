// 훅·스킬 스크립트가 같이 쓰는 서버 연결 도우미.
// 서버(데몬)는 컴퓨터에 하나만 뜨고 모든 Claude 세션이 같이 쓴다. 세션은 서버 안에서 세션 id로 나뉜다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.CODE_MAP_PORT ?? 4747);
export const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server.mjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function info() {
  try {
    const r = await fetch(`${BASE}/api/ping`, { signal: AbortSignal.timeout(400) });
    const j = await r.json();
    return j.app === 'code-map' ? j : null;
  } catch {
    return null;
  }
}

const older = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

// 0.3 이하 데몬은 스스로 내리는 길이 없어서, 포트를 잡은 프로세스가 우리 데몬(server.mjs --daemon)일 때만 끝낸다
function killLegacyDaemon() {
  if (process.platform === 'win32') return false;
  try {
    const pid = Number(execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]);
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    if (!pid || !/server\.mjs/.test(cmd) || !/--daemon/.test(cmd)) return false;
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// 플러그인을 업데이트하면 예전 버전 데몬이 포트를 쥐고 있을 수 있다. 더 새 버전의 훅이 그 데몬을 내린다.
// 직접 띄운 서버(데모·폴더 모드)나 더 새 버전 서버는 건드리지 않는다.
async function retire(s) {
  if (s.daemon === false || !older(s.version, VERSION)) return false;
  let asked = false;
  if (s.pid) {
    try {
      asked = (await fetch(`${BASE}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) })).ok;
    } catch {}
  } else {
    asked = killLegacyDaemon();
  }
  if (!asked) return false;
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    if (!(await info())) return true;
  }
  return false;
}

// 서버가 떠 있는지 확인하고, start면 없을 때 백그라운드로 띄운다
export async function ensureServer(start, { dataDir } = {}) {
  let s = await info();
  if (s && start && (await retire(s))) s = null;
  if (s) return true;
  if (!start) return false;
  const env = { ...process.env };
  if (dataDir) env.CLAUDE_PLUGIN_DATA = dataDir;
  spawn(process.execPath, [SERVER, '--daemon', '--port', String(PORT)], { detached: true, stdio: 'ignore', env }).unref();
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if (await info()) return true;
  }
  return false;
}

export async function post(pathname, body) {
  try {
    const r = await fetch(BASE + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return await r.json();
  } catch {
    return null;
  }
}

export async function get(pathname) {
  try {
    const r = await fetch(BASE + pathname, { signal: AbortSignal.timeout(1500) });
    return await r.json();
  } catch {
    return null;
  }
}
