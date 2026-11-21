import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePopulation } from '../src/population.js';
import { drawSample } from '../src/sampling.js';
import { inspect } from '../src/qc.js';
import { simulateIncident } from '../src/simulation.js';

const pop = generatePopulation({ size: 600, seed: 'registry-2026w47' });
const sampling = drawSample(pop, { sampleSize: 60, method: 'proportional', seed: 'sample-2026w47' });
const inspected = { ...sampling, samples: inspect(sampling.samples, pop) };

test('正常路径：整层置空后该层无有效样本且每个排除样本保留抽中概率', () => {
  const r = simulateIncident(inspected, {
    emptyStratum: '低风险',
    withdrawCount: 0,
    seed: 'inc-1',
  });
  assert.ok(r.effectiveSamples.every((s) => s.riskLevel !== '低风险'));
  const emptyExclusions = r.exclusions.filter((e) => e.kind === 'empty-stratum');
  const lowN = sampling.allocations.find((a) => a.stratum === '低风险').sampleCount;
  assert.equal(emptyExclusions.length, lowN);
  for (const e of emptyExclusions) {
    assert.equal(e.riskLevel, '低风险');
    assert.ok(e.inclusionProbability > 0);
    assert.match(e.reason, /标识损坏/);
  }
  assert.equal(r.summary.effectiveTotal, r.effectiveSamples.length);
});

test('正常路径：撤回复核从剩余样本中确定性挑选，排除依据可追溯', () => {
  const a = simulateIncident(inspected, {
    emptyStratum: '低风险',
    withdrawCount: 2,
    seed: 'inc-2',
  });
  const b = simulateIncident(inspected, {
    emptyStratum: '低风险',
    withdrawCount: 2,
    seed: 'inc-2',
  });
  assert.deepEqual(
    a.exclusions.map((e) => e.id),
    b.exclusions.map((e) => e.id),
  );
  const withdrawn = a.exclusions.filter((e) => e.kind === 'withdrawn');
  assert.equal(withdrawn.length, 2);
  for (const w of withdrawn) {
    assert.match(w.reason, /留样争议|校准失败/);
    assert.ok(w.inclusionProbability > 0);
  }
  assert.equal(
    a.summary.effectiveTotal + a.summary.excludedTotal,
    a.summary.drawnTotal,
  );
});

test('无异常参数时返回全量有效样本、零排除', () => {
  const r = simulateIncident(inspected, {
    emptyStratum: null,
    withdrawCount: 0,
    seed: 'inc-3',
  });
  assert.equal(r.effectiveSamples.length, inspected.samples.length);
  assert.equal(r.exclusions.length, 0);
});

test('异常：置空一个原本就没抽到样本的层时报错', () => {
  const tiny = drawSample(pop, { sampleSize: 2, method: 'proportional', seed: 'tiny-inc' });
  const tinyInspected = { ...tiny, samples: inspect(tiny.samples, pop) };
  // 2 个样本无法覆盖全部 3 层，必然存在 sampleCount=0 的层
  const empty = tiny.allocations.find((a) => a.sampleCount === 0);
  assert.ok(empty, '前置条件：小样本下至少一层无样本');
  assert.throws(
    () =>
      simulateIncident(tinyInspected, {
        emptyStratum: empty.stratum,
        withdrawCount: 0,
        seed: 'inc-4',
      }),
    /原本就没有抽中样本/,
  );
});

test('异常：撤回数量超过剩余有效样本', () => {
  assert.throws(
    () =>
      simulateIncident(inspected, {
        emptyStratum: null,
        withdrawCount: inspected.samples.length + 1,
        seed: 'inc-5',
      }),
    /不足以撤回/,
  );
});

test('异常：非法风险层与非法撤回数量', () => {
  assert.throws(
    () => simulateIncident(inspected, { emptyStratum: '外星层', seed: 'inc-6' }),
    /未知风险层/,
  );
  assert.throws(
    () => simulateIncident(inspected, { withdrawCount: -1, seed: 'inc-7' }),
    /非负整数/,
  );
});

test('异常：缺少情景种子', () => {
  assert.throws(
    () => simulateIncident(inspected, { emptyStratum: '低风险' }),
    /显式 seed/,
  );
});

test('质检判定与底册真相一致且可重复', () => {
  const byId = new Map(pop.records.map((r) => [r.id, r]));
  for (const s of inspected.samples) {
    assert.equal(s.defective, byId.get(s.id).defective);
    assert.equal(s.inspectionResult, s.defective ? '命中缺陷' : '合格');
  }
});
