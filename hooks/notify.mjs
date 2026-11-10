#!/usr/bin/env node
// Claude Code 훅 → Code Map 서버. 훅 입력(JSON)을 그대로 받아 필요한 필드만 보낸다.
// 서버가 없으면 백그라운드로 띄운다. SessionStart에서는 이 세션의 지도 주소를 사용자에게 보여 준다.
// 표준 출력에는 SessionStart의 JSON 말고는 아무것도 쓰지 않는다(일부 훅의 출력은 Claude 컨텍스트에 들어간다).
import { ensureServer, post } from './client.mjs';

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  if (process.env.CODE_MAP_DISABLE === '1') return;
  let h = {};
  try { h = JSON.parse(raw || '{}'); } catch { return; }
  const event = h.hook_event_name;
  const body = {
    hook_event_name: event,
    session_id: h.session_id,
    cwd: h.cwd,
    prompt: h.prompt,
    session_title: h.session_title,
    file_path: h.tool_input?.file_path ?? h.tool_input?.notebook_path,
  };
  // 서버를 새로 띄울 만한 이벤트에서만 띄운다(Stop·SessionEnd 때문에 다시 살리지 않는다)
  const start = event === 'SessionStart' || event === 'UserPromptSubmit';
  if (!(await ensureServer(start))) return;
  const r = await post('/api/hook', body);
  if (event === 'SessionStart' && r?.url && h.source !== 'compact' && process.env.CODE_MAP_QUIET !== '1') {
    process.stdout.write(JSON.stringify({ systemMessage: `Code Map: ${r.url}` }));
  }
});
