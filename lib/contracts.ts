import { z } from 'zod';

const threshold = z.number().finite().min(-1_000_000).max(1_000_000);
export const conditionsSchema = z.object({
  growthMin: threshold,
  peMin: threshold,
  peMax: threshold,
  volatilityMax: threshold,
}).strict();
export type Conditions = z.infer<typeof conditionsSchema>;
export const DEFAULT_CONDITIONS: Conditions = { growthMin: 0, peMin: 0, peMax: 30, volatilityMax: 3 };
export const REPORT = '2025-4';
export const GROWTH_FIELD = 'calculate_parent_holder_net_profit_yoy_growth_ratio';
export const SCOPE = '沪深300样本20只，非全市场筛选';
export function conflicts(c: Conditions): string[] {
  const messages: string[] = [];
  if (!conditionsSchema.safeParse(c).success) messages.push('请填写所有有限数值（绝对值不超过 1,000,000）。');
  if (c.peMin < 0) messages.push('PE 下限不能为负；本策略要求 PE_TTM > 0。');
  if (c.peMin >= c.peMax) messages.push('PE 下限必须小于上限。');
  if (c.volatilityMax <= 0) messages.push('波动率阈值必须大于 0%；非负波动率无法满足小于等于零的严格上限。');
  return messages;
}
export const screenRequestSchema = z.object({ conditions: conditionsSchema }).strict();
export const parseRequestSchema = z.object({ text: z.string().trim().min(2).max(1200) }).strict();
export type Source = {
  provider: '扶摇'; endpoint: string; field: string; fetchedAt: number;
  timestamp?: number; report?: string; params: Record<string, string>;
};
export type Metric = { value: number | null; raw: string | number | null; source: Source; error?: string };
export type PricePoint = { date_ms: number; close_price: number };
export type VolatilityMetric = Metric & { prices: PricePoint[]; returns: number[]; startDate?: number; endDate?: number; sampleCount: number };
export type StockData = {
  thscode: string; ticker: string; name: string;
  growth: Metric; pe: Metric; volatility: VolatilityMetric;
};
export type Check = { key: 'A' | 'B' | 'C'; title: string; rule: string; value: number | null; unit: string; passed: boolean | null; reason: string };
export type StockResult = StockData & { status: 'selected' | 'excluded' | 'insufficient'; checks: Check[] };
export type ScreenResult = {
  conditions: Conditions; stocks: StockResult[]; scope: string; report: string;
  fetchedAt: number; poolSource: Source;
};
export type ParseResult = { conditions: Conditions; assumptions: string[]; explicit: string[]; unsupported: string[]; conflicts: string[]; model: string };
