const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertOwnerMerge } = require('./check-release-owner.cjs');
const context = { event: 'push', ref: 'refs/heads/main', actor: 'kariyakarwana',
  triggeringActor: 'kariyakarwana', sha: 'release-sha', repository: 'kariyakarwana/technova-pos-api' };
const branch = { commit: { sha: context.sha } };
const pr = { number: 20, merged_at: '2026-11-01', merge_commit_sha: context.sha,
  base: { ref: 'main', repo: { full_name: context.repository } }, merged_by: { login: 'kariyakarwana' } };
test('owner merge is explicit production permission', () => assert.equal(assertOwnerMerge(context, branch, [pr]), 20));
for (const [name, overrides] of Object.entries({
  'another actor': { actor: 'collaborator' }, 'another rerun actor': { triggeringActor: 'collaborator' },
  'manual dispatch': { event: 'workflow_dispatch' }, 'feature branch': { ref: 'refs/heads/feature/test' },
})) test(`reject ${name}`, () => assert.throws(() => assertOwnerMerge({ ...context, ...overrides }, branch, [pr])));
test('reject direct pushes', () => assert.throws(() => assertOwnerMerge(context, branch, [])));
test('reject old commit', () => assert.throws(() => assertOwnerMerge(context, { commit: { sha: 'new' } }, [pr])));
for (const [name, overrides] of Object.entries({
  'unmerged PR': { merged_at: null }, 'different merge commit': { merge_commit_sha: 'other' },
  'another merger': { merged_by: { login: 'collaborator' } },
  'another base': { base: { ref: 'develop', repo: { full_name: context.repository } } },
})) test(`reject ${name}`, () => assert.throws(() => assertOwnerMerge(context, branch, [{ ...pr, ...overrides }])));
