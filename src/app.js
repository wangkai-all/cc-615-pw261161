// 应用编排：底册 -> 分层抽样 -> 质检 -> 异常情景 -> 估计。
// 内存态单会话演示；每一步都保留抽中概率、分配依据与排除依据。

import { generatePopulation } from './population.js';
import { drawSample, ALLOCATION_METHODS } from './sampling.js';
import { inspect } from './qc.js';
import { simulateIncident } from './simulation.js';
import { estimate, ESTIMATION_VARIANTS } from './estimation.js';

export function createAppState() {
  return {
    population: null,
    sampling: null,
    inspected: null,
    incident: null,
    lastEstimate: null,
  };
}

export function runSampling(state, input = {}) {
  const populationSeed = input.populationSeed || 'registry-2026w47';
  const sampleSeed = input.sampleSeed || 'sample-2026w47';
  const size = input.populationSize ?? 600;
  const sampleSize = input.sampleSize ?? 60;
  const method = input.method || 'proportional';

  if (!ALLOCATION_METHODS.includes(method)) {
    throw new Error(`未知分配方式: ${method}`);
  }

  // 重新生成底册并抽样，保证任何一次点击都从干净状态开始、结果可重复
  const population = generatePopulation({ size, seed: populationSeed });
  const sampling = drawSample(population, { sampleSize, method, seed: sampleSeed });
  const inspectedSamples = inspect(sampling.samples, population);

  state.population = population;
  state.sampling = { ...sampling, samples: inspectedSamples };
  state.inspected = { ...sampling, samples: inspectedSamples };
  state.incident = null;
  state.lastEstimate = null;

  return serializeSampling(state);
}

export function runIncident(state, input = {}) {
  if (!state.inspected) {
    throw new Error('请先生成分层抽样结果，再模拟异常情景');
  }
  const incidentSeed = input.incidentSeed || 'incident-2026w47';
  const incident = simulateIncident(state.inspected, {
    emptyStratum: input.emptyStratum ?? '低风险',
    withdrawCount: input.withdrawCount ?? 2,
    seed: incidentSeed,
  });
  state.incident = incident;
  state.lastEstimate = null;
  return serializeIncident(state);
}

export function runEstimate(state, input = {}) {
  if (!state.inspected) {
    throw new Error('请先生成分层抽样结果，再查看估计组成');
  }
  const variant = input.variant || 'full';
  if (!ESTIMATION_VARIANTS.includes(variant)) {
    throw new Error(`未知估计变体: ${variant}`);
  }

  const samples = state.incident ? state.incident.effectiveSamples : state.inspected.samples;
  const exclusions = state.incident ? state.incident.exclusions : [];

  const result = estimate({
    strata: state.population.strata,
    samples,
    exclusions,
    variant,
  });
  state.lastEstimate = result;
  return serializeEstimate(state, result);
}

export function getDebugState(state) {
  return {
    hasPopulation: !!state.population,
    populationSeed: state.population?.seed ?? null,
    samplingSeed: state.sampling?.seed ?? null,
    method: state.sampling?.method ?? null,
    drawnTotal: state.sampling?.totalDrawn ?? 0,
    incident: state.incident
      ? {
          emptyStratum: state.incident.emptyStratum,
          excludedTotal: state.incident.exclusions.length,
          effectiveTotal: state.incident.effectiveSamples.length,
        }
      : null,
    lastVariant: state.lastEstimate?.variant ?? null,
  };
}

function serializeSampling(state) {
  const { population, sampling } = state;
  return {
    population: {
      seed: population.seed,
      total: population.total,
      generatedAt: population.generatedAt,
      strata: population.strata,
    },
    sampling: {
      seed: sampling.seed,
      method: sampling.method,
      requestedSampleSize: sampling.requestedSampleSize,
      totalDrawn: sampling.totalDrawn,
      allocations: sampling.allocations,
      samples: sampling.samples.map((s) => ({
        id: s.id,
        section: s.section,
        shift: s.shift,
        riskLevel: s.riskLevel,
        inclusionProbability: s.inclusionProbability,
        defective: s.defective,
        inspectionResult: s.inspectionResult,
      })),
    },
    truth: population.truth,
  };
}

function serializeIncident(state) {
  const incident = state.incident;
  return {
    incident: {
      seed: incident.seed,
      emptyStratum: incident.emptyStratum,
      requestedWithdrawals: incident.requestedWithdrawals,
      summary: incident.summary,
      exclusions: incident.exclusions,
      effectiveSamples: incident.effectiveSamples.map((s) => ({
        id: s.id,
        riskLevel: s.riskLevel,
        inclusionProbability: s.inclusionProbability,
        defective: s.defective,
      })),
    },
  };
}

function serializeEstimate(state, result) {
  return {
    context: {
      hasIncident: !!state.incident,
      effectiveSampleCount: state.incident
        ? state.incident.effectiveSamples.length
        : state.inspected.samples.length,
      exclusions: state.incident ? state.incident.exclusions : [],
    },
    estimate: result,
    truth: state.population.truth,
  };
}
