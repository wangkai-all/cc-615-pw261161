import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePopulation, RISK_LEVELS } from '../src/population.js';

test('相同种子生成完全相同的虚构底册', () => {
  const a = generatePopulation({ size: 600, seed: 's1' });
  const b = generatePopulation({ size: 600, seed: 's1' });
  assert.equal(a.records.length, 600);
  assert.deepEqual(
    a.records.map((r) => r.id),
    b.records.map((r) => r.id),
  );
  assert.deepEqual(
    a.records.map((r) => r.riskScore),
    b.records.map((r) => r.riskScore),
  );
  assert.deepEqual(
    a.records.map((r) => r.defective),
    b.records.map((r) => r.defective),
  );
});

test('不同种子通常产出不同底册', () => {
  const a = generatePopulation({ size: 600, seed: 'alpha' });
  const b = generatePopulation({ size: 600, seed: 'beta' });
  assert.notDeepEqual(
    a.records.map((r) => r.riskScore),
    b.records.map((r) => r.riskScore),
  );
});

test('风险层占比稳定在 20%/45%/35% 附近且三层覆盖全部记录', () => {
  const pop = generatePopulation({ size: 600, seed: 'share-check' });
  const counts = Object.fromEntries(RISK_LEVELS.map((l) => [l, 0]));
  for (const r of pop.records) counts[r.riskLevel] += 1;
  assert.equal(counts['高风险'], 120);
  assert.equal(counts['中风险'], 270);
  assert.equal(counts['低风险'], 210);
  assert.deepEqual(
    pop.strata.map((s) => s.stratum),
    RISK_LEVELS,
  );
});

test('每条记录都有工段、班次，且缺陷标记为布尔值', () => {
  const pop = generatePopulation({ size: 50, seed: 'fields' });
  for (const r of pop.records) {
  assert.ok(['冲压工段', '焊接工段', '涂装工段', '总装工段'].includes(r.section));
    assert.ok(['早班', '中班', '夜班'].includes(r.shift));
    assert.equal(typeof r.defective, 'boolean');
    assert.match(r.id, /^VC-\d{5}$/);
  }
});

test('高风险层真实缺陷率显著高于低风险层（虚构参数设计使然）', () => {
  const pop = generatePopulation({ size: 600, seed: 'rate-order' });
  const high = pop.strata.find((s) => s.stratum === '高风险');
  const low = pop.strata.find((s) => s.stratum === '低风险');
  assert.ok(high.trueDefectRate > low.trueDefectRate * 2);
  assert.ok(high.trueDefectRate > 0.08);
  assert.ok(low.trueDefectRate < 0.08);
});

test('全量真实缺陷率与逐条记录一致', () => {
  const pop = generatePopulation({ size: 300, seed: 'truth' });
  const expected = pop.records.filter((r) => r.defective).length / 300;
  assert.ok(Math.abs(pop.truth.overallDefectRate - expected) < 1e-6);
});

test('非法底册总量抛出异常', () => {
  assert.throws(() => generatePopulation({ size: 0 }), /正整数/);
  assert.throws(() => generatePopulation({ size: -5 }), /正整数/);
  assert.throws(() => generatePopulation({ size: 1.5 }), /正整数/);
});
