// 估计端：分层比率估计 + 不确定范围。
//
// 关键纪律（题目要求）：
//  1. 必须保留每个单位的抽中概率 π_h 与样本排除依据，不允许直接拿
//     “高风险样本缺陷比例”推全厂（本模块同时给出朴素池化比例作对照并标注偏差）。
//  2. 某层没有可用样本（空层/整层撤回复核）时，该层不可估计：
//     - renorm：仅在可估层上重归一化权重做点估计，并显式标注覆盖缺口；
//     - conservative：缺口层按 [0,1] 区间并入，给出保守不确定范围。
//  3. 区间使用 Wilson score interval（层内）与正态近似（总体均值），
//     单层 n=1 等退化情形不会产生 NaN。

export const ESTIMATION_VARIANTS = ['full', 'renorm', 'conservative'];

function wilsonInterval(defects, n, z = 1.96) {
  if (n <= 0) return { lower: null, upper: null, width: null };
  const phat = defects / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / denom;
  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);
  return {
    lower: Number(lower.toFixed(6)),
    upper: Number(upper.toFixed(6)),
    width: Number((upper - lower).toFixed(6)),
  };
}

/**
 * 分层估计总体缺陷率。
 * @param {object} args
 * @param {Array} args.strata 每层 { stratum, populationCount }
 * @param {Array} args.samples 已质检样本，含 riskLevel/inclusionProbability/defective
 * @param {Array} [args.exclusions] 被排除样本 [{ id, riskLevel, reason }]
 * @param {'full'|'renorm'|'conservative'} [args.variant]
 */
export function estimate({ strata, samples, exclusions = [], variant = 'full' }) {
  if (!ESTIMATION_VARIANTS.includes(variant)) {
    throw new Error(`未知估计变体: ${variant}`);
  }
  const totalN = strata.reduce((s, x) => s + x.populationCount, 0);
  if (totalN <= 0) throw new Error('底册总量为 0，无法估计');

  const eligible = samples.filter((s) => s.defective !== null);
  if (eligible.length === 0) {
    throw new Error('没有任何已质检且有效的样本，无法给出估计');
  }

  const byStratum = new Map(strata.map((s) => [s.stratum, []]));
  for (const s of eligible) {
    if (!byStratum.has(s.riskLevel)) {
      throw new Error(`样本 ${s.id} 属于未知层: ${s.riskLevel}`);
    }
    byStratum.get(s.riskLevel).push(s);
  }

  const rows = [];
  const estimableLevels = [];
  let weightedMean = 0;
  let variance = 0;
  let estimableWeight = 0;

  for (const meta of strata) {
    const level = meta.stratum;
    const Nh = meta.populationCount;
    const Wh = Nh / totalN;
    const group = byStratum.get(level) || [];
    const nh = group.length;
    const defects = group.filter((x) => x.defective).length;
    const ph = nh > 0 ? defects / nh : null;
    const inclusionProbability =
      nh > 0 ? group[0].inclusionProbability : null;

    const row = {
      stratum: level,
      populationCount: Nh,
      weight: Number(Wh.toFixed(6)),
      sampleCount: nh,
      defectCount: defects,
      sampleRate: nh > 0 ? Number(ph.toFixed(6)) : null,
      inclusionProbability,
      estimable: nh > 0,
      wilson: wilsonInterval(defects, nh),
    };
    rows.push(row);

    if (nh > 0) {
      estimableLevels.push(level);
      estimableWeight += Wh;
      weightedMean += Wh * ph;
      // 分层均值方差：Σ W_h² · (1-f_h) · p_h(1-p_h)/(n_h-1)，n_h=1 时方差记 0
      const fh = group[0].inclusionProbability;
      const inner =
        nh > 1 ? (ph * (1 - ph)) / (nh - 1) : 0;
      variance += Wh * Wh * (1 - fh) * inner;
    }
  }

  const emptyStrata = rows.filter((r) => !r.estimable).map((r) => r.stratum);

  // ---- 朴素池化比例：把所有样本当简单随机样本，忽略分层与抽中概率 ----
  const pooledDefects = eligible.filter((s) => s.defective).length;
  const pooledN = eligible.length;
  const naivePooledRate = pooledDefects / pooledN;
  const naiveWilson = wilsonInterval(pooledDefects, pooledN);

  // ---- 高风险样本比例直接外推（题目明确禁止的做法，仅作偏差对照）----
  const highGroup = byStratum.get('高风险') || [];
  const highDefects = highGroup.filter((x) => x.defective).length;
  const highRiskExtrapolation =
    highGroup.length > 0
      ? {
          rate: Number((highDefects / highGroup.length).toFixed(6)),
          sampleCount: highGroup.length,
          warning:
            '高风险样本占比被过度抽样，直接外推全厂会系统性高估整体缺陷率，禁止作为总体估计',
        }
      : { rate: null, sampleCount: 0, warning: '高风险层无样本，无法计算该对照值' };

  let pointEstimate;
  let interval;
  let coverageGap = 0;
  let methodNote;

  if (variant === 'full') {
    if (emptyStrata.length > 0) {
      throw new Error(
        `存在无可用样本的层 [${emptyStrata.join('、')}]，full 变体要求每层可估；` +
          '请改用 renorm（重归一化）或 conservative（保守区间）',
      );
    }
    pointEstimate = weightedMean;
    const se = Math.sqrt(variance);
    interval = clampInterval(pointEstimate - 1.96 * se, pointEstimate + 1.96 * se);
    methodNote =
      '所有层均可估：分层加权点估计 Σ Wₕ pₕ，方差 Σ Wₕ²(1-fₕ)pₕ(1-pₕ)/(nₕ-1)，95% 正态近似区间';
  } else if (variant === 'renorm') {
    if (estimableWeight <= 0) throw new Error('没有可估计的层');
    pointEstimate = weightedMean / estimableWeight;
    // 重归一化后方差按可估层权重重缩放
    const rescaledVariance =
      variance / (estimableWeight * estimableWeight);
    const se = Math.sqrt(rescaledVariance);
    interval = clampInterval(pointEstimate - 1.96 * se, pointEstimate + 1.96 * se);
    coverageGap = 1 - estimableWeight;
    methodNote =
      `空层 [${emptyStrata.join('、') || '无'}] 被排除，仅在可估层上重归一化权重；` +
      `点估计只覆盖 ${(estimableWeight * 100).toFixed(1)}% 的总体，缺口 ${(coverageGap * 100).toFixed(1)}% 不具代表性，区间不含缺口不确定性`;
  } else {
    // conservative：可估层给点估计与方差，空层按 [0,1] 并入
    pointEstimate = weightedMean; // 空层 p 未知，区间层面处理
    const se = Math.sqrt(variance);
    const [estLow, estHigh] = [
      pointEstimate - 1.96 * se,
      pointEstimate + 1.96 * se,
    ];
    let lower = weightedMean; // 空层取 0 时的中心贡献
    let upper = weightedMean; // 空层取 1 时的中心贡献
    for (const meta of strata) {
      const Wh = meta.populationCount / totalN;
      if (rows.find((r) => r.stratum === meta.stratum).estimable) continue;
      lower += Wh * 0;
      upper += Wh * 1;
    }
    coverageGap = 1 - estimableWeight;
    interval = clampInterval(
      Math.min(estLow, lower),
      Math.max(estHigh, upper),
    );
    methodNote =
      `空层 [${emptyStrata.join('、') || '无'}] 按缺陷率 [0,1] 并入总体区间，` +
      `覆盖缺口 ${(coverageGap * 100).toFixed(1)}%；点估计仍只累加可估层，缺口在区间宽度中显式体现`;
  }

  return {
    variant,
    pointEstimate: Number(pointEstimate.toFixed(6)),
    interval95: interval,
    standardError:
      variant === 'renorm'
        ? Number(Math.sqrt(variance / (estimableWeight * estimableWeight)).toFixed(6))
        : Number(Math.sqrt(variance).toFixed(6)),
    coverageGap: Number(coverageGap.toFixed(6)),
    estimableStrata: estimableLevels,
    emptyStrata,
    stratumRows: rows,
    naivePooled: {
      rate: Number(naivePooledRate.toFixed(6)),
      sampleCount: pooledN,
      interval95: naiveWilson,
      note: '池化比例忽略分层权重与抽中概率，仅作对照，不是总体估计量',
    },
    highRiskExtrapolation,
    exclusions: exclusions.map((e) => ({ ...e })),
    methodNote,
  };
}

function clampInterval(low, high) {
  return {
    lower: Number(Math.max(0, low).toFixed(6)),
    upper: Number(Math.min(1, high).toFixed(6)),
    width: Number(Math.min(1, Math.max(0, high - low)).toFixed(6)),
  };
}
