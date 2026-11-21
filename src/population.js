// 虚构底册生成：工段 × 班次 × 产品记录，按风险评分分入 高/中/低 风险层。
// 全部为可重复生成的虚构记录，不对应任何真实产品。

import { makeRng } from './rng.js';

export const SECTIONS = ['冲压工段', '焊接工段', '涂装工段', '总装工段'];
export const SHIFTS = ['早班', '中班', '夜班'];

export const RISK_LEVELS = ['高风险', '中风险', '低风险'];

export const RISK_CONFIG = {
  高风险: { targetShare: 0.2, baseRate: 0.18, sd: 0.384 },
  中风险: { targetShare: 0.45, baseRate: 0.06, sd: 0.237 },
  低风险: { targetShare: 0.35, baseRate: 0.02, sd: 0.14 },
};

// 历史质控输入（虚构），用于计算风险评分
const HISTORICAL_RATE = {
  冲压工段: 0.08,
  焊接工段: 0.055,
  涂装工段: 0.04,
  总装工段: 0.03,
};
const SHIFT_PENALTY = { 早班: 0.0, 中班: 0.012, 夜班: 0.035 };

/**
 * 生成一批虚构产品底册。
 * @param {object} opts
 * @param {number} opts.size 底册总数 N（默认 600）
 * @param {string|number} opts.seed 随机种子，相同种子产出完全相同的记录
 */
export function generatePopulation({ size = 600, seed = 'registry-2026w47' } = {}) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('底册总数 size 必须是正整数');
  }
  const rng = makeRng(seed);
  const records = [];

  for (let i = 0; i < size; i++) {
    const section = SECTIONS[rng.int(SECTIONS.length)];
    const shift = SHIFTS[rng.int(SHIFTS.length)];
    const serial = `VC-${String(i + 1).padStart(5, '0')}`;

    // 风险评分 = 工段历史不良率 + 班次修正 + 设备抖动；评分越高风险越大
    const equipmentNoise = rng.next() * 0.05;
    const riskScore = HISTORICAL_RATE[section] + SHIFT_PENALTY[shift] + equipmentNoise;

    // 潜在缺陷倾向（质检判定时使用），层基线率 + 记录级抖动
    const latentNoise = rng.next() * 0.04 - 0.02;

    records.push({
      id: serial,
      section,
      shift,
      riskScore: Number(riskScore.toFixed(4)),
      latentNoise: Number(latentNoise.toFixed(4)),
      riskLevel: null, // 下面按评分分位统一赋值
      defective: null, // 抽样质检前未知
    });
  }

  // 按风险评分排序后用固定分位切层，保证每层占比稳定（高 20% / 中 45% / 低 35%）
  const order = records
    .map((r, idx) => ({ idx, score: r.riskScore }))
    .sort((a, b) => b.score - a.score);
  const highCut = Math.round(size * RISK_CONFIG['高风险'].targetShare);
  const midCut = highCut + Math.round(size * RISK_CONFIG['中风险'].targetShare);
  order.forEach((entry, rank) => {
    const level = rank < highCut ? '高风险' : rank < midCut ? '中风险' : '低风险';
    records[entry.idx].riskLevel = level;
  });

  // 真实缺陷标记：底册里“隐藏的真相”，质检端只对抽中样本判定后才可见
  for (const r of records) {
    const p = RISK_CONFIG[r.riskLevel].baseRate + r.latentNoise;
    const clamped = Math.min(0.95, Math.max(0.001, p));
    r.defective = rng.next() < clamped;
  }

  const strata = buildStrataSummary(records);
  return {
    seed: String(seed),
    generatedAt: new Date('2026-11-21T08:00:00Z').toISOString(),
    total: size,
    records,
    strata,
    truth: {
      overallDefectRate: Number(
        (records.filter((r) => r.defective).length / size).toFixed(6),
      ),
      note: '全量真实缺陷率仅用于演示对照，分析端在真实场景中无法获知',
    },
  };
}

export function buildStrataSummary(records) {
  const map = new Map();
  for (const level of RISK_LEVELS) {
    map.set(level, { stratum: level, populationCount: 0, defectCount: 0 });
  }
  for (const r of records) {
    const s = map.get(r.riskLevel);
    s.populationCount += 1;
    if (r.defective) s.defectCount += 1;
  }
  return RISK_LEVELS.map((level) => {
    const s = map.get(level);
    return {
      ...s,
      populationShare: Number((s.populationCount / records.length).toFixed(6)),
      trueDefectRate:
        s.populationCount === 0
          ? null
          : Number((s.defectCount / s.populationCount).toFixed(6)),
    };
  });
}
