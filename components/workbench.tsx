'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { DEFAULT_CONDITIONS, SCOPE, conditionsSchema, conflicts, type Conditions, type ScreenResult, type ParseResult, type StockResult, type Metric } from '@/lib/contracts';
import { previewConditions } from '@/lib/preview';

type IconName = 'grid' | 'spark' | 'arrow' | 'save' | 'chevron' | 'check' | 'info' | 'clock';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    spark: <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/></>,
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6"/></>,
    save: <><path d="M5 3h12l3 3v15H4V3h1Z"/><path d="M8 3v6h8V3M8 21v-8h8v8"/></>,
    chevron: <path d="m8 5 7 7-7 7"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const number = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4, minimumFractionDigits: 2 });
const time = (value?: number) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未提供';
const date = (value?: number) => value ? new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
const statusText = { selected: '入选', excluded: '排除', insufficient: '数据不足' };
const savedSchema = z.array(z.object({ id: z.string(), name: z.string().min(1).max(40), text: z.string().max(1200), conditions: conditionsSchema, savedAt: z.number() }).strict()).max(20);
type Saved = z.infer<typeof savedSchema>;
const STORAGE_KEY = 'zhixuan.schemes.v1';
const fields: { key: keyof Conditions; label: string; unit: string }[] = [
  { key: 'growthMin', label: '增长率下限', unit: '%' }, { key: 'peMin', label: 'PE 下限', unit: '倍' },
  { key: 'peMax', label: 'PE 上限', unit: '倍' }, { key: 'volatilityMax', label: '波动率上限', unit: '%' },
];
const initial = Object.fromEntries(Object.entries(DEFAULT_CONDITIONS).map(([key, value]) => [key, String(value)])) as Record<keyof Conditions, string>;
const conditionSummary = (c: Conditions) => `A > ${c.growthMin}% · B > ${c.peMin} 且 < ${c.peMax} 倍 · C < ${c.volatilityMax}%`;

function Evidence({ metric }: { metric: Metric }) {
  return <dl className="evidence">
    <div><dt>来源</dt><dd>扶摇 · {metric.source.report ? `报告期 ${metric.source.report}（2025年年报）` : `数据时点 ${time(metric.source.timestamp)}`}</dd></div>
    <div><dt>获取</dt><dd>{time(metric.source.fetchedAt)}（北京时间）</dd></div>
    <div><dt>字段</dt><dd><code>{metric.source.field}</code></dd></div>
    {metric.raw !== null && <div><dt>原值</dt><dd><code>{String(metric.raw)}</code></dd></div>}
    <div><dt>接口</dt><dd><code>{metric.source.endpoint}</code></dd></div>
  </dl>;
}
function StockDetail({ stock }: { stock: StockResult }) {
  return <div className="stock-detail">
    <div className="detail-heading"><strong>{stock.name} · 逐条件解释</strong><span>所有条件以未四舍五入的原值判定</span></div>
    <div className="check-grid">{stock.checks.map((check, index) => {
      const metric = [stock.growth, stock.pe, stock.volatility][index];
      return <section className="check-card" key={check.key}>
        <div className="flex items-center justify-between gap-2"><h4><span>{check.key}</span>{check.title}</h4><span className={`tiny-status ${check.passed === null ? 'insufficient' : check.passed ? 'selected' : 'excluded'}`}>{check.passed === null ? '缺失' : check.passed ? '满足' : '不满足'}</span></div>
        <p className="metric-big">{number(check.value)}<small>{check.value !== null ? check.unit : ''}</small></p>
        <p className="rule-line">条件 {check.rule}{check.key === 'B' ? ' 倍' : ''}</p>
        <p className={check.passed === null ? 'missing-reason' : 'reason'}>{check.reason}</p>
        <Evidence metric={metric}/>
        {check.key === 'C' && <p className="calculation-note">前复权 · {stock.volatility.sampleCount} 个日收益率<br/>{date(stock.volatility.startDate)} — {date(stock.volatility.endDate)}<br/>总体标准差（分母 20），不年化。</p>}
      </section>;
    })}</div>
    <details className="raw-details"><summary>查看计算依据与原始请求参数</summary>
      <p>收益率 rᵢ = (Pᵢ / Pᵢ₋₁ − 1) × 100%；σ = √[Σ(rᵢ − 平均收益率)² / 20]。只使用请求区间内的完整日线；相同交易日相同价格去重，冲突价格或坏数据不补齐。</p>
      <div className="raw-grid">{[stock.growth, stock.pe, stock.volatility].map((metric, i) => <div key={i}><b>{['财务', '估值', '行情'][i]}请求</b><code>{Object.entries(metric.source.params).map(([k, v]) => `${k}=${v}`).join('\n')}</code></div>)}</div>
      {stock.volatility.prices.length > 0 && <div className="raw-table-wrap"><table className="raw-table"><thead><tr><th>日期（北京时间）</th><th>date_ms</th><th>close_price（前复权）</th><th>日收益率 %</th></tr></thead><tbody>{stock.volatility.prices.map((p, i) => <tr key={p.date_ms}><td>{date(p.date_ms)}</td><td>{p.date_ms}</td><td>{p.close_price}</td><td>{i > 0 && stock.volatility.returns[i - 1] !== undefined ? stock.volatility.returns[i - 1].toPrecision(12) : '—'}</td></tr>)}</tbody></table></div>}
    </details>
  </div>;
}

export default function Workbench() {
  const [text, setText] = useState('帮我找盈利增长、估值合理、近期波动较小的股票');
  const [values, setValues] = useState(initial);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsedText, setParsedText] = useState('');
  const [result, setResult] = useState<ScreenResult | null>(null);
  const [busy, setBusy] = useState<'parse' | 'screen' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'all' | StockResult['status']>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [schemeName, setSchemeName] = useState('我的筛选方案');
  const conditions = Object.fromEntries(fields.map(f => [f.key, values[f.key].trim() === '' ? NaN : Number(values[f.key])])) as Conditions;
  const issues = conflicts(conditions);
  const changed = result && JSON.stringify(result.conditions) !== JSON.stringify(conditions);
  const preview = previewConditions(result, conditions);
  const counts = result ? {
    selected: result.stocks.filter(s => s.status === 'selected').length,
    excluded: result.stocks.filter(s => s.status === 'excluded').length,
    insufficient: result.stocks.filter(s => s.status === 'insufficient').length,
  } : null;
  useEffect(() => {
    try { const data = localStorage.getItem(STORAGE_KEY); if (data) setSaved(savedSchema.parse(JSON.parse(data))); }
    catch { setNotice('浏览器中的方案无法读取；可继续使用工作台并重新保存。'); }
  }, []);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [busy]);
  function apply(c: Conditions) { setValues(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) as typeof initial); }
  async function parse() {
    if (busy) return;
    setBusy('parse'); setElapsed(0); setError(''); setNotice(''); setParsed(null);
    try {
      const response = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(65000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'AI 解析失败，可继续手动编辑条件。');
      setParsed(data); setParsedText(text); apply(data.conditions);
      setNotice('AI 解析完成。请核对假设及条件，再确认执行筛选。');
    } catch (e) { setError(e instanceof Error && e.name === 'Error' ? e.message : 'AI 请求超时或网络异常。可继续手动编辑条件。'); }
    finally { setBusy(null); }
  }
  async function run() {
    if (issues.length || busy) return;
    setBusy('screen'); setElapsed(0); setError(''); setNotice('');
    try {
      const response = await fetch('/api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conditions }), signal: AbortSignal.timeout(300000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '筛选失败。');
      setResult(data); setFilter('all'); setExpanded(null);
      setNotice('筛选完成。点击股票行查看逐条件解释与数据来源。');
    } catch (e) { setError(`${e instanceof Error && e.name === 'Error' ? e.message : '筛选请求超时或网络异常。'}${result ? ' 下方保留上次结果，本次未更新。' : ''}`); }
    finally { setBusy(null); }
  }
  function save() {
    if (issues.length) return;
    const name = schemeName.trim();
    if (!name) { setError('请填写方案名称。'); return; }
    if (saved.length >= 20) { setError('最多保存 20 个方案，请先删除不需要的方案。'); return; }
    const next = [{ id: crypto.randomUUID(), name, text, conditions, savedAt: Date.now() }, ...saved];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); setNotice('方案已保存在当前浏览器。'); setError(''); }
    catch { setError('浏览器存储不可用或空间不足，方案未保存。'); }
  }
  function remove(id: string) {
    const next = saved.filter(s => s.id !== id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); }
    catch { setError('无法更新浏览器存储。'); }
  }
  const visibleStocks = result?.stocks.filter(s => filter === 'all' || s.status === filter) ?? [];
  return <div className="app-shell">
    <aside className="rail" aria-label="工作台导航"><a href="#" className="brand-mark" aria-label="知选 AI 首页">Z<span>·</span></a><a href="#workspace" className="rail-active" title="选股工作台" aria-label="选股工作台"><Icon name="grid" size={21}/></a><button onClick={() => setShowSaved(!showSaved)} title="本地方案库" aria-label="本地方案库"><Icon name="save" size={21}/></button><span className="rail-bottom">知<br/>选</span></aside>
    <div className="main-shell">
      <header className="topbar"><div className="wordmark">知选 <span>AI</span><i/> <span className="topbar-sub">策略研究工作台</span></div><div className="topbar-meta"><span className="source-dot"/>扶摇金融数据<span className="divider">/</span><span>同花顺 02 题</span><span className="version-pill">MVP 01</span></div></header>
      <main id="workspace">
        <div className="page-heading"><div><p className="eyebrow">NATURAL LANGUAGE · STOCK SCREENER</p><h1>让选股条件，清晰可解释<span>。</span></h1><p className="subtitle">用自然语言表达思路，用真实数据验证条件。</p></div><button className="secondary-button library-button" onClick={() => setShowSaved(!showSaved)}><Icon name="save"/>我的方案 <span>{saved.length}</span></button></div>
        <div className="scope-banner"><div><Icon name="info"/><strong>{SCOPE}</strong></div><span>固定财报：2025年年报（2025-4）<i/>演示阈值可编辑 · 非投资建议</span></div>
        {showSaved && <section className="saved-panel panel"><div className="section-title"><h2>我的本地方案</h2><button className="text-button" onClick={() => setShowSaved(false)}>收起</button></div><div className="save-form"><input aria-label="方案名称" maxLength={40} value={schemeName} onChange={e => setSchemeName(e.target.value)} placeholder="为当前条件命名"/><button className="secondary-button" disabled={!!busy || issues.length > 0} onClick={save}><Icon name="save"/>保存当前条件</button></div><p className="helper">仅保存自然语言与阈值，不保存行情结果；载入后需重新执行。最多 20 个，仅在此浏览器可用。</p>{saved.length === 0 ? <p className="saved-empty">还没有保存的方案。</p> : <ul className="saved-list">{saved.map(s => <li key={s.id}><div><strong>{s.name}</strong><small>{time(s.savedAt)}</small></div><button className="text-button" disabled={!!busy} onClick={() => { apply(s.conditions); setText(s.text); setParsed(null); setNotice(`已载入“${s.name}”，请确认条件后执行。`); setError(''); }}>载入</button><button className="text-button muted" onClick={() => remove(s.id)}>删除</button></li>)}</ul>}</section>}
        <div aria-live="polite">{notice && <div className="notice"><Icon name="check"/>{notice}</div>}</div>
        {error && <div className="error-banner" role="alert"><Icon name="info"/>{error}</div>}
        <div className="workspace-grid">
          <section className="strategy-panel panel">
            <div className="section-title"><h2><span className="step">01</span>构建筛选条件</h2><span className="micro-label">STRATEGY</span></div>
            <div className="strategy-body">
              <label className="input-label" htmlFor="intent">描述你的选股思路</label>
              <div className="prompt-box"><textarea id="intent" value={text} onChange={e => setText(e.target.value)} disabled={!!busy} maxLength={1200} rows={4} placeholder="例如：净利润增长超过5%，PE在0到25之间，波动率小于2%"/><div className="prompt-bottom"><span>{text.length} / 1200</span><button className="ai-button" disabled={!!busy || text.trim().length < 2} onClick={parse}><Icon name="spark"/>{busy === 'parse' ? `解析中 ${elapsed}s` : 'AI 解析'}</button></div></div>
              <p className="helper">AI 仅提取条件。你也可以直接编辑下方阈值。</p>
              <div className="conditions-heading"><h3>筛选条件</h3><span>{parsed ? 'AI 解析后可修改' : '演示默认值 · 可修改'}</span></div>
              <fieldset disabled={!!busy} className="conditions-fieldset"><legend className="sr-only">编辑筛选阈值</legend>
                <div className="condition-block"><div className="condition-title"><span className="condition-letter">A</span><div><h4>盈利增长</h4><p>2025年年报 · 归母净利润同比</p></div><span className="operator">&gt;</span></div><div className="threshold-row"><label htmlFor="growthMin">增长率下限</label><div className="number-input"><input id="growthMin" type="number" step="any" value={values.growthMin} onChange={e => setValues({ ...values, growthMin: e.target.value })}/><span>%</span></div></div></div>
                <div className="condition-block"><div className="condition-title"><span className="condition-letter">B</span><div><h4>合理估值</h4><p>正值 PE_TTM · 严格开区间</p></div><span className="operator">&lt; &gt;</span></div><div className="range-input">{fields.slice(1, 3).map(f => <div key={f.key}><label htmlFor={f.key}>{f.label}</label><div className="number-input"><input id={f.key} type="number" step="any" value={values[f.key]} onChange={e => setValues({ ...values, [f.key]: e.target.value })}/><span>倍</span></div></div>)}</div></div>
                <div className="condition-block"><div className="condition-title"><span className="condition-letter">C</span><div><h4>较低波动</h4><p>最近20个日收益率 · 总体标准差</p></div><span className="operator">&lt;</span></div><div className="threshold-row"><label htmlFor="volatilityMax">波动率上限</label><div className="number-input"><input id="volatilityMax" type="number" step="any" value={values.volatilityMax} onChange={e => setValues({ ...values, volatilityMax: e.target.value })}/><span>%</span></div></div></div>
              </fieldset>
              {issues.length > 0 && <div className="conflicts" role="alert"><strong>请先解决条件冲突</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
              {parsed && parsed.unsupported.length > 0 && <div className="unsupported unsupported-notice"><b>以下需求未执行</b><ul>{parsed.unsupported.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              <button className="run-button" onClick={run} disabled={!!busy || issues.length > 0}>{busy === 'screen' ? <><span className="spinner"/>获取真实数据 · {elapsed}s</> : <>确认条件并执行筛选<Icon name="arrow"/></>}</button>
              <p className="execution-note">A ∩ B ∩ C · 三项全部满足才入选<br/>数据缺失单独分类，不作为 0 或自动通过。</p>
              <div className="assumptions"><div className="flex items-center gap-2"><Icon name="info" size={15}/><h4>{parsed ? '解析依据与默认假设' : '默认假设，等待你确认'}</h4></div>{parsed ? <>{parsedText !== text && <p className="warning-text">输入已改变；下方为上一次解析记录，可重新解析。</p>}<p>以下记录对应上次 AI 输出；后续手动修改以条件卡片为准。</p>{parsed.explicit.length > 0 && <ul className="explicit-evidence">{parsed.explicit.map((a, i) => <li key={i}>{a}</li>)}</ul>}{parsed.assumptions.length > 0 && <details className="assumption-defaults"><summary>默认假设 {parsed.assumptions.length} 项 · 展开核对</summary><ul>{parsed.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}</> : <details className="assumption-defaults"><summary>初始阈值为演示默认值 · 展开说明</summary><p>“增长、合理估值、较低波动”没有唯一数值定义。初始的 0%、0–30 倍、3% 均为演示假设，不代表用户已指定或 AI 已调用。</p></details>}</div>
            </div>
          </section>
          <section className="results-column" aria-busy={busy === 'screen'}>
            {changed && result && <section className="condition-preview panel" aria-labelledby="preview-title" aria-live="polite">
              <div className="preview-heading"><Icon name="info"/><h3 id="preview-title">基于上次数据快照的条件变化预览</h3><span>尚未执行</span></div>
              <p className="preview-context">对应上次筛选时间：{time(result.fetchedAt)}（北京时间）。仅复用已有指标，不更新行情或财报，不代表最新实时数据。</p>
              {preview ? <>
                <dl className="preview-counts"><div><dt>调整前入选</dt><dd data-preview="before">{preview.beforeCount}<small>只</small></dd></div><div><dt>调整后预计入选</dt><dd data-preview="after">{preview.afterCount}<small>只</small></dd></div><div><dt>数量变化</dt><dd data-preview="delta">{preview.delta > 0 ? '+' : ''}{preview.delta}<small>只</small></dd></div></dl>
                <div className="preview-rules"><p><b>上次已执行条件</b><span>{conditionSummary(result.conditions)}</span></p><p><b>当前编辑条件</b><span>{conditionSummary(conditions)}</span></p></div>
                <div className="preview-changes">{([{ key: 'added', title: '预计新增入选', stocks: preview.added }, { key: 'removed', title: '预计退出入选', stocks: preview.removed }] as const).map(group => <div key={group.key} data-preview={group.key}><h4>{group.title}<span>{group.stocks.length} 只</span></h4>{group.stocks.length ? <ul>{group.stocks.map(stock => <li key={stock.thscode}><strong>{stock.name}</strong><code>{stock.thscode}</code><span>{statusText[stock.before]} → {statusText[stock.after]}</span></li>)}</ul> : <p>无</p>}</div>)}</div>
                {preview.insufficientCount > 0 && <p className="preview-context">仍有 {preview.insufficientCount} 只数据不足，调整阈值不会补齐缺失数据。</p>}
              </> : <p className="preview-unavailable" role="status">条件存在冲突或数值未填写完整，暂不生成数量预览。请先修正左侧条件。</p>}
              <p className="preview-footer">下方统计、列表和逐股解释仍对应上次已执行条件；确认后点击“执行筛选”才会更新正式结果。</p>
            </section>}
            {result && <p className="executed-label">{changed ? '上次已执行统计 · 尚未应用当前编辑条件' : '已执行筛选统计'}</p>}
            <div className="stats-grid">{(['selected', 'excluded', 'insufficient'] as const).map((key, i) => <div key={key} className={`stat-card stat-${key}`}><div><span>{['满足全部条件', '未满足条件', '待补全数据'][i]}</span><span className="stat-index">0{i + 1}</span></div><p>{counts ? counts[key] : '—'}<small>只</small></p><span className="stat-caption">{['入选样本', '排除样本', '数据不足样本'][i]}</span></div>)}</div>
            <div className="results-panel panel"><div className="section-title"><h2><span className="step">02</span>{result ? '上次已执行结果' : '样本筛选结果'}</h2><span className="micro-label">{result ? `${result.stocks.length} STOCKS` : 'WAITING FOR RUN'}</span></div>
              <div className="result-tabs" role="group" aria-label="结果分类">{(['all', 'selected', 'excluded', 'insufficient'] as const).map(key => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === 'all' ? '全部样本' : statusText[key]}<span>{counts ? key === 'all' ? result!.stocks.length : counts[key] : '—'}</span></button>)}</div>
              {changed && <div className="stale-banner">条件已修改。下方仍为上次执行结果，请重新执行以更新。</div>}
              {busy === 'screen' && <div className="loading-banner" role="status"><span className="spinner dark"/>正在获取成分股、估值、财务与历史行情，并发上限 3。{result ? '下方保留上次结果。' : '首次获取可能需要一些时间。'}</div>}
              {result ? <>
                <div className="result-snapshot"><Icon name="clock" size={14}/><span>执行于 {time(result.fetchedAt)}<br/><span className="snapshot-rules">已执行条件：{conditionSummary(result.conditions)}</span></span></div>
                <div className="stock-table"><div className="table-head"><span>股票 / 代码</span><span>净利润同比</span><span>PE_TTM</span><span>20日波动率</span><span>判定</span><span/></div>{visibleStocks.length === 0 ? <div className="no-matches">此分类暂无股票。可查看其他分类或修改阈值后重新执行。</div> : visibleStocks.map(stock => <div key={stock.thscode} className="stock-row-group"><button className={`stock-row ${expanded === stock.thscode ? 'expanded' : ''}`} onClick={() => setExpanded(expanded === stock.thscode ? null : stock.thscode)} aria-expanded={expanded === stock.thscode} aria-controls={`detail-${stock.thscode}`}><span className="stock-name"><strong>{stock.name}</strong><small>{stock.thscode}</small></span><span>{number(stock.growth.value)}{stock.growth.value !== null ? '%' : ''}</span><span>{number(stock.pe.value)}</span><span>{number(stock.volatility.value)}{stock.volatility.value !== null ? '%' : ''}</span><span><span className={`status-badge ${stock.status}`}>{stock.status === 'selected' && <Icon name="check" size={12}/>} {statusText[stock.status]}</span></span><span className="row-chevron"><Icon name="chevron" size={14}/></span></button>{expanded === stock.thscode && <div id={`detail-${stock.thscode}`}><StockDetail stock={stock}/></div>}</div>)}</div>
                <div className="result-footnote">按成分股接口原始顺序展示，不代表排名。成分股数据时点：{time(result.poolSource.timestamp)}。<br/>估值与行情为各自数据时点，不保证实时；展开股票可查看报告期、原值与计算依据。</div>
              </> : <div className="empty-state"><div className="empty-graphic" aria-hidden="true"><span/><span/><span/><span/><i><Icon name="check" size={22}/></i></div><h3>从一个可验证的想法开始</h3><p>确认左侧条件后，获取 20 只样本的真实数据。<br/>每一个入选与排除，都有对应的数值和依据。</p><div className="empty-steps"><span>01 确认条件</span><Icon name="arrow" size={14}/><span>02 获取数据</span><Icon name="arrow" size={14}/><span>03 查看解释</span></div></div>}
            </div>
            <div className="method-panel"><div><Icon name="info"/><h3>读懂结果，而不只看结果</h3></div><p>财务增长率使用 <b>2025年年报</b>，不是实时最新财报。波动率取前复权收盘价，使用最近 21 个有效交易日生成 20 个日收益率，计算总体标准差，不年化。接口错误、缺失或冲突数据会明确标记。</p><div><span>确定性 TypeScript 计算</span><span>原始字段可追溯</span><span>AI 不参与入选判定</span></div></div>
          </section>
        </div>
        <footer><span>知选 AI <i/> 把每一个条件说清楚</span><p>本工具用于产品能力验证与策略研究演示，不构成投资建议或收益承诺。样本覆盖有限，历史数据不代表未来表现。</p></footer>
      </main>
    </div>
  </div>;
}
