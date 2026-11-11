// Claude 세션 하나의 화면 상태. 요청(turn)이 시작될 때 프로젝트 상태를 기준으로 잡고,
// 이 세션이 고친 파일만 비교해서 보여 준다.
import { diffModels, memberLabel, STEREOS, graph, callGraph, invert } from './model.mjs';

const GROUP = { entry: 0, prop: 1, field: 1, ctor: 2, method: 3 };
const VERB = { added: '추가', modified: '수정', deleted: '삭제' };
const CALLERS_PER_METHOD = 6;
const MAX_CONTEXT = 20;

// 남이 바꾼 클래스 하나를 이 세션의 기준(s)에 흡수한다. b → a가 남의 변경이다.
// 이 세션이 이미 바꾼 선언부·멤버는 그대로 두고, 이 세션이 손대지 않은 부분만 남의 결과로 바꾼다.
function sameClass(x, y) {
  if (x.headerHash !== y.headerHash || x.members.length !== y.members.length) return false;
  const ym = new Map(y.members.map((m) => [m.key, m.hash]));
  return x.members.every((m) => ym.get(m.key) === m.hash);
}

function rebase(s, b, a) {
  if (!b) return s ?? a; // 남이 새로 만든 클래스
  if (!s) return s; // 이 세션이 만든 클래스: 기준에 없는 그대로
  if (!a) return sameClass(s, b) ? null : s; // 남이 지운 클래스
  const sm = new Map(s.members.map((m) => [m.key, m]));
  const bm = new Map(b.members.map((m) => [m.key, m]));
  const am = new Map(a.members.map((m) => [m.key, m]));
  const headerTheirs = s.headerHash === b.headerHash && b.headerHash !== a.headerHash;
  let touched = headerTheirs;
  const members = [];
  for (const key of new Set([...sm.keys(), ...am.keys()])) {
    const B = bm.get(key), A = am.get(key), S = sm.get(key);
    if (B?.hash !== A?.hash && S?.hash === B?.hash) {
      touched = true;
      if (A) members.push(A);
    } else if (S) members.push(S);
  }
  return touched ? { ...(headerTheirs ? a : s), members } : s;
}

const pick = (map, fn) => new Map([...map].filter(([, v]) => fn(v)));
const splitKey = (k) => { const i = k.indexOf('#'); return { cls: k.slice(0, i), key: k.slice(i + 1) }; };

function memberView(m, status, ref) {
  return { key: m.key, kind: m.kind, name: m.name, sig: m.sig, tags: m.tags, private: m.private, static: !!m.static, line: m.line, status, ref };
}

// 화면에 보낼 클래스 하나 — 지워진 멤버는 원래 자리 근처에 끼워 넣는다
function classView(id, ch, cur, base, ctx, refs) {
  const c = cur.get(id);
  const b = base.get(ch?.renamedFrom ?? id);
  const src = c ?? b;
  const view = {
    id, name: src.name, simple: src.simple, pkg: src.pkg, file: src.file, line: src.line, kind: src.kind,
    layer: src.layer, stereo: STEREOS.find((s) => src.anns.includes(s)) ?? null, route: src.route,
    status: ch?.status ?? 'same', header: !!ch?.header && ch?.status === 'modified', oldName: ch?.oldName ?? null,
    ctx: !!ctx, members: [],
  };
  const isRef = (k) => !!refs?.has(k);
  if (ctx) {
    // 맥락 카드는 호출로 이어진 멤버만 보여 준다
    view.members = (src.members ?? []).filter((m) => isRef(m.key)).map((m) => memberView(m, 'same', true));
    return view;
  }
  const st = (k) => ch?.members.get(k)?.status ?? 'same';
  const list = c ? c.members.map((m) => memberView(m, ch?.status === 'added' ? 'added' : st(m.key), isRef(m.key))) : [];
  if (b) {
    b.members.forEach((m, idx) => {
      if (c && st(m.key) !== 'deleted') return;
      let pos = -1;
      for (let j = idx - 1; j >= 0 && pos < 0; j--) pos = list.findIndex((x) => x.key === b.members[j].key);
      list.splice(pos + 1, 0, memberView(m, 'deleted', isRef(m.key)));
    });
  }
  view.members = list
    .map((m, i) => [m, i])
    .sort((x, y) => (GROUP[x[0].kind] - GROUP[y[0].kind]) || (x[1] - y[1]))
    .map(([m]) => m);
  return view;
}

export class Session {
  constructor(id, project, { title = '', manual = false } = {}) {
    this.id = id;
    this.short = id.slice(0, 8);
    this.project = project;
    this.title = title;
    this.manual = manual; // 훅 없이 직접 띄운 경우: 모든 변경을 이 세션 것으로 본다
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.busy = manual;
    this.closed = false;
    this.changed = false; // 이 세션이 코드를 한 번이라도 바꿨는지(자동 열기 판단)
    this.autoOpen = false;
    this.opened = false;
    this.turn = { id: 0, prompt: '', startedAt: Date.now(), endedAt: null, kind: 'start' };
    this.base = new Map();
    this.baseEdges = new Map();
    this.baseCalls = new Map();
    this.baseCallers = new Map();
    this.touched = new Set();
    this.intents = new Map();
    this.log = [];
    this.frames = [];
    this.seq = 0;
    this.listeners = new Set();
  }

  // 지금 프로젝트 상태를 새 기준으로 삼는다(새 요청 시작)
  startTurn(prompt, kind = 'turn') {
    const P = this.project;
    this.base = P.cur;
    this.baseEdges = P.edges;
    this.baseCalls = P.calls;
    this.baseCallers = P.callers;
    this.touched = new Set();
    this.intents.clear();
    this.busy = this.manual || kind === 'turn';
    this.turn = { id: this.turn.id + 1, prompt: prompt ?? '', startedAt: Date.now(), endedAt: null, kind };
    this.log = [];
    this.frames = [];
    this.pushLog({ kind, label: kind === 'turn' ? prompt || '새 요청' : kind === 'start' ? '세션 시작' : '기준 초기화' });
    this.emit([]);
  }

  endTurn() {
    this.busy = this.manual;
    if (this.turn.endedAt) return;
    this.turn.endedAt = Date.now();
    this.intents.clear();
    this.pushLog({ kind: 'end', label: '작업 끝' });
    this.emit([]);
  }

  // 다른 세션(지도를 켜지 않은 세션 포함)이 고친 내용은 이 세션의 비교 기준에 흡수한다.
  // 그래야 여러 세션이 같은 파일을 고쳐도 이 세션 지도에는 이 세션이 바꾼 것만 남는다.
  absorb(deltas) {
    if (this.manual) return;
    const base = new Map(this.base);
    let changed = false;
    for (const d of deltas) {
      const before = new Map(d.before.map((t) => [t.id, t]));
      const after = new Map(d.after.map((t) => [t.id, t]));
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const cur = base.get(id);
        const next = rebase(cur, before.get(id), after.get(id));
        if (next === cur) continue;
        if (next) base.set(id, next);
        else base.delete(id);
        changed = true;
      }
    }
    if (!changed) return;
    this.base = base;
    this.baseEdges = graph(base);
    this.baseCalls = callGraph(base);
    this.baseCallers = invert(this.baseCalls);
    this.emit([]);
  }

  intent(rel) {
    if (!this.project.files.has(rel)) return;
    this.intents.set(rel, Date.now());
    this.emit([]);
    setTimeout(() => {
      const t = this.intents.get(rel);
      if (t && Date.now() - t >= 15000) { this.intents.delete(rel); this.emit([]); }
    }, 15100);
  }

  pushLog(ev) {
    const e = { id: ++this.seq, ts: Date.now(), ...ev };
    this.log.push(e);
    return e;
  }

  // 이 세션 몫으로 판정된 파일 변경들 — 직전 상태와 비교한 차이를 이벤트로 남긴다
  // agent: 서브에이전트가 고쳤으면 그 이름(타임라인에 표시)
  applyBatch(deltas, agent = null) {
    const events = [];
    let cleared = false;
    for (const d of deltas) {
      this.touched.add(d.rel);
      cleared = this.intents.delete(d.rel) || cleared;
      const before = new Map(d.before.map((t) => [t.id, t]));
      const after = new Map(d.after.map((t) => [t.id, t]));
      const name = (id) => (after.get(id) ?? before.get(id))?.name ?? id;
      for (const [id, ch] of diffModels(before, after)) {
        if (ch.status === 'added') events.push(this.pushLog({ kind: 'added', cls: id, label: `${name(id)} 클래스 추가` }));
        else if (ch.status === 'deleted') events.push(this.pushLog({ kind: 'deleted', cls: id, label: `${name(id)} 클래스 삭제` }));
        else {
          if (ch.renamedFrom) events.push(this.pushLog({ kind: 'modified', cls: id, label: `${ch.oldName} → ${name(id)} 이름 변경` }));
          else if (ch.header) events.push(this.pushLog({ kind: 'modified', cls: id, label: `${name(id)} 선언 수정` }));
          for (const [key, mc] of ch.members) {
            const m = [...(after.get(id)?.members ?? []), ...(before.get(id)?.members ?? [])].find((x) => x.key === key);
            events.push(this.pushLog({ kind: mc.status, cls: id, key, label: `${name(id)} · ${m ? memberLabel(m) : key} ${VERB[mc.status]}` }));
          }
        }
      }
    }
    if (agent) for (const e of events) e.agent = agent;
    if (events.length) this.changed = true;
    if (events.length || cleared) this.emit(events);
  }

  payload(events = []) {
    const P = this.project;
    const scope = (c) => this.touched.has(c.file);
    const base = pick(this.base, scope);
    const cur = pick(P.cur, scope);
    const changes = diffModels(base, cur);
    const focus = new Set(changes.keys());
    const intentIds = new Set();
    for (const rel of this.intents.keys()) for (const t of P.files.get(rel)?.types ?? []) { focus.add(t.id); intentIds.add(t.id); }

    // 호출 관계: 바뀐 메서드가 부르는 메서드 + 바뀐 메서드를 부르는 메서드
    const refs = new Map();
    const addRef = ({ cls, key }) => { if (!refs.has(cls)) refs.set(cls, new Set()); refs.get(cls).add(key); };
    // 시그니처가 바뀐 메서드는 예전 키로 기준 호출을 찾는다(기존 호출이 '새 호출'로 보이지 않게)
    const oldKey = new Map();
    for (const [id, ch] of changes) {
      for (const [key, mc] of ch.members) if (mc.prevKey && mc.prevKey !== key) oldKey.set(`${id}#${key}`, `${id}#${mc.prevKey}`);
    }
    const newKey = new Map([...oldKey].map(([n, o]) => [o, n]));
    const toNew = (k) => newKey.get(k) ?? k;
    const baseOut = (f) => [...(this.baseCalls.get(oldKey.get(f) ?? f) ?? [])].map(toNew);
    const baseIn = (f) => [...(this.baseCallers.get(oldKey.get(f) ?? f) ?? [])].map(toNew);
    const calls = new Map();
    const addCall = (from, to) => {
      const k = `${from}>${to}`;
      if (calls.has(k)) return;
      const inCur = !!P.calls.get(from)?.has(to), inBase = baseOut(from).includes(to);
      const e = { from: splitKey(from), to: splitKey(to), status: inCur && inBase ? 'same' : inCur ? 'added' : 'deleted' };
      calls.set(k, e);
      addRef(e.from);
      addRef(e.to);
    };
    const memberOf = (id, key) => (P.cur.get(id)?.members ?? []).find((m) => m.key === key) ?? (this.base.get(id)?.members ?? []).find((m) => m.key === key);
    for (const [id, ch] of changes) {
      for (const [key] of ch.members) {
        const m = memberOf(id, key);
        if (!m || (m.kind !== 'method' && m.kind !== 'ctor')) continue;
        const f = `${id}#${key}`;
        for (const t of new Set([...(P.calls.get(f) ?? []), ...baseOut(f)])) addCall(f, t);
        const ins = [...new Set([...(P.callers.get(f) ?? []), ...baseIn(f)])];
        for (const s of ins.slice(0, CALLERS_PER_METHOD)) addCall(s, f);
      }
    }

    // 맥락 카드: 호출로 이어진 클래스를 먼저, 그다음 의존 관계로 바로 붙은 클래스
    const known = (id) => P.cur.has(id) || this.base.has(id);
    const ctx = [];
    for (const id of refs.keys()) if (!focus.has(id) && known(id)) ctx.push(id);
    const allEdges = new Map([...this.baseEdges, ...P.edges]);
    const score = new Map();
    for (const e of allEdges.values()) {
      const [a, b] = focus.has(e.from) ? [e.from, e.to] : focus.has(e.to) ? [e.to, e.from] : [];
      if (a && !focus.has(b) && !refs.has(b) && known(b)) score.set(b, (score.get(b) ?? 0) + 1);
    }
    for (const [id] of [...score].sort((x, y) => y[1] - x[1])) ctx.push(id);
    const ctxIds = ctx.slice(0, MAX_CONTEXT);
    const visible = new Set([...focus, ...ctxIds]);

    const classes = [];
    for (const id of focus) {
      if (!known(id)) continue;
      const v = classView(id, changes.get(id), P.cur, this.base, false, refs.get(id));
      v.intent = intentIds.has(id);
      classes.push(v);
    }
    for (const id of ctxIds) classes.push(classView(id, null, P.cur, this.base, true, refs.get(id)));

    const edges = [];
    for (const [key, e] of allEdges) {
      if (!visible.has(e.from) || !visible.has(e.to)) continue;
      const inCur = P.edges.has(key), inBase = this.baseEdges.has(key);
      edges.push({ ...(inCur ? P.edges.get(key) : e), status: inCur && inBase ? 'same' : inCur ? 'added' : 'deleted' });
    }

    const counts = { added: 0, modified: 0, deleted: 0 };
    for (const ch of changes.values()) {
      if (ch.status !== 'modified') { counts[ch.status]++; continue; }
      if (ch.header) counts.modified++;
      for (const m of ch.members.values()) counts[m.status]++;
    }

    return {
      session: this.summary(),
      root: P.root,
      turn: { ...this.turn }, // 다시보기 프레임마다 그 시점의 요청 상태가 남도록 복사
      counts, classes, edges,
      calls: [...calls.values()].filter((e) => visible.has(e.from.cls) && visible.has(e.to.cls)),
      events, log: this.log,
      stats: { files: P.files.size, classes: P.cur.size, broken: [...P.broken], ready: P.ready },
    };
  }

  summary() {
    return {
      id: this.id, short: this.short, title: this.title, project: this.project.name, root: this.project.root,
      prompt: this.turn.prompt, busy: this.busy, closed: this.closed, manual: this.manual,
      lastActive: this.lastActive, createdAt: this.createdAt, touched: this.touched.size,
    };
  }

  emit(events) {
    if (!this.listeners.size && !events.length && this.frames.length) return;
    const p = this.payload(events);
    if (events.length || this.frames.length === 0 || p.classes.length) {
      const { log, ...frame } = p;
      this.frames.push(frame);
      if (this.frames.length > 400) this.frames.shift();
    }
    for (const fn of this.listeners) fn(p);
  }

  diffText(id, key) {
    const P = this.project;
    const ch = diffModels(this.base, P.cur).get(id);
    const c = P.cur.get(id);
    const b = this.base.get(ch?.renamedFrom ?? id);
    const src = c ?? b;
    if (!src) return null;
    if (key === '__class__') {
      return { title: src.name, file: src.file, line: src.line, before: b?.headerText ?? null, after: c?.headerText ?? null };
    }
    const prevKey = ch?.members.get(key)?.prevKey ?? key;
    const after = c?.members.find((m) => m.key === key);
    const before = b?.members.find((m) => m.key === prevKey);
    const m = after ?? before;
    if (!m) return null;
    return { title: `${src.name}.${memberLabel(m)}`, file: src.file, line: m.line, before: before ? dedent(before.text) : null, after: after ? dedent(after.text) : null };
  }
}

function dedent(text) {
  const lines = text.split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join('\n');
}
