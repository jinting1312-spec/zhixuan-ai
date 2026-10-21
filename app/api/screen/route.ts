import { NextResponse } from 'next/server';
import { screenRequestSchema, conflicts } from '@/lib/contracts';
import { screen, DataError } from '@/lib/fuyao';
export const runtime = 'nodejs';
export const maxDuration = 300;
let activeScreen: Promise<unknown> | null = null;
export async function POST(request: Request) {
  let body;
  try { body = screenRequestSchema.safeParse(await request.json()); }
  catch { return NextResponse.json({ error: '请求必须是有效 JSON。' }, { status: 400 }); }
  if (!body.success) return NextResponse.json({ error: '条件结构不合法，请填写完整数值。' }, { status: 400 });
  const errors = conflicts(body.data.conditions);
  if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  // One screening per instance prevents overlapping users from building an unbounded API queue.
  if (activeScreen) return NextResponse.json({ error: '当前服务实例正在获取数据，请稍后重试。' }, { status: 429 });
  try {
    const job = screen(body.data.conditions);
    activeScreen = job;
    return NextResponse.json(await job, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return NextResponse.json({ error: e instanceof DataError ? e.message : '筛选服务异常，请稍后重试。' }, { status: 502 }); }
  finally { activeScreen = null; }
}
