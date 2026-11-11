#!/usr/bin/env node
// Claude Code 훅 → Live Code Map. 훅 입력(JSON)을 stdin으로 받는다.
// 기본(ask)은 세션마다 지도를 켜지 않는다. Java/Kotlin 저장소에서 요청이 오면 "코드 작업이면 열지 물어보라"는
// 안내를 Claude에 붙이고, 사용자가 고른 답(AskUserQuestion)을 이 훅이 읽어 지도를 켠다.
// 표준 출력은 Claude 컨텍스트나 화면에 들어가므로 정해진 JSON 말고는 쓰지 않는다.
import { ensureServer, post } from './client.mjs';
import { Store, dataDir, MODE, ASK_NOTE, openUrl, readAnswer, startTracking, lastPrompt } from './state.mjs';
import { findRoot, isJvmProject } from '../lib/root.mjs';

const OPEN_COMMAND = /^\s*\/(live-code-map:)?live-code-map\b/;
const say = (obj) => process.stdout.write(JSON.stringify(obj));

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  if (MODE === 'off') return;
  let h;
  try { h = JSON.parse(raw || '{}'); } catch { return; }
  if (!h.session_id) return;
  const store = new Store(dataDir());
  if (h.hook_event_name === 'PostToolUse' && h.tool_name === 'AskUserQuestion') return onAnswer(h, store);
  if (h.hook_event_name === 'UserPromptSubmit') return onPrompt(h, store);
  return forward(h, store);
});

function hookBody(h, extra = {}) {
  return {
    hook_event_name: h.hook_event_name,
    session_id: h.session_id,
    cwd: h.cwd,
    prompt: h.prompt,
    session_title: h.session_title,
    file_path: h.tool_input?.file_path ?? h.tool_input?.notebook_path,
    ...extra,
  };
}

async function onPrompt(h, store) {
  const st = store.session(h.session_id);
  if (st.mode === 'on') {
    if (await ensureServer(true)) await post('/api/hook', hookBody(h, { track: true, autoOpen: !!st.auto }));
    return;
  }
  if (st.mode === 'off' || OPEN_COMMAND.test(String(h.prompt ?? ''))) return;
  const cwd = h.cwd || process.cwd();
  const root = findRoot(cwd);
  if (!isJvmProject(root, cwd)) return;
  const pref = MODE === 'always' ? 'always' : store.repo(root);
  if (pref === 'never') return;
  if (pref === 'always') {
    // 묻지 않고 기록을 시작하고, 이 세션에서 코드가 처음 바뀔 때 브라우저를 연다
    store.setSession(h.session_id, { mode: 'on', auto: true });
    if (await ensureServer(true)) await post('/api/hook', hookBody(h, { track: true, autoOpen: true }));
    return;
  }
  say({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ASK_NOTE } });
}

async function onAnswer(h, store) {
  const a = readAnswer(h);
  if (!a) return;
  const cwd = h.cwd || process.cwd();
  const root = findRoot(cwd);
  const tell = (context, systemMessage) =>
    say({ ...(systemMessage ? { systemMessage } : {}), hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } });

  if (a.choice === 'open' || a.choice === 'always') {
    if (a.choice === 'always') store.setRepo(root, 'always');
    const url = await startTracking(store, { sessionId: h.session_id, cwd, prompt: lastPrompt(h.transcript_path) });
    if (!url) return tell('Live Code Map could not start its local server (it needs Node 20+ and a free port 4747). Tell the user in one line, then continue the task.');
    return tell(`Live Code Map is open at ${url}. Continue the task without mentioning it again.`, `Live Code Map: ${url}`);
  }
  store.setSession(h.session_id, { mode: 'off' });
  if (a.choice === 'never') store.setRepo(root, 'never');
  if (a.choice) return tell('Live Code Map stays closed. Do not ask about it again; continue the task.');
  tell(`The user answered "${a.text}" to the Code Map question. If that means they want the map, run the /live-code-map skill; otherwise continue without asking again.`);
}

// 편집·요청 끝 이벤트: 지도를 켠 세션이면 서버로 보낸다. 서버는 등록되지 않은 세션의 이벤트를 무시한다.
async function forward(h, store) {
  const st = store.session(h.session_id);
  const on = st.mode === 'on';
  // 켠 세션은 서버가 꺼져 있으면 파일을 고친 직후 다시 띄운다. 그 밖에는 떠 있을 때만 보낸다(/live-code-map으로 켠 경우).
  if (!(await ensureServer(on && h.hook_event_name === 'PostToolUse'))) return;
  const r = await post('/api/hook', hookBody(h, { track: on, autoOpen: on && !!st.auto }));
  if (r?.open && r.url) openUrl(r.url);
}
