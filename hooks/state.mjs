// 훅과 /live-code-map 스킬이 같이 쓰는 상태와 동작.
//   세션별 선택: on(지도 켬) / off(이 세션은 묻지 않음) — 플러그인 데이터 폴더의 sessions/<id>.json
//   저장소별 선택: always(묻지 않고 켬) / never(묻지 않음) — repos.json
// 프롬프트나 코드는 디스크에 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ensureServer, post } from './client.mjs';

// ask(기본): 코드 작업 요청 때 Claude가 열지 물어본다 / always: 묻지 않고 켠다 / off: 아무것도 하지 않는다
export const MODE = process.env.CODE_MAP_DISABLE === '1' ? 'off' : (process.env.CODE_MAP_MODE || 'ask').toLowerCase();

const usable = (v) => (v && !v.includes('${') ? v : undefined);

export function dataDir(explicit) {
  return usable(explicit) ?? usable(process.env.CLAUDE_PLUGIN_DATA) ?? path.join(os.homedir(), '.claude', 'live-code-map');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export class Store {
  constructor(dir) {
    this.dir = dir;
  }

  sessionFile(id) {
    return path.join(this.dir, 'sessions', `${String(id).replace(/[^\w-]/g, '_').slice(0, 80)}.json`);
  }

  session(id) {
    return readJson(this.sessionFile(id), {});
  }

  setSession(id, patch) {
    const next = { ...this.session(id), ...patch, ts: Date.now() };
    for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
    writeJson(this.sessionFile(id), next);
    if (Math.random() < 0.05) this.prune();
    return next;
  }

  repo(root) {
    return readJson(path.join(this.dir, 'repos.json'), {})[root] ?? null;
  }

  setRepo(root, choice) {
    const file = path.join(this.dir, 'repos.json');
    const all = readJson(file, {});
    if (choice) all[root] = choice;
    else delete all[root];
    return writeJson(file, all);
  }

  // 일주일 넘은 세션 선택은 지운다
  prune() {
    const dir = path.join(this.dir, 'sessions');
    try {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.rmSync(p, { force: true });
      }
    } catch {}
  }
}

export function openUrl(url) {
  const browser = process.env.CODE_MAP_BROWSER;
  if (browser === 'none') return;
  if (process.platform === 'darwin') execFile('open', browser ? ['-a', browser, url] : [url], () => {});
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
  else execFile('xdg-open', [url], () => {});
}

// 지금 요청의 프롬프트를 대화 기록 끝에서 찾는다(지도 상단에 보여 줄 제목). 못 찾으면 빈 문자열.
export function lastPrompt(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let d;
      try { d = JSON.parse(lines[i]); } catch { continue; }
      if (d.type !== 'user' || d.isMeta) continue;
      const c = d.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) && c.length && c.every((x) => x.type === 'text') ? c.map((x) => x.text).join('\n') : null;
      if (text && !text.startsWith('<')) return text.slice(0, 400);
    }
  } catch {}
  return '';
}

// 이 세션의 지도를 켠다: 서버를 띄우고 세션을 등록한 뒤(지금 상태가 비교 기준) 브라우저로 연다
export async function startTracking(store, { sessionId, cwd, prompt = '', open = true }) {
  if (!(await ensureServer(true))) return null;
  const r = await post('/api/open', { session_id: sessionId, cwd, prompt });
  if (!r?.url) return null;
  store.setSession(sessionId, { mode: 'on' });
  if (open) openUrl(r.url);
  return r.url;
}

// UserPromptSubmit에서 Claude 컨텍스트에 붙이는 안내. 코드 작업인지는 Claude가 요청 내용을 보고 판단한다.
export const ASK_NOTE = [
  'Live Code Map plugin: only if this request will make you add, change or delete Java/Kotlin source code,',
  'ask the user once, before your first file edit, with the AskUserQuestion tool whether to open Live Code Map',
  '(a live browser diagram of the classes, methods and calls you change in this session).',
  'Use the header "Code Map", a one-line question in the user\'s language, and these four options in this order',
  '(translate the labels): "Open" (show the live map now), "Not now" (don\'t ask again in this session),',
  '"Always in this repo" (open automatically from now on, without asking), "Never in this repo".',
  'A hook acts on the answer, so do not run anything for it; just continue the task.',
  'Do not ask if this is not a Java/Kotlin code change (a question, review, explanation, git, docs or config work),',
  'if you already asked about Code Map in this conversation, or if AskUserQuestion is unavailable.',
].join(' ');

const CHOICES = ['open', 'off', 'always', 'never'];

function guessChoice(text) {
  if (/always|항상|자동/i.test(text)) return 'always';
  if (/never|묻지|다시는/i.test(text)) return 'never';
  if (/not now|later|나중|안\s*열|아니|그냥|skip|\bno\b/i.test(text)) return 'off';
  if (/open|열|yes|네|응|좋아/i.test(text)) return 'open';
  return null;
}

// AskUserQuestion 결과에서 Code Map 질문의 답을 찾는다. 질문이 없으면 null.
export function readAnswer(h) {
  const questions = h.tool_input?.questions ?? h.tool_response?.questions ?? [];
  const answers = { ...(h.tool_input?.answers ?? {}), ...(h.tool_response?.answers ?? {}) };
  const q = questions.find((x) => /code\s*-?\s*map|코드\s*맵/i.test(`${x.header ?? ''} ${x.question ?? ''}`));
  if (!q) return null;
  const text = String(answers[q.question] ?? '').trim();
  // 안내한 네 가지 보기를 순서대로 썼으면 순서로, 직접 입력한 답이면 낱말로 판단한다
  const idx = (q.options ?? []).findIndex((o) => o.label === text);
  const byOrder = q.options?.length === CHOICES.length ? CHOICES[idx] : undefined;
  return { text, choice: byOrder ?? guessChoice(text) };
}
