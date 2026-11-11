// 프로젝트 하나(저장소 루트)의 파일·클래스·관계 상태. 여러 Claude 세션이 같은 프로젝트를 공유한다.
import fs from 'node:fs';
import path from 'node:path';
import { parseSource, hash } from './parse.mjs';
import { classify, graph, callGraph, invert } from './model.mjs';

const SKIP_DIRS = new Set(['.git', '.gradle', '.idea', '.kotlin', '.mvn', 'build', 'out', 'target', 'bin', 'node_modules', 'generated']);
const SOURCE = /\.(java|kt)$/;
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

export { findRoot } from './root.mjs';

export class Project {
  constructor(root) {
    this.root = root;
    this.name = path.basename(root);
    this.files = new Map(); // rel → 파싱 결과
    this.srcHash = new Map();
    this.broken = new Set();
    this.sessions = new Set();
    this.cur = new Map();
    this.edges = new Map();
    this.calls = new Map();
    this.callers = new Map();
    this.watcher = null;
    this.ready = false;
  }

  scan(dir = this.root) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) this.scan(path.join(dir, ent.name));
      } else if (SOURCE.test(ent.name)) this.load(toRel(this.root, path.join(dir, ent.name)));
    }
    if (dir === this.root) {
      this.rebuild();
      this.ready = true;
    }
  }

  // 파일 하나를 다시 읽는다. 바뀐 게 없거나 괄호가 안 맞는 중간 상태면 null
  load(rel) {
    const abs = path.join(this.root, rel);
    let src = null;
    try {
      if (fs.statSync(abs).isFile()) src = fs.readFileSync(abs, 'utf8');
    } catch { /* 지워진 파일 */ }
    const prev = this.files.get(rel);
    if (src === null) {
      if (!prev) return null;
      this.files.delete(rel);
      this.srcHash.delete(rel);
      return { rel, before: prev.types, after: [] };
    }
    const h = hash(src);
    if (this.srcHash.get(rel) === h) return null;
    let parsed;
    try {
      parsed = parseSource(src, rel);
    } catch (e) {
      console.warn(`파싱 실패 ${rel}: ${e.message}`);
      return null;
    }
    if (!parsed.ok) {
      this.broken.add(rel);
      return null;
    }
    this.broken.delete(rel);
    this.srcHash.set(rel, h);
    this.files.set(rel, parsed);
    return { rel, before: prev?.types ?? [], after: parsed.types };
  }

  rebuild() {
    const cur = new Map();
    for (const f of this.files.values()) for (const t of f.types) cur.set(t.id, t);
    classify(cur);
    this.cur = cur;
    this.edges = graph(cur);
    this.calls = callGraph(cur);
    this.callers = invert(this.calls);
  }

  // 파일 감시: Edit 도구든 셸이든 IDE든 저장되면 잡힌다
  watch(onFiles) {
    const pending = new Set();
    let timer = null;
    this.watcher = fs.watch(this.root, { recursive: true }, (_evt, name) => {
      if (!name) return;
      const rel = name.toString().split(path.sep).join('/');
      if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) return;
      if (SOURCE.test(rel)) pending.add(rel);
      else if (!fs.existsSync(path.join(this.root, rel))) {
        for (const f of this.files.keys()) if (f.startsWith(rel + '/')) pending.add(f); // 폴더째 지워지거나 옮겨진 경우
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const rels = [...pending];
        pending.clear();
        onFiles(rels);
      }, 120);
    });
  }

  relOf(file) {
    const rel = toRel(this.root, path.resolve(this.root, file));
    return rel.startsWith('..') ? null : rel;
  }

  close() {
    this.watcher?.close();
  }
}
