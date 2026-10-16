# AI 编程项目的架构约束调研

> 调研日期：2026-10-15（Asia/Shanghai）。对象：Dify、OpenHands，以及相关官方工程文档。
> 同日补充：已找到用户指定的 new-api 聊天并核对前端与根目录规范，详见 [new-api 采用决策](new-api-adaptation.md)。
> 目的：为九章 Vue 前端与未来后端建立抽离、复用、组件化和 AI 开发规则。

## 1. 结论

值得借鉴的是“明确所有者 + 单向依赖 + 契约生成 + 状态归属 + 自动检查 + 用户行为验收”。单独一份“请保持代码优雅”的提示词不能约束架构。

Dify 与 OpenHands 是 AI 产品/开源项目，它们的公开 agent 规则说明项目如何指导 AI 贡献者；不能据此推断所有代码均由 AI 生成，也不能声称规则已经杜绝所有违规。

其 React/Next/Jotai 等具体实现不照搬到九章。借鉴的是职责与契约，落实为 Vue/Pinia/Vue Query/Naive UI 架构。

## 2. 检索与证据边界

已尝试内置网页检索，但未返回可引用的页面正文。因此通过 Python urllib 实际获取官方页面与 GitHub 原始文件；通过 git ls-remote 获取 main 的 commit，然后再次读取固定 commit 的核心 AGENTS 文件。

本次只读研究外部项目，没有安装/运行它们，没有复制业务源码。临时原文缓存为 /tmp/jiuzhang-frontend-research，可能随系统清理消失；以下固定 commit 链接是长期核对依据。

仅采用已读到的规则，未将 README 的宣传当性能保证。OpenHands 的 frontend/AGENTS.md 在该快照不存在；当前规则来自根 AGENTS.md 与 .agents/skills 引用，而非沿用旧目录印象。

## 3. Dify：目录规则、组件所有者与生成契约

固定快照：ab7677632d305e759bcb4ff857b99c9cf173a09b。

| 已核对事实 | 原始位置 | 九章采用方式 |
|---|---|---|
| 根规则要求按改动范围读取 scoped AGENTS | 根 AGENTS.md [R2] | 根规则 + web/api/contracts 三个目录规则 |
| 前端新请求使用生成的 consoleQuery/consoleClient，不手写 DTO 镜像 | web/AGENTS.md [R3] | OpenAPI -> generated types -> 类型 HTTP client |
| 组件按产品流程和行为所有者组织；稳定契约被多个纵向模块使用再提升共享 | component ownership 文档 [R5] | module 内聚，按实际共享契约提取，不先建大 shared |
| 不按缩短文件长度盲目抽取；包装必须拥有行为/状态/验证等价值 | component ownership 文档 [R5] | Naive 基础组件直接用；只抽语义组件 |
| server/cache 状态与本地草稿、URL 状态分开 | state 文档 [R6] | Vue Query / Pinia / URL / ref 明确分工 |
| controllers 处理传输，services 编排，domain 拥有策略；库保持无业务性 | api/AGENTS.md [R4] | 后端 Controller/Application/Domain/Infrastructure |
| 有 ast-grep 与 lint 针对新模型继承的规则 | api/AGENTS.md [R4] | 规则要有可执行门禁与反例，不能只写 Markdown |

Dify 禁止在真实业务表面以临时 Mock state 替代未确认接口。九章当前“全部 Mock”是用户明确阶段要求，因此不照搬该禁令；采用网络级 Mock 保持业务层仍按稳定接口工作。

## 4. OpenHands：仓库所有权、类型客户端与状态单写入口

固定快照：5958302c1c5dbdc441cbb7d85dc650ffc4d606bd。

| 已核对事实 | 原始位置 | 九章采用方式 |
|---|---|---|
| 规定 Canvas、Agent Server SDK、extensions、automation 分别拥有什么 | 根 AGENTS.md [R8] | web/api/contracts 职责清晰；首期同仓库即可，无需复制多仓结构 |
| 正常依赖为服务端契约 -> TypeScript 客户端 -> Canvas | 根 AGENTS.md [R8] | 契约单向生成，前端不重建后端 endpoint/DTO |
| durable state 有命名所有者和明显 writer；修改共享适配器需列消费者 | 根 AGENTS.md [R8] | 状态单一来源，公共组件改动列受影响页面 |
| 按任务加载专用技能，不把详细规则不断复制回根文件 | 根 AGENTS.md [R8] | 精简 AGENTS + 单一详细规范文档 |
| 测试 Mock 底层 service 而非消费它的 hook | 根 AGENTS.md [R8] | MSW 模拟网络；组件/composable 保持真实路径 |
| 存在受控客户端调用与局部明确例外 | frontend-api-contracts guide [R9] | 统一 client，最小例外白名单，禁止到处直接 fetch |
| 前端指南提醒不要声称超出实际 lint 配置的强制范围 | frontend-development guide [R10] | 逐项说明已启用/待实施门禁，检查器有负例验证 |

这不意味着 OpenHands 是 Vue 架构模板。九章仍坚持用户选择的 Vue/Pinia/Naive UI；不引入项目不需要的多后端兼容层、React provider 或云运行时。

## 5. 官方机制与工具事实

### AGENTS 的作用范围

OpenAI 官方文档描述 Codex 的全局及项目目录指令发现、近层文件的覆盖/组合关系，以及默认指令大小限制。它是指导机制，不是包依赖沙箱。[R1]

九章的做法：根入口主动要求读取改动目标的 scoped AGENTS；详细规范只维护一次；机械边界由 CI 执行，避免依赖工具是否自动载入某目录指令。

### 类型与数据

Vue 官方指出 Vite 开发/构建转译不执行完整类型检查，SFC 应独立运行 vue-tsc。[T1]

TanStack Vue Query 以远端/异步 server state 的获取、缓存和同步为主要职责；因此九章保留 Pinia 管客户端状态，加 Vue Query 管接口数据，避免两份权威缓存。[T3]

OpenAPI TypeScript 可从 OpenAPI 3.0/3.1 生成 TypeScript 类型；这些类型是编译期结构，不自动验证收到的 JSON。[T5]

### Mock 与执行

MSW 使用网络级拦截，浏览器 handlers 可以与测试复用；其文档明确应 await worker.start() 再渲染，且 HTTP localhost 是 Service Worker 开发例外。[T4]

因此九章应用照常发 HTTP；Mock fixture/DB 不进入页面和 repository。未处理 API 不能悄悄放行到真实网络。静态 demo 与 real build 分开，后者还要排除 public 中的 worker 文件。

### 边界工具

ESLint no-restricted-imports 可约束指定 import 路径/模式，但不是完整包级沙箱；解析后的 alias/相对路径、循环、barrel 应由依赖图检查补充。[T7][T8]

dependency-cruiser 文档给出 forbidden/from/to/path/circular 等规则与分组路径引用，可表达业务模块边界。实际 .vue 和动态 import 覆盖要用已安装版本做合法/非法夹具验证，不在尚未配置时声称已全面支持。[T8]

## 6. 对九章的最终决策

1. 根 AGENTS 与目标目录规则分层，只包含项目可共享的要求；个人环境偏好保留在用户长期记忆。
2. 按业务 module 组织，page 装配，shared 无业务；不为了“组件化”把每个函数独立成文件。
3. OpenAPI 唯一传输契约，DTO 自动生成，前后端独立运行时。
4. Query、Pinia、URL、局部状态、Mock DB 各有归属。
5. 复用看稳定契约与真实消费者，不看文件数；普通 Naive 组件不二次空包装。
6. Mock 从 HTTP 边界进入；状态修改跨页面一致；场景可复现。
7. 机器检查覆盖能自动检测的规则；行为/职责的判断保留评审与浏览器验收。
8. 第一阶段仅 web + contracts，后端目录只有规则；不引入微服务或独立 UI 包。

对应设计与检查方案分别见 [前端设计](../frontend-design.md) 和 [AI 规范](../ai-development.md)。new-api 补充了先复用行为、稳定组件出口、字段/错误/焦点契约与消费者测试，落实为 [UI 与 Vue 约定](../ui-conventions.md)；不迁移其 React、shadcn、Bun 或 Rsbuild。

## 7. 一手来源目录

- [R1] [OpenAI：Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)，读取于 2026-10-15。
- [R2] [Dify 根 AGENTS](https://github.com/langgenius/dify/blob/ab7677632d305e759bcb4ff857b99c9cf173a09b/AGENTS.md)。
- [R3] [Dify 前端 AGENTS](https://github.com/langgenius/dify/blob/ab7677632d305e759bcb4ff857b99c9cf173a09b/web/AGENTS.md)。
- [R4] [Dify 后端 AGENTS](https://github.com/langgenius/dify/blob/ab7677632d305e759bcb4ff857b99c9cf173a09b/api/AGENTS.md)。
- [R5] [Dify 组件职责](https://github.com/langgenius/dify/blob/ab7677632d305e759bcb4ff857b99c9cf173a09b/.agents/skills/how-to-write-component/references/ownership.md)。
- [R6] [Dify 状态归属](https://github.com/langgenius/dify/blob/ab7677632d305e759bcb4ff857b99c9cf173a09b/.agents/skills/how-to-write-component/references/state.md)。
- [R7] [Dify 数据契约](https://github.com/langgenius/dify/blob/ab7677632d305e759bcb4ff857b99c9cf173a09b/.agents/skills/how-to-write-component/references/data.md)。
- [R8] [OpenHands 根 AGENTS](https://github.com/OpenHands/OpenHands/blob/5958302c1c5dbdc441cbb7d85dc650ffc4d606bd/AGENTS.md)。
- [R9] [OpenHands 前端 API 契约](https://github.com/OpenHands/OpenHands/blob/5958302c1c5dbdc441cbb7d85dc650ffc4d606bd/.agents/skills/frontend-api-contracts/references/guide.md)。
- [R10] [OpenHands 前端开发指南](https://github.com/OpenHands/OpenHands/blob/5958302c1c5dbdc441cbb7d85dc650ffc4d606bd/.agents/skills/frontend-development/references/guide.md)。
- [T1] [Vue TypeScript 官方指南](https://vuejs.org/guide/typescript/overview.html)。
- [T2] [Naive UI 官方仓库](https://github.com/tusen-ai/naive-ui)。
- [T3] [TanStack Vue Query 概览](https://tanstack.com/query/latest/docs/framework/vue/overview)；[Pinia 官方介绍](https://pinia.vuejs.org/introduction.html)。
- [T4] [MSW 浏览器集成](https://mswjs.io/docs/integrations/browser)；[MSW 官方仓库](https://github.com/mswjs/msw)。
- [T5] [OpenAPI TypeScript 官方介绍](https://openapi-ts.dev/introduction)。
- [T6] [Vite 官方入门](https://vite.dev/guide/)。
- [T7] [ESLint no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports)。
- [T8] [dependency-cruiser 规则文档](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)。

项目固定 commit 的文件已实际读取，网址主干上的工具文档可能继续变化。并未以项目星数或未经核实的“最佳实践”作为选型依据。
