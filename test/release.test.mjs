import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommit, bumpFor, nextVersion, releaseNotes } from '../scripts/release.mjs';

const c = (subject, body = '') => ({ subject, body, hash: 'abcdef1234' });

test('parses conventional commits', () => {
  assert.deepEqual(parseCommit(c('feat(web): add import')), { type: 'feat', scope: 'web', breaking: false, text: 'add import', hash: 'abcdef1' });
  assert.equal(parseCommit(c('fix!: change format')).breaking, true);
  assert.equal(parseCommit(c('feat: x', 'BREAKING CHANGE: removed y')).breaking, true);
  assert.equal(parseCommit(c('Update README')), null);
});

test('picks the highest bump', () => {
  assert.equal(bumpFor([c('docs: readme'), c('chore: deps')]), null);
  assert.equal(bumpFor([c('fix: a'), c('docs: b')]), 'patch');
  assert.equal(bumpFor([c('fix: a'), c('feat: b')]), 'minor');
  assert.equal(bumpFor([c('feat: a'), c('fix!: b')]), 'major');
  assert.equal(bumpFor([c('feat: a [skip release]')]), null);
});

test('next version (0.x keeps breaking changes on minor)', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.3', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.4.2', 'major'), '0.5.0');
  assert.equal(nextVersion('1.4.2', 'major'), '2.0.0');
  assert.equal(nextVersion('1.4.2', null), null);
  assert.throws(() => nextVersion('v1', 'patch'));
});

test('release notes group commits', () => {
  const n = releaseNotes('0.2.0', [c('feat(cli): run folder'), c('fix: crash'), c('chore: tidy')], 'https://github.com/o/r');
  assert.match(n, /### Features\n- \*\*cli:\*\* run folder \(\[abcdef1\]/);
  assert.match(n, /### Fixes\n- crash/);
  assert.ok(!n.includes('tidy'));
});
