// Live Code Map 화면: 서버가 보내는 세션별 변경 상태를 레이어별 클래스 카드, 의존 관계선, 메서드 호출선으로 그린다.
const $ = (s) => document.querySelector(s);
const COL_W = 312, GAP_X = 140, GAP_Y = 18, TOP = 48, PAD = 28;
const FOLLOW_ZOOM = 0.8;
const LANES = [['controller', 'Controller'], ['service', 'Service'], ['repository', 'Repository'], ['domain', 'Domain'], ['other', 'DTO · 기타']];
const KCHIP = { class: ['C', 'c'], data: ['D', 'c'], abstract: ['A', 'c'], sealed: ['S', 'c'], interface: ['I', 'i'], enum: ['E', 'e'], object: ['O', 'o'], record: ['R', 'r'], annotation: ['@', 'i'], file: ['F', 'f'] };
const KIND_WORD = { interface: 'interface', enum: 'enum', data: 'data class', record: 'record', object: 'object', abstract: 'abstract class', sealed: 'sealed class', annotation: 'annotation', file: '최상위 선언' };
const MCHIP = { method: 'm', prop: 'p', field: 'f', ctor: 'c', entry: 'e' };
const MARK = { added: '+', modified: '~', deleted: '−' };
const UNCHANGED_LIMIT = 6;
const SID = decodeURIComponent(location.pathname.match(/^\/s\/([^/]+)/)?.[1] ?? '');

const viewport = $('#viewport'), stage = $('#stage'), cardsEl = $('#cards');
const edgesSvg = $('#edges'), edgeLayer = $('#edgeLayer'), callLayer = $('#callLayer'), lanesEl = $('#lanes');
const nodes = new Map(); // id → { el, card, keys, html, fresh, rows }
const edgeEls = new Map();
const callEls = new Map();
const expanded = new Set();
const view = { x: 24, y: 12, k: 1 };
let pos = new Map();
let stageSize = { w: 0, h: 0 };
let live = null, shown = null;
let replaying = false;
let follow = true;
let endedTurn = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const fmtDur = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)}초` : `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`);
const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`; };
const pkgTail = (pkg) => pkg.split('.').slice(-2).join('.');
const bump = (map, id) => { const n = map.get(id) ?? 0; map.set(id, n + 1); return n; };
const api = (p) => `${p}${p.includes('?') ? '&' : '?'}s=${encodeURIComponent(SID)}`;
const post = (url) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

// ---- 그리기 ----
function render(p, { replay = false, camera: moveCamera = true } = {}) {
  shown = p;
  setHeader(p);
  const ids = new Set(p.classes.map((c) => c.id));
  for (const [id, n] of nodes) {
    if (ids.has(id)) continue;
    n.el.classList.add('leaving');
    setTimeout(() => n.el.remove(), 350);
    nodes.delete(id);
  }
  for (const c of p.classes) {
    let n = nodes.get(c.id);
    if (!n) {
      n = createNode(c.id);
      nodes.set(c.id, n);
    }
    fillNode(n, c);
  }
  layout(p.classes, p.edges, p.calls);
  drawEdges(p.edges);
  drawCalls(p.calls);
  const empty = p.classes.length === 0;
  $('#empty').hidden = !empty;
  $('#emptyTitle').textContent = p.stats.ready === false ? '프로젝트를 읽는 중' : '변경을 기다리는 중';
  $('#emptySub').textContent = `${p.session.project} · ${p.stats.classes}개 클래스 · ${p.stats.files}개 파일 감시 중`;
  const isDemo = p.session.id === 'demo';
  $('#demo').hidden = !isDemo || !empty || replay;
  $('#demoBar').hidden = !isDemo || empty;
  flash(p.events);
  // 요청이 끝나면 이번에 바뀐 전체를 한눈에 보여 준다
  const justEnded = !!p.turn.endedAt && endedTurn !== p.turn.id;
  if (justEnded) endedTurn = p.turn.id;
  if (moveCamera && (follow || replay)) {
    if (justEnded && !replay) fitView(true);
    else camera(p);
  }
}

function createNode(id) {
  const el = document.createElement('div');
  el.className = 'node fresh';
  el.dataset.id = id;
  const card = document.createElement('div');
  card.className = 'card';
  el.appendChild(card);
  cardsEl.appendChild(el);
  return { el, card, keys: null, html: '', fresh: true, rows: new Map() };
}

function fillNode(n, c) {
  const cl = n.card.classList;
  for (const s of ['same', 'added', 'modified', 'deleted']) cl.toggle(`s-${s}`, c.status === s);
  cl.toggle('ctx', c.ctx);
  cl.toggle('intent', !!c.intent);
  const html = cardHtml(c, n.keys, n.fresh);
  if (html !== n.html) {
    n.card.innerHTML = html;
    n.html = html;
  }
  n.keys = new Set(c.members.map((m) => m.key));
}

function cardHtml(c, prevKeys, fresh) {
  const [chip, kc] = KCHIP[c.kind] ?? KCHIP.class;
  const badge = c.status === 'added' ? '새 클래스'
    : c.status === 'deleted' ? '삭제됨'
    : c.oldName ? `이름 변경 ← ${c.oldName}`
    : c.header ? '선언 수정'
    : c.status === 'modified' ? '수정' : '';
  const stereo = c.stereo ? `@${c.stereo}` : KIND_WORD[c.kind] ?? 'class';
  let h = `<div class="c-head"><span class="c-stereo">${esc(stereo)}</span>`
    + (badge ? `<span class="c-badge">${esc(badge)}</span>` : '')
    + (c.intent ? '<span class="c-intent">수정 중</span>' : '')
    + '</div>'
    + `<div class="c-name" data-act="class" title="선언부 변경 보기"><span class="kchip k-${kc}">${chip}</span><span class="c-title">${esc(c.name)}</span></div>`
    + `<div class="c-sub">${esc(pkgTail(c.pkg))} · ${esc(c.file.split('/').pop())}${c.route ? ` · <span class="route">${esc(c.route)}</span>` : ''}</div>`;
  if (!c.members.length) return h;

  const open = expanded.has(c.id);
  const hideable = (m) => m.status === 'same' && !m.ref;
  const unchangedTotal = c.members.filter(hideable).length;
  let unchanged = 0;
  const rows = [];
  for (const m of c.members) {
    if (hideable(m) && !open && unchanged++ >= UNCHANGED_LIMIT) continue;
    const isNew = prevKeys && !fresh && !prevKeys.has(m.key);
    const cls = `m s-${m.status}${m.private ? ' priv' : ''}${m.static ? ' static' : ''}${m.ref ? ' ref' : ''}${isNew ? ' row-in' : ''}`;
    rows.push(`<li class="${cls}" data-act="member" data-key="${esc(m.key)}" title="${esc(m.sig)} — 눌러서 변경 보기">`
      + `<span class="mchip mk-${m.kind}">${MCHIP[m.kind] ?? '?'}</span>`
      + `<span class="sig">${esc(m.sig)}</span>`
      + `<span class="mark">${MARK[m.status] ?? ''}</span>`
      + (m.tags.length ? `<span class="tags">${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : '')
      + '</li>');
  }
  h += `<ul class="c-mem">${rows.join('')}</ul>`;
  if (!c.ctx && unchangedTotal > UNCHANGED_LIMIT) {
    h += `<button class="c-more" data-act="more">${open ? '접기' : `변경 없는 멤버 ${unchangedTotal - UNCHANGED_LIMIT}개 더 보기`}</button>`;
  }
  return h;
}

// 레이어별 열에 카드를 쌓는다. 두 번째 열부터는 이웃의 평균 위치로 정렬해 선이 덜 꼬이게 한다
function layout(classes, edges, calls) {
  const byLane = new Map(LANES.map(([k]) => [k, []]));
  for (const c of classes) (byLane.get(c.layer) ?? byLane.get('other')).push(c);
  const lanes = LANES.filter(([k]) => byLane.get(k).length);
  const nb = new Map();
  const link = (a, b) => {
    if (a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!nb.has(x)) nb.set(x, []);
      nb.get(x).push(y);
    }
  };
  for (const e of edges) link(e.from, e.to);
  for (const e of calls) link(e.from.cls, e.to.cls);
  const rank = new Map();
  lanes.forEach(([k], li) => {
    const bary = (c) => {
      const r = (nb.get(c.id) ?? []).map((id) => rank.get(id)).filter((x) => x !== undefined);
      return r.length ? r.reduce((a, b) => a + b, 0) / r.length : Infinity;
    };
    const list = byLane.get(k);
    list.sort((a, b) => (li ? bary(a) - bary(b) : 0) || (a.ctx - b.ctx) || a.name.localeCompare(b.name));
    list.forEach((c, i) => rank.set(c.id, i));
  });

  pos = new Map();
  let maxY = TOP;
  lanes.forEach(([k], li) => {
    const x = PAD + li * (COL_W + GAP_X);
    let y = TOP;
    for (const c of byLane.get(k)) {
      const n = nodes.get(c.id);
      const h = n.card.offsetHeight;
      n.rows = new Map([...n.card.querySelectorAll('li[data-key]')].map((li) => [li.dataset.key, li.offsetTop + Math.min(li.offsetHeight, 25) / 2]));
      pos.set(c.id, { x, y, h, col: li });
      place(n, x, y);
      y += h + GAP_Y;
    }
    maxY = Math.max(maxY, y);
  });
  const w = PAD * 2 + lanes.length * COL_W + Math.max(0, lanes.length - 1) * GAP_X;
  const h = maxY + PAD;
  stageSize = { w, h };
  edgesSvg.setAttribute('width', w);
  edgesSvg.setAttribute('height', h);
  lanesEl.innerHTML = lanes
    .map(([, label], li) => `<div class="lane" style="left:${PAD + li * (COL_W + GAP_X) - 14}px;width:${COL_W + 28}px;height:${h - 8}px"><span class="lane-label">${label}</span></div>`)
    .join('');
}

function place(n, x, y) {
  n.el.style.transform = `translate(${x}px, ${y}px)`;
  if (!n.fresh) return;
  n.el.getBoundingClientRect();
  n.el.classList.remove('fresh');
  n.card.classList.add('enter');
  n.card.addEventListener('animationend', () => n.card.classList.remove('enter'), { once: true });
  n.fresh = false;
}

// 두 점 사이 곡선. 열이 다르면 옆으로, 같은 열이면 오른쪽으로 크게 돌아 들어간다
function curve(a, ya, b, yb, loop) {
  if (b.col !== a.col) {
    const right = b.col > a.col;
    const x1 = right ? a.x + COL_W : a.x;
    const x2 = right ? b.x - 3 : b.x + COL_W + 3;
    const dx = Math.round(Math.max(36, Math.abs(x2 - x1) * 0.45) * (right ? 1 : -1));
    return `M${x1},${ya} C${x1 + dx},${ya} ${x2 - dx},${yb} ${x2},${yb}`;
  }
  const x = a.x + COL_W;
  const bend = Math.round(loop + Math.min(80, Math.abs(yb - ya) * 0.12));
  return `M${x},${ya} C${x + bend},${ya} ${x + bend},${yb} ${x + 3},${yb}`;
}

// 새로 생긴 선은 그려지듯 나타나게 한다(점선은 서서히)
function upsertPath(map, layer, key, d, cls, solid, data) {
  let el = map.get(key);
  if (!el) {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    Object.assign(el.dataset, data);
    layer.appendChild(el);
    map.set(key, el);
    el.setAttribute('class', `${cls} ${solid ? 'draw' : 'fade'}`);
    if (solid) el.setAttribute('pathLength', '1');
    el.addEventListener('animationend', () => {
      el.removeAttribute('pathLength');
      el.classList.remove('draw', 'fade');
    }, { once: true });
  } else {
    const keep = ['draw', 'fade', 'hl'].filter((x) => el.classList.contains(x));
    el.setAttribute('class', [cls, ...keep].join(' '));
  }
  el.setAttribute('d', d);
  el.style.d = `path("${d}")`;
  return el;
}

function prune(map, seen) {
  for (const [k, el] of map) {
    if (seen.has(k)) continue;
    el.remove();
    map.delete(k);
  }
}

function drawEdges(edges) {
  const seen = new Set();
  const outN = new Map(), inN = new Map();
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const key = `${e.from}|${e.to}`;
    seen.add(key);
    const ya = Math.round(a.y + 22 + Math.min(bump(outN, e.from), 6) * 6);
    const yb = Math.round(b.y + 22 + Math.min(bump(inN, e.to), 6) * 6);
    const solid = e.kind !== 'implements' && e.kind !== 'uses' && e.status !== 'deleted';
    const el = upsertPath(edgeEls, edgeLayer, key, curve(a, ya, b, yb, 42), `edge k-${e.kind} s-${e.status}`, solid, { from: e.from, to: e.to });
    const tri = e.kind === 'extends' || e.kind === 'implements';
    el.setAttribute('marker-end', `url(#m-${tri ? 'tri' : 'arrow'}${e.status === 'same' ? '' : '-' + e.status})`);
  }
  prune(edgeEls, seen);
}

// 메서드 호출선: 부르는 멤버 줄에서 불리는 멤버 줄로
function drawCalls(calls) {
  const seen = new Set();
  for (const e of calls) {
    const a = pos.get(e.from.cls), b = pos.get(e.to.cls);
    if (!a || !b) continue;
    const ra = nodes.get(e.from.cls)?.rows.get(e.from.key), rb = nodes.get(e.to.cls)?.rows.get(e.to.key);
    const ya = Math.round(a.y + (ra ?? 22)), yb = Math.round(b.y + (rb ?? 22));
    const key = `${e.from.cls}#${e.from.key}>${e.to.cls}#${e.to.key}`;
    seen.add(key);
    const self = e.from.cls === e.to.cls;
    const el = upsertPath(callEls, callLayer, key, curve(a, ya, b, yb, self ? 22 : 54), `call s-${e.status}`, e.status !== 'deleted', {
      from: e.from.cls, to: e.to.cls, fromKey: e.from.key, toKey: e.to.key,
    });
    const suffix = e.status === 'same' ? '' : '-' + e.status;
    el.setAttribute('marker-end', `url(#m-call${suffix})`);
    el.setAttribute('marker-start', `url(#m-dot${suffix})`);
  }
  prune(callEls, seen);
}

function flash(events) {
  for (const ev of events) {
    const n = ev.cls && nodes.get(ev.cls);
    if (!n) continue;
    const target = ev.key ? n.card.querySelector(`[data-key="${CSS.escape(ev.key)}"]`) : n.card;
    if (!target) continue;
    const cls = `flash-${ev.kind}`;
    target.classList.remove('flash-added', 'flash-modified', 'flash-deleted');
    void target.offsetWidth;
    target.classList.add(cls);
    target.addEventListener('animationend', () => target.classList.remove(cls), { once: true });
  }
}

// ---- 카메라 ----
function applyView(smooth) {
  stage.classList.toggle('smooth', smooth);
  stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
}

function fitScale() {
  const r = viewport.getBoundingClientRect();
  return Math.min(1, (r.width - 32) / stageSize.w, (r.height - 72) / stageSize.h);
}

function fitView(smooth = true) {
  if (!stageSize.w) return;
  const r = viewport.getBoundingClientRect();
  view.k = clamp(fitScale(), 0.3, 1);
  view.x = Math.max(16, (r.width - stageSize.w * view.k) / 2);
  view.y = 8;
  applyView(smooth);
}

function focusOn(id, smooth = true, k = clamp(view.k, 0.6, 1)) {
  const p = pos.get(id);
  if (!p) return;
  const r = viewport.getBoundingClientRect();
  view.k = k;
  view.x = r.width / 2 - (p.x + COL_W / 2) * view.k;
  view.y = Math.min(8, r.height * 0.4 - (p.y + Math.min(p.h, 260) / 2) * view.k);
  applyView(smooth);
}

// 전체가 충분히 크게 보이면 전체를, 아니면 방금 바뀐 카드를 가운데로
function camera(p) {
  if (!p.classes.length) return;
  if (fitScale() >= 0.72) return fitView(true);
  const last = [...p.events].reverse().find((e) => e.cls && pos.has(e.cls));
  const target = last?.cls ?? p.classes.find((c) => c.intent)?.id;
  if (target) focusOn(target, true, Math.max(FOLLOW_ZOOM, fitScale()));
}

// ---- 상단·타임라인 ----
function setHeader(p) {
  const t = p.turn;
  const tag = $('#turnTag');
  if (t.kind === 'turn') {
    tag.textContent = t.endedAt ? '완료' : '작업 중';
    tag.classList.toggle('live', !t.endedAt);
    $('#turnText').textContent = t.prompt || '새 요청';
  } else {
    tag.textContent = t.kind === 'reset' ? '기준 초기화' : '세션 시작';
    tag.classList.remove('live');
    $('#turnText').textContent = '이후 바뀌는 코드를 그려요';
  }
  $('#turn').title = t.prompt || '';
  const c = p.counts;
  $('#counts').innerHTML = [
    c.added && `<span class="cnt a" title="추가">+${c.added}</span>`,
    c.modified && `<span class="cnt m" title="수정">~${c.modified}</span>`,
    c.deleted && `<span class="cnt d" title="삭제">−${c.deleted}</span>`,
  ].filter(Boolean).join('');
  document.title = `${p.session.project} · Live Code Map`;
}

let logTurn = null;
const logIds = new Set();
function renderLog(p) {
  const list = $('#log');
  if (p.turn.id !== logTurn) {
    list.innerHTML = '';
    logIds.clear();
    logTurn = p.turn.id;
  }
  const t = p.turn;
  $('#tlPrompt').textContent = t.kind === 'turn' ? t.prompt || '새 요청' : t.kind === 'reset' ? '기준 초기화 이후 변경' : '세션 시작 이후 변경';
  $('#tlMeta').textContent = `${fmtTime(t.startedAt)} 시작${t.endedAt ? ` · ${fmtDur(t.endedAt - t.startedAt)} 걸림` : ''}`;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  for (const ev of p.log) {
    if (logIds.has(ev.id)) continue;
    logIds.add(ev.id);
    const li = document.createElement('li');
    li.className = `ev ${ev.kind}`;
    const text = ev.kind === 'turn' ? '요청 시작' : ev.kind === 'start' ? '세션 시작' : ev.label;
    li.innerHTML = `<time>${fmtTime(ev.ts)}</time><span class="ev-dot"></span><span class="ev-text">${esc(text)}</span>`;
    if (ev.cls) {
      li.addEventListener('click', () => {
        focusOn(ev.cls);
        openDiff(ev.cls, ev.key ?? '__class__');
      });
    }
    list.appendChild(li);
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

// ---- diff ----
function lineDiff(a, b) {
  const A = a ? a.split('\n') : [], B = b ? b.split('\n') : [];
  const n = A.length, m = B.length;
  if (n * m > 400000) return [...A.map((s) => ['del', s]), ...B.map((s) => ['add', s])];
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(['same', A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['del', A[i++]]);
    else out.push(['add', B[j++]]);
  }
  while (i < n) out.push(['del', A[i++]]);
  while (j < m) out.push(['add', B[j++]]);
  return out;
}

async function openDiff(id, key) {
  const r = await fetch(api(`/api/diff?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`));
  if (!r.ok) return;
  const d = await r.json();
  const note = d.before == null ? ' · 새로 추가' : d.after == null ? ' · 삭제됨' : d.before === d.after ? ' · 이번 요청에서 바뀌지 않음' : '';
  $('#diffTitle').textContent = d.title;
  $('#diffMeta').textContent = `${d.file}:${d.line}${note}`;
  $('#diffBody').innerHTML = lineDiff(d.before ?? '', d.after ?? '')
    .map(([t, s]) => `<span class="dl ${t}">${esc(s) || ' '}</span>`)
    .join('');
  $('#diff').hidden = false;
}
const closeDiff = () => { $('#diff').hidden = true; };

// ---- 다시보기 ----
function clearCanvas() {
  for (const n of nodes.values()) n.el.remove();
  nodes.clear();
  for (const map of [edgeEls, callEls]) {
    for (const el of map.values()) el.remove();
    map.clear();
  }
}

async function startReplay() {
  const { frames } = await (await fetch(api('/api/frames'))).json();
  const steps = frames.filter((f) => f.classes.length);
  if (!steps.length) return;
  replaying = true;
  $('#replay').textContent = '다시보기 중지';
  $('#replay').classList.add('on');
  $('#replayBanner').hidden = false;
  clearCanvas();
  for (let i = 0; i < steps.length && replaying; i++) {
    $('#replayStep').textContent = `${i + 1} / ${steps.length}`;
    render(steps[i], { replay: true });
    await sleep(steps[i].events.length ? 1100 : 650);
  }
  if (replaying) {
    await sleep(700);
    stopReplay();
  }
}

function stopReplay() {
  replaying = false;
  $('#replay').textContent = '다시보기';
  $('#replay').classList.remove('on');
  $('#replayBanner').hidden = true;
  if (live) render({ ...live, events: [] });
}

// ---- 조작 ----
function toggle(btn, on) {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}
function setFollow(on) {
  follow = on;
  toggle($('#follow'), on);
}

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = viewport.getBoundingClientRect();
    const k = clamp(view.k * Math.exp(-e.deltaY * 0.01), 0.25, 2);
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
  }
  applyView(false);
  setFollow(false);
}, { passive: false });

let drag = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.card, .legend, .primary')) return;
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  viewport.setPointerCapture(e.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.x = drag.vx + e.clientX - drag.x;
  view.y = drag.vy + e.clientY - drag.y;
  applyView(false);
  if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) setFollow(false);
});
viewport.addEventListener('pointerup', () => {
  drag = null;
  viewport.classList.remove('dragging');
});

cardsEl.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const id = act.closest('.node').dataset.id;
  if (act.dataset.act === 'member') openDiff(id, act.dataset.key);
  else if (act.dataset.act === 'class') openDiff(id, '__class__');
  else if (act.dataset.act === 'more') {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    if (shown) render({ ...shown, events: [] }, { camera: false });
  }
});

// 카드나 멤버 줄에 올리면 연결된 선만 진하게
function highlight(id, key) {
  edgesSvg.classList.toggle('hovering', !!id);
  for (const el of edgeEls.values()) el.classList.toggle('hl', !!id && !key && (el.dataset.from === id || el.dataset.to === id));
  for (const el of callEls.values()) {
    const d = el.dataset;
    const hit = key ? (d.from === id && d.fromKey === key) || (d.to === id && d.toKey === key) : d.from === id || d.to === id;
    el.classList.toggle('hl', !!id && hit);
  }
}
cardsEl.addEventListener('pointerover', (e) => {
  const node = e.target.closest('.node');
  highlight(node?.dataset.id ?? null, e.target.closest('li[data-key]')?.dataset.key ?? null);
});
cardsEl.addEventListener('pointerleave', () => highlight(null));

$('#tDeps').addEventListener('click', (e) => {
  const on = !edgesSvg.classList.toggle('hide-deps');
  toggle(e.currentTarget, on);
});
$('#tCalls').addEventListener('click', (e) => {
  const on = !edgesSvg.classList.toggle('hide-calls');
  toggle(e.currentTarget, on);
});
$('#follow').addEventListener('click', () => {
  setFollow(!follow);
  if (follow && shown) camera(shown);
});
$('#fit').addEventListener('click', () => fitView(true));
$('#reset').addEventListener('click', () => post(api('/api/reset')));
$('#demo').addEventListener('click', () => post('/api/demo'));
$('#demoBar').addEventListener('click', () => post('/api/demo'));
$('#replay').addEventListener('click', () => (replaying ? stopReplay() : startReplay()));
$('#logToggle').addEventListener('click', () => $('#timeline').classList.toggle('open'));
$('#diffClose').addEventListener('click', closeDiff);
$('#diff').addEventListener('click', (e) => { if (e.target.id === 'diff') closeDiff(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDiff(); });
window.addEventListener('resize', () => { if (follow && shown) camera(shown); });

// ---- 세션 ----
const sessionLabel = (s) => `${s.project} · ${s.title || s.prompt || s.short}`;
const statusOf = (s) => (s.closed ? ['종료', 'closed'] : s.busy && !s.manual ? ['작업 중', 'busy'] : ['대기', 'idle']);

async function loadSessions() {
  try {
    return (await (await fetch('/api/sessions')).json()).sessions;
  } catch {
    return null;
  }
}

async function refreshPicker() {
  const list = await loadSessions();
  if (!list) return;
  const pick = $('#pick');
  pick.hidden = list.length < 2;
  pick.innerHTML = list.map((s) => `<option value="${esc(s.short)}"${s.short === SID ? ' selected' : ''}>${esc(sessionLabel(s))}${s.busy && !s.manual ? ' · 작업 중' : ''}</option>`).join('');
}
$('#pick').addEventListener('change', (e) => { location.href = `/s/${encodeURIComponent(e.target.value)}`; });

async function renderList() {
  const list = await loadSessions();
  if (!list) return;
  $('#listEmpty').hidden = list.length > 0;
  $('#sessions').innerHTML = list.map((s) => {
    const [label, cls] = statusOf(s);
    const c = s.counts;
    const counts = [c.added && `<span class="cnt a">+${c.added}</span>`, c.modified && `<span class="cnt m">~${c.modified}</span>`, c.deleted && `<span class="cnt d">−${c.deleted}</span>`].filter(Boolean).join('');
    return `<li><a class="sess" href="/s/${encodeURIComponent(s.short)}">`
      + `<span class="sess-top"><strong>${esc(s.project)}</strong><span class="sess-id">${esc(s.short)}</span><span class="sess-st ${cls}">${label}</span></span>`
      + `<span class="sess-prompt">${esc(s.title || s.prompt || '아직 요청이 없어요')}</span>`
      + `<span class="sess-meta"><span>${esc(s.root)}</span><span>${ago(s.lastActive)}</span>${counts}</span>`
      + '</a></li>';
  }).join('');
}

// ---- 실시간 연결 ----
function connect() {
  const es = new EventSource(api('/events'));
  const conn = $('#conn');
  es.onopen = () => { conn.className = 'conn on'; conn.title = '서버와 연결됨'; };
  es.onerror = async () => {
    conn.className = 'conn off';
    conn.title = '연결이 끊겼어요 — 다시 연결하는 중';
    const list = await loadSessions();
    if (list && !list.some((s) => s.short === SID)) {
      es.close();
      $('#emptyTitle').textContent = '세션을 찾을 수 없어요';
      $('#emptySub').innerHTML = '세션이 끝났거나 서버가 다시 시작됐어요. <a href="/">세션 목록으로</a>';
      $('#empty').hidden = false;
    }
  };
  es.onmessage = (e) => {
    const p = JSON.parse(e.data);
    const first = !live;
    live = p;
    renderLog(p);
    if (replaying) return;
    render(p);
    if (first) fitView(false);
  };
}

if (SID) {
  connect();
  refreshPicker();
  setInterval(refreshPicker, 5000);
} else {
  document.body.classList.add('listing');
  $('#mapView').hidden = true;
  $('#listView').hidden = false;
  renderList();
  setInterval(renderList, 2500);
}
