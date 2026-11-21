import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate } from '../src/estimation.js';

// 手工构造的三层底册与样本，数值可手工复核
const strata = [
  { stratum: '高风险', populationCount: 200 },
  { stratum: '中风险', populationCount: 300 },
  { stratum: '低风险', populationCount: 500 },
];
const mkSample = (id, riskLevel, n, inclusionProbability, defective) => ({
  id,
  riskLevel,
  inclusionProbability,
  defective,
});

function fullSamples() {
  // 高 n=10 缺陷 4；中 n=10 缺陷 3；低 n=10 缺陷 0
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(mkSample(`H${i}`, '高风险', 10, 0.05, i < 4));
    samples.push(mkSample(`M${i}`, '中风险', 10, 0.0333, i < 3));
    samples.push(mkSample(`L${i}`, '低风险', 10, 0.02, false));
  }
  return samples;
}

test('正常路径：分层加权点估计 = Σ Wₕpₕ = 0.17（手工值）', () => {
  const r = estimate({ strata, samples: fullSamples(), variant: 'full' });
  // 0.2*0.4 + 0.3*0.3 + 0.5*0 = 0.17
  assert.ok(Math.abs(r.pointEstimate - 0.17) < 1e-9);
  assert.equal(r.emptyStrata.length, 0);
  assert.equal(r.coverageGap, 0);
  assert.deepEqual(r.estimableStrata, ['高风险', '中风险', '低风险']);
});

test('正常路径：方差与 95% 区间为手工计算值', () => {
  const r = estimate({ strata, samples: fullSamples(), variant: 'full' });
  // v_h = W_h² (1-f_h) p(1-p)/9
  const vH = 0.04 * 0.95 * 0.24 / 9;
  const vM = 0.09 * (1 - 0.0333) * 0.21 / 9;
  const variance = vH + vM;
  const se = Math.sqrt(variance);
  assert.ok(Math.abs(r.standardError - se) < 1e-5);
  assert.ok(Math.abs(r.interval95.lower - Math.max(0, 0.17 - 1.96 * se)) < 1e-5);
  assert.ok(Math.abs(r.interval95.upper - Math.min(1, 0.17 + 1.96 * se)) < 1e-5);
  assert.ok(r.interval95.lower < r.pointEstimate && r.interval95.upper > r.pointEstimate);
});

test('朴素池化比例与高风险外推值被同时给出并标注偏差风险', () => {
  const r = estimate({ strata, samples: fullSamples(), variant: 'full' });
  // 池化：7/30 ≈ 0.2333，明显高于加权点估计 0.17（输出保留 6 位小数）
  assert.ok(Math.abs(r.naivePooled.rate - 7 / 30) < 1e-6);
  assert.ok(Math.abs(r.highRiskExtrapolation.rate - 0.4) < 1e-6);
  assert.match(r.highRiskExtrapolation.warning, /禁止/);
  assert.ok(r.naivePooled.rate > r.pointEstimate);
});

test('层 Wilson 区间在 0 缺陷层仍为有限区间而非 NaN', () => {
  const r = estimate({ strata, samples: fullSamples(), variant: 'full' });
  const low = r.stratumRows.find((x) => x.stratum === '低风险');
  assert.equal(low.sampleRate, 0);
  assert.ok(low.wilson.lower === 0);
  assert.ok(low.wilson.upper > 0 && Number.isFinite(low.wilson.upper));
});

test('异常路径：存在空层时 full 变体必须报错而不是静默忽略', () => {
  const samples = fullSamples().filter((s) => s.riskLevel !== '低风险');
  assert.throws(
    () => estimate({ strata, samples, variant: 'full' }),
    /无可用样本的层.*低风险/,
  );
});

test('空层 renorm：仅在可估层重归一化，点估计=0.34 且报告覆盖缺口 0.5', () => {
  const samples = fullSamples().filter((s) => s.riskLevel !== '低风险');
  const r = estimate({ strata, samples, variant: 'renorm' });
  // (0.2*0.4 + 0.3*0.3) / 0.5 = 0.17/0.5 = 0.34
  assert.ok(Math.abs(r.pointEstimate - 0.34) < 1e-9);
  assert.ok(Math.abs(r.coverageGap - 0.5) < 1e-9);
  assert.deepEqual(r.emptyStrata, ['低风险']);
  assert.match(r.methodNote, /重归一化/);
});

test('空层 conservative：点估计只计可估层 0.17，区间上界至少被缺口抬到 0.67', () => {
  const samples = fullSamples().filter((s) => s.riskLevel !== '低风险');
  const r = estimate({ strata, samples, variant: 'conservative' });
  assert.ok(Math.abs(r.pointEstimate - 0.17) < 1e-9);
  // 空层占 0.5，取缺陷率 1 时上界至少 0.17 + 0.5 = 0.67
  assert.ok(r.interval95.upper >= 0.67 - 1e-9);
  assert.ok(r.interval95.width > 0.5);
  assert.match(r.methodNote, /\[0,1\]/);
});

test('高风险层置空（关键层无样本）：renorm 与 conservative 均可运行并标注', () => {
  const samples = fullSamples().filter((s) => s.riskLevel !== '高风险');
  const renorm = estimate({ strata, samples, variant: 'renorm' });
  assert.deepEqual(renorm.emptyStrata, ['高风险']);
  assert.ok(renorm.coverageGap > 0);
  const cons = estimate({ strata, samples, variant: 'conservative' });
  assert.ok(cons.interval95.upper >= 0.2 - 1e-9); // 缺口 0.2
});

test('退化情形：某层只有 1 个样本时不产生 NaN', () => {
  const samples = fullSamples().filter((s) => !['H1', 'M1', 'L1'].includes(s.id));
  // 每层剩 9 个；再把高层砍到 1 个
  const oneOnly = samples.filter((s) => s.riskLevel !== '高风险');
  oneOnly.push(mkSample('H0', '高风险', 1, 0.005, true));
  const r = estimate({ strata, samples: oneOnly, variant: 'full' });
  assert.ok(Number.isFinite(r.pointEstimate));
  assert.ok(Number.isFinite(r.standardError));
  const high = r.stratumRows.find((x) => x.stratum === '高风险');
  assert.equal(high.sampleCount, 1);
  assert.equal(high.sampleRate, 1);
});

test('异常：没有任何有效样本时拒绝估计', () => {
  assert.throws(
    () => estimate({ strata, samples: [], variant: 'full' }),
    /没有任何已质检/,
  );
});

test('异常：样本属于未知层时报错', () => {
  const bad = [mkSample('X1', '神秘层', 1, 0.1, true)];
  assert.throws(() => estimate({ strata, samples: bad }), /未知层/);
});

test('异常：未知估计变体', () => {
  assert.throws(
    () => estimate({ strata, samples: fullSamples(), variant: 'bayes' }),
    /未知估计变体/,
  );
});

test('排除依据被原样保留在估计结果中', () => {
  const exclusions = [
    { id: 'L0', riskLevel: '低风险', reason: '留样争议撤回复核', kind: 'withdrawn' },
  ];
  const r = estimate({
    strata,
    samples: fullSamples().filter((s) => s.id !== 'L0'),
    exclusions,
    variant: 'full',
  });
  assert.equal(r.exclusions.length, 1);
  assert.equal(r.exclusions[0].id, 'L0');
});

test('所有区间端点都被限制在 [0,1]', () => {
  const r = estimate({ strata, samples: fullSamples(), variant: 'full' });
  assert.ok(r.interval95.lower >= 0 && r.interval95.upper <= 1);
  for (const row of r.stratumRows) {
    assert.ok(row.wilson.lower >= 0 && row.wilson.upper <= 1);
  }
});
