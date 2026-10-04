import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('pattern learning has explicit governance lifecycle endpoints', () => {
  const source = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  for (const marker of [
    "status !== 'pending' && row.rows[0].status !== 'review'",
    "status !== 'approved'",
    "enabled: false",
    "pattern_definition.activated",
    "explicitActivation: true",
  ]) assert.ok(source.includes(marker), `missing governance marker: ${marker}`);
});

test('pattern learning routes are mounted', () => {
  const source = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("app.use('/api/pattern-learning', patternLearningRouter)"));
  assert.ok(source.includes("import patternLearningRouter from './routes/patternLearningRoutes.js'"));
});
