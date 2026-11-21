import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, pathname, body) {
  const resp = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

test('GET / 返回 HTML 页面且包含业务结果区与三个按钮', async () => {
  const resp = await fetch(`${base}/`);
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type'), /text\/html/);
  const html = await resp.text();
  assert.match(html, /data-evidence-result/);
  assert.match(html, /生成分层抽样结果/);
  assert.match(html, /模拟空层和撤回复核/);
  assert.match(html, /查看估计组成/);
});

test('GET /public/app.js 与 styles.css 可访问', async () => {
  const js = await fetch(`${base}/public/app.js`);
  assert.equal(js.status, 200);
  const css = await fetch(`${base}/public/styles.css`);
  assert.equal(css.status, 200);
});

test('完整正常流程：抽样 -> 异常情景 -> 三种估计变体', async () => {
  const sample = await call('POST', '/api/sample', {
    method: 'proportional',
    sampleSize: 60,
    populationSize: 600,
  });
  assert.equal(sample.status, 200);
  assert.equal(sample.data.sampling.totalDrawn, 60);
  assert.ok(sample.data.sampling.samples.every((s) => s.inclusionProbability > 0));
  assert.equal(sample.data.population.strata.length, 3);

  const incident = await call('POST', '/api/incident', {
    emptyStratum: '低风险',
    withdrawCount: 2,
  });
  assert.equal(incident.status, 200);
  assert.ok(incident.data.incident.summary.excludedTotal > 2);
  assert.equal(incident.data.incident.emptyStratum, '低风险');
  assert.ok(incident.data.incident.exclusions.every((e) => e.reason.length > 0));

  const full = await call('POST', '/api/estimate', { variant: 'full' });
  assert.equal(full.status, 400);
  assert.match(full.data.error, /无可用样本的层/);

  const renorm = await call('POST', '/api/estimate', { variant: 'renorm' });
  assert.equal(renorm.status, 200);
  assert.ok(renorm.data.estimate.coverageGap > 0);
  assert.deepEqual(renorm.data.estimate.emptyStrata, ['低风险']);

  const cons = await call('POST', '/api/estimate', { variant: 'conservative' });
  assert.equal(cons.status, 200);
  assert.ok(cons.data.estimate.interval95.width > renorm.data.estimate.interval95.width);
});

test('优化分配同样可跑通完整流程', async () => {
  const sample = await call('POST', '/api/sample', {
    method: 'optimal',
    sampleSize: 90,
  });
  assert.equal(sample.status, 200);
  assert.equal(sample.data.sampling.method, 'optimal');
  const est = await call('POST', '/api/estimate', { variant: 'full' });
  assert.equal(est.status, 200);
  assert.equal(est.data.estimate.emptyStrata.length, 0);
  assert.ok(est.data.estimate.interval95.lower <= est.data.estimate.pointEstimate);
});

test('重复抽样结果完全一致（可重复性端到端验证）', async () => {
  const a = await call('POST', '/api/sample', { sampleSize: 60, method: 'proportional' });
  const b = await call('POST', '/api/sample', { sampleSize: 60, method: 'proportional' });
  assert.deepEqual(
    a.data.sampling.samples.map((s) => s.id),
    b.data.sampling.samples.map((s) => s.id),
  );
  assert.equal(a.data.population.seed, b.data.population.seed);
});

test('异常：未抽样先模拟情景 / 先估计均被拒绝', async () => {
  const fresh = createServer();
  await new Promise((r) => fresh.listen(0, '127.0.0.1', r));
  const port = fresh.address().port;
  try {
    const inc = await fetch(`http://127.0.0.1:${port}/api/incident`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(inc.status, 400);
    const incBody = await inc.json();
    assert.match(incBody.error, /请先生成/);

    const est = await fetch(`http://127.0.0.1:${port}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(est.status, 400);
  } finally {
    await new Promise((r) => fresh.close(r));
  }
});

test('异常：样本量超量、非法分配方式、非法变体返回 400', async () => {
  const tooBig = await call('POST', '/api/sample', { sampleSize: 9999 });
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.data.error, /超过底册总量/);

  const badMethod = await call('POST', '/api/sample', { method: 'snowball' });
  assert.equal(badMethod.status, 400);
  assert.match(badMethod.data.error, /未知分配方式/);

  await call('POST', '/api/sample', { sampleSize: 30 });
  const badVariant = await call('POST', '/api/estimate', { variant: 'magic' });
  assert.equal(badVariant.status, 400);
  assert.match(badVariant.data.error, /未知估计变体/);
});

test('异常：非法 JSON 与未知路径', async () => {
  const badJson = await fetch(`${base}/api/sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  assert.equal(badJson.status, 400);
  const body = await badJson.json();
  assert.match(body.error, /合法 JSON/);

  const notFound = await call('GET', '/api/nope');
  assert.equal(notFound.status, 404);
});

test('GET /api/state 返回当前会话调试状态', async () => {
  const r = await call('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(typeof r.data.hasPopulation, 'boolean');
});
