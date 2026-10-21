import { NextResponse } from 'next/server';
import { parseRequestSchema } from '@/lib/contracts';
import { parseIntent, ParseError } from '@/lib/llm';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  let body;
  try { body = parseRequestSchema.safeParse(await request.json()); }
  catch { return NextResponse.json({ error: '请求必须是有效 JSON。' }, { status: 400 }); }
  if (!body.success) return NextResponse.json({ error: '请输入 2–1200 字的选股需求。' }, { status: 400 });
  try { return NextResponse.json(await parseIntent(body.data.text), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (e) { return NextResponse.json({ error: e instanceof ParseError ? e.message : 'AI 服务异常，可继续手动编辑。' }, { status: 502 }); }
}
