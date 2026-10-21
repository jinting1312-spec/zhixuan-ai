# 知选 AI

同花顺 02 题「自然语言智能选股与策略解释器」的可运行 MVP。Next.js App Router、TypeScript、Tailwind CSS、Zod；同一项目内包含服务端数据接口、确定性筛选和单页工作台。

产品：[https://zhixuan-stock-ai.netlify.app/](https://zhixuan-stock-ai.netlify.app/) · 源码：[jinting1312-spec/zhixuan-ai](https://github.com/jinting1312-spec/zhixuan-ai)。交付摘要见 [SUBMISSION.md](SUBMISSION.md)。

## 启动

需要 Node.js 22+ 和 npm。新机器在任意工作目录克隆仓库，进入包含 `package.json` 的仓库根目录：

```sh
git clone https://github.com/jinting1312-spec/zhixuan-ai.git
cd zhixuan-ai
npm ci
```

参照根目录 `.env.example` 新建 `.env.local`，填入下表的服务端配置；示例不含真实密钥，需要自行配置。已有 `.env.local` 不应覆盖。然后启动：

```sh
npm run dev
```

访问终端显示的本地地址，默认 http://127.0.0.1:3000。生产模式使用 `npm run build` 后执行 `npm start`。启动与构建脚本会通过 `scripts/runtime-env.mjs` 关闭 Next.js 可选遥测，避免开发时遇到的 Windows 用户配置写入 `EXDEV` 错误，不修改环境文件。

原开发机器的正式根目录为 `F:\Personal Profile Organization\02Work\2.8Project\zhixuan`，此路径不是运行要求。所有命令都在项目根目录执行；`preparation/` 仅为本机历史测试参考，不随源码交付。

| 服务端变量 | 用途 |
| --- | --- |
| `FUYAO_API_KEY` | 扶摇 API；固定 `https://fuyao.aicubes.cn`，`X-api-key` 请求头 |
| `LLM_API_KEY` | DeepSeek / OpenAI 兼容接口密钥 |
| `LLM_BASE_URL` | 本项目配置为 `https://api.deepseek.com`；程序追加 `/chat/completions` |
| `LLM_MODEL` | `deepseek-flash` |

所有变量只在服务端读取，禁止增加 `NEXT_PUBLIC_` 前缀。`.gitignore` 已排除 `.env.local`、`.env.*`（保留 `.env.example`）、`preparation/`、`node_modules/`、`.next/`。服务端模块使用 `server-only`，不会被客户端组件导入。日志仅输出检查摘要，不输出凭据、请求头或上游原始错误正文。

## 使用

1. 输入思路并点击「AI 解析」，或直接编辑默认阈值。
2. 核对数值、默认假设、不支持的需求和冲突。解析不会自动执行选股。
3. 点击「确认条件并执行筛选」。查看全部、入选、排除和数据不足分类。
4. 点击股票行，查看每个条件的数值、原始字段、原值、报告期/行情时点、请求参数，以及参与计算的 21 个收盘价与 20 个收益率。
5. 「我的方案」可命名保存、载入或删除方案，存储在当前浏览器 localStorage。只保存条件和输入，不保存行情；载入后必须重新执行。

完成一次筛选后，修改阈值会出现「基于上次数据快照的条件变化预览」，显示调整前/后预计入选数、差异和新增/退出入选股票。预览只调用现有确定性规则引擎判断已取得的指标，不请求扶摇或 DeepSeek、不重算底层金融指标。两组条件与快照对应的筛选时间分别展示；下方正式统计、列表与逐股解释仍保留上次已执行结果。无快照时不生成预览，非法或未填完整的条件暂停预览，恢复原条件后隐藏预览，重新执行成功后以新的正式结果为准。

当前线上地址：[知选 AI](https://zhixuan-stock-ai.netlify.app/)。用户已完成首版线上核心功能人工验收，并反馈包含条件变化预览的最新版本已部署。本轮材料整理重新验证本地测试和构建，未补做线上人工验收。

## 数据与计算口径

**沪深300样本20只，非全市场筛选。** 使用成分股接口原始顺序的前 20 条，不按涨跌或筛选结果重排，不拿其他股票补齐坏记录。此顺序及名单可能随上游变化，结果保留成分股数据时点。

| 条件 | 数据来源 | 默认规则 |
| --- | --- | --- |
| A | `/api/a-share/financials/indicators` → `data.abilities[].indicators[]`，`index_id=calculate_parent_holder_net_profit_yoy_growth_ratio` 的 `value` | 2025年年报（`report=2025-4`）归母净利润同比 > 0% |
| B | `/api/a-share/valuations/snapshot` → `data.item[].pe_ttm`、`data.timestamp` | PE_TTM > 0 且 < 30 |
| C | `/api/a-share/prices/historical` → `data.item[].date_ms`、`close_price`，`data.timestamp` | 最近 20 个日收益率的总体标准差 < 3% |

A 的值按百分数表示，`5` 表示 `5%`，不是 `500%`。允许严格的数字字符串，空字符串、`null`、布尔值、百分号字符串等不是 0。报告期固定为 `2025-4`，**不是实时最新财报**。所有比较均为严格不等号，不含边界；判定使用未四舍五入数值，列表展示最多 4 位小数。

C 请求最近 90 个日历日、`interval=1d`、`adjust=forward`，结束时间为北京时间当天零点前一毫秒，避免使用当天未收盘日线。按北京时间交易日期去重，按时间升序，取最后 21 个有效收盘价。

```
r[i] = (close[i] / close[i-1] - 1) * 100
mean = sum(r) / 20
volatility = sqrt(sum((r - mean)^2) / 20)
```

采用总体标准差（分母 20），不年化。相同交易日相同价格仅计一次；重复日期价格冲突、非法或缺失日期、缺失/零/负价格、未来日期等均标为数据不足，不跨越坏记录计算。对 90 日返回区间采用保守检查，即使坏记录较早也可能令该指标不足。没有独立交易日历，无法验证上游完全省略的交易日；不会补价或声称停牌日连续可交易。波动率窗口的起止交易日会单独展示。

三项均通过才入选；数据完整但至少一项不通过为排除；任一数值、必需时间戳、报告期或来源不完整则优先列为数据不足，即使其他项已经失败。成分股接口整体失败时返回明确错误，无法伪造一个 20 只股票池。单股或估值接口错误保留其余真实数据。

## AI 的职责与边界

模型只处理用户文本，返回四个白名单阈值候选及原文依据；不接收股票财务数据，不计算指标，不决定入选，不执行模型返回的代码、URL、SQL 或工具调用。HTTP 与 JSON 双重校验，Zod 严格拒绝额外字段、非有限数字和结构异常。

未明确给出的阈值由程序填入演示默认值并标注「默认假设」。模型声称明确的阈值必须附有输入中的原文片段，且片段内含有同一个阿拉伯数值，否则降级为默认值。中文数词、方向、多个数值之间的语义仍可能解析有误，界面展示原文并要求用户确认，不能把原文包含数值等同于完整语义证明。不支持的指标、OR 条件、非严格比较等由模型在「未执行」提示中列出；模型可能漏识别，只有展示并经用户确认的 A/B/C 条件会被执行。

PE 下限必须非负且小于上限，波动率上限必须正数。冲突在前后端独立检查；不合法条件不会向扶摇发起筛选请求。AI 错误明确显示，手工编辑与筛选仍可使用。用户修改条件后，旧结果保留原执行条件并显著提示需重新运行。

## 缓存、运行与部署限制

- 单个 Node 服务实例的所有扶摇与 LLM 网络请求共用并发上限 3；同实例一次只接受一个筛选任务，重复请求返回 429，避免排队失控。多 Vercel 实例之间不共享此限流器。
- 进程内成功响应缓存：成分股 1 小时，估值 5 分钟，财务 6 小时，日线 15 分钟；相同请求合并。失败请求不缓存。缓存不保证跨冷启动、部署或多实例持久化；每项保留原获取时间。无后台刷新。
- 扶摇单次请求超时 18 秒，AI 45 秒；筛选 Route 最大运行时间配置为 300 秒，实际仍受 Vercel 套餐限制。上游持续超时可能导致整次请求超时，应稍后重试。
- 无账户、回测、监控、全市场筛选或两股对比。公开部署前，应按实际配额配置平台访问保护/访问限流；当前是本地与受控演示 MVP，API 路由没有身份认证。
- 外部数据的真实性、及时性由上游提供；页面显示数据时点，不承诺实时更新。

Vercel 使用包含本 README 和 `package.json` 的 **zhixuan 正式根目录**作为 Root Directory（如果仓库根就是 zhixuan，则保持根目录；若上层仓库含 zhixuan 则选择 `zhixuan`），框架选择 Next.js，构建命令 `npm run build`，在 Vercel Environment Variables 中单独配置上述 4 项服务端变量。不要上传 `.env.local`。项目未自动部署到 Vercel。

## 验证

```powershell
npm test
npm run test:api
npm run test:llm
npm run test:live
npm run build
```

单元测试使用标明的人工构造数据，覆盖正常筛选、边界、PE 冲突、负波动率、财务缺失、来源不完整、K 线不足/坏值/乱序/重复日期、API 失败、并发上限、LLM 非法 JSON 和模糊意图的默认假设。`test:api` 改编自 preparation 中原始测试脚本，修正了增长率字段。`test:llm` 进行一次真实模型调用；`test:live` 验证实际 20 只股票筛选、波动率复算及明确/模糊输入的真实模型解析，会消耗 API 额度。

实际执行记录见 [AI_USAGE.md](AI_USAGE.md)。

额外浏览器验证脚本：`node scripts/check-browser.mjs`，需要先用独立临时 profile 启动本机 Chromium / Chrome 的 `--remote-debugging-port=9229`。脚本通过原生 DevTools 协议检查编辑冲突、真实筛选、解释、保存/刷新/载入、真实 AI 解析及 390px 响应式布局，无需额外浏览器依赖。它会调用真实服务；仅在独立测试浏览器中执行。可选 `SCREENSHOT_DIR` 指定截图目录。

浏览器脚本还验证预览计数、退出名单、原结果不被覆盖、无效输入/恢复原条件以及编辑阈值期间零额外 API 请求。可选 `BROWSER_BASE_URL` 指定本地生产服务或上述线上地址，默认 `http://127.0.0.1:3000`。快照预览单元测试另覆盖净数量不变但成员替换、数据不足和不重算底层价格。

开发参考：[Next.js 安装文档](https://nextjs.org/docs/app/getting-started/installation)、[DeepSeek Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。
