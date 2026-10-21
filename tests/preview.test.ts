import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDITIONS, type ScreenResult, type StockData, type Source } from '../lib/contracts';
import { evaluate } from '../lib/engine';
import { previewConditions } from '../lib/preview';

// Synthetic stored metrics for rule-preview tests, never used by the product.
const source: Source = { provider: '扶摇', endpoint: '/test-only', field: 'test-only', fetchedAt: 1792512000000, timestamp: 1792512000000, report: '2025-4', params: {} };
function data(code: string, growth: number | null, pe: number, volatility = 1): StockData {
  return {
    thscode: code, ticker: code.slice(0, 6), name: `测试${code}`,
    growth: { value: growth, raw: growth, source }, pe: { value: pe, raw: pe, source },
    volatility: { value: volatility, raw: null, source, sampleCount: 20,
      prices: Array.from({ length: 21 }, (_, i) => ({ date_ms: source.timestamp! - (21 - i) * 86400000, close_price: 100 })), returns: Array(20).fill(0) },
  };
}
function snapshot(stocks = [data('000001.SZ', 5, 20), data('000002.SZ', 15, 40), data('000003.SZ', null, 10)]): ScreenResult {
  return { conditions: { ...DEFAULT_CONDITIONS }, stocks: stocks.map(stock => evaluate(stock, DEFAULT_CONDITIONS)), scope: 'test-only', report: '2025-4', fetchedAt: source.fetchedAt, poolSource: source };
}
test('预览无快照或条件未变化时不生成结果', () => {
  assert.equal(previewConditions(null, DEFAULT_CONDITIONS), null);
  assert.equal(previewConditions(snapshot(), { ...DEFAULT_CONDITIONS }), null);
});
test('放宽阈值列出新增入选，数据不足不自动通过', () => {
  const result = previewConditions(snapshot(), { ...DEFAULT_CONDITIONS, peMax: 50 })!;
  assert.equal(result.beforeCount, 1); assert.equal(result.afterCount, 2); assert.equal(result.delta, 1);
  assert.deepEqual(result.added.map(s => [s.thscode, s.before, s.after]), [['000002.SZ', 'excluded', 'selected']]);
  assert.equal(result.removed.length, 0); assert.equal(result.insufficientCount, 1);
});
test('收紧阈值列出退出入选，沿用严格边界', () => {
  const result = previewConditions(snapshot(), { ...DEFAULT_CONDITIONS, growthMin: 5 })!;
  assert.equal(result.beforeCount, 1); assert.equal(result.afterCount, 0); assert.equal(result.delta, -1);
  assert.deepEqual(result.removed.map(s => [s.thscode, s.before, s.after]), [['000001.SZ', 'selected', 'excluded']]);
});
test('净数量不变也展示成员替换；无成员变化返回空名单', () => {
  const s = snapshot();
  const swapped = previewConditions(s, { ...DEFAULT_CONDITIONS, growthMin: 10, peMax: 50 })!;
  assert.equal(swapped.delta, 0); assert.equal(swapped.afterCount, 1);
  assert.equal(swapped.added[0].thscode, '000002.SZ'); assert.equal(swapped.removed[0].thscode, '000001.SZ');
  const same = previewConditions(s, { ...DEFAULT_CONDITIONS, peMax: 29 })!;
  assert.equal(same.delta, 0); assert.deepEqual(same.added, []); assert.deepEqual(same.removed, []);
});
test('冲突、空输入及非有限数值不保留有效数量预览', () => {
  for (const change of [{ peMin: 30 }, { volatilityMax: -1 }, { growthMin: NaN }, { peMax: Infinity }]) {
    assert.equal(previewConditions(snapshot(), { ...DEFAULT_CONDITIONS, ...change }), null);
  }
});
test('预览不修改快照、已执行条件、指标、来源或逐股解释', () => {
  const s = snapshot(); const before = structuredClone(s);
  function freeze(value: object) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); Object.freeze(value); }
  freeze(s);
  previewConditions(s, { ...DEFAULT_CONDITIONS, peMax: 50 });
  assert.deepEqual(s, before);
  assert.equal(previewConditions(s, DEFAULT_CONDITIONS), null);
});
test('使用已存波动率而非重算底层价格，无任何网络请求', () => {
  const s = snapshot([data('000001.SZ', 5, 20, 3.5)]);
  // Constant test prices would produce zero volatility if incorrectly recalculated.
  for (const p of s.stocks[0].volatility.prices) Object.defineProperty(p, 'close_price', { get() { throw new Error('Must not read underlying prices'); } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('Preview must not request data'); }) as typeof fetch;
  try {
    const result = previewConditions(s, { ...DEFAULT_CONDITIONS, peMax: 50 })!;
    assert.equal(result.afterCount, 0);
    const relaxed = previewConditions(s, { ...DEFAULT_CONDITIONS, volatilityMax: 4 })!;
    assert.equal(relaxed.afterCount, 1);
  } finally { globalThis.fetch = originalFetch; }
});
