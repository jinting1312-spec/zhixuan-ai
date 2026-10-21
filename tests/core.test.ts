import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDITIONS, REPORT, conflicts, type StockData, type Source } from '../lib/contracts';
import { calculateVolatility, evaluate, numeric } from '../lib/engine';
import { createLimiter, requestFuyao } from '../lib/fuyao';
import { decodeModel } from '../lib/llm';

// Synthetic fixtures are confined to tests; product data always comes from Fuyao.
const now = Date.UTC(2026, 9, 21);
const src: Source = { provider: '扶摇', endpoint: '/test-only', field: 'test-only', params: {}, timestamp: now, fetchedAt: now };
const rows = Array.from({ length: 21 }, (_, i) => ({ date_ms: now - (21 - i) * 86400000, close_price: 100 * 1.01 ** Math.ceil(i / 2) * .99 ** Math.floor(i / 2) }));
function stock(): StockData {
  return { thscode: '000001.SZ', ticker: '000001', name: '测试专用',
    growth: { value: 5, raw: '5', source: { ...src, report: REPORT } },
    pe: { value: 20, raw: 20, source: src },
    volatility: { ...calculateVolatility(rows, now), raw: null, source: src },
  };
}
test('正常筛选：三项全部满足，百分数5按5%处理', () => {
  const result = evaluate(stock(), DEFAULT_CONDITIONS);
  assert.equal(result.status, 'selected');
  assert.ok(result.checks.every(check => check.passed === true));
});
test('严格阈值与负PE：边界相等不能通过', () => {
  for (const value of [-1, 0, 30]) {
    const s = stock(); s.pe.value = value;
    assert.equal(evaluate(s, DEFAULT_CONDITIONS).status, 'excluded');
  }
  const s = stock(); s.growth.value = 0;
  assert.equal(evaluate(s, DEFAULT_CONDITIONS).checks[0].passed, false);
  s.growth.value = 5; s.volatility.value = 3;
  assert.equal(evaluate(s, DEFAULT_CONDITIONS).checks[2].passed, false);
});
test('PE上下限冲突、负波动率、负PE下限及非数值均被拒绝', () => {
  for (const change of [{ peMin: 30 }, { peMin: 31 }, { volatilityMax: -1 }, { volatilityMax: 0 }, { peMin: -1 }, { peMax: NaN }]) {
    const c = { ...DEFAULT_CONDITIONS, ...change };
    assert.ok(conflicts(c).length);
    assert.throws(() => evaluate(stock(), c));
  }
});
test('财务缺失为数据不足，即使其他条件不满足也不冒充完整排除结论', () => {
  const s = stock(); s.growth.value = null; s.pe.value = 100;
  const result = evaluate(s, DEFAULT_CONDITIONS);
  assert.equal(result.status, 'insufficient');
  assert.equal(result.checks[0].passed, null);
  assert.equal(result.checks[1].passed, false);
});
test('来源时间戳或报告期不完整为数据不足', () => {
  const s = stock(); s.pe.source = { ...src, timestamp: undefined };
  assert.equal(evaluate(s, DEFAULT_CONDITIONS).status, 'insufficient');
  s.pe.source = src; s.growth.source.report = '2024-4';
  assert.equal(evaluate(s, DEFAULT_CONDITIONS).status, 'insufficient');
});
test('K线排序与总体标准差：20个交替±1%收益率得到1%', () => {
  const result = calculateVolatility([...rows].reverse(), now);
  assert.equal(result.sampleCount, 20);
  assert.ok(Math.abs(result.value! - 1) < 1e-10);
  assert.deepEqual(result.prices, rows);
});
test('K线不足：20个价格不能产生20个收益率', () => {
  const result = calculateVolatility(rows.slice(1), now);
  assert.equal(result.value, null);
  assert.match(result.error!, /至少需要 21/);
});
test('缺失值、零/负价格、坏日期及未来日期不跨越计算', () => {
  for (const replacement of [{ close_price: 0 }, { close_price: -1 }, { close_price: null }, { date_ms: null }, { date_ms: now + 86400000 }]) {
    const changed = rows.map((r, i) => i === 10 ? { ...r, ...replacement } : r);
    assert.equal(calculateVolatility(changed, now).value, null);
  }
});
test('相同日相同价格去重，冲突重复日拒绝', () => {
  assert.equal(calculateVolatility([...rows, rows[0]], now).sampleCount, 20);
  assert.equal(calculateVolatility([...rows, { ...rows[0], close_price: 999 }], now).value, null);
  assert.equal(calculateVolatility([...rows.slice(1), rows[1]], now).value, null);
});
test('数字字符串严格转换，空值不等于0', () => {
  for (const v of [null, undefined, '', ' ', false, '5%', Infinity, 'NaN']) assert.equal(numeric(v), null);
  assert.equal(numeric('-4.53225500'), -4.532255);
  assert.equal(numeric('0'), 0);
});
test('API失败：HTTP失败、业务code失败及非法JSON均明确报错', async () => {
  const old = process.env.FUYAO_API_KEY;
  process.env.FUYAO_API_KEY = 'unit-test-placeholder';
  try {
    for (const response of [new Response('{}', { status: 503 }), Response.json({ code: 1, data: {} }), new Response('invalid json')]) {
      await assert.rejects(requestFuyao('/test', {}, (async () => response) as typeof fetch));
    }
    const okay = await requestFuyao('/test', {}, (async () => Response.json({ code: 0, data: { item: [] } })) as typeof fetch);
    assert.deepEqual(okay.data, { item: [] });
  } finally { if (old === undefined) delete process.env.FUYAO_API_KEY; else process.env.FUYAO_API_KEY = old; }
});
test('并发请求上限3，任务失败仍释放队列', async () => {
  const limit = createLimiter(3); let active = 0; let maximum = 0;
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => limit(async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (i === 1) throw new Error('test failure');
    return i;
  })));
  assert.equal(maximum, 3);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 9);
});
const candidateOutput = () => ({ conditions: { growthMin: { value: null as number | null, evidence: null as string | null }, peMin: { value: null as number | null, evidence: null as string | null }, peMax: { value: null as number | null, evidence: null as string | null }, volatilityMax: { value: null as number | null, evidence: null as string | null } }, unsupported: [] });
test('LLM非法JSON与任意代码/查询字段被拒绝', () => {
  assert.throws(() => decodeModel('not JSON', '低估值'));
  assert.throws(() => decodeModel('```json\n{}\n```', '低估值'));
  assert.throws(() => decodeModel(JSON.stringify({ ...candidateOutput(), code: 'eval()' }), '低估值'));
});
test('模糊意图的模型建议不会冒充用户明确阈值', () => {
  const output = candidateOutput(); output.conditions.peMax = { value: 15, evidence: '低估值' };
  const result = decodeModel(JSON.stringify(output), '低估值');
  assert.deepEqual(result.conditions, DEFAULT_CONDITIONS);
  assert.equal(result.assumptions.length, 4);
  assert.equal(result.explicit.length, 0);
});
test('明确数值按原文提取，冲突保留用于人工修改', () => {
  const output = candidateOutput(); output.conditions.peMin = { value: 40, evidence: 'PE大于40' }; output.conditions.peMax = { value: 20, evidence: '小于20' };
  const result = decodeModel(JSON.stringify(output), 'PE大于40且小于20');
  assert.equal(result.conditions.peMin, 40);
  assert.equal(result.explicit.length, 2);
  assert.ok(result.conflicts.length);
});
