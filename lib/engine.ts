import { conditionsSchema, conflicts, type Conditions, type StockData, type StockResult, type PricePoint } from './contracts';

// Do not coerce null, whitespace, booleans, infinity, or formatted percentages to 0.
export function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function calculateVolatility(rows: unknown, end: number) {
  const empty = { value: null, prices: [] as PricePoint[], returns: [] as number[], sampleCount: 0 };
  if (!Array.isArray(rows) || !rows.length) return { ...empty, error: 'K线数据为空。' };
  const days = new Map<string, PricePoint>();
  for (const row of rows) {
    const date = numeric(row?.date_ms);
    const close = numeric(row?.close_price);
    if (date === null || !Number.isSafeInteger(date) || date < 946684800000 || date > end) return { ...empty, error: 'K线包含缺失、非法或超出请求结束时间的日期。' };
    if (close === null || close <= 0) return { ...empty, error: 'K线包含缺失、非数值或非正收盘价；不跨越坏数据计算收益率。' };
    const day = new Date(date + 8 * 3600000).toISOString().slice(0, 10);
    const previous = days.get(day);
    if (previous && previous.close_price !== close) return { ...empty, error: '同一交易日存在冲突收盘价，无法可靠计算。' };
    // Identical duplicate trading dates count once; retain the earliest timestamp.
    if (!previous || date < previous.date_ms) days.set(day, { date_ms: date, close_price: close });
  }
  const prices = [...days.values()].sort((a, b) => a.date_ms - b.date_ms).slice(-21);
  if (prices.length < 21) return { ...empty, prices, sampleCount: Math.max(0, prices.length - 1), error: `仅 ${prices.length} 个有效交易日收盘价，至少需要 21 个。` };
  const returns = prices.slice(1).map((p, i) => (p.close_price / prices[i].close_price - 1) * 100);
  const mean = returns.reduce((sum, r) => sum + r, 0) / 20;
  // Population standard deviation, denominator 20. Units are percentage points.
  const value = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / 20);
  if (!Number.isFinite(value)) return { ...empty, error: '收益率计算溢出，无法计算波动率。' };
  return { value, prices, returns, sampleCount: 20, startDate: prices[0].date_ms, endDate: prices[20].date_ms };
}

export function evaluate(stock: StockData, conditions: Conditions): StockResult {
  conditionsSchema.parse(conditions);
  const errors = conflicts(conditions);
  if (errors.length) throw new Error(errors.join(' '));
  const definitions = [
    { key: 'A' as const, title: '归母净利润同比', metric: stock.growth, unit: '%', rule: `> ${conditions.growthMin}%`, test: (v: number) => v > conditions.growthMin },
    { key: 'B' as const, title: '滚动市盈率', metric: stock.pe, unit: '倍', rule: `> ${conditions.peMin} 且 < ${conditions.peMax}`, test: (v: number) => v > conditions.peMin && v < conditions.peMax },
    { key: 'C' as const, title: '20日收益率波动率', metric: stock.volatility, unit: '%', rule: `< ${conditions.volatilityMax}%`, test: (v: number) => v < conditions.volatilityMax },
  ];
  const checks = definitions.map(({ key, title, metric, unit, rule, test }) => {
    const hasSource = metric.source.provider === '扶摇' && !!metric.source.endpoint && !!metric.source.field && Number.isFinite(metric.source.fetchedAt) &&
      (key === 'A' ? metric.source.report === '2025-4' : typeof metric.source.timestamp === 'number' && metric.source.timestamp > 0) &&
      (key !== 'C' || (stock.volatility.sampleCount === 20 && stock.volatility.prices.length === 21));
    const valid = metric.value !== null && Number.isFinite(metric.value) && !metric.error && hasSource;
    const passed = valid ? test(metric.value!) : null;
    return { key, title, rule, value: metric.value, unit, passed, reason: passed === null ? metric.error ?? '数值或数据来源不完整。' : passed ? '满足条件' : '不满足条件' };
  });
  const status = checks.some(c => c.passed === null) ? 'insufficient' : checks.every(c => c.passed) ? 'selected' : 'excluded';
  return { ...stock, status, checks };
}
