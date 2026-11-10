#!/usr/bin/env node
// /code-map 스킬이 부른다: 지금 폴더의 가장 최근 Claude 세션 지도를 브라우저로 연다.
//   CODE_MAP_BROWSER=Aside 처럼 앱 이름을 주면 그 브라우저로 연다(macOS)
import { execFile } from 'node:child_process';
import { ensureServer, get, BASE } from './client.mjs';

const ok = await ensureServer(true);
if (!ok) {
  console.log('Code Map 서버를 띄우지 못했어요. node가 설치돼 있는지, 4747 포트를 다른 프로그램이 쓰고 있지 않은지 확인해 주세요.');
  process.exit(0);
}
const list = (await get(`/api/sessions?cwd=${encodeURIComponent(process.cwd())}`))?.sessions ?? [];
const url = list.length ? `${BASE}/s/${list[0].short}` : BASE;
const browser = process.env.CODE_MAP_BROWSER;
if (process.platform === 'darwin') execFile('open', browser ? ['-a', browser, url] : [url], () => {});
else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
else execFile('xdg-open', [url], () => {});
console.log(list.length ? `Code Map을 열었어요: ${url}` : `이 폴더의 Claude 세션이 아직 등록되지 않아 세션 목록을 열었어요: ${url}`);
