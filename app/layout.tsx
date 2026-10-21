import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '知选 AI · 自然语言选股工作台',
  description: '基于扶摇真实数据的沪深300样本筛选与逐条件解释。',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
