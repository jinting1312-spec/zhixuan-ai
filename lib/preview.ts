import { conflicts, type Conditions, type ScreenResult } from './contracts';
import { evaluate } from './engine';

// Re-evaluate only the already-computed metrics. No I/O, price calculations,
// snapshot mutation, or replacement of the last executed result.
export function previewConditions(snapshot: ScreenResult | null, next: Conditions) {
  if (!snapshot || conflicts(next).length) return null;
  if ((Object.keys(next) as Array<keyof Conditions>).every(key => next[key] === snapshot.conditions[key])) return null;
  const after = snapshot.stocks.map(stock => evaluate(stock, next));
  const changes = after.flatMap((stock, i) => stock.status === snapshot.stocks[i].status ? [] : [{
    thscode: stock.thscode, name: stock.name,
    before: snapshot.stocks[i].status, after: stock.status,
  }]);
  const beforeCount = snapshot.stocks.filter(stock => stock.status === 'selected').length;
  const afterCount = after.filter(stock => stock.status === 'selected').length;
  return {
    beforeCount, afterCount, delta: afterCount - beforeCount,
    added: changes.filter(stock => stock.after === 'selected'),
    removed: changes.filter(stock => stock.before === 'selected'),
    insufficientCount: after.filter(stock => stock.status === 'insufficient').length,
  };
}
