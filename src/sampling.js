// 分层抽样：等比分配（proportional）与优化/Neyman 分配（optimal）。
// 每层独立做不放回简单随机抽样，记录每单位的抽中概率 π_h = n_h / N_h，
// 并保留层内抽样比、分配方式等全部分析端所需依据。

import { makeRng } from './rng.js';
import { RISK_CONFIG, RISK_LEVELS } from './population.js';

export const ALLOCATION_METHODS = ['proportional', 'optimal'];

/**
 * 计算各层样本量分配。
 * @param {Array<{stratum:string, populationCount:number}>} strata
 * @param {number} sampleSize 总样本量 n
 * @param {'proportional'|'optimal'} method
 */
export function allocate(strata, sampleSize, method = 'proportional') {
  if (!ALLOCATION_METHODS.includes(method)) {
    throw new Error(`未知分配方式: ${method}，仅支持 ${ALLOCATION_METHODS.join('/')}`);
  }
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) {
    throw new Error('总样本量必须是正整数');
  }
  const N = strata.reduce((sum, s) => sum + s.populationCount, 0);
  if (sampleSize > N) {
    throw new Error(`样本量 ${sampleSize} 超过底册总量 ${N}`);
  }

  const weights = strata.map((s) => {
    const Nh = s.populationCount;
    if (method === 'proportional') return Nh; // 等比：N_h
    // Neyman 优化分配：N_h × S_h，S_h 用规划阶段的历史标准差
    return Nh * RISK_CONFIG[s.stratum].sd;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);

  // 先按权重取整（受每层容量 n_h ≤ N_h 约束），再用最大余数法补齐差额
  let raw = strata.map((s, h) => {
    const exact = (weights[h] / weightSum) * sampleSize;
    return { h, exact, floor: Math.min(Math.floor(exact), s.populationCount) };
  });
  let remaining = sampleSize - raw.reduce((sum, x) => sum + x.floor, 0);

  // 容量被截断的层不再参与补额；按余数大小（平局按层定义顺序）确定补额优先级
  while (remaining > 0) {
    const candidates = raw
      .filter((x) => x.floor < strata[x.h].populationCount)
      .sort((a, b) => {
        const ra = a.exact - Math.floor(a.exact);
        const rb = b.exact - Math.floor(b.exact);
        if (rb !== ra) return rb - ra;
        return (
          RISK_LEVELS.indexOf(strata[a.h].stratum) -
          RISK_LEVELS.indexOf(strata[b.h].stratum)
        );
      });
    if (candidates.length === 0) break;
    candidates[0].floor += 1;
    remaining -= 1;
  }

  const allocations = strata.map((s, h) => ({
    stratum: s.stratum,
    populationCount: s.populationCount,
    allocatedSample: raw[h].floor,
    exactShare: Number((raw[h].exact / sampleSize).toFixed(6)),
    weight: Number((weights[h] / weightSum).toFixed(6)),
  }));
  const allocatedTotal = allocations.reduce((sum, a) => sum + a.allocatedSample, 0);
  if (allocatedTotal !== sampleSize) {
    throw new Error(`样本量分配失败：期望 ${sampleSize}，实际 ${allocatedTotal}`);
  }
  return allocations;
}

/**
 * 执行分层不放回随机抽样。
 * @param {object} population generatePopulation 的产出
 * @param {object} opts
 * @param {number} opts.sampleSize
 * @param {'proportional'|'optimal'} opts.method
 * @param {string|number} opts.seed 抽样种子（与底册种子独立，保证可重复）
 */
export function drawSample(population, { sampleSize, method = 'proportional', seed } = {}) {
  if (!seed && seed !== 0) throw new Error('抽样必须提供显式 seed 以保证可重复');
  const allocations = allocate(population.strata, sampleSize, method);

  const idsByStratum = new Map(RISK_LEVELS.map((l) => [l, []]));
  for (const r of population.records) idsByStratum.get(r.riskLevel).push(r.id);

  const samples = [];
  const stratumDetails = [];

  for (const alloc of allocations) {
    const level = alloc.stratum;
    const Nh = alloc.populationCount;
    const nh = alloc.allocatedSample;
    const rng = makeRng(`${seed}:${level}`);
    const picked = rng.shuffle(idsByStratum.get(level)).slice(0, nh);

    // 不放回 SRSWOR 下，层内每个单位抽中概率相同：π_h = n_h / N_h
    const inclusionProbability = Nh === 0 ? null : Number((nh / Nh).toFixed(6));

    for (const id of picked) {
      const record = population.records.find((r) => r.id === id);
      samples.push({
        id: record.id,
        section: record.section,
        shift: record.shift,
        riskLevel: level,
        inclusionProbability,
        samplingFraction: inclusionProbability,
        defective: null, // 等待质检端判定
      });
    }

    stratumDetails.push({
      stratum: level,
      populationCount: Nh,
      sampleCount: nh,
      inclusionProbability,
      allocationWeight: alloc.weight,
      exactShare: alloc.exactShare,
      sampled: nh > 0,
    });
  }

  return {
    seed: String(seed),
    method,
    requestedSampleSize: sampleSize,
    totalDrawn: samples.length,
    allocations: stratumDetails,
    samples,
  };
}
