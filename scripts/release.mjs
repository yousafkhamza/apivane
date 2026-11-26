// Semantic release without dependencies, driven by Conventional Commits since the last v* tag.
//   feat → minor · fix/perf/revert → patch · "!" or "BREAKING CHANGE" → major (minor while on 0.x)
//   No previous tag → first release uses the version in package.json.
//   Commits containing [skip release] are ignored.
// Usage (CI):  node scripts/release.mjs next          → writes release/version to $GITHUB_OUTPUT + release-notes.md
//              node scripts/release.mjs apply 1.2.3   → sets the version in package.json files (not committed)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** @param {{subject:string, body:string, hash?:string}} c */
export function parseCommit(c) {
  const m = c.subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!m) return null;
  const breaking = !!m[3] || /^BREAKING[ -]CHANGE:/m.test(c.body || '');
  return { type: m[1].toLowerCase(), scope: m[2] || '', breaking, text: m[4].trim(), hash: (c.hash || '').slice(0, 7) };
}

/** @returns {'major'|'minor'|'patch'|null} */
export function bumpFor(commits) {
  let level = null;
  const order = { patch: 1, minor: 2, major: 3 };
  for (const raw of commits) {
    if (/\[skip release\]/i.test(raw.subject + raw.body)) continue;
    const c = parseCommit(raw);
    if (!c) continue;
    const l = c.breaking ? 'major' : c.type === 'feat' ? 'minor' : ['fix', 'perf', 'revert'].includes(c.type) ? 'patch' : null;
    if (l && (!level || order[l] > order[level])) level = l;
  }
  return level;
}

export function nextVersion(current, level) {
  const m = String(current).match(SEMVER);
  if (!m) throw new Error(`Not a semver version: ${current}`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (level === 'major' && maj === 0) level = 'minor'; // 0.x: breaking changes bump minor
  if (level === 'major') return `${maj + 1}.0.0`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  if (level === 'patch') return `${maj}.${min}.${pat + 1}`;
  return null;
}

export function releaseNotes(version, commits, repoUrl = '') {
  const groups = { breaking: [], feat: [], fix: [], other: [] };
  for (const raw of commits) {
    const c = parseCommit(raw);
    if (!c) continue;
    const link = c.hash && repoUrl ? ` ([${c.hash}](${repoUrl}/commit/${c.hash}))` : '';
    const line = `- ${c.scope ? `**${c.scope}:** ` : ''}${c.text}${link}`;
    if (c.breaking) groups.breaking.push(line);
    if (c.type === 'feat') groups.feat.push(line);
    else if (c.type === 'fix' || c.type === 'perf') groups.fix.push(line);
    else if (!c.breaking && ['revert', 'refactor', 'docs', 'build', 'ci'].includes(c.type)) groups.other.push(line);
  }
  const sec = (t, l) => (l.length ? `### ${t}\n${l.join('\n')}\n\n` : '');
  return `## ApiVane ${version}\n\n${sec('⚠ Breaking changes', groups.breaking)}${sec('Features', groups.feat)}${sec('Fixes', groups.fix)}${sec('Other', groups.other)}` +
    `### Install\n- Web: ${process.env.SITE_URL || 'https://yousafkhamza.github.io/apivane/'}\n- CLI: \`npx apivane-cli@${version}\`\n- Docker: \`ghcr.io/yousafkhamza/apivane:${version}\`\n- Extensions: zips attached below\n`;
}

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

function readCommits(range) {
  const out = git('log', ...(range ? [range] : []), '--format=%H%x1f%s%x1f%b%x1e');
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => { const [hash, subject, body] = r.split('\x1f'); return { hash, subject, body: body || '' }; });
}

function setOutput(k, v) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  console.log(`${k}=${v}`);
}

function main([cmd, arg]) {
  const pkgPath = path.join(root, 'package.json');
  if (cmd === 'apply') {
    if (!SEMVER.test(arg || '')) throw new Error('usage: release.mjs apply X.Y.Z');
    for (const f of [pkgPath, path.join(root, 'packages/cli/package.json')]) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.version = arg;
      fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    }
    console.log(`version set to ${arg}`);
    return;
  }
  if (cmd !== 'next') throw new Error('usage: release.mjs next | apply X.Y.Z');
  // Re-run of a release whose tag already points at this commit (e.g. npm publish failed):
  // finish the same version instead of skipping. Later steps are idempotent.
  let headTag = '';
  try { headTag = git('describe', '--tags', '--exact-match', '--match', 'v[0-9]*', 'HEAD'); } catch { /* not tagged */ }
  if (headTag) {
    setOutput('release', 'true');
    setOutput('version', headTag.slice(1));
    setOutput('existing', 'true');
    fs.writeFileSync(path.join(root, 'release-notes.md'), releaseNotes(headTag.slice(1), []));
    console.log(`${headTag} already points at HEAD — finishing that release.`);
    return;
  }
  let last = '';
  try { last = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'); } catch { /* no tags yet */ }
  const commits = readCommits(last ? `${last}..HEAD` : '');
  let version;
  if (!last) version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version; // first release
  else version = nextVersion(last.slice(1), bumpFor(commits));
  if (!version) { setOutput('release', 'false'); console.log(`No feat/fix/breaking commits since ${last} — nothing to release.`); return; }
  const repo = process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}` : '';
  fs.writeFileSync(path.join(root, 'release-notes.md'), releaseNotes(version, commits, repo));
  setOutput('release', 'true');
  setOutput('version', version);
  setOutput('previous', last || 'none');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
