import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');

test('predictive signals cannot bypass correlation-risk-policy before case creation',()=>{
  const predictiveWrite=source.indexOf("action:'predictive_signal.generated'");
  const correlationWrite=source.indexOf("INSERT INTO correlations");
  const caseWrite=source.indexOf("INSERT INTO cases");
  const riskWrite=source.indexOf("INSERT INTO risk_assessments");
  const policyEval=source.indexOf("const policy=evaluatePolicies");
  assert.ok(predictiveWrite>=0);
  assert.ok(correlationWrite>=0);
  assert.ok(riskWrite>=0);
  assert.ok(policyEval>=0);
  assert.ok(caseWrite>=0);
  assert.ok(predictiveWrite<correlationWrite);
  assert.ok(correlationWrite<riskWrite);
  assert.ok(riskWrite<caseWrite);
  assert.ok(policyEval<caseWrite);
  assert.ok(source.includes("if(policy.shouldOpenCase)"));
  assert.ok(!source.includes("if(predictions.length"));
  assert.ok(!source.includes("if(predictiveScore>"));
});
