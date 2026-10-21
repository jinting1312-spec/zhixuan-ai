// Only print status summaries. Never print headers, credentials, or upstream errors.
const required = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`FAIL: missing ${missing.join(', ')}`);
  process.exit(1);
}
try {
  const base = process.env.LLM_BASE_URL.replace(/\/+$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.LLM_MODEL, messages: [{ role: 'user', content: 'Return exactly this JSON object: {"ok":true}' }], response_format: { type: 'json_object' }, max_tokens: 256, temperature: 0 }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  const content = JSON.parse(json?.choices?.[0]?.message?.content ?? '');
  if (content.ok !== true) throw new Error('Unexpected JSON');
  console.log('PASS: actual LLM chat/completions call; HTTP 200; valid JSON response.');
} catch (error) {
  console.error(`FAIL: model verification (${error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : 'network, timeout, or invalid response'}).`);
  process.exitCode = 1;
}
