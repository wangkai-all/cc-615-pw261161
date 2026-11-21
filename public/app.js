/* 前端交互：三个按钮分别调用真实后端功能，业务结果区同步更新 data-evidence-result。 */

const $ = (id) => document.getElementById(id);
const resultArea = $('resultArea');
const resultContent = $('resultContent');
const resultMarker = $('resultMarker');
const statusBanner = $('statusBanner');

function setEvidence(marker, bannerKind, bannerText) {
  resultArea.setAttribute('data-evidence-result', marker);
  resultMarker.textContent = marker;
  if (bannerText) {
    statusBanner.className = `banner ${bannerKind}`;
    statusBanner.textContent = bannerText;
  } else {
    statusBanner.className = 'banner hidden';
    statusBanner.textContent = '';
  }
}

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.error || `请求失败 (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

const riskTagClass = {
  高风险: 'tag tag-high',
  中风险: 'tag tag-mid',
  低风险: 'tag tag-low',
};

function pct(x, digits = 2) {
  if (x === null || x === undefined) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---------------- 按钮 1：生成分层抽样结果 ----------------
$('btnSample').addEventListener('click', async () => {
  const payload = {
    method: $('allocationMethod').value,
    sampleSize: Number($('sampleSize').value),
    populationSize: Number($('populationSize').value),
  };
  try {
    const data = await postJson('/api/sample', payload);
    renderSampling(data);
    setEvidence(
      `sampling:${data.sampling.method}:n=${data.sampling.totalDrawn}`,
      'ok',
      `已生成 ${data.sampling.totalDrawn} 个分层样本（种子 ${data.sampling.seed}），每个样本均记录抽中概率`,
    );
  } catch (err) {
    renderError(err);
  }
});

function renderSampling(data) {
  const { population, sampling, truth } = data;
  const allocRows = sampling.allocations
    .map(
      (a) => `
      <tr>
        <td><span class="${riskTagClass[a.stratum]}">${a.stratum}</span></td>
        <td>${a.populationCount}</td>
        <td>${a.sampleCount}</td>
        <td>${pct(a.inclusionProbability, 3)}</td>
        <td>${pct(a.allocationWeight, 2)}</td>
        <td>${a.sampled ? '是' : '否（本层未分配样本）'}</td>
      </tr>`,
    )
    .join('');

  const sampleRows = sampling.samples
    .map(
      (s) => `
      <tr>
        <td>${esc(s.id)}</td>
        <td>${esc(s.section)}</td>
        <td>${esc(s.shift)}</td>
        <td><span class="${riskTagClass[s.riskLevel]}">${s.riskLevel}</span></td>
        <td>${pct(s.inclusionProbability, 3)}</td>
        <td><span class="tag ${s.defective ? 'tag-defect' : 'tag-pass'}">${s.inspectionResult}</span></td>
      </tr>`,
    )
    .join('');

  resultContent.innerHTML = `
    <h3>底册与抽样参数</h3>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">底册总量 N</div><div class="value">${population.total}</div>
        <div class="sub">种子 ${esc(population.seed)}</div></div>
      <div class="kpi"><div class="label">抽中样本 n</div><div class="value">${sampling.totalDrawn}</div>
        <div class="sub">${sampling.method === 'proportional' ? '等比分配' : 'Neyman 优化分配'} · 种子 ${esc(sampling.seed)}</div></div>
      <div class="kpi"><div class="label">全量真实缺陷率（仅演示对照）</div><div class="value">${pct(truth.overallDefectRate)}</div>
        <div class="sub">真实场景分析端不可获知</div></div>
    </div>

    <h3>分层抽样与抽中概率 πₕ = nₕ / Nₕ</h3>
    <table>
      <thead><tr>
        <th>风险层</th><th>层容量 Nₕ</th><th>层样本 nₕ</th><th>抽中概率 πₕ</th><th>分配权重</th><th>是否有样本</th>
      </tr></thead>
      <tbody>${allocRows}</tbody>
    </table>

    <h3>质检端逐样本判定（含工段/班次/抽中概率）</h3>
    <div class="sample-scroll">
      <table>
        <thead><tr>
          <th>样本编号</th><th>工段</th><th>班次</th><th>风险层</th><th>抽中概率</th><th>质检结果</th>
        </tr></thead>
        <tbody>${sampleRows}</tbody>
      </table>
    </div>
  `;
}

// ---------------- 按钮 2：模拟空层和撤回复核 ----------------
$('btnIncident').addEventListener('click', async () => {
  const payload = {
    emptyStratum: $('emptyStratum').value,
    withdrawCount: Number($('withdrawCount').value),
  };
  try {
    const data = await postJson('/api/incident', payload);
    renderIncident(data);
    setEvidence(
      `incident:empty=${data.incident.emptyStratum}:excluded=${data.incident.summary.excludedTotal}`,
      'warn',
      `异常情景已施加：${data.incident.summary.emptyReason}，并撤回 ${data.incident.requestedWithdrawals} 个复核样本；全部排除依据已留存`,
    );
  } catch (err) {
    renderError(err);
  }
});

function renderIncident(data) {
  const { incident } = data;
  const exclusionRows = incident.exclusions
    .map(
      (e) => `
      <tr>
        <td>${esc(e.id)}</td>
        <td><span class="${riskTagClass[e.riskLevel]}">${e.riskLevel}</span></td>
        <td>${pct(e.inclusionProbability, 3)}</td>
        <td>${e.kind === 'empty-stratum' ? '整层置空' : '撤回复核'}</td>
        <td style="text-align:left">${esc(e.reason)}</td>
      </tr>`,
    )
    .join('');

  const effectiveRows = incident.effectiveSamples
    .map(
      (s) => `
      <tr>
        <td>${esc(s.id)}</td>
        <td><span class="${riskTagClass[s.riskLevel]}">${s.riskLevel}</span></td>
        <td>${pct(s.inclusionProbability, 3)}</td>
        <td><span class="tag ${s.defective ? 'tag-defect' : 'tag-pass'}">${s.defective ? '命中缺陷' : '合格'}</span></td>
      </tr>`,
    )
    .join('');

  resultContent.innerHTML = `
    <h3>异常情景汇总（种子 ${esc(incident.seed)}）</h3>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">原抽中样本</div><div class="value">${incident.summary.drawnTotal}</div></div>
      <div class="kpi"><div class="label">排除样本</div><div class="value">${incident.summary.excludedTotal}</div>
        <div class="sub">整层置空 + 撤回复核</div></div>
      <div class="kpi"><div class="label">有效样本</div><div class="value">${incident.summary.effectiveTotal}</div></div>
      <div class="kpi"><div class="label">置空层</div><div class="value">${esc(incident.emptyStratum)}</div>
        <div class="sub">该层无任何可判定样本</div></div>
    </div>

    <h3>样本排除依据（抽中概率仍保留，可追溯）</h3>
    <table>
      <thead><tr><th>样本编号</th><th>风险层</th><th>原抽中概率</th><th>排除类型</th><th>排除依据</th></tr></thead>
      <tbody>${exclusionRows}</tbody>
    </table>

    <h3>剩余有效样本（用于估计）</h3>
    <div class="sample-scroll">
      <table>
        <thead><tr><th>样本编号</th><th>风险层</th><th>抽中概率</th><th>质检结果</th></tr></thead>
        <tbody>${effectiveRows}</tbody>
      </table>
    </div>
  `;
}

// ---------------- 按钮 3：查看估计组成 ----------------
$('btnEstimate').addEventListener('click', async () => {
  const payload = { variant: $('estimateVariant').value };
  try {
    const data = await postJson('/api/estimate', payload);
    renderEstimate(data);
    const gap = data.estimate.coverageGap;
    setEvidence(
      `estimate:${data.estimate.variant}:point=${(data.estimate.pointEstimate * 100).toFixed(2)}%`,
      gap > 0 ? 'warn' : 'ok',
      `估计完成：点估计 ${pct(data.estimate.pointEstimate)}，95% 区间 [${pct(data.estimate.interval95.lower)}, ${pct(data.estimate.interval95.upper)}]` +
        (gap > 0 ? `；覆盖缺口 ${pct(gap)}` : ''),
    );
  } catch (err) {
    renderError(err);
  }
});

function renderEstimate(data) {
  const { estimate: est, truth, context } = data;
  const stratumRows = est.stratumRows
    .map(
      (r) => `
      <tr>
        <td><span class="${riskTagClass[r.stratum]}">${r.stratum}</span></td>
        <td>${r.populationCount}</td>
        <td>${pct(r.weight)}</td>
        <td>${r.sampleCount}</td>
        <td>${r.defectCount}</td>
        <td>${r.sampleRate === null ? '不可估' : pct(r.sampleRate)}</td>
        <td>${r.inclusionProbability === null ? '—' : pct(r.inclusionProbability, 3)}</td>
        <td>${r.wilson.lower === null ? '—' : `[${pct(r.wilson.lower)}, ${pct(r.wilson.upper)}]`}</td>
        <td>${r.estimable ? '可估' : '<strong>空层</strong>'}</td>
      </tr>`,
    )
    .join('');

  const exclusionRows = context.exclusions.length
    ? context.exclusions
        .map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.riskLevel)}</td><td style="text-align:left">${esc(e.reason)}</td></tr>`)
        .join('')
    : '<tr><td colspan="3" style="text-align:center">无排除样本</td></tr>';

  resultContent.innerHTML = `
    <h3>总体缺陷率估计（变体 ${esc(est.variant)}）</h3>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">分层加权点估计</div>
        <div class="value">${pct(est.pointEstimate)}</div>
        <div class="sub">标准误 ${pct(est.standardError, 3)}</div></div>
      <div class="kpi"><div class="label">95% 不确定范围</div>
        <div class="value">[${pct(est.interval95.lower)}, ${pct(est.interval95.upper)}]</div>
        <div class="sub">区间宽度 ${pct(est.interval95.width)}</div></div>
      <div class="kpi"><div class="label">覆盖缺口</div>
        <div class="value">${pct(est.coverageGap)}</div>
        <div class="sub">空层: ${est.emptyStrata.length ? esc(est.emptyStrata.join('、')) : '无'}</div></div>
      <div class="kpi"><div class="label">全量真实值（对照）</div>
        <div class="value">${pct(truth.overallDefectRate)}</div>
        <div class="sub">分析端真实场景不可见</div></div>
    </div>

    <div class="method-note">${esc(est.methodNote)}</div>

    <h3>估计组成：每层权重、样本率与抽中概率</h3>
    <table>
      <thead><tr>
        <th>风险层</th><th>Nₕ</th><th>权重 Wₕ</th><th>nₕ</th><th>缺陷数</th>
        <th>层样本率 pₕ</th><th>πₕ</th><th>层 95% Wilson 区间</th><th>状态</th>
      </tr></thead>
      <tbody>${stratumRows}</tbody>
    </table>

    <h3>偏差对照：为什么不能直接用高风险样本比例推全厂</h3>
    <div class="warning-box">
      <p style="margin:0 0 8px">
        <strong>高风险样本直接外推值 = ${est.highRiskExtrapolation.rate === null ? '—' : pct(est.highRiskExtrapolation.rate)}</strong>
        （基于 ${est.highRiskExtrapolation.sampleCount} 个高风险样本）。${esc(est.highRiskExtrapolation.warning)}
      </p>
      <p style="margin:0">
        朴素池化比例 = <strong>${pct(est.naivePooled.rate)}</strong>
        （Wilson 区间 [${pct(est.naivePooled.interval95.lower)}, ${pct(est.naivePooled.interval95.upper)}]）：${esc(est.naivePooled.note)}
      </p>
    </div>

    <h3>样本排除依据（估计输入审计）</h3>
    <table>
      <thead><tr><th>样本编号</th><th>风险层</th><th>排除依据</th></tr></thead>
      <tbody>${exclusionRows}</tbody>
    </table>
  `;
}

function renderError(err) {
  setEvidence(
    `error:${err.status || 'runtime'}`,
    'error',
    err.message,
  );
  resultContent.innerHTML = `
    <div class="warning-box">
      <strong>操作未完成：</strong>${esc(err.message)}
      <p style="margin:8px 0 0">请调整参数后重试；已有的抽样结果不会被失败操作覆盖。</p>
    </div>`;
}
