import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePopulation } from '../src/population.js';
import { drawSample, allocate } from '../src/sampling.js';

const pop = generatePopulation({ size: 600, seed: 'registry-2026w47' });

test('等比分配：各层 nₕ/Nₕ 抽样比一致且总量守恒', () => {
  const alloc = allocate(pop.strata, 60, 'proportional');
  const total = alloc.reduce((s, a) => s + a.allocatedSample, 0);
  assert.equal(total, 60);
  const fractions = alloc.map((a) => a.allocatedSample / a.populationCount);
  for (const f of fractions) {
    assert.ok(Math.abs(f - 0.1) < 0.012); // 取整误差范围内抽样比相同
  }
});

test('优化分配：高风险层（Sₕ 更大）获得比等比更多的样本', () => {
  const prop = allocate(pop.strata, 60, 'proportional');
  const opt = allocate(pop.strata, 60, 'optimal');
  const highProp = prop.find((a) => a.stratum === '高风险').allocatedSample;
  const highOpt = opt.find((a) => a.stratum === '高风险').allocatedSample;
  assert.ok(highOpt > highProp);
  assert.equal(
    opt.reduce((s, a) => s + a.allocatedSample, 0),
    60,
  );
});

test('抽中概率 πₕ = nₕ/Nₕ 被写入每个样本', () => {
  const result = drawSample(pop, { sampleSize: 60, method: 'proportional', seed: 'k1' });
  for (const s of result.samples) {
    const meta = result.allocations.find((a) => a.stratum === s.riskLevel);
    assert.equal(s.inclusionProbability, meta.inclusionProbability);
    assert.ok(
      Math.abs(s.inclusionProbability - meta.sampleCount / meta.populationCount) < 1e-9,
    );
    assert.ok(s.inclusionProbability > 0 && s.inclusionProbability <= 1);
  }
});

test('相同抽样种子产出完全相同的样本集合', () => {
  const a = drawSample(pop, { sampleSize: 60, method: 'optimal', seed: 'rep-1' });
  const b = drawSample(pop, { sampleSize: 60, method: 'optimal', seed: 'rep-1' });
  assert.deepEqual(
    a.samples.map((s) => s.id),
    b.samples.map((s) => s.id),
  );
});

test('不同抽样种子通常抽到不同样本', () => {
  const a = drawSample(pop, { sampleSize: 60, method: 'proportional', seed: 'x' });
  const b = drawSample(pop, { sampleSize: 60, method: 'proportional', seed: 'y' });
  assert.notDeepEqual(
    a.samples.map((s) => s.id),
    b.samples.map((s) => s.id),
  );
});

test('不放回抽样：同一层内无重复单位', () => {
  const result = drawSample(pop, { sampleSize: 100, method: 'optimal', seed: 'dup' });
  const ids = result.samples.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(result.totalDrawn, 100);
});

test('样本量等于底册总量时整库抽中，πₕ = 1', () => {
  const result = drawSample(pop, { sampleSize: 600, method: 'proportional', seed: 'census' });
  assert.equal(result.totalDrawn, 600);
  for (const a of result.allocations) {
    assert.equal(a.sampleCount, a.populationCount);
    assert.equal(a.inclusionProbability, 1);
  }
});

test('小样本量下每层最多 1 个样本且不报错', () => {
  const result = drawSample(pop, { sampleSize: 3, method: 'proportional', seed: 'tiny' });
  assert.equal(result.totalDrawn, 3);
  for (const a of result.allocations) {
    assert.ok(a.sampleCount <= 1);
  }
});

test('异常：未知分配方式', () => {
  assert.throws(
    () => allocate(pop.strata, 10, 'cluster'),
    /未知分配方式/,
  );
});

test('异常：样本量超过底册总量', () => {
  assert.throws(
    () => drawSample(pop, { sampleSize: 601, method: 'proportional', seed: 'z' }),
    /超过底册总量/,
  );
});

test('异常：样本量非正整数', () => {
  assert.throws(() => allocate(pop.strata, 0), /正整数/);
  assert.throws(() => allocate(pop.strata, -1), /正整数/);
});

test('异常：缺少抽样种子', () => {
  assert.throws(
    () => drawSample(pop, { sampleSize: 10, method: 'proportional' }),
    /显式 seed/,
  );
});
