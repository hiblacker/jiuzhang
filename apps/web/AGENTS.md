# 前端代码规则

继承根 AGENTS.md。详细设计见 ../../docs/frontend-design.md，页面验收见 ../../docs/frontend-page-map.md。

## 技术与职责

- Vue 3 Composition API、script setup lang="ts"、TypeScript strict、Pinia、Naive UI、Vue Router、Vite。
- Vue Query 管理服务器状态（当前来自 MSW）；Pinia 管理主题/导航/演示会话/跨页未提交草稿，不复制 Query 缓存。
- 单组件状态使用 ref/reactive；需要可分享的筛选/分页/排序放 URL。
- 页面负责装配与协调，业务组件归 modules/<domain>/components，通用展示放 shared/ui。
- 纯函数不依赖 Vue；composable 管理生命周期；repository 负责 HTTP 和 DTO 映射，不弹消息、不导航。

## 依赖方向

app -> pages -> modules -> shared；mocks 为独立开发适配层，只有 main.ts 的启动入口可动态导入 mocks/browser。

- pages 之间不互相导入；shared 不导入 app/pages/modules/mocks。
- modules/<a> 不导入 modules/<b> 内部文件；跨域在 pages 协调，必要公开依赖需文档说明、无环并用静态检查白名单表达。
- 模块外消费者只导入 index.ts，内部可相对引用，禁止全项目大 barrel。唯一轻量入口例外是 app/i18n.ts 按需导入 modules/<domain>/locales/index.ts；该入口只导出词典，不导入组件、业务入口或编辑器。
- HTTP 传输仅在 shared/api/client；业务端点请求仅在 modules/<domain>/api；组件不直接 fetch/axios。
- OpenAPI 是唯一 DTO 来源；可有 ViewModel，但要有命名明确的 mapper，不另写 DTO 镜像。
- 本目录由 pnpm 独立构建；后端 apps/api、apps/worker、根 modules 由未来 Maven 管理。禁止从前端 src/modules 导入 Java 源码/配置，开发前端无需后端环境。
- PATCH 保留显式 false/0，缺失/null/空字符串分别处理；大整数/Decimal 不隐式 Number 化，运行枚举和幂等语义沿用契约与总体架构。

## UI 与 Mock

- 新增/修改 UI 先检索 modules、shared/ui、shared/composables 的同类行为，读取候选 API 和调用方；先复用已有交互，再组合 Naive UI；新增须说明缺口。
- Naive UI 基础组件直接使用；确认/复制/列表状态已有公共行为所有者时必须复用。不得把所有基础控件空包装。
- UI 契约与建设清单见 ../../docs/ui-conventions.md；其中待建组件不等于已有组件，始终以实际文件为准。
- 列表覆盖加载/空/失败/成功；提交覆盖校验/loading/错误恢复/缓存刷新，错误只由一个展示所有者消费。
- NForm + FormRules 对接领域纯校验；Vue I18n 首期只有 zh-CN，labelKey 在展示层翻译。主题 token 在 shared/theme，app 负责装配。
- Pinia state/getter 解构用 storeToRefs；响应式 ID、watch 清理与资源销毁按 Vue 语义处理。
- 单元/组件测试就近 __tests__；跨模块集成/E2E 放 tests。修改用户行为要验证失败、取消和受影响消费者。
- 表单编辑草稿与 Query 缓存对象分离，取消不污染原始数据。
- 业务数据仅驻留 Mock DB；页面/repository 不写 Mock 分支。
- await worker.start() 再 mount，未匹配 /api/v1 请求显式报错，不穿透真实服务。
- 超过约 300 行为人工检查提示，不是硬拆分指标。
- 新增页面同步路由清单与验收矩阵；Mock 写入须经 HTTP，刷新可读，重置可复现。
- 修改共享组件验证消费者；未执行的检查不得报告通过。
- 当前阶段按用户确认只验收桌面端，浏览器默认 1440×1000；后续不新增或重跑小屏幕/窄屏/移动端专项，也不把它们作为本阶段交付门禁。历史响应布局和验证记录保留；组合回归须先检查所选用例是否主动切换到小屏幕，避免通过整文件或全量命令再次运行。桌面端仍覆盖主要交互、长数据、明暗主题和焦点。
