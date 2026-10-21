import 'server-only';
import { z } from 'zod';
import { REPORT, GROWTH_FIELD, SCOPE, type Source, type Metric, type StockData, type ScreenResult, type Conditions } from './contracts';
import { numeric, calculateVolatility, evaluate } from './engine';

const BASE = 'https://fuyao.aicubes.cn';
const PATH = {
  pool: '/api/a-share-index/constituents/ths-stock-list',
  pe: '/api/a-share/valuations/snapshot',
  financial: '/api/a-share/financials/indicators',
  prices: '/api/a-share/prices/historical',
};
export class DataError extends Error {}
export function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limited<T>(job: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try { return await job(); }
    finally { const next = queue.shift(); if (next) next(); else active--; }
  };
}
export const limited = createLimiter(3);
type Cached = { data: unknown; fetchedAt: number };
const cache = new Map<string, { expires: number; value: Cached }>();
const pending = new Map<string, Promise<Cached>>();

export async function requestFuyao(path: string, params: Record<string, string>, fetcher: typeof fetch = fetch): Promise<Cached> {
  const key = process.env.FUYAO_API_KEY;
  if (!key) throw new DataError('服务端未配置 FUYAO_API_KEY。');
  const url = new URL(path, BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const response = await fetcher(url, { headers: { 'X-api-key': key, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(18000) });
    if (!response.ok) throw new DataError(`扶摇请求失败（HTTP ${response.status}）。`);
    const json = await response.json();
    if (json?.code !== 0) throw new DataError('扶摇返回业务失败（code 非 0）。');
    if (!json.data || typeof json.data !== 'object') throw new DataError('扶摇响应缺少 data。');
    return { data: json.data, fetchedAt: Date.now() };
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError('扶摇请求超时、网络不可达或响应不是有效 JSON。');
  }
}
async function cached(path: string, params: Record<string, string>, ttl: number): Promise<Cached> {
  const key = path + JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key)!;
  const promise = limited(() => requestFuyao(path, params)).then(value => {
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + ttl, value });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataError('扶摇数据结构不符合预期。');
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): number | undefined {
  const n = numeric(value);
  return n !== null && Number.isSafeInteger(n) && n >= 946684800000 && n <= Date.now() + 86400000 ? n : undefined;
}
function source(endpoint: string, field: string, params: Record<string, string>, fetchedAt = Date.now()): Source {
  return { provider: '扶摇', endpoint, field, params, fetchedAt };
}
function raw(value: unknown): string | number | null { return typeof value === 'string' || typeof value === 'number' ? value : null; }
function failure(error: unknown) { return error instanceof DataError ? error.message : '数据字段结构异常。'; }
const stockSchema = z.object({ thscode: z.string().regex(/^\d{6}\.(SH|SZ)$/), ticker: z.string(), name: z.string().min(1) });

async function financial(thscode: string): Promise<Metric> {
  const params = { thscode, report: REPORT };
  let src = { ...source(PATH.financial, `data.abilities[].indicators[index_id=${GROWTH_FIELD}].value`, params), report: REPORT };
  try {
    const response = await cached(PATH.financial, params, 6 * 3600000);
    src = { ...src, fetchedAt: response.fetchedAt };
    const d = object(response.data);
    if (d.report !== REPORT || d.thscode !== thscode) throw new DataError('财报的报告期或股票代码与请求不一致。');
    if (!Array.isArray(d.abilities)) throw new DataError('缺少财务能力指标。');
    const matches = d.abilities.flatMap(b => Array.isArray(b?.indicators) ? b.indicators : []).filter(i => i?.index_id === GROWTH_FIELD);
    if (matches.length !== 1 || numeric(matches[0]?.value) === null) throw new DataError('2025年年报归母净利润同比缺失、重复或无效。');
    return { value: numeric(matches[0].value), raw: raw(matches[0].value), source: src };
  } catch (e) { return { value: null, raw: null, source: src, error: failure(e) }; }
}

async function prices(thscode: string): Promise<StockData['volatility']> {
  // End at the previous China calendar day to exclude an unfinished intraday bar.
  const end = Math.floor((Date.now() + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000 - 1;
  const start = end - 90 * 86400000;
  const params = { thscode, interval: '1d', start: String(start), end: String(end), adjust: 'forward' };
  let src = source(PATH.prices, 'data.item[].date_ms / close_price', params);
  const empty = { value: null, raw: null, prices: [], returns: [], sampleCount: 0 };
  try {
    const response = await cached(PATH.prices, params, 15 * 60000);
    const d = object(response.data);
    src = { ...src, fetchedAt: response.fetchedAt, timestamp: timestamp(d.timestamp) };
    if (d.thscode !== thscode || d.interval !== '1d' || d.adjust !== 'forward') throw new DataError('行情股票代码、周期或复权方式不一致。');
    if (!src.timestamp) throw new DataError('行情缺少有效数据时间戳。');
    const result = calculateVolatility(d.item, end);
    if (result.prices.some(p => p.date_ms < start)) throw new DataError('行情日期早于请求起点。');
    return { ...result, raw: null, source: src };
  } catch (e) { return { ...empty, source: src, error: failure(e) }; }
}

export async function screen(conditions: Conditions): Promise<ScreenResult> {
  const poolParams = { thscode: '000300.SH' };
  const pool = await cached(PATH.pool, poolParams, 3600000);
  const d = object(pool.data);
  if (!Array.isArray(d.item) || d.item.length < 20) throw new DataError('成分股接口不足 20 条，无法建立指定样本池。');
  const parsed = z.array(stockSchema).safeParse(d.item.slice(0, 20));
  if (!parsed.success || new Set(parsed.data.map(s => s.thscode)).size !== 20) throw new DataError('成分股前 20 条存在缺失或重复代码。');
  const poolSource = { ...source(PATH.pool, 'data.item[0..19]: thscode / ticker / name', poolParams, pool.fetchedAt), timestamp: timestamp(d.timestamp) };
  if (!poolSource.timestamp) throw new DataError('成分股列表缺少有效数据时间戳。');
  const stocks = parsed.data;
  const peParams = { thscodes: stocks.map(s => s.thscode).join(',') };
  let peSource = source(PATH.pe, 'data.item[].pe_ttm', peParams);
  let peRows: Record<string, unknown>[] = [];
  let peError: string | undefined;
  try {
    const pe = await cached(PATH.pe, peParams, 5 * 60000);
    const p = object(pe.data);
    peSource = { ...peSource, fetchedAt: pe.fetchedAt, timestamp: timestamp(p.timestamp) };
    if (!Array.isArray(p.item) || !peSource.timestamp) throw new DataError('估值快照缺少记录或有效时间戳。');
    peRows = p.item.map(object);
  } catch (e) { peError = failure(e); }
  const results = await Promise.all(stocks.map(async stock => {
    const [growth, volatility] = await Promise.all([financial(stock.thscode), prices(stock.thscode)]);
    const matches = peRows.filter(row => row.thscode === stock.thscode);
    const value = matches.length === 1 ? numeric(matches[0].pe_ttm) : null;
    const pe: Metric = { value, raw: raw(matches[0]?.pe_ttm), source: peSource, error: peError ?? (value === null ? 'PE_TTM 缺失、重复或无效。' : undefined) };
    return evaluate({ ...stock, growth, pe, volatility }, conditions);
  }));
  return { conditions, stocks: results, scope: SCOPE, report: REPORT, fetchedAt: Date.now(), poolSource };
}
