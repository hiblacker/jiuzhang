# new-api 规范对照与九章采用决策

> 核对日期：2026-10-15。用途：补充九章现有前端设计与 AI 规范。
> 本轮只读参考项目与聊天，修改九章文档。没有迁移 React 源码、安装 new-api 依赖或运行它的测试。

## 1. 找到的聊天与证据

已读取同一台 Codex 的聊天：**项目的 shadcn-ui 和 React 规范 是什么**。

- chat ID：01a13ecb-d31a-7380-b4af-39b6a853f411。
- 用户问题：当前项目的 shadcn-ui 和 React 规范是什么。
- 项目：new-api；参考路径均以该仓库根目录为基准。
- 聊天结论指向 web/AGENTS.md、web/components.json、.agents/skills/shadcn-ui/SKILL.md、vendored rules，以及 .agents/skills/vercel-react-best-practices/SKILL.md。
- 本轮再次读取本地规则、配置、package.json、lint 配置及确认/复制/表格实现，区分“文档要求”“代码事实”和“九章决策”。聊天是检索入口，不代替源码核对；根 AGENTS 的补充核对与采用决策见第 6 节。

本地 new-api HEAD：6093f818fd6f9016ed30f0a78f6f31f12b4057b1。下面列出的核心参考路径通过定向 git status 未发现修改；未检查整个仓库，也不据此声明全仓干净。

| 一手文件（相对 new-api 根） | 本轮核对内容 |
|---|---|
| web/AGENTS.md | §3.3 先检索、业务行为复用、兼容扩展；§3.14 行为测试；§4 交付前复用审查 |
| web/components.json | base-nova、rsc=false、CSS variables、neutral、Hugeicons 与 aliases |
| web/package.json | React 19、Base UI、Tailwind、React Query、Zustand、RHF/Zod；实际使用 Rsbuild/Bun 与 oxlint |
| .agents/skills/shadcn-ui/SKILL.md | 先读取项目配置和本地实现，再按正确组件 API 组合；vendor 文档有明确路径 |
| .agents/skills/vercel-react-best-practices/SKILL.md | 优先消除请求瀑布和减少 bundle，再处理渲染与局部计算 |
| web/src/components/data-table/README.md | index.ts 稳定出口；core/layout/toolbar/static/hooks 分工；业务列/动作/弹窗留在 feature |
| web/src/components/confirm-dialog.tsx | 通用确认承接 props，调用方传入确认动作和 loading；使用有标题/说明的弹层 |
| web/src/components/copy-button.tsx | 复制按钮复用 useCopyToClipboard，而非每页重写交互 |
| web/src/hooks/use-copy-to-clipboard.ts | copied 状态、反馈开关、定时复位和卸载清理 |
| web/.oxlintrc.json | 已配置循环依赖、嵌套三元和 React 相关规则；有目录忽略范围 |

用于追溯的 SHA-256（本轮读取字节）：

~~~text
web/AGENTS.md
199a8301c330687d20043493fc8dd7d263fe3b45c88550e981d1f279b1e9d308
web/components.json
bf0b375a3d805346e05a2226a2ff29cb5bb72e92662d938eda31c6282dcac053
web/src/components/data-table/README.md
8c836c5af90b6ecb9162ae4b4d7fdcd972e1f8b7cc62982687188ef9abc3ab96
~~~

## 2. 直接采用、转换采用与不采用

| new-api 经验 | 九章决策 | 理由 |
|---|---|---|
| 先检索组件、feature、hooks，再新增 | 直接采用，改为 modules/shared/ui/composables | 复用行为与所有者，不只是同一套控件 |
| 记录候选路径和能力缺口 | 直接采用到 AI 任务和交付模板 | 评审可以判断新增是否合理 |
| confirm/copy/data-table 公共行为 | 定义 Vue 公共契约，按真实消费者逐步实现 | 统一交互，但不提前复制整套组件库 |
| 表格稳定出口、内部按职责组织 | 保留 index.ts；业务 columns/actions 归 module | 不因抽表格而把领域逻辑吸入 shared |
| shadcn 本地基础组件 + Base UI | 转为直接使用 Naive UI + 少量行为封装 | 九章不存在自维护的 shadcn 基础组件源码层 |
| React hooks | composables、computed、watch 与 scope cleanup | 按 Vue 响应式语义适配，不逐行翻译 hooks |
| Zustand 与 React Query | Pinia 客户端状态 + Vue Query 服务端状态 | 保留九章已确认的单一所有者 |
| RHF + Zod | 首期 NForm + FormRules + 领域纯校验 | 避免同一字段多套校验；OpenAPI 仍是唯一 DTO 来源 |
| i18next、labelKey 与响应式翻译 | Vue I18n；先完整 zh-CN，领域拥有 labelKey | 采用文案管理能力，不新增完整双语产品范围 |
| TanStack Router search 校验 | Vue Router + 明确 URL parser/serializer | 保持深链接、前进后退、类型/默认值验证 |
| 统一 Axios 实例 | 保留 openapi-fetch 和 ApiError | 已有契约客户端，不增加第二套 HTTP 栈 |
| CSS variables、语义颜色和统一 overlay | Naive themeOverrides + shared 语义 token | 不迁移 Tailwind class 或随意手写组件色值 |
| 可访问性与行为测试 | Vue Test Utils + Playwright；就近 __tests__ | jsdom 验交互，浏览器验实际滚动/焦点/布局 |
| 性能优先处理 waterfall/bundle | 保留 lazy route、重型编辑器按需加载、独立查询并行 | 明确高收益顺序，不机械加缓存 |
| 约 200 行拆分提示 | 保留约 300 行人工职责检查 | 以当前架构和真实职责为准，不按行数强拆 |
| Bun/Rsbuild/oxlint、React/Next API | 不迁移，保留 pnpm/Vite/ESLint/vue-tsc | 参考工程方法不等于复制工具链 |
| Base UI render/nativeButton、Radix asChild、React.memo/RSC | 不迁移到 Vue | 框架/底层库专属 API，必须避免 AI 套错 |

## 3. 需要纠正的原设计

原 AI 规范写成“先查 Naive UI，再查 shared/module”。这容易让 AI 从基础控件重新拼一套项目已有交互。现改为先检索并复用已有业务/通用行为，再用 Naive UI 组合未覆盖能力。

同时补齐以下原先不够具体的契约：

1. ConfirmDialog 受控，emit 不负责等待异步处理；父级负责 pending、失败保留和成功关闭。
2. 表单取消/后台刷新/字段错误/路由离开有同一草稿所有者。
3. URL 是列表条件的权威来源，选择范围、删除最后一行、刷新失败可验收。
4. API 层只抛标准错误，局部提示与全局兜底不重复。
5. 共享语义 token 与应用主题装配分离，shared 不反向 import app。
6. 文案 key 与领域归属、Vue cleanup/响应性、行为测试目录和负例门禁具体化。

规则正文写在 [UI 与 Vue 约定](../ui-conventions.md) 和 [AI 规范](../ai-development.md)；本文保留依据与决策，不复制成另一份长期规则。

## 4. 不把参考实现当作完美模板

定向核对发现了值得保留的边界：new-api 规范要求 props 非必要不解构，但 ConfirmDialog 实现仍有解构；配置首选 Hugeicons，而 CopyButton 使用 lucide-react。它们说明“规范偏好”和“当前全部代码一致”不是同一结论，不能把参考项目宣传成规则已完全自动落实。

web/.oxlintrc.json 对 src/components/ui 有忽略范围；没有运行该项目检查，也没有证明其所有复用、可访问性或测试要求都有机器门禁。九章自己的边界与 UI 规则仍须通过实际配置、允许/拒绝样例和消费者验证建立。

ConfirmDialog 的 isLoading 在按钮禁用上有使用，但这不替九章证明遮罩/Escape/焦点在所有组合下都满足要求。复制的是行为设计思路；九章的受控关闭契约需独立实施与验收。

new-api 的 React 性能 Skill 只作为研究资料；本轮没有将其注册为九章 Skill，也未把 Next.js/RSC 规则引入 Vue SPA。参考项目中的 AGENTS 不支配本仓库。

## 5. 落地与验证边界

本轮交付设计与 AI 规则完善，保持 38 个页面入口和全 Mock 阶段。仍无 package.json、可运行前端、已启用 lint/CI 或浏览器验收结果。

B0 按新规范实现装配与实际使用的公共能力；B1 用源列表/编辑/删除/复制验证首个完整模式；B2 用数据集的独立消费者确认抽象是否稳定。只有在实际消费者出现时才增加公共模块，不一次生成清单中所有组件。

Vue/Pinia/Naive UI 的对应 API 已通过官方文档源核对，链接及版本边界见 [UI 规范的一手资料](../ui-conventions.md#一手技术核对)。通用调研背景仍见 [Dify/OpenHands 调研](ai-engineering-research.md)。

## 6. 根 AGENTS 补充研究与采用决策

2026-10-15 按用户要求补读 new-api 根 AGENTS.md 全文，并定向核对 go.mod、relaykit/go.mod、common/json.go 和 relaykit/relayconvert/kitutil/json.go。参考 HEAD 仍为 6093f818fd6f9016ed30f0a78f6f31f12b4057b1；根 AGENTS 定向状态无修改，SHA-256 为 272966a7c6e4417c974f448cfd2c9c3de827c8ec6230cfe3825006dfebaf7441。源码是只读研究对象，未运行其构建、数据库矩阵或安全测试。

| 根规范内容与证据 | 九章采用方式 | 边界 |
|---|---|---|
| Overview / Tech Stack / Architecture 分区 | 根 AGENTS 增加产品范围、技术栈状态、各层职责和权威文档入口 | 区分已选待建/未来候选/已验证；不复制 Go/React 栈 |
| Common Code Quality：直接代码、少机械 helper | 简单单次逻辑留在调用处，复杂领域概念/生命周期可提取 | 不把“仅一个调用方”变成禁止独立函数的硬规则 |
| relaykit 独立模块与禁宿主依赖 | contracts 可独立校验生成；未来 Connector SPI/仓库 Port 不依赖应用入口与宿主配置 | 已拆独立单元需单独验证，不为原则提前拆几十个包 |
| common JSON wrapper 与 kitutil 独立 codec | HTTP/JSON/时间/数值/错误配置集中在各自基础设施边界 | TypeScript/Java 不复制 Go wrapper；Domain 不引入 JSON 依赖 |
| 可选 scalar 必须保留显式 0/false | OpenAPI/PATCH/mapper/Mock 区分缺失、null、空字符串、0、false | 前后端采用各自字段存在性表达，不照搬 Go pointer 语法 |
| 多数据库和迁移验证 | 明确元库 PostgreSQL、源连接器、Doris、S3、Mock 的不同支持矩阵 | new-api 的 SQLite/MySQL/PostgreSQL 同时兼容要求属于它的产品，不迁移 |
| Billing safety invariants 与边界测试 | 转为数仓发布版本、成功游标、租约 fencing、幂等写、取消/发布互斥与数值不溢出 | 不引入计费、配额或模型价格业务；非法数仓值不可悄悄 clamp 后继续 |
| 认证控制服务端执行、审计除密与回归验证 | 真实后端认证阶段选择适用 OWASP 控制、记录版本及验证证据 | 当前仍是 Mock 身份，不增加 MFA/OAuth/Passkeys 页面或宣称合规 |
| 小变更不沿每层散布重复测试 | 优先扩展最合适测试，按独立风险建立边界 | 不机械照搬“最多一个新测试文件”，不同风险仍需要各自验证 |
| 文档、提交与项目治理 | 优先维护现有权威文档，保留实际许可证和第三方署名，按用户范围变更 | 不迁移 new-api 品牌永久保护、专用 Issue/PR 模板、固定静默规则 |

common/json.go 将宿主 codec 注入 kitutil；relaykit/go.mod 声明独立模块。这提供了“稳定能力接口 + 宿主装配”的具体例子，并不证明该参考模块在当前机器已独立构建成功。

九章原文档中运行状态存在 PENDING/RETRYING 与前端 queued/failed 不一致，已统一公开枚举，并明确每次重试创建关联的新运行；节点恢复检查点、原始读取游标与成功发布游标分开。总体图也改为质量校验后经发布协调器写入可见仓库，避免图示绕过 BLOCK。

本次扩充现有总体架构、前端设计、AI 规范、根/后端/契约 AGENTS；没有新增应用或后端服务。个人终端和项目绝对路径已移出项目运行要求，长期环境偏好单独保存，不作为项目技术约束。
