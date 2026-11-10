// 훅·스킬 스크립트가 같이 쓰는 서버 연결 도우미
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.CODE_MAP_PORT ?? 4747);
export const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ping() {
  try {
    const r = await fetch(`${BASE}/api/ping`, { signal: AbortSignal.timeout(400) });
    return (await r.json()).app === 'code-map';
  } catch {
    return false;
  }
}

// 서버가 떠 있는지 확인하고, start면 없을 때 백그라운드로 띄운다
export async function ensureServer(start) {
  if (await ping()) return true;
  if (!start) return false;
  spawn(process.execPath, [SERVER, '--daemon', '--port', String(PORT)], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if (await ping()) return true;
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
