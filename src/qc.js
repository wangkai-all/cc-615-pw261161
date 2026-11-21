// 质检端：对抽中样本逐一判定“是否命中缺陷”。
// 判定读取底册中隐藏的真实缺陷标记（虚构），并记录判定依据，过程确定可重复。

/**
 * @param {Array} samples drawSample 产出的样本数组（defective 为 null）
 * @param {object} population 底册
 */
export function inspect(samples, population) {
  const byId = new Map(population.records.map((r) => [r.id, r]));
  return samples.map((s) => {
    const record = byId.get(s.id);
    if (!record) throw new Error(`样本 ${s.id} 在底册中不存在`);
    return {
      ...s,
      defective: record.defective,
      inspectionResult: record.defective ? '命中缺陷' : '合格',
      inspectedAt: new Date('2026-11-21T09:30:00Z').toISOString(),
    };
  });
}
