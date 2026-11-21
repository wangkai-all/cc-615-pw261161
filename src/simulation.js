// 异常情景模拟：
//  - 空层：某风险层全部样本“标识损坏无法判定”，该层没有任何可用样本；
//  - 撤回复核：指定样本被质检端撤回（留样争议/设备校准失败），从有效样本排除，
//    但保留记录与排除依据，分析端仍可追溯每个单位的抽中概率。

import { makeRng } from './rng.js';
import { RISK_LEVELS } from './population.js';

const EMPTY_REASON = '样本标识损坏，质检端无法判定，整层无有效样本';
export const WITHDRAW_REASONS = ['留样争议撤回复核', '检测设备校准失败，结果撤回'];

/**
 * 在一次已完成质检的抽样结果上施加异常情景。
 * @param {object} inspected drawSample + inspect 后的对象
 * @param {object} opts
 * @param {string} opts.emptyStratum 需要置空的层（可选）
 * @param {number} opts.withdrawCount 撤回复核的样本数（默认 0）
 * @param {string|number} opts.seed 情景随机种子
 */
export function simulateIncident(inspected, { emptyStratum = null, withdrawCount = 0, seed } = {}) {
  if (emptyStratum !== null && !RISK_LEVELS.includes(emptyStratum)) {
    throw new Error(`未知风险层: ${emptyStratum}`);
  }
  if (!Number.isInteger(withdrawCount) || withdrawCount < 0) {
    throw new Error('撤回复核样本数必须是非负整数');
  }
  if (!seed && seed !== 0) throw new Error('情景模拟必须提供显式 seed');

  const exclusions = [];
  let working = inspected.samples.map((s) => ({ ...s }));

  // 1) 整层置空
  if (emptyStratum) {
    const removed = working.filter((s) => s.riskLevel === emptyStratum);
    if (removed.length === 0) {
      throw new Error(`层 [${emptyStratum}] 原本就没有抽中样本，无法模拟整层置空`);
    }
    for (const s of removed) {
      exclusions.push({
        id: s.id,
        riskLevel: s.riskLevel,
        inclusionProbability: s.inclusionProbability,
        reason: EMPTY_REASON,
        kind: 'empty-stratum',
      });
    }
    working = working.filter((s) => s.riskLevel !== emptyStratum);
  }

  // 2) 撤回复核：在剩余样本里按确定性随机顺序挑选，优先从高风险层选
  const rng = makeRng(`${seed}:withdraw`);
  const priority = RISK_LEVELS.slice();
  const ordered = working
    .slice()
    .sort((a, b) => {
      const diff = priority.indexOf(a.riskLevel) - priority.indexOf(b.riskLevel);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  const shuffled = rng.shuffle(ordered);
  const toWithdraw = shuffled.slice(0, withdrawCount);
  if (toWithdraw.length < withdrawCount) {
    throw new Error(
      `剩余有效样本 ${working.length} 个，不足以撤回 ${withdrawCount} 个`,
    );
  }
  const withdrawIds = new Set(toWithdraw.map((s) => s.id));
  for (const s of working.filter((x) => withdrawIds.has(x.id))) {
    exclusions.push({
      id: s.id,
      riskLevel: s.riskLevel,
      inclusionProbability: s.inclusionProbability,
      reason: WITHDRAW_REASONS[rng.int(WITHDRAW_REASONS.length)],
      kind: 'withdrawn',
    });
  }
  const effectiveSamples = working.filter((s) => !withdrawIds.has(s.id));

  return {
    seed: String(seed),
    emptyStratum,
    requestedWithdrawals: withdrawCount,
    effectiveSamples,
    exclusions,
    summary: {
      drawnTotal: inspected.samples.length,
      excludedTotal: exclusions.length,
      effectiveTotal: effectiveSamples.length,
      emptyReason: EMPTY_REASON,
    },
  };
}
