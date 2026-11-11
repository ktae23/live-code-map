// 저장소 루트 찾기와 Java/Kotlin 프로젝트 판별. 훅이 요청마다 부르므로 무거운 모듈을 불러오지 않는다.
import fs from 'node:fs';
import path from 'node:path';

// cwd에서 위로 올라가며 .git이 있는 곳을 프로젝트 루트로 본다
export function findRoot(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(cwd);
    dir = up;
  }
}

const MARKERS = ['build.gradle.kts', 'build.gradle', 'pom.xml', 'settings.gradle.kts', 'settings.gradle'];
const SKIP = new Set(['node_modules', 'build', 'out', 'target', 'dist', 'bin']);
const hasMarker = (dir) => MARKERS.some((m) => fs.existsSync(path.join(dir, m)));

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

// Gradle·Maven 빌드 파일이 cwd~루트 사이, 또는 (git 저장소라면) 루트에서 두 단계 아래까지 있으면 Java/Kotlin 프로젝트로 본다.
// git 저장소가 아닌 폴더(예: 홈)에서는 아래를 뒤지지 않는다. 그 아래 프로젝트가 있다고 이 세션이 그 작업을 하는 건 아니다.
export function isJvmProject(root, cwd = root) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (hasMarker(dir)) return true;
    if (dir === root || path.dirname(dir) === dir || !dir.startsWith(root)) break;
  }
  if (!fs.existsSync(path.join(root, '.git'))) return false;
  let budget = 400;
  for (const d of subdirs(root)) {
    if (hasMarker(d)) return true;
    for (const dd of subdirs(d)) {
      if (--budget < 0) return false;
      if (hasMarker(dd)) return true;
    }
  }
  return false;
}
