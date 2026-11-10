// 파싱 결과로 레이어를 나누고, 의존·호출 관계를 잇고, 두 시점을 비교한다. 모두 순수 함수다.

const REPO_SUPERS = new Set([
  'JpaRepository', 'CrudRepository', 'PagingAndSortingRepository', 'ListCrudRepository', 'MongoRepository',
  'ReactiveCrudRepository', 'CoroutineCrudRepository', 'R2dbcRepository', 'JpaSpecificationExecutor',
  'QuerydslPredicateExecutor', 'Repository',
]);
const BEAN_LAYERS = new Set(['controller', 'service', 'repository']);
const RANK = { extends: 5, implements: 4, inject: 3, has: 2, uses: 1 };
export const STEREOS = ['RestController', 'Controller', 'RestControllerAdvice', 'ControllerAdvice', 'Service', 'Repository', 'Mapper', 'Component', 'Configuration', 'Entity', 'Embeddable', 'MappedSuperclass', 'Document'];

const has = (c, ...names) => names.some((n) => c.anns.includes(n));

function layerOf(c) {
  const n = c.simple;
  if (has(c, 'RestController', 'Controller', 'RestControllerAdvice', 'ControllerAdvice') || /Controller$/.test(n)) return 'controller';
  if (has(c, 'Repository', 'Mapper') || c.supers.some((s) => REPO_SUPERS.has(s.name)) || /(Repository|Dao)$/.test(n)) return 'repository';
  if (has(c, 'Entity', 'Table', 'Document', 'Embeddable', 'MappedSuperclass')) return 'domain';
  if (has(c, 'Service', 'Component', 'Configuration') || /(Service|ServiceImpl|UseCase|Facade|Gateway|Client|Adapter|Port)$/.test(n)) return 'service';
  return 'other';
}

export function classify(classes) {
  for (const c of classes.values()) c.layer = layerOf(c);
  // 엔티티와 같은 패키지의 enum·sealed는 도메인으로 본다
  const domainPkgs = new Set([...classes.values()].filter((c) => c.layer === 'domain').map((c) => c.pkg));
  for (const c of classes.values()) {
    if (c.layer === 'other' && (c.kind === 'enum' || c.kind === 'sealed') && domainPkgs.has(c.pkg)) c.layer = 'domain';
  }
}

// 단순 이름 → 클래스. 같은 이름이 여럿이면 중첩 → 같은 패키지 → import 순
function resolver(classes) {
  const bySimple = new Map();
  for (const c of classes.values()) {
    if (c.kind === 'file') continue;
    if (!bySimple.has(c.simple)) bySimple.set(c.simple, []);
    bySimple.get(c.simple).push(c);
  }
  return (simple, from) => {
    const list = bySimple.get(simple);
    if (!list) return null;
    if (list.length === 1) return list[0];
    return list.find((c) => c.id.startsWith(from.id + '.'))
      ?? list.find((c) => c.pkg === from.pkg)
      ?? list.find((c) => from.imports.some((im) => im === `${c.pkg}.${c.simple}` || im === `${c.pkg}.*`))
      ?? list[0];
  };
}

export function graph(classes) {
  const resolve = resolver(classes);
  const edges = new Map();
  const add = (from, to, kind) => {
    if (!to || to.id === from.id) return;
    const key = `${from.id}|${to.id}`;
    const prev = edges.get(key);
    if (!prev || RANK[kind] > RANK[prev.kind]) edges.set(key, { from: from.id, to: to.id, kind });
  };
  const dep = (from, simple) => {
    const to = resolve(simple, from);
    if (to) add(from, to, BEAN_LAYERS.has(to.layer) && to.kind !== 'data' && to.kind !== 'record' ? 'inject' : 'has');
  };
  for (const c of classes.values()) {
    for (const s of c.supers) {
      add(c, resolve(s.name, c), s.rel);
      for (const a of s.args) add(c, resolve(a, c), 'uses');
    }
    for (const p of c.ctor) p.ids.forEach((id) => dep(c, id));
    for (const m of c.members) {
      if (m.kind === 'prop' || m.kind === 'field' || m.kind === 'ctor') (m.ids ?? []).forEach((id) => dep(c, id));
    }
  }
  return edges;
}

// 메서드 → 메서드 호출. 키는 `${클래스 id}#${멤버 key}`
// 수신 객체의 타입은 필드·생성자 파라미터·메서드 파라미터·지역 변수·반환 타입을 따라가 정한다
export function callGraph(classes) {
  const resolve = resolver(classes);
  const fileFns = new Map(); // 패키지 → 이름 → [클래스, 멤버] (Kotlin 최상위 함수)
  for (const c of classes.values()) {
    if (c.kind !== 'file') continue;
    if (!fileFns.has(c.pkg)) fileFns.set(c.pkg, new Map());
    for (const m of c.members) if (m.kind === 'method') fileFns.get(c.pkg).set(m.name, [c, m]);
  }
  const fileFn = (name, from) => {
    const local = fileFns.get(from.pkg)?.get(name);
    if (local) return local;
    for (const im of from.imports) {
      const dot = im.lastIndexOf('.');
      if (im.slice(dot + 1) === name) { const hit = fileFns.get(im.slice(0, dot))?.get(name); if (hit) return hit; }
    }
    return null;
  };
  const fromIds = (ids, from) => {
    for (const id of ids ?? []) { const c = resolve(id, from); if (c) return c; }
    return null;
  };
  const supersOf = (c) => c.supers.map((s) => resolve(s.name, c)).filter(Boolean);
  const find = (c, name, kinds, depth = 0) => {
    const m = c.members.find((x) => x.name === name && kinds.includes(x.kind));
    if (m) return [c, m];
    if (depth > 2) return null;
    for (const s of supersOf(c)) { const r = find(s, name, kinds, depth + 1); if (r) return r; }
    return null;
  };
  // record의 name() 같은 접근자 호출은 해당 프로퍼티로 잇는다
  const method = (t, name) => find(t, name, ['method']) ?? (t.kind === 'record' ? find(t, name, ['prop']) : null);

  const out = new Map();
  for (const c of classes.values()) {
    for (const m of c.members) {
      if (!m.calls?.length) continue;
      const scope = new Map();
      for (const p of m.params) scope.set(p.name, { ids: p.ids });
      for (const l of m.locals ?? []) if (!scope.has(l.name)) scope.set(l.name, l);

      const nameType = (name, depth) => {
        const l = scope.get(name);
        if (l) return l.ids?.length ? fromIds(l.ids, c) : l.chain && depth < 4 ? chainType(l.chain, depth + 1) : null;
        const f = find(c, name, ['prop', 'field']);
        if (f) return fromIds(f[1].ids, f[0]);
        const p = c.ctor.find((x) => x.name === name);
        return p ? fromIds(p.ids, c) : null;
      };
      const chainType = (chain, depth = 0) => {
        let t = null;
        for (let i = 0; i < chain.length; i++) {
          const seg = chain[i];
          if (seg === '?') return null;
          const call = seg.endsWith('()');
          const name = call ? seg.slice(0, -2) : seg;
          if (i === 0) {
            if (name === 'this') t = c;
            else if (name === 'super') t = supersOf(c)[0] ?? null;
            else if (/^[A-Z]/.test(name)) t = resolve(name, c); // 생성자 호출 또는 정적 참조
            else if (call) { const r = find(c, name, ['method']) ?? fileFn(name, c); t = r ? fromIds(r[1].ids, r[0]) : null; }
            else t = nameType(name, depth);
          } else {
            const r = call ? method(t, name) : find(t, name, ['prop', 'field']);
            t = r ? fromIds(r[1].ids, r[0]) : null;
          }
          if (!t) return null;
        }
        return t;
      };

      for (const call of m.calls) {
        let hit = null;
        if (!call.recv.length) {
          if (/^[A-Z]/.test(call.name)) continue;
          hit = find(c, call.name, ['method']) ?? fileFn(call.name, c);
        } else {
          const t = chainType(call.recv);
          if (t) hit = method(t, call.name);
        }
        if (!hit || (hit[0] === c && hit[1] === m)) continue;
        const from = `${c.id}#${m.key}`;
        if (!out.has(from)) out.set(from, new Set());
        out.get(from).add(`${hit[0].id}#${hit[1].key}`);
      }
    }
  }
  return out;
}

export function invert(calls) {
  const out = new Map();
  for (const [from, tos] of calls) {
    for (const to of tos) {
      if (!out.has(to)) out.set(to, new Set());
      out.get(to).add(from);
    }
  }
  return out;
}

function compareClass(b, c) {
  const members = new Map();
  const bm = new Map(b.members.map((m) => [m.key, m]));
  const cm = new Map(c.members.map((m) => [m.key, m]));
  const gone = [], fresh = [];
  for (const [k, m] of cm) {
    const o = bm.get(k);
    if (!o) fresh.push(m);
    else if (o.hash !== m.hash) members.set(k, { status: 'modified', prevKey: k });
  }
  for (const [k, o] of bm) if (!cm.has(k)) gone.push(o);
  // 시그니처만 바뀐 경우: 같은 이름·종류가 하나씩 사라지고 생겼으면 수정으로 본다
  for (const m of fresh) {
    const same = gone.filter((o) => o.kind === m.kind && o.name === m.name);
    const twins = fresh.filter((f) => f.kind === m.kind && f.name === m.name);
    if (same.length === 1 && twins.length === 1) {
      gone.splice(gone.indexOf(same[0]), 1);
      members.set(m.key, { status: 'modified', prevKey: same[0].key });
    } else members.set(m.key, { status: 'added' });
  }
  for (const o of gone) members.set(o.key, { status: 'deleted' });
  const header = b.headerHash !== c.headerHash;
  return { status: header || members.size ? 'modified' : 'same', header, members };
}

// 기준(base)과 현재(cur)를 클래스·멤버 단위로 비교한다
export function diffModels(base, cur) {
  const out = new Map();
  const added = [], deleted = [];
  for (const [id, c] of cur) {
    const b = base.get(id);
    if (!b) added.push(c);
    else {
      const ch = compareClass(b, c);
      if (ch.status !== 'same') out.set(id, ch);
    }
  }
  for (const [id, b] of base) if (!cur.has(id)) deleted.push(b);
  for (const c of added) {
    // 같은 파일에서 하나가 사라지고 하나가 생겼으면 이름 변경으로 본다
    const was = deleted.filter((b) => b.file === c.file && b.kind === c.kind);
    if (was.length === 1 && added.filter((a) => a.file === c.file && a.kind === c.kind).length === 1) {
      const b = was[0];
      deleted.splice(deleted.indexOf(b), 1);
      out.set(c.id, { ...compareClass(b, c), status: 'modified', renamedFrom: b.id, oldName: b.name });
    } else {
      out.set(c.id, { status: 'added', header: true, members: new Map(c.members.map((m) => [m.key, { status: 'added' }])) });
    }
  }
  for (const b of deleted) {
    out.set(b.id, { status: 'deleted', header: true, members: new Map(b.members.map((m) => [m.key, { status: 'deleted' }])) });
  }
  return out;
}

export const memberLabel = (m) => (m.kind === 'method' || m.kind === 'ctor' ? `${m.name}()` : m.name);
