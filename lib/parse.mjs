// Java·Kotlin 소스에서 선언부(클래스·프로퍼티·메서드)만 뽑는다.
// 메서드 본문은 해석하지 않고 범위와 해시만 잡는다. 외부 패키지 없이 직접 토큰화한다.

const KT_MODS = new Set([
  'public', 'private', 'protected', 'internal', 'open', 'final', 'abstract', 'sealed', 'data', 'enum',
  'annotation', 'inner', 'companion', 'override', 'lateinit', 'const', 'suspend', 'inline', 'noinline',
  'crossinline', 'infix', 'operator', 'tailrec', 'external', 'expect', 'actual', 'value', 'vararg',
]);
const JAVA_MODS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'native', 'transient',
  'volatile', 'strictfp', 'default', 'sealed',
]);
const OPS = ['...', '->', '::', '?.', '?:', '!!', '..', '==', '!=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%='];

// 줄바꿈 뒤에도 문장이 이어지는지 — Kotlin은 세미콜론 없이 줄바꿈으로 문장을 끝낸다
const CONT_PREV = new Set(['=', '.', '?.', ',', '(', '[', ':', '->', '+', '-', '*', '/', '%', '&&', '||', '?:', '==', '!=', '..', '!', '+=', '-=', '::', 'in', 'is', 'as', 'to', 'else', 'return', 'throw', 'by', 'and', 'or']);
const CONT_NEXT = new Set(['.', '?.', '?:', '&&', '||', '->', 'else', 'catch', 'finally', 'as', 'is', '..', '::', 'to', 'and', 'or', '=']);

// 본문에서 호출이 아닌 키워드
const BODY_KW = new Set([
  'if', 'for', 'while', 'when', 'switch', 'catch', 'return', 'synchronized', 'super', 'this', 'new', 'throw', 'try',
  'else', 'do', 'in', 'is', 'as', 'object', 'fun', 'val', 'var', 'assert', 'yield', 'finally', 'init', 'get', 'set',
]);

const MAPPINGS = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH', RequestMapping: '' };
const TAGGED = new Set(['Transactional', 'Scheduled', 'EventListener', 'TransactionalEventListener', 'Async', 'Cacheable', 'CacheEvict', 'KafkaListener', 'Bean', 'PreAuthorize']);

export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
const isIdPart = (c) => isIdStart(c) || (c >= 48 && c <= 57);
const isDigit = (c) => c >= 48 && c <= 57;

// 토큰: { v, t: 'id'|'op'|'str'|'chr'|'num', s, e, line, nl(앞에 줄바꿈이 있었는지) }
export function lex(src, kotlin) {
  const toks = [];
  const n = src.length;
  let i = 0, line = 1, nl = false;

  const skipQuoted = (j) => {
    j++;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '"') return j + 1;
      if (c === '\n') return j; // 닫히지 않은 문자열은 줄 끝에서 끊는다
      if (kotlin && c === '$' && src[j + 1] === '{') { j = skipTemplate(j + 2); continue; }
      j++;
    }
    return j;
  };
  const skipRaw = (j) => {
    j += 3;
    while (j < n) {
      if (src[j] === '"' && src[j + 1] === '"' && src[j + 2] === '"') {
        let k = j + 3;
        while (src[k] === '"') k++;
        return k;
      }
      if (src[j] === '\n') line++;
      if (kotlin && src[j] === '$' && src[j + 1] === '{') { j = skipTemplate(j + 2); continue; }
      if (!kotlin && src[j] === '\\') { j += 2; continue; }
      j++;
    }
    return j;
  };
  const skipChar = (j) => {
    let k = j + 1;
    k += src[k] === '\\' ? 2 : 1;
    while (k < n && k < j + 10 && src[k] !== '\'' && src[k] !== '\n') k++;
    return src[k] === '\'' ? k + 1 : j + 1;
  };
  const skipBlock = (j) => {
    let depth = 1;
    j += 2;
    while (j < n) {
      if (src[j] === '\n') line++;
      if (src[j] === '*' && src[j + 1] === '/') {
        j += 2;
        if (!kotlin || --depth === 0) return j;
        continue;
      }
      if (kotlin && src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; continue; }
      j++;
    }
    return j;
  };
  // 문자열 템플릿 ${ ... } 안쪽 코드 — 중괄호와 중첩 문자열을 센다
  const skipTemplate = (j) => {
    let depth = 1;
    while (j < n) {
      const c = src[j];
      if (c === '\n') { line++; j++; continue; }
      if (c === '"') { j = src.startsWith('"""', j) ? skipRaw(j) : skipQuoted(j); continue; }
      if (c === '\'') { j = skipChar(j); continue; }
      if (c === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
      if (c === '/' && src[j + 1] === '*') { j = skipBlock(j); continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j + 1;
      j++;
    }
    return j;
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 10) { line++; nl = true; i++; continue; }
    if (c === 32 || c === 9 || c === 13 || c === 12 || c === 0xfeff) { i++; continue; }
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      const l0 = line;
      i = skipBlock(i);
      if (line !== l0) nl = true;
      continue;
    }
    const start = i, startLine = line;
    let t, v;
    if (ch === '"') { i = src.startsWith('"""', i) ? skipRaw(i) : skipQuoted(i); t = 'str'; }
    else if (ch === '\'') { i = skipChar(i); t = 'chr'; }
    else if (ch === '`' && kotlin) {
      const j = src.indexOf('`', i + 1);
      i = j < 0 ? n : j + 1;
      t = 'id';
      v = src.slice(start + 1, i - 1);
    } else if (isDigit(c) || (ch === '.' && isDigit(src.charCodeAt(i + 1)))) {
      i++;
      while (i < n) {
        const d = src.charCodeAt(i);
        if (isIdPart(d)) i++;
        else if (src[i] === '.' && isDigit(src.charCodeAt(i + 1))) i++;
        else break;
      }
      t = 'num';
    } else if (isIdStart(c)) {
      i++;
      while (i < n && isIdPart(src.charCodeAt(i))) i++;
      t = 'id';
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      i += op ? op.length : 1;
      t = 'op';
    }
    toks.push({ v: v ?? src.slice(start, i), t, s: start, e: i, line: startLine, nl });
    nl = false;
  }
  return toks;
}

function pairBrackets(toks) {
  const match = new Int32Array(toks.length).fill(-1);
  const stack = [];
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  let ok = true;
  for (let i = 0; i < toks.length; i++) {
    const { t, v } = toks[i];
    if (t !== 'op') continue;
    if (v === '(' || v === '[' || v === '{') stack.push(i);
    else if (v === ')' || v === ']' || v === '}') {
      const j = stack.pop();
      if (j === undefined || OPEN[toks[j].v] !== v) { ok = false; continue; }
      match[i] = j;
      match[j] = i;
    }
  }
  if (stack.length) ok = false;
  return { match, ok };
}

function pathOf(args) {
  if (!args) return '';
  const m = args.match(/(?:value|path)\s*=\s*[[{]?\s*"([^"]*)"/) || args.match(/^\(\s*[[{]?\s*"([^"]*)"/);
  return m ? m[1] : '';
}
function joinPath(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.replace(/\/$/, '') + '/' + b.replace(/^\//, '');
}

export function parseSource(src, file) {
  const kotlin = file.endsWith('.kt');
  const toks = lex(src, kotlin);
  const { match, ok } = pairBrackets(toks);
  const p = new Parser(src, toks, match, kotlin, file);
  p.parseFile();
  return { ok, pkg: p.pkg, imports: p.imports, types: p.types };
}

class Parser {
  constructor(src, toks, match, kotlin, file) {
    Object.assign(this, { src, toks, match, kotlin, file });
    this.pkg = '';
    this.imports = [];
    this.types = [];
  }

  v(i) { return this.toks[i]?.v; }
  isId(i) { return this.toks[i]?.t === 'id'; }
  close(i) { const m = this.match[i]; return m > i ? m : this.toks.length - 1; }
  // 토큰 [a, b) 범위의 원문
  text(a, b) { return b > a ? this.src.slice(this.toks[a].s, this.toks[b - 1].e) : ''; }
  // 들여쓰기를 맞추려고 첫 줄 시작부터 자른다
  block(a, b) {
    if (b <= a) return '';
    const s = this.src.lastIndexOf('\n', this.toks[a].s - 1) + 1;
    return this.src.slice(s, this.toks[b - 1].e);
  }

  parseFile() {
    let i = 0;
    while (this.v(i) === '@' && this.v(i + 1) === 'file') i = this.annotation(i, []);
    if (this.v(i) === 'package') {
      const [name, j] = this.qualified(i + 1);
      this.pkg = name;
      i = this.v(j) === ';' ? j + 1 : j;
    }
    while (this.v(i) === 'import') i = this.importDecl(i + 1);
    // Kotlin 최상위 함수·프로퍼티는 파일 이름의 가상 클래스(OrderUtilsKt)에 모은다
    const base = this.file.split('/').pop().replace(/\.kt$/, '');
    const fileCls = this.kotlin ? this.makeClass(base + 'Kt', 'file', null, { anns: [], mods: [] }, this.toks[0] ?? { line: 1 }) : null;
    this.body(i, this.toks.length, fileCls);
    if (fileCls && fileCls.members.length) this.types.push(this.finish(fileCls));
  }

  qualified(i) {
    let name = '';
    while (this.isId(i) || this.v(i) === '*') {
      name += this.v(i++);
      if (this.v(i) === '.') { name += '.'; i++; } else break;
    }
    return [name, i];
  }

  importDecl(i) {
    if (this.v(i) === 'static') i++;
    const [name, j] = this.qualified(i);
    if (name) this.imports.push(name);
    let k = j;
    if (this.kotlin && this.v(k) === 'as') k += 2;
    return this.v(k) === ';' ? k + 1 : k;
  }

  annotation(i, out) {
    let j = i + 1;
    if (this.isId(j) && this.v(j + 1) === ':') j += 2; // @field:, @get:, @file:
    if (!this.isId(j)) return i + 1;
    let name = this.v(j++);
    while (this.v(j) === '.' && this.isId(j + 1)) { name = this.v(j + 1); j += 2; }
    let args = '';
    if (this.v(j) === '(' && !this.toks[j].nl) {
      const c = this.close(j);
      args = this.text(j, c + 1);
      j = c + 1;
    }
    out.push({ name, args });
    return j;
  }

  isMod(i) {
    if (!(this.kotlin ? KT_MODS : JAVA_MODS).has(this.v(i))) return false;
    const nx = this.toks[i + 1];
    return !!nx && (nx.t === 'id' || nx.v === '@' || nx.v === '<');
  }

  body(i, end, owner, isStatic = false) {
    if (owner?.kind === 'enum') i = this.enumEntries(i, end, owner);
    while (i < end) {
      const v = this.v(i);
      if (v === ';' || v === ',') { i++; continue; }
      const start = i;
      const anns = [], mods = [];
      while (i < end) {
        if (this.v(i) === '@' && this.v(i + 1) !== 'interface') { i = this.annotation(i, anns); continue; }
        if (this.isMod(i)) { mods.push(this.v(i++)); continue; }
        break;
      }
      if (i >= end) break;
      const d = { start, anns, mods, owner, isStatic: isStatic || mods.includes('static') };
      const next = this.kotlin ? this.ktDecl(i, end, d) : this.javaDecl(i, end, d);
      i = next > i ? next : i + 1;
    }
  }

  ktDecl(i, end, d) {
    const k = this.v(i);
    if (k === 'class' || k === 'interface' || k === 'object' || (k === 'fun' && this.v(i + 1) === 'interface')) return this.typeDecl(i, end, d);
    if (k === 'fun') return this.ktFun(i, end, d);
    if (k === 'val' || k === 'var') return this.ktProp(i, end, d);
    if (k === 'constructor') return this.ktCtor(i, end, d);
    if (k === 'init') return this.v(i + 1) === '{' ? this.close(i + 1) + 1 : i + 1;
    if (k === 'typealias') return this.expr(i + 1, end);
    return this.expr(i, end); // 알 수 없는 문장은 끝까지 건너뛴다
  }

  javaDecl(i, end, d) {
    const k = this.v(i);
    const isRecord = k === 'record' && this.isId(i + 1) && (this.v(i + 2) === '(' || this.v(i + 2) === '<');
    if (k === 'class' || k === 'interface' || k === 'enum' || isRecord || (k === '@' && this.v(i + 1) === 'interface')) return this.typeDecl(i, end, d);
    if (k === '{') return this.close(i) + 1; // 초기화 블록
    return this.javaMember(i, end, d);
  }

  typeDecl(i, end, d) {
    const { mods, owner } = d;
    let kind;
    if (this.kotlin) {
      if (this.v(i) === 'fun') i++;
      const k = this.v(i);
      kind = k === 'interface' ? 'interface'
        : k === 'object' ? (mods.includes('companion') ? 'companion' : 'object')
        : mods.includes('enum') ? 'enum' : mods.includes('data') ? 'data'
        : mods.includes('annotation') ? 'annotation' : mods.includes('sealed') ? 'sealed'
        : mods.includes('abstract') ? 'abstract' : 'class';
    } else {
      const at = this.v(i) === '@';
      if (at) i++;
      const k = this.v(i);
      kind = at ? 'annotation' : k === 'enum' ? 'enum' : k === 'record' ? 'record'
        : k === 'interface' ? 'interface' : mods.includes('abstract') ? 'abstract' : 'class';
    }
    const kw = this.toks[i++];

    // companion object 멤버는 바깥 클래스의 static 멤버로 합친다
    if (kind === 'companion' && owner && owner.kind !== 'file') {
      let j = i;
      while (j < end && this.v(j) !== '{' && !(j > i && this.toks[j].nl)) j++;
      if (this.v(j) !== '{') return j;
      const c = this.close(j);
      this.body(j + 1, c, owner, true);
      return c + 1;
    }

    let name = null;
    if (this.isId(i) && this.v(i) !== 'constructor') name = this.v(i++);
    const cls = this.makeClass(name ?? (kind === 'companion' ? 'Companion' : '(익명)'), kind, owner, d, kw);
    if (this.v(i) === '<') { const j = this.angles(i); cls.typeParams = this.text(i, j); i = j; }

    if (this.kotlin) {
      let j = i;
      while (this.v(j) === '@') j = this.annotation(j, []);
      while (['private', 'protected', 'internal', 'public'].includes(this.v(j))) j++;
      if (this.v(j) === 'constructor') j++;
      if (this.v(j) === '(') { this.ctorParams(cls, j); i = this.close(j) + 1; }
      if (this.v(i) === ':') i = this.supers(i + 1, end, cls);
      if (this.v(i) === 'where') i = this.skipWhere(i, end);
    } else {
      if (kind === 'record' && this.v(i) === '(') { this.ctorParams(cls, i); i = this.close(i) + 1; }
      while (this.v(i) === 'extends' || this.v(i) === 'implements' || this.v(i) === 'permits') {
        const rel = this.v(i);
        i = this.supers(i + 1, end, cls, rel);
      }
    }
    cls.headerText = this.block(d.start, i);
    if (this.v(i) === '{') {
      const c = this.close(i);
      this.body(i + 1, c, cls);
      i = c + 1;
    }
    this.finish(cls);
    return i;
  }

  makeClass(name, kind, owner, d, kw) {
    const nested = owner && owner.kind !== 'file';
    const cls = {
      id: nested ? `${owner.id}.${name}` : this.pkg ? `${this.pkg}.${name}` : name,
      name: nested ? `${owner.name}.${name}` : name,
      simple: name,
      pkg: this.pkg,
      file: this.file,
      line: kw.line,
      kind,
      anns: d.anns.map((a) => a.name),
      annArgs: Object.fromEntries(d.anns.map((a) => [a.name, a.args])),
      mods: d.mods,
      typeParams: '',
      supers: [],
      ctor: [],
      members: [],
      imports: this.imports,
      headerText: '',
    };
    if (kind !== 'file') this.types.push(cls);
    return cls;
  }

  finish(cls) {
    // 선언부 해시: 생성자 프로퍼티는 멤버로 따로 비교하므로 뺀다
    const plain = cls.ctor.filter((p) => !p.prop).map((p) => [p.name, p.type]);
    cls.headerHash = hash(JSON.stringify([cls.kind, cls.anns, cls.annArgs, cls.typeParams, cls.supers, plain]));
    cls.route = pathOf(cls.annArgs.RequestMapping);
    return cls;
  }

  ctorParams(cls, i) {
    const params = this.params(i);
    for (const p of params) {
      if (cls.kind === 'record') p.prop = 'val';
      if (!p.prop) continue;
      this.addMember(cls, {
        kind: 'prop', name: p.name, type: p.type, ids: p.ids, mut: p.prop, anns: p.anns, mods: p.mods,
        line: this.toks[p.s].line, text: this.block(p.s, p.e),
      });
    }
    cls.ctor = params.map(({ name, type, ids, prop }) => ({ name, type, ids, prop }));
  }

  supers(i, end, cls, rel) {
    while (i < end) {
      while (this.v(i) === '@') i = this.annotation(i, []);
      if (!this.isId(i)) break;
      let name = this.v(i++);
      while (this.v(i) === '.' && this.isId(i + 1)) { name = this.v(i + 1); i += 2; }
      let args = [];
      if (this.v(i) === '<') { const j = this.angles(i); args = this.typeIds(i, j); i = j; }
      const call = this.v(i) === '(';
      if (call) i = this.close(i) + 1;
      if (this.kotlin && this.v(i) === 'by') i = this.delegate(i + 1, end);
      const r = rel === 'implements' ? 'implements'
        : rel === 'extends' || rel === 'permits' ? 'extends'
        : call || cls.kind === 'interface' ? 'extends' : 'implements';
      if (rel !== 'permits') cls.supers.push({ name, args, rel: r });
      if (this.v(i) === ',') { i++; continue; }
      break;
    }
    return i;
  }

  delegate(i, end) {
    const s = i;
    while (i < end) {
      const v = this.v(i);
      if (v === ',' || v === '{' || (i > s && this.toks[i].nl)) return i;
      if (v === '(' || v === '[') { i = this.close(i) + 1; continue; }
      i++;
    }
    return i;
  }

  skipWhere(i, end) {
    i++;
    while (i < end) {
      const v = this.v(i);
      if (v === '{' || v === '=') return i;
      if (this.toks[i].nl && this.v(i - 1) !== ',' && this.v(i - 1) !== ':') return i;
      i++;
    }
    return i;
  }

  angles(i) {
    let depth = 0;
    for (let j = i; j < this.toks.length; j++) {
      const v = this.v(j);
      if (v === '<') depth++;
      else if (v === '>') { if (--depth === 0) return j + 1; }
      else if (v === '(' || v === '[') j = this.close(j);
      else if (v === '{' || v === ';' || v === '=' || v === ')' || v === '}') return i + 1; // 제네릭이 아니었다
    }
    return i + 1;
  }

  params(i) {
    const c = this.close(i);
    return this.split(i + 1, c)
      .map(([a, b]) => (this.kotlin ? this.ktParam(a, b) : this.javaParam(a, b)))
      .filter(Boolean);
  }

  // 괄호 안을 최상위 쉼표로 나눈다. 기본값 식 안의 < > 는 비교 연산일 수 있어 세지 않는다
  split(a, b) {
    const out = [];
    let s = a, angle = 0, dflt = false;
    for (let j = a; j < b; j++) {
      const v = this.v(j);
      if (v === '(' || v === '[' || v === '{') { j = this.close(j); continue; }
      if (v === '=') dflt = true;
      else if (!dflt && v === '<') angle++;
      else if (!dflt && v === '>' && angle > 0) angle--;
      else if (v === ',' && angle === 0) {
        if (j > s) out.push([s, j]);
        s = j + 1;
        dflt = false;
      }
    }
    if (b > s) out.push([s, b]);
    return out;
  }

  ktParam(a, b) {
    let j = a;
    const anns = [], mods = [];
    while (j < b && this.v(j) === '@') j = this.annotation(j, anns);
    while (j < b && this.isMod(j)) mods.push(this.v(j++));
    let prop = null;
    if (this.v(j) === 'val' || this.v(j) === 'var') prop = this.v(j++);
    if (!this.isId(j)) return null;
    const name = this.v(j++);
    let type = '', ids = [];
    if (this.v(j) === ':') {
      let k = j + 1;
      while (k < b && this.v(k) !== '=') {
        if (this.v(k) === '(' || this.v(k) === '[') k = this.close(k);
        k++;
      }
      type = this.typeText(j + 1, k);
      ids = this.typeIds(j + 1, k);
    }
    return { name, type, ids, prop, mods, anns: anns.map((x) => x.name), s: a, e: b };
  }

  javaParam(a, b) {
    let j = a;
    const anns = [];
    while (j < b && (this.v(j) === '@' || this.v(j) === 'final')) j = this.v(j) === '@' ? this.annotation(j, anns) : j + 1;
    let e = b;
    while (e > j && (this.v(e - 1) === ']' || this.v(e - 1) === '[')) e--;
    if (e - 1 < j || !this.isId(e - 1)) return null;
    return { name: this.v(e - 1), type: this.typeText(j, e - 1), ids: this.typeIds(j, e - 1), prop: null, mods: [], anns: anns.map((x) => x.name), s: a, e: b };
  }

  ktFun(i, end, d) {
    const kw = this.toks[i];
    let j = i + 1;
    if (this.v(j) === '<') j = this.angles(j);
    const recvStart = j;
    let nameAt = -1;
    while (j < end) {
      const v = this.v(j);
      if (v === '<') { j = this.angles(j); continue; }
      if (v === '(') break;
      if (v === '{' || v === '=' || v === ';' || v === '}') return j;
      if (this.isId(j)) nameAt = j;
      j++;
    }
    if (this.v(j) !== '(' || nameAt < 0) return j;
    const params = this.params(j);
    let k = this.close(j) + 1;
    let ret = '', ids = [];
    if (this.v(k) === ':') {
      const r = k + 1;
      k = this.typeEnd(r, end);
      ret = this.typeText(r, k);
      ids = this.typeIds(r, k);
    }
    if (this.v(k) === 'where') k = this.skipWhere(k, end);
    let body = null;
    if (this.v(k) === '{') { body = [k + 1, this.close(k)]; k = body[1] + 1; }
    else if (this.v(k) === '=') { const e = this.expr(k + 1, end); body = [k + 1, e]; k = e; }
    this.addMember(d.owner, {
      kind: 'method', name: this.v(nameAt), params, ret, ids,
      receiver: nameAt > recvStart ? this.typeText(recvStart, nameAt - 1) : '',
      anns: d.anns, mods: d.mods, static: d.isStatic, line: kw.line, text: this.block(d.start, k),
      ...this.bodyScan(body),
    });
    return k;
  }

  ktProp(i, end, d) {
    const kw = this.toks[i];
    let j = i + 1;
    if (this.v(j) === '<') j = this.angles(j);
    if (this.v(j) === '(') return this.expr(j, end); // 구조 분해 선언
    let k = j, nameAt = -1;
    while (k < end) {
      const v = this.v(k);
      if (v === '<') { k = this.angles(k); continue; }
      if (v === ':' || v === '=' || v === 'by' || v === ';' || v === '}' || (k > j && this.toks[k].nl)) break;
      if (this.isId(k)) nameAt = k;
      k++;
    }
    if (nameAt < 0) return k;
    let type = '', ids = [];
    if (this.v(k) === ':') {
      const t = k + 1;
      k = this.typeEnd(t, end);
      type = this.typeText(t, k);
      ids = this.typeIds(t, k);
    }
    if (this.v(k) === '=' || this.v(k) === 'by') k = this.expr(k + 1, end);
    k = this.accessors(k, end);
    this.addMember(d.owner, {
      kind: 'prop', name: this.v(nameAt), type, ids, mut: kw.v,
      receiver: nameAt > j ? this.typeText(j, nameAt - 1) : '',
      anns: d.anns, mods: d.mods, static: d.isStatic, line: kw.line, text: this.block(d.start, k),
    });
    return k;
  }

  // 프로퍼티 뒤에 붙는 get()/set() 접근자
  accessors(k, end) {
    while (k < end) {
      let m = k;
      while (this.v(m) === '@') m = this.annotation(m, []);
      while (['private', 'protected', 'internal', 'public', 'override', 'inline', 'external'].includes(this.v(m))) m++;
      if (this.v(m) !== 'get' && this.v(m) !== 'set') return k;
      m++;
      if (this.v(m) === '(') m = this.close(m) + 1;
      if (this.v(m) === ':') m = this.typeEnd(m + 1, end);
      if (this.v(m) === '{') m = this.close(m) + 1;
      else if (this.v(m) === '=') m = this.expr(m + 1, end);
      k = m;
    }
    return k;
  }

  ktCtor(i, end, d) {
    const kw = this.toks[i];
    let k = i + 1;
    if (this.v(k) !== '(') return k;
    const params = this.params(k);
    k = this.close(k) + 1;
    if (this.v(k) === ':') {
      k++;
      if (this.isId(k)) k++;
      if (this.v(k) === '(') k = this.close(k) + 1;
    }
    let body = null;
    if (this.v(k) === '{') { body = [k + 1, this.close(k)]; k = body[1] + 1; }
    this.addMember(d.owner, {
      kind: 'ctor', name: 'constructor', params, ret: '', ids: [],
      anns: d.anns, mods: d.mods, line: kw.line, text: this.block(d.start, k),
      ...this.bodyScan(body),
    });
    return k;
  }

  // 메서드 본문에서 호출(receiver 체인 + 이름)과 지역 변수 선언을 모은다. 타입 해석은 model에서 한다
  bodyScan(range) {
    const calls = [], locals = [];
    if (!range) return { calls, locals };
    const [a, b] = range;
    for (let j = a; j < b; j++) {
      const t = this.toks[j];
      if (t.t !== 'id') {
        if (t.v === '::' && this.isId(j + 1) && this.v(j + 1) !== 'class') {
          const r = this.isId(j - 1) ? this.v(j - 1) : null;
          calls.push({ recv: r && r !== 'this' ? [r] : [], name: this.v(j + 1), line: t.line });
        }
        continue;
      }
      if (this.kotlin && (t.v === 'val' || t.v === 'var') && this.isId(j + 1)) {
        const name = this.v(j + 1);
        let k = j + 2, ids = null, chain = null;
        if (this.v(k) === ':') { const e = this.typeEnd(k + 1, b); ids = this.typeIds(k + 1, e); k = e; }
        if (this.v(k) === '=') chain = this.chainAt(k + 1, b);
        locals.push({ name, ids, chain });
        j++;
        continue;
      }
      if (!this.kotlin && (j === a || [';', '{', '}', '(', 'final'].includes(this.v(j - 1))) && !BODY_KW.has(t.v)) {
        // Java 지역 변수: Type [<..>] [[]] name (= | ; | :)
        let k = j + 1;
        if (this.v(k) === '<') k = this.angles(k);
        while (this.v(k) === '[' && this.v(k + 1) === ']') k += 2;
        if (this.isId(k) && ['=', ';', ':', ','].includes(this.v(k + 1))) {
          const isVar = t.v === 'var';
          locals.push({ name: this.v(k), ids: isVar ? null : this.typeIds(j, k), chain: isVar && this.v(k + 1) === '=' ? this.chainAt(k + 2, b) : null });
        }
      }
      const nx = this.toks[j + 1];
      const isCall = nx && (nx.v === '(' || (this.kotlin && nx.v === '{' && !nx.nl));
      if (!isCall || BODY_KW.has(t.v) || this.v(j - 1) === 'new' || this.v(j - 1) === 'fun') continue;
      const recv = [];
      let k = j - 1;
      while (k > a && (this.v(k) === '.' || this.v(k) === '?.')) {
        let p = k - 1;
        if (this.v(p) === '!!') p--;
        const pv = this.v(p);
        if ((pv === ')' || pv === '}') && this.match[p] > 0 && this.isId(this.match[p] - 1)) {
          const q = this.match[p] - 1;
          recv.unshift(this.v(q) + '()');
          k = q - 1;
        } else if (this.isId(p)) {
          recv.unshift(pv);
          k = p - 1;
        } else {
          recv.unshift('?');
          break;
        }
      }
      calls.push({ recv, name: t.v, line: t.line });
    }
    return { calls, locals };
  }

  // 대입식 오른쪽의 호출 체인: orderRepository.findById(id).orElseThrow { } → [orderRepository, findById(), orElseThrow()]
  chainAt(k, b) {
    const segs = [];
    while (k < b) {
      if (this.v(k) === 'new' && this.isId(k + 1)) {
        segs.push(this.v(k + 1) + '()');
        k += 2;
        if (this.v(k) === '<') k = this.angles(k);
        if (this.v(k) === '(') k = this.close(k) + 1;
      } else if (this.isId(k)) {
        const name = this.v(k++);
        if (this.v(k) === '<') { const e = this.angles(k); if (this.v(e) === '(') k = e; }
        if (this.v(k) === '(') {
          segs.push(name + '()');
          k = this.close(k) + 1;
          if (this.kotlin && this.v(k) === '{' && !this.toks[k].nl) k = this.close(k) + 1;
        } else if (this.kotlin && this.v(k) === '{' && !this.toks[k].nl) {
          segs.push(name + '()');
          k = this.close(k) + 1;
        } else segs.push(name);
      } else break;
      if (this.v(k) === '!!') k++;
      if (this.v(k) === '.' || this.v(k) === '?.') { k++; continue; }
      break;
    }
    return segs.length ? segs : null;
  }

  // 타입 식이 끝나는 위치
  typeEnd(k, end) {
    const s = k;
    while (k < end) {
      const v = this.v(k);
      if (k > s && this.toks[k].nl && !['.', '?', '<', ',', '->'].includes(this.v(k - 1)) && v !== '.' && v !== '->') return k;
      if (v === '<') { k = this.angles(k); continue; }
      if (v === '(' || v === '[') { k = this.close(k) + 1; continue; }
      if (v === '{' || v === '=' || v === ',' || v === ')' || v === ';' || v === '}' || v === 'where' || v === 'by') return k;
      k++;
    }
    return k;
  }

  // Kotlin 식 본문·초기값을 문장 끝까지 건너뛴다
  expr(i, end) {
    const s = i;
    while (i < end) {
      const t = this.toks[i];
      if (i > s && t.nl && !CONT_PREV.has(this.v(i - 1)) && !CONT_NEXT.has(t.v)) return i;
      const v = t.v;
      if (v === ';') return i + 1;
      if (v === '}' || v === ')' || v === ']') return i;
      if (v === '(' || v === '[' || v === '{') { i = this.close(i) + 1; continue; }
      i++;
    }
    return i;
  }

  javaMember(i, end, d) {
    let j = i, typeStart = i;
    if (this.v(j) === '<') { j = this.angles(j); typeStart = j; }
    while (j < end) {
      const v = this.v(j);
      if (v === '<') { j = this.angles(j); continue; }
      if (v === '[') { j = this.close(j) + 1; continue; }
      if (v === '@') { j = this.annotation(j, d.anns); continue; }
      if (v === '(' || v === '=' || v === ';' || v === '{' || v === ',' || v === '}') break;
      j++;
    }
    const stop = this.v(j);
    if (stop === '{') return this.close(j) + 1; // static { } 같은 블록
    if (stop === '}') return j;
    const last = j - 1;
    if (last < typeStart || !this.isId(last)) return this.javaSkip(j, end);
    const name = this.v(last);
    if (stop === '(') {
      const params = this.params(j);
      let k = this.close(j) + 1;
      while (k < end && this.v(k) !== '{' && this.v(k) !== ';' && this.v(k) !== '}') {
        if (this.v(k) === '(' || this.v(k) === '[') k = this.close(k);
        k++;
      }
      let body = null;
      if (this.v(k) === '{') { body = [k + 1, this.close(k)]; k = body[1] + 1; }
      else if (this.v(k) === ';') k++;
      const isCtor = last === typeStart && d.owner && name === d.owner.simple;
      this.addMember(d.owner, {
        kind: isCtor ? 'ctor' : 'method', name, params,
        ret: isCtor ? '' : this.typeText(typeStart, last), ids: isCtor ? [] : this.typeIds(typeStart, last),
        anns: d.anns, mods: d.mods, static: d.isStatic, line: this.toks[last].line, text: this.block(d.start, k),
        ...this.bodyScan(body),
      });
      return k;
    }
    const k = this.javaSkip(j, end);
    this.addMember(d.owner, {
      kind: 'field', name, type: this.typeText(typeStart, last), ids: this.typeIds(typeStart, last),
      mut: d.mods.includes('final') ? 'val' : 'var',
      anns: d.anns, mods: d.mods, static: d.isStatic, line: this.toks[last].line, text: this.block(d.start, k),
    });
    return k;
  }

  javaSkip(j, end) {
    while (j < end) {
      const v = this.v(j);
      if (v === ';') return j + 1;
      if (v === '}') return j;
      if (v === '(' || v === '[' || v === '{') { j = this.close(j) + 1; continue; }
      j++;
    }
    return j;
  }

  enumEntries(i, end, cls) {
    const DECL = new Set(['fun', 'val', 'var', 'class', 'interface', 'object', 'init', 'constructor', 'companion']);
    while (i < end) {
      if (this.v(i) === ';') return i + 1;
      const s = i;
      while (this.v(i) === '@') i = this.annotation(i, []);
      if (!this.isId(i) || this.isMod(i) || DECL.has(this.v(i))) return s;
      const name = this.v(i);
      const line = this.toks[i++].line;
      if (this.v(i) === '(') i = this.close(i) + 1;
      if (this.v(i) === '{') i = this.close(i) + 1;
      this.addMember(cls, { kind: 'entry', name, anns: [], mods: [], line, text: this.block(s, i) });
      if (this.v(i) === ',') { i++; continue; }
      return this.v(i) === ';' ? i + 1 : i;
    }
    return i;
  }

  typeText(a, b) {
    let s = '';
    for (let j = a; j < b; j++) {
      const t = this.toks[j];
      if (t.v === '@') { j = this.annotation(j, []) - 1; continue; }
      if (t.v === ',') s += ', ';
      else if (t.v === '->') s += ' -> ';
      else if (t.v === ':') s += ': ';
      else if (t.t === 'id' && /[\w$)>\]?]$/.test(s)) s += ' ' + t.v;
      else s += t.v;
    }
    return s.trim();
  }

  // 타입 식에 나온 대문자 식별자 — 프로젝트 안 클래스와의 관계선을 그릴 때 쓴다
  typeIds(a, b) {
    const out = new Set();
    for (let j = a; j < b; j++) {
      const t = this.toks[j];
      if (t.v === '@') { j = this.annotation(j, []) - 1; continue; }
      if (t.t === 'id' && /^[A-Z]/.test(t.v) && this.v(j + 1) !== '.') out.add(t.v);
    }
    return [...out];
  }

  addMember(cls, m) {
    if (!cls) return;
    m.params = (m.params ?? []).map(({ name, type, ids }) => ({ name, type, ids }));
    // 생성자는 파라미터 타입이 의존성, 메서드의 ids는 반환 타입
    if (m.kind === 'ctor') m.ids = [...new Set(m.params.flatMap((p) => p.ids))];
    m.calls ??= [];
    m.locals ??= [];
    const sigTypes = m.kind === 'method' || m.kind === 'ctor' ? `(${m.params.map((p) => p.type).join(',')})` : '';
    m.key = `${m.static ? 'static ' : ''}${m.kind} ${m.receiver ? m.receiver + '.' : ''}${m.name}${sigTypes}`;
    if (cls.members.some((x) => x.key === m.key)) m.key += '@' + m.line;
    m.hash = hash(m.text.replace(/\s+/g, ' '));
    m.private = m.mods.includes('private');
    m.tags = this.tags(m.anns, cls);
    m.sig = sigOf(m, cls);
    m.anns = m.anns.map((a) => a.name ?? a);
    cls.members.push(m);
  }

  tags(anns, cls) {
    const out = [];
    for (const a of anns) {
      if (typeof a === 'string') continue;
      if (a.name in MAPPINGS) {
        const method = MAPPINGS[a.name] || (a.args.match(/RequestMethod\.(\w+)/)?.[1] ?? 'ANY');
        out.push(`${method} ${joinPath(pathOf(cls.annArgs.RequestMapping), pathOf(a.args)) || '/'}`);
      } else if (TAGGED.has(a.name)) out.push('@' + a.name);
    }
    return out;
  }
}

function sigOf(m, cls) {
  const ps = m.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ');
  const recv = m.receiver ? m.receiver + '.' : '';
  switch (m.kind) {
    case 'method': {
      const ret = m.ret && m.ret !== 'void' && m.ret !== 'Unit' ? `: ${m.ret}` : '';
      return `${recv}${m.name}(${ps})${ret}`;
    }
    case 'ctor': return `${m.name === 'constructor' ? 'constructor' : cls.simple}(${ps})`;
    case 'entry': return m.name;
    default: return m.type ? `${recv}${m.name}: ${m.type}` : `${recv}${m.name}`;
  }
}
