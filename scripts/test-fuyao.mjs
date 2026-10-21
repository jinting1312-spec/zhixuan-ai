/** Adapted from the read-only preparation script. Status summaries only. */
if (!process.env.FUYAO_API_KEY) { console.error('FAIL: FUYAO_API_KEY is missing.'); process.exit(1); }
const end = Date.now();
const specs = [
  ['成分股', '/api/a-share-index/constituents/ths-stock-list', { thscode: '000300.SH' }, d => Array.isArray(d.item) && d.item.length >= 20],
  ['估值', '/api/a-share/valuations/snapshot', { thscodes: '600519.SH,000001.SZ' }, d => d.item?.some(r => r.pe_ttm != null) && typeof d.timestamp === 'number'],
  ['财务', '/api/a-share/financials/indicators', { thscode: '600519.SH', report: '2025-4' }, d => d.report === '2025-4' && d.abilities?.flatMap(b => b.indicators ?? []).some(i => i.index_id === 'calculate_parent_holder_net_profit_yoy_growth_ratio' && i.value != null)],
  ['K线', '/api/a-share/prices/historical', { thscode: '600519.SH', interval: '1d', adjust: 'forward', start: String(end - 90 * 86400000), end: String(end) }, d => d.item?.filter(r => typeof r.date_ms === 'number' && r.close_price > 0).length >= 21],
];
let passed = 0;
for (const [name, path, params, check] of specs) {
  try {
    const url = new URL(path, 'https://fuyao.aicubes.cn');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetch(url, { headers: { 'X-api-key': process.env.FUYAO_API_KEY }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error();
    const j = await r.json();
    if (j.code !== 0 || !check(j.data ?? {})) throw new Error();
    passed++; console.log(`PASS: ${name} HTTP 200, code=0, required fields present.`);
  } catch { console.log(`FAIL: ${name} network, API status, or required data invalid.`); }
}
console.log(`Fuyao: ${passed}/${specs.length} passed; financial report=2025-4.`);
if (passed !== specs.length) process.exitCode = 1;
