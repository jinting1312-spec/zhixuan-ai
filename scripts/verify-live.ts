import assert from 'node:assert/strict';
import { DEFAULT_CONDITIONS } from '../lib/contracts';
import { screen } from '../lib/fuyao';
import { parseIntent } from '../lib/llm';

const started = Date.now();
try {
  const result = await screen(DEFAULT_CONDITIONS);
  assert.equal(result.stocks.length, 20);
  const counts = { selected: 0, excluded: 0, insufficient: 0 };
  const reasons = new Set<string>();
  for (const stock of result.stocks) {
    counts[stock.status]++;
    for (const c of stock.checks) if (c.passed === null) reasons.add(c.reason);
    if (stock.volatility.value !== null) {
      assert.equal(stock.volatility.prices.length, 21);
      assert.equal(stock.volatility.returns.length, 20);
      const prices = stock.volatility.prices;
      const returns = prices.slice(1).map((p, i) => 100 * (p.close_price / prices[i].close_price - 1));
      const mean = returns.reduce((a, b) => a + b, 0) / 20;
      const expected = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
      assert.ok(Math.abs(expected - stock.volatility.value) < 1e-10);
    }
  }
  console.log(`PASS: live Fuyao screening; 20 samples; ${JSON.stringify(counts)}; duration=${Date.now() - started}ms.`);
  if (reasons.size) console.log(`Data gaps explicitly reported: ${[...reasons].join(' | ')}`);
  const explicit = await parseIntent('2025年年报归母净利润同比大于5%，PE大于0且小于25，最近20个日收益率波动率小于2%');
  assert.deepEqual(explicit.conditions, { growthMin: 5, peMin: 0, peMax: 25, volatilityMax: 2 });
  assert.equal(explicit.conflicts.length, 0);
  console.log('PASS: actual LLM parsed four explicit numeric thresholds.');
  const vague = await parseIntent('帮我找盈利增长、估值合理、近期波动较小的股票');
  assert.deepEqual(vague.conditions, DEFAULT_CONDITIONS);
  assert.equal(vague.assumptions.length, 4);
  console.log('PASS: actual LLM vague intent uses four clearly labelled default assumptions.');
} catch (error) {
  // Assertions and sanitized service errors contain no credentials or upstream response bodies.
  console.error(`FAIL: live validation (${error instanceof assert.AssertionError ? 'result did not meet assertion' : error instanceof Error && ['DataError', 'ParseError'].includes(error.constructor.name) ? error.message : 'unexpected response or network failure'}).`);
  process.exitCode = 1;
}
