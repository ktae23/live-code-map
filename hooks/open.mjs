#!/usr/bin/env node
// /live-code-map 스킬이 부른다.
//   node open.mjs --session <세션 id> [--data <플러그인 데이터 폴더>]          이 세션의 지도를 켜고 브라우저로 연다
//   node open.mjs --session <세션 id> [--data <플러그인 데이터 폴더>] off      이 세션의 지도를 끈다(기록을 버리고 다시 묻지 않음)
//   node open.mjs --session <세션 id> [--data <플러그인 데이터 폴더>] reset    이 저장소의 "항상 열기/묻지 않기"를 지운다
//   CODE_MAP_BROWSER=Aside 처럼 앱 이름을 주면 그 브라우저로 연다(macOS)
import { ensureServer, get, post, BASE } from './client.mjs';
import { Store, dataDir, openUrl, startTracking } from './state.mjs';
import { findRoot } from '../lib/root.mjs';

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.includes('${') ? v : undefined;
};
const sessionId = opt('--session');
const store = new Store(dataDir(opt('--data')));
const cwd = process.cwd();

async function main() {
  if (args.includes('off')) {
    if (!sessionId) {
      console.log('세션 id를 몰라 끌 세션을 고르지 못했어요. 지도 화면 오른쪽 위의 "끄기"를 눌러 주세요.');
      return;
    }
    store.setSession(sessionId, { mode: 'off', auto: null });
    const closed = (await ensureServer(false)) && (await post('/api/close', { session_id: sessionId }))?.ok;
    const always = store.repo(findRoot(cwd)) === 'always';
    console.log((closed ? '이 세션의 Live Code Map을 껐어요.' : '이 세션은 지도가 켜져 있지 않아요. 앞으로 이 세션에서는 묻지 않아요.')
      + ' 다시 켜려면 /live-code-map'
      + (always ? '\n이 저장소는 "항상 열기"로 돼 있어서 새 세션에서는 다시 켜져요. 그만 켜려면 /live-code-map reset 후 질문에 "이 저장소는 묻지 않기"를 고르세요.' : ''));
    return;
  }

  if (args.includes('reset')) {
    const root = findRoot(cwd);
    const ok = store.setRepo(root, null);
    if (sessionId) store.setSession(sessionId, { mode: null, auto: null });
    console.log(ok
      ? `${root} 저장소의 Live Code Map 선택을 지웠어요. 다음에 Java/Kotlin 코드 작업을 시키면 다시 물어봐요.`
      : `선택을 저장한 파일을 고치지 못했어요: ${store.dir}/repos.json`);
    return;
  }

  if (sessionId) {
    const url = await startTracking(store, { sessionId, cwd });
    console.log(url
      ? `Live Code Map을 열었어요: ${url}\n지금부터 이 세션이 고치는 Java/Kotlin 코드가 지도에 그려져요.`
      : 'Live Code Map 서버를 띄우지 못했어요. Node 20 이상이 설치돼 있는지, 4747 포트를 다른 프로그램이 쓰고 있지 않은지 확인해 주세요.');
    return;
  }

  // 세션 id를 모르면(스킬 치환을 지원하지 않는 Claude Code) 이 폴더의 최근 세션이나 세션 목록을 연다
  if (!(await ensureServer(true, { dataDir: store.dir }))) {
    console.log('Live Code Map 서버를 띄우지 못했어요. Node 20 이상이 설치돼 있는지, 4747 포트를 다른 프로그램이 쓰고 있지 않은지 확인해 주세요.');
    return;
  }
  const list = (await get(`/api/sessions?cwd=${encodeURIComponent(cwd)}`))?.sessions ?? [];
  const url = list.length ? `${BASE}/s/${list[0].short}` : BASE;
  openUrl(url);
  console.log(list.length ? `Live Code Map을 열었어요: ${url}` : `이 폴더에서 켠 세션이 없어 세션 목록을 열었어요: ${url}`);
}

await main();
