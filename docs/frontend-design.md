# 九章前端先行方案

> 2026-10-15 · 设计基线与实施约定；应用已建立，交互验收持续中。
> 用户确定：Vue 3 + TypeScript + Pinia + Naive UI；业务数据全部 Mock；无后端服务。
> 配套：[页面矩阵](frontend-page-map.md) · [UI 与 Vue 约定](ui-conventions.md) · [AI 开发规范](ai-development.md) · [调研依据](research/ai-engineering-research.md) · [总体数仓方案](architecture.md)。
> 2026-10-15 补充：[new-api 聊天与本地规范对照](research/new-api-adaptation.md)，采用组件行为复用、主题与测试方法，保持既定 Vue 技术栈。

## 1. 本阶段交付范围

先交付一个可以独立运行、体验完整业务流程的数仓管理端。业务后端、数据库、Doris、MinIO、Quartz 均不需要启动。

前端完成数据源接入、数据集建模、任务运行、仓库管理、查询服务、治理与系统管理的页面及主要操作。模拟数据贯穿各页面，创建数据源后能在数据集编辑器选择，数据集发布后出现在任务及仓库视图。

三层产品导航仍是数据源、数据集、仓库；任务中心、数据治理、数据服务、系统管理是配套能力，不另造业务层。ODS/DWD/DWS/ADS 是仓库内部逻辑分类，不是四个独立前端系统。

**演示边界**：连接测试不触达数据库；SQL 编辑器只演示约定查询；数据预览不证明 SQL 正确；任务进度是模拟；Cron 支持配置、下次时间预览与浏览器前台演示派发；页面关闭后不会执行定时任务；脱敏演示不构成真实数据安全；权限切换只演示 UI。

当前仓库已有 apps/web、packages/contracts、锁文件与本地检查命令；实际启动说明见根 README.md，实施状态见页面矩阵。

## 2. 技术选型

| 职责 | 决策 | 边界和理由 |
|---|---|---|
| 框架 | Vue 3 + Composition API + script setup | SFC 统一风格，页面与业务组件都使用 TypeScript |
| 类型 | TypeScript strict + vue-tsc | 开发服务器转译和类型检查分开；必须独立 typecheck [T1] |
| 构建 | Vite | SPA 即可；此管理端首期没有 SSR/SEO 需求 |
| 路由 | Vue Router | 懒加载、嵌套路由、详情 tab、路由元信息、草稿离开提示 |
| 客户端状态 | Pinia | 主题、侧栏、演示会话、需要跨页的编辑草稿 |
| 接口状态 | @tanstack/vue-query | 列表/详情缓存、请求去重、错误/加载状态、mutation 后刷新 [T3] |
| 组件库 | Naive UI | NDataTable、NForm、NTree、NDrawer、NModal、NTabs、NLayout；统一 themeOverrides [T2] |
| 表单校验 | NForm + FormRules + 领域纯函数 | 表单草稿与 DTO 分离；首期不再叠加其他表单库或一份重复 Zod 字段规则 |
| 文案 | Vue I18n，首期仅 zh-CN | 领域拥有 labelKey，渲染时翻译；Naive locale 同步，不额外承诺双语页面 |
| 接口契约 | OpenAPI 3.1 + openapi-typescript | 唯一传输结构；跨语言协作不共享 Java/Python 源码 [T5] |
| HTTP | openapi-fetch | 消费生成的路径与请求响应类型；第一版不再引入另一套 Axios 客户端 |
| Mock | MSW 浏览器模式 | 拦截 HTTP，不污染组件/repository，测试复用 handlers [T4] |
| Mock 持久化 | IndexedDB + idb | 当前演示数据持久化；localStorage 只存轻量偏好与少量草稿 |
| 图与血缘 | Vue Flow | 数据集节点编辑和血缘展示使用不同业务适配器，复用画布集成 |
| 代码编辑 | CodeMirror 6 | SQL/JSON 编辑；语法高亮不等于真实执行或后端语义校验 |
| 图表 | ECharts | 概览与统计，按页懒加载；所有性能数字标记演示数据 |
| 图标 | lucide-vue-next 图标 | 风格一致，显式按需导入 |
| 样式 | CSS variables + scoped CSS + Naive 主题 | 暂不同时引入 Tailwind/UnoCSS，避免重复样式体系 |
| 测试 | Vitest + Vue Test Utils + Playwright | 逻辑/组件/用户流程分层测试 |
| 规范 | ESLint flat config + typescript-eslint + eslint-plugin-vue + Prettier | 静态质量和一致格式 |
| 边界检查 | TypeScript/Vue AST 边界检查 + 定向 ESLint 规则 | 验证解析后的依赖、循环与受限 import，而非只靠口头规则 |
| 包管理 | pnpm workspace | 首期只建立 web 和 contracts；不提前拆 UI 包或引入 Nx/Turborepo |

技术版本采用“验证兼容后精确锁定”，不用未固定的 latest 作为持续开发基线。B0 按选定 Vite 版本的官方要求选择受支持 Node 版本，验证 peerDependencies、安装、vue-tsc、build 与浏览器后，将 Node engines、packageManager 精确版本和依赖锁文件提交；不以开发者当前安装的版本代替项目兼容性决策。

## 3. 总体前端架构

~~~mermaid
flowchart TD
  U[页面与 Naive UI] --> C[领域 composables / Query / mutations]
  C --> R[模块 repository / DTO mapper]
  R --> H[统一类型 HTTP client]
  H --> M[开发模式：MSW 拦截]
  M --> DB[Mock handlers + IndexedDB]
  H -. 未来 real 模式 .-> API[真实业务 API]
  O[OpenAPI 契约] --> G[生成 paths / DTO 类型]
  G --> H
  G --> M
  P[Pinia：客户端状态] --> U
  URL[路由：可分享的筛选和身份] --> U
~~~

业务链路统一为：页面 -> 领域 composable -> repository -> HTTP -> MSW/真实 API。页面不能知道返回值来自 Mock 还是后端。

Pinia 不保存另一份 dataSources/datasets/tasks 列表。API 数据只有 Query cache 一个前端权威副本；浏览器里的 Mock DB 扮演暂时的“服务端”，不能被 Pinia/页面直接读取。

## 4. 目录与依赖

### 4.1 当前前端目录

下图展开前端与契约，API/Worker 和后端库是后续预留；完整全栈布局见本节后续说明。

~~~text
jiuzhang/
  AGENTS.md
  package.json                   # B0 创建，统一 scripts/packageManager
  pnpm-workspace.yaml             # B0 创建
  pnpm-lock.yaml                  # 实际安装生成，不手写
  .node-version                  # B0 验证后锁定，与 engines/CI 一致
  apps/
    web/
      AGENTS.md
      package.json
      vite.config.ts
      eslint.config.js
      tsconfig*.json
      public/mockServiceWorker.js # MSW CLI 生成
      src/
        main.ts                  # 唯一 Mock 启动入口
        app/
          App.vue
          layouts/WorkspaceLayout.vue
          providers/             # Naive/Query/Pinia providers
          router/                # 路由表、守卫、菜单元信息
          stores/preferences.ts
          theme/                 # 将 shared token 装配为 themeOverrides/CSS variables
          i18n/                  # 公共/领域词典装配与 locale
        pages/
          overview/
          sources/
          datasets/
          tasks/
          warehouse/
          governance/
          services/
          system/
          auth/
        modules/
          sources/
            api/source-repository.ts
            api/source-mapper.ts
            model/source-query-keys.ts
            composables/use-source-list.ts
            components/SourceConnectionForm.vue
            components/SourceObjectBrowser.vue
            locales/zh-CN.ts       # 领域文案，通过公开出口装配
            __tests__/            # 本域规则/mapper/composable 行为测试
            index.ts
          datasets/
          jobs/                  # schedule/task/run 同一执行领域
          warehouse/
          governance/
          services/
          identity/
        shared/
          api/client.ts
          api/api-error.ts
          ui/page-header/         # 简单组件按需单文件；复杂组件用目录 + index.ts
          ui/async-state/
          ui/confirm-dialog/      # B1 实际消费者出现时建立
          ui/copy-button/
          ui/query-toolbar/
          composables/            # 与领域无关的交互生命周期
          theme/                  # 无业务依赖的语义 token
          i18n/                   # 通用词典及类型
          editors/               # CodeMirror 集成
          graph/                 # Vue Flow 技术集成，不含数仓规则
          lib/datetime/
          lib/download/
          config/
          session/               # 最小只读会话接口/注入 key
        mocks/
          browser.ts
          handlers/              # sources/datasets/jobs/warehouse 等
          db/                    # IndexedDB、版本迁移与原子写入
          fixtures/              # 固定 seed、实体间引用
          scenarios/             # normal/empty/error/slow/forbidden
          ui/MockControls.vue
      tests/integration/         # 跨模块/Mock/契约集成
      tests/e2e/
      tests/support/             # 测试隔离、fixture 及公共 setup
    api/                         # 后端 HTTP 应用；当前仅 AGENTS.md
    worker/                      # 后端执行进程；未来创建
  modules/                       # Java 库；未来创建，非前端 src/modules
    platform/                    # 后端领域先包级隔离，共享给 API/Worker
    connector-spi/
    connector-jdbc/               # 按接入需求创建具体适配器
    connector-http/
    connector-file/
  packages/
    contracts/
      AGENTS.md
      openapi.yaml               # B0/B1 创建
      generated/schema.d.ts      # 生成，不手改
      examples/
  infra/                         # 未来集成环境/迁移/部署
  pom.xml / .mvn/ / mvnw          # 未来 Java 构建；当前不创建
  tools/                         # 实施时创建边界、契约、验收工具
  docs/
~~~

依赖规则：

- app 可以装配 pages、modules 的公开出口和 shared。
- pages 可以组合多个领域，但 pages 不能互相导入。
- modules 默认互不导入；领域组件、composables、api、纯规则相邻存放。
- modules 内部可互相引用；对外只暴露 index.ts。例外跨域依赖要记录 ADR、调用方、无环证明。
- shared 不依赖上层，也不包含 source/dataset/task 等业务流程。
- mocks 仅依赖契约与明确无副作用的 shared 纯工具；生产业务代码不依赖 mocks。main.ts 动态导入 mocks/browser 为唯一启动例外。
- 测试可导入 fixture/handler；这些例外按目录明确配置，不放宽应用规则。
- contracts 不依赖 web 或 api。generated 文件、第三方包和 MSW 生成脚本不受业务行数规则检查。

**跨域示例**：数据集创建页同时组合 sources 公开导出的 SourcePicker 和 datasets 的 DatasetEditor，以稳定 sourceId/objectId 和选择结果交互；DatasetEditor 不深入导入 sources 的 Store、API 或私有表单。

### 4.2 后续后端代码放在哪里

本方案采用全栈同仓库、前后端分别构建。前端目录是完整仓库的一个子应用；后端进入下列预留位置，不需要移动现有 Vue 组件和页面。仓库级目录的权威定义见 [总体架构第 10 节](architecture.md#10-全栈仓库目录)。

| 仓库位置 | 归属与未来内容 | 当前阶段 |
|---|---|---|
| apps/web | Vue 页面、组件、Query、HTTP repository、Mock | B0–B5 实施，不依赖后端进程 |
| apps/api | Spring Boot HTTP 入口、controller/DTO 映射、认证适配、装配 | 当前只有规则，后端阶段建立 |
| apps/worker | 任务领取/心跳、调用处理用例、运行配置 | 后端阶段建立，独立于 API 运行 |
| modules/platform | Java 领域库，按 sources/datasets/jobs/warehouse 等包组织 application/domain/infrastructure | 后端首期一个库，不先拆成一组微服务 |
| modules/connector-* | 独立 SPI 与按需 JDBC/HTTP/file 适配器 | 真实源接入时建立 |
| packages/contracts | OpenAPI、生成 TS 声明、共同示例与校验工具 | 已建立 OpenAPI、生成类型及包内检查 |
| infra | 集成环境、元库迁移与部署配置 | 后端阶段建立，当前前端无需容器 |

必须区别两个 modules：apps/web/src/modules 是前端功能目录；根 modules 是未来 Java 库。前端 source-repository 发 HTTP；后端 SourceRepository 是领域端口/数据库适配，名字相近不代表可共享运行时代码。前后端只共享传输契约、数据字典、错误码与示例。

后端包级结构、API/Worker 入口和迁移执行所有权见总体架构，不在本文件维护第二份 Java 目录树。该规划保持既有根 modules 位置；将多个逻辑领域先放在 platform 单库，是为了在两进程之间复用用例而避免一开始就建立大量 Maven 子工程。

### 4.3 两套构建如何共存

pnpm workspace 第一阶段只选择 apps/web 与 packages/contracts。根 pnpm dev/build/check 只调前端和契约工具；不能安装前端依赖时自动拉起 Java 构建、数据库或 Docker。

后端阶段增加根 pom.xml、Maven Wrapper 及 API/Worker/实际库模块，由 Maven 管 Java 依赖与测试。前端不导入 Maven 模块，后端不依赖 Node 的运行时代码。按目录和契约影响触发 CI；契约变化在后端存在后必须验证两端。

contracts 的 package.json 只是校验和 TS 生成工具入口，协议文件本身语言无关。未来 Java DTO/接口如采用生成器，产物位于 API 构建输出，通过 mapper 进入 application；后端领域模型独立设计，不能将 TS 类型或生成 DTO 当 ORM 实体。

## 5. 状态与组件抽离

| 状态 | 所有者 | 示例 |
|---|---|---|
| 接口资源 | Vue Query | 数据源列表、数据集详情、运行记录 |
| 可分享导航 | URL | 当前详情 ID、tab、关键词、页码、排序 |
| 局部交互 | ref/reactive | 弹窗开关、选择行、当前表单会话 |
| 跨页客户端状态 | Pinia | 明暗主题、菜单收起、草稿、演示用户 |
| 模拟持久资源 | mocks/db | 创建的数据源、任务与仓库表 |
| 派生状态 | computed | 是否可发布、空状态、已选择数量 |

细节要求：

1. Query key 至少包含 domain + workspaceId + 资源标识/完整筛选条件；演示角色/工作区切换清除或隔离缓存。
2. 编辑先建立草稿快照，不直接编辑 Query 返回对象。取消不保存；保存后 invalidate 列表与详情；失败保留草稿。
3. 为共享行为抽 composable，不把整个页面搬到一个 useEverything；纯格式化/转换逻辑用纯函数。
4. Pinia 草稿带 datasetId、schemaVersion、updatedAt，切换资源时不串数据；持久化前明确删除敏感字段。
5. app 拥有全局 provider；下层只使用 shared/session 的最小只读接口或 props，不能反向导入 app stores。
6. 中文界面为首期主语言；Vue I18n 在 B0 装配 zh-CN，公共状态标签、错误文案和枚举 labelKey 由所属域统一维护，展示时翻译。
7. 首先检索并复用已有交互所有者，再用 Naive UI 组合未覆盖能力；统一确认、复制、异步状态不能在每个页面重复实现。

组件分四类：

- **基础组件**：直接使用 NButton/NInput/NSelect 等，不把所有 Naive UI 再包一遍。
- **技术集成**：SqlEditor、JsonEditor、GraphCanvas、图表容器；封装第三方生命周期、resize、销毁和只读状态。
- **业务组件**：SourceConnectionForm、DatasetFieldTable、MaskRuleEditor、ScheduleForm、RunTimeline、WarehouseSchemaPanel；放在所属 module。
- **页面容器**：负责路由参数、页面布局和跨领域协调，不堆连接器详情与任务规则。

组件只用一次但有独立生命周期/提交边界也可以抽；存在重复但语义不同，不强行复用。公共组件避免几十个 boolean props；先定义 props/emits/slots 以及加载、错误、可访问性契约。

具体约定统一维护在 [UI 与 Vue 约定](ui-conventions.md)：公共能力建设清单、受控确认弹窗、NForm 草稿/验证、列表 URL 与选择范围、响应式清理、主题/文案归属和错误提示所有者。组件/领域测试随所有者放 __tests__，跨模块集成与 E2E 放 apps/web/tests。目录树为计划，不代表其中每个组件已经存在。

## 6. 产品信息架构与页面体验

完整路线见页面矩阵，包含 38 个路由入口；创建和编辑复用同一个表单所有者，详情页以 tab 组织子视图。

主导航：工作台 / 数据源 / 数据集 / 任务中心 / 仓库 / 数据治理 / 数据服务 / 系统管理。

- 左栏固定宽度约 224px，可折叠；顶部工作区、面包屑、全局搜索入口、演示状态、主题和用户。
- 主要页面最小支持 1280px 桌面，1920px 不无限拉宽表单；窄屏允许侧栏折叠，编辑器需要明确最小工作区，不承诺首期完整移动端编辑。
- 统一 4/8px 间距体系、边框、圆角、文字层级、状态色；暗色主题从 tokens 切换。
- 列表默认 20 条、可选 50/100；搜索/筛选/排序/分页行为一致。分页选择变化重置页码。
- 大字段列表与日志按需虚拟化；图编辑器、SQL 编辑器和图表分包。
- 删除确认说明影响对象；存在下游依赖默认 409，显示引用清单。
- 表单以 NForm 为校验所有者，完整 label、必填提示、错误定位、键盘操作；不同时引入重复表单状态库。
- 无权限、空数据、接口失败、数据过期与加载状态有区分；toast 只承担结果反馈，不替代页面错误信息。

## 7. Mock 设计

### 7.1 契约先行

先写 OpenAPI，再生成类型、写 MSW handlers 和 repositories。当前接口约定包括：

~~~text
GET/POST        /api/v1/sources
GET/PATCH/DELETE /api/v1/sources/{id}
POST            /api/v1/sources/{id}/test
GET             /api/v1/sources/{id}/objects
GET             /api/v1/sources/{id}/objects/{objectId}/fields
POST            /api/v1/sources/{id}/preview
GET/POST        /api/v1/datasets
GET/PATCH/DELETE /api/v1/datasets/{id}
POST            /api/v1/datasets/{id}/validate
POST            /api/v1/datasets/{id}/preview
POST            /api/v1/datasets/{id}/publish
POST            /api/v1/datasets/{id}/runs
GET/PATCH       /api/v1/tasks/{id}
POST            /api/v1/tasks/{id}/pause
POST            /api/v1/tasks/{id}/resume
POST            /api/v1/tasks/{id}/backfills
GET             /api/v1/runs
GET             /api/v1/runs/{id}
POST            /api/v1/runs/{id}/cancel
POST            /api/v1/runs/{id}/retry
GET             /api/v1/warehouse/tables
GET             /api/v1/warehouse/tables/{id}
POST            /api/v1/queries
GET             /api/v1/queries/{id}
POST            /api/v1/exports
~~~

以上是资源规划而非已存在 API，完整治理/服务/系统接口随对应批次补齐并受统一契约约束。

统一响应：成功为 data + meta，分页 meta 含 page/pageSize/total/requestId；错误使用 HTTP 4xx/5xx 加 error.code/message/details/requestId。不要所有响应 HTTP 200；正常空结果为 200 + 空 items，不是 404。

ID 使用字符串；时间明确 ISO 8601/UTC，中文演示默认 Asia/Shanghai，未来按工作区时区显示。rowCount/byteCount 使用十进制字符串传输，避免大数丢失；字段 null、未提供、0、false、空字符串语义独立。PATCH 的 mapper 按字段是否存在更新，不使用 truthy/falsy 省略有效值。凭证只用固定 dummy 标记。

发布和运行创建等可重试写操作由契约声明幂等键作用域和请求指纹：同一键/同一请求返回同一结果，同一键/不同内容返回冲突；演示 handlers 以事务验证相同行为。运行状态与重试/取消语义统一见 [总体架构](architecture.md#61-运行与尝试)，前端不另写一套枚举。

### 7.2 数据与跨页面一致性

演示主题为虚构零售：客户、商品、订单、退款、营销活动。数据源覆盖 MySQL、PostgreSQL、SQL Server、Oracle、Doris/ClickHouse 类只读连接与 REST API；目录能力仅为演示，不表述为已接入真实驱动。

固定 seed 规划：8 个数据源、15 个数据集、12 个任务、40 次运行、24 张分层仓库表、6 条质量规则、6 条脱敏策略、6 个数据服务、6 个用户/3 个角色。具体数量在实施 fixture 时锁定，并由关联一致性测试核对，不显示与真实实体脱节的统计卡。

数据库结构：sources、sourceObjects、datasets、datasetVersions、tasks、runs、warehouseTables、qualityRules、maskPolicies、services、users、auditEvents。关联 ID 来自同一 seed manifest，避免每页独立编造对象。

GET 实现真实过滤、排序与分页；POST/PATCH/DELETE 修改同一 Mock DB。概要统计由 DB 数据计算。创建/编辑后刷新浏览器可恢复；重置演示数据回到相同 seed。

### 7.3 持久化与场景

- IndexedDB 数据库名/版本统一维护，版本升级有迁移或显式重置提示；失败显示“本地数据不可用”，不能悄悄当成接口成功。
- 初始化 await seedReady，且只在空数据库初始化；同一个事务内执行资源修改与审计写入。
- normal 默认固定约 300ms；slow 固定约 1800ms；empty 返回合法空分页；error 返回约定 500；forbidden 返回 403。
- 场景作用于指定端点/域，不把整个站点随机打坏；测试使用固定 clock/seed，禁止依赖 Math.random 成败。
- Mock 控制面仅在 demo/dev 模式入口注入；生产页面不能 import mocks/db。控制面支持切换场景/角色/清空并重建。
- 仅虚构数据；真实连接串/密码即使在配置表单输入也不持久化，UI 明示不要输入真实凭证。

### 7.4 启动与模式切换

main.ts 的设计伪代码（不是已提交实现）：

~~~ts
async function bootstrap() {
  if (import.meta.env.VITE_API_MODE === 'mock') {
    const { startMocking } = await import('./mocks/browser')
    await startMocking()
  }
  mountApplication()
}
void bootstrap().catch(renderBootstrapFailure)
~~~

startMocking 内先 await DB/seed，再 await worker.start。renderBootstrapFailure 展示独立的启动失败与重试界面，不挂载看似正常的业务页面；void 本身不处理拒绝。MSW 未处理的 /api/v1 请求必须 fail fast；静态资源、Vite HMR 正常放行。[T4]

模式：

- development：mock，开发服务器。
- demo：mock，静态构建，永远显示“演示数据”，可直接预览。
- production/real：无 Mock 初始化、无 fixture 包，不部署 mockServiceWorker.js；构建检查确认没有演示数据落入生产产物。Vite public 目录默认复制，必须显式排除 Mock worker，不能只写 if 分支。

从 demo 切 real 要停止并注销**本应用路径下**的 MSW worker，再 reload；不清其他网站/同源其他应用的 worker。首期建议 demo 和 real 使用不同 origin，防止旧 service worker 残留。

MSW 依赖 Service Worker。localhost HTTP 是开发例外；普通局域网 HTTP 可能不具备安全上下文，应使用 localhost 或受信任 HTTPS，不能通过关闭浏览器安全开关解决。[T4]

## 8. 核心业务演示闭环

### A. 接入并加工

创建数据源 -> 模拟测试连接 -> 浏览对象 -> 选表新建数据集 -> 字段映射/过滤/关联 -> 预览 -> 添加手机号脱敏与主键质量规则 -> 发布版本。

要求：保存的源在数据集选择器出现；草稿取消不污染保存版；类型映射失败有定位；预览数据使用固定样本并清晰区分真实 SQL 执行。

### B. 调度并入仓

配置调度 -> 手动启动 -> 运行记录轮询 -> 模拟抽取/清洗/检查/发布 -> 仓库表新版本 -> 查询与导出。

模拟运行用 startedAt/durationMs/outcome 派生状态，状态时间保存在 DB，刷新后能恢复；后台 tab 计时受限也不能让任务永远卡住。Cron/固定间隔由浏览器前台演示时钟派发，不驱动后台服务；关闭页面后不执行，错过计划跳过。失败按固定 5 秒延迟演示自动重试，暂停任务保留待重试关系，取消与 BLOCK 不自动重试。runId/datasetVersion/outputTableId 始终可追踪。

### C. 失败恢复

模拟 API 500/403/慢响应 -> 表单保留输入 -> 质量 BLOCK 阻止发布 -> 日志可定位 -> 修改规则/重试 -> 新运行成功。

取消与重试有合法状态检查；重复点击提交不产生重复实体；删除被引用的数据源返回 409；运行中版本与后来修改的草稿独立。

### D. 治理及消费

字段敏感标签 -> 预览脱敏效果 -> 血缘展示源字段到仓库列 -> 发布数据服务 -> 模拟参数调用 -> 角色切换显示无权限状态 -> 导出/操作审计。

SQL、API 数据服务与脱敏的结果都是演示协议，浏览器不发送请求到用户填写的真实源端地址。

## 9. 性能、可访问性与错误处理

- 页面按路由 lazy import；CodeMirror、Vue Flow、ECharts 各自异步加载，不进默认首页 bundle。
- 大表仅渲染当前分页；DOM 不一次挂载所有 10,000 行日志或字段。
- 请求携带 AbortSignal；切页取消失效查询；相同 query key 去重；错误有可读 code/requestId。
- mutation 过程中按钮 loading，错误保留输入；成功后更新相关缓存，不能刷新整页冒充状态同步。
- HTTP/repository 只规范化并抛出 ApiError；字段/弹窗/页面的错误由交互所有者消费，全局兜底与局部处理互斥，取消请求不弹失败消息。
- 对互不依赖的查询并行发起；用性能记录确认问题，再考虑局部计算和渲染优化，不照搬 React memo/hooks 规则。
- 错误边界处理异步组件失败、路由未知 ID、无权限、Mock 初始化失败和 IndexedDB 存储失败。
- 键盘可操作表单、菜单、弹窗；图标按钮有名称；焦点可见；颜色之外同时显示状态文字。
- 性能指标在实施基准机上测量后定义预算，不提前承诺任意机器“秒开”。B0 记录首页/编辑器首开时间及打包体积，后续批次监测回退。

## 10. 从本地启动到看到页面

### 10.1 项目运行要求

B0 验证后以根 package.json 的 engines/packageManager、.node-version 和 CI 固定项目 Node/pnpm 组合。个人终端、发行版、用户名和安装目录不属于项目要求。当前应用、锁文件及本地检查已建立，以下命令为可执行约定；前端 CI 配置已建立，远端执行尚未验证。

### 10.2 B0 实施后的固定命令

以下命令适用于 B0 已创建应用、scripts、workspace 和 lockfile 的状态；当前只有文档时不能直接启动：

~~~bash
# 在仓库根目录执行；先启用项目声明的 Node/pnpm 版本
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm dev
~~~

包管理器安装/版本管理方式由开发环境决定，运行版本必须与项目声明一致。B0 首次建 lockfile 使用 pnpm install，之后使用 frozen-lockfile；不混用 npm/yarn lockfile。

约定 pnpm dev 启动 Vite：host=127.0.0.1，port=5174，strictPort=true。浏览器打开 http://localhost:5174。端口冲突先报告占用，不擅自结束用户进程；可显式换端口并同步测试 baseURL。

开发服务器地址必须实际在浏览器验证。若 localhost 无法访问，排查进程、监听、端口与环境转发；需要 host=0.0.0.0 时说明监听范围变化。Service Worker 的安全上下文要求保持不变。

### 10.3 root scripts 契约

| 命令 | B0/B1 需实现的行为 |
|---|---|
| pnpm dev | apps/web 的 mock 开发模式 |
| pnpm build | demo 模式静态构建，显式含 Mock |
| pnpm preview | 预览 demo 构建，固定端口 4173 |
| pnpm dev:real | real 模式，切真实 API；当前没有后端应出现明确网络错误，不回退假数据 |
| pnpm build:real | 生产产物，禁止 Mock fixture/worker |
| pnpm generate:api | contracts OpenAPI -> generated TS |
| pnpm check:contracts | schema 校验 + 独立生成 + 生成漂移 + Mock 请求/响应契约 |
| pnpm --filter @jiuzhang/contracts check | 从契约包独立校验/生成，禁止隐式借用 web/app 输入和配置 |
| pnpm check:boundaries | 依赖层级、公开出口和循环检查 |
| pnpm lint / typecheck | 代码规范 + vue-tsc |
| pnpm format:check | Prettier 检查维护的源码和文档，范围排除生成内容 |
| pnpm check:ui | AST 检查明确受限 UI 用法/样式边界；行为复用仍需要评审和测试 |
| pnpm check:i18n | zh-CN 必需 key、枚举 labelKey、动态 key 清单与重复 key 校验 |
| pnpm test:unit | 逻辑/mapper/关键组件测试 |
| pnpm test:e2e | Playwright 用户流程及路由覆盖 |
| pnpm check | 将当前批次已配置的所有门禁串联，失败退出非零 |

首次 B0 需使用项目 devDependency 的 Playwright 安装浏览器（例如 pnpm --filter @jiuzhang/web exec playwright install chromium）；若系统依赖缺失，明确列出需要管理员安装的包，不假定免密 sudo。

### 10.4 开发者每天的循环

选页面矩阵项 -> 核对 scoped AGENTS -> 写/修改契约 -> 更新 Mock -> 实现领域逻辑/组件 -> 浏览器操作 -> 运行受影响测试及门禁 -> 更新完成状态。

B0 结束时必须实际给出 localhost 地址、截图/浏览器验证结论和启动命令，而不是只交文件路径。本轮是方案与规范制定，尚不报告这一验收已完成。

## 11. 分批实施与验收

| 批次 | 可见成果 | 退出标准 |
|---|---|---|
| B0 基建 | 主布局、导航、主题/zh-CN、实际使用的 PageHeader/AsyncState、概览、Mock/契约和门禁 | 本地启动并浏览器看到页面；类型/构建通过；正常/失败请求走 MSW；错误只显示一次；边界及 UI/key 检查有正反例 |
| B1 数据源 | 列表、创建、编辑、详情、表结构、预览；确认/复制样板 | 新建->测试->保存->刷新恢复；URL/选择/分页一致；提交失败保留输入；取消不污染缓存；删除依赖及重复点击可验收 |
| B2 数据集 | 编辑器、字段、转换、质量/脱敏、调度、发布、版本详情 | 完整 A 闭环；DAG 环检测；草稿与发布版隔离；复用确认/列表等实际公共契约并验证源模块消费者 |
| B3 任务与仓库 | 任务、运行日志、补数、仓库表、SQL/导入导出 | B/C 闭环；取消/重试/失败恢复；无真实数据库访问 |
| B4 治理与管理 | 血缘、规则、目录、数据服务、用户角色、审计 | D 闭环，权限/无数据/异常分支可验收 |
| B5 全面验收 | 38 个路由入口和所有详情 tab | 路由无占位/404；深链接刷新可用；全部流程测试；real 构建无 Mock |

不将 B0 的菜单和占位页认作“全部页面已完成”。每个批次可独立预览，不需等待真实后端。

## 12. 接入真实后端的迁移

1. 后端按同一 OpenAPI 实现；CI 比较实际接口与契约，解决不兼容项。
2. 配置 VITE_API_MODE=real 和唯一 API base URL；部署优先同源 /api/v1 反向代理，开发代理仅 real 模式启用。
3. 去掉 demo 登录/角色模拟，接入真实会话；鉴权、租户隔离、脱敏和审计由后端最终执行。
4. 当后端遵守同一契约时，保留页面/composable/repository 的调用路径和交互，通过配置切换 HTTP 目标；不能承诺所有代码零改动。真实会话、异步查询/运行、错误及并发版本差异若改变协议，先改契约再迁移消费者。
5. 跑同一用户行为测试，加真实后端集成测试；Mock 不证明事务、安全或仓库吞吐正确。
6. 停止本应用 Mock worker、清理演示资源与缓存；生产包检查；服务端权限专项验收。
7. real 模式请求失败明确展示错误，不回退 Mock，也不在浏览器直连数据库。逐领域联调采用显式环境/测试配置；不能在生产页面里混合假成功和真实写入。

以数据源保存为例，前端始终是 SourceConnectionForm → useSourceEditor → sourceRepository → HTTP client。Mock 模式由 MSW handler 更新 IndexedDB；真实模式由 API controller → sources.application → domain/port → PostgreSQL/连接器适配器执行。Worker 在任务提交后异步消费运行，不要求浏览器持有源数据库或仓库凭证。

## 13. 实施前仍需在 B0 确认的细项

已可采用的默认：中文、单工作区演示、明暗主题、桌面优先、38 路由、虚构零售 seed、无需 Docker。无需因这些常规选择阻塞推进。

未验证项：最终依赖组合、浏览器二进制/系统依赖、localhost 可达性、真实 UI 效果和静态检查器的 .vue 覆盖。这些均由 B0 的执行结果确认，不以调研代替。

## 一手资料

- [T1] Vue TypeScript：[官方指南](https://vuejs.org/guide/typescript/overview.html)，Vite 转译与 vue-tsc 分工。
- [T2] Naive UI：[官方仓库 README](https://github.com/tusen-ai/naive-ui)，Vue 3、TypeScript、主题系统。
- [T3] TanStack Vue Query：[官方概览](https://tanstack.com/query/latest/docs/framework/vue/overview)，server state；Pinia：[官方介绍](https://pinia.vuejs.org/introduction.html)。
- [T4] MSW：[浏览器集成](https://mswjs.io/docs/integrations/browser)，启动顺序与 localhost/HTTPS；[官方仓库](https://github.com/mswjs/msw)。
- [T5] OpenAPI TypeScript：[官方介绍](https://openapi-ts.dev/introduction)，OpenAPI 3.0/3.1 生成类型。
- [T6] Vite：[官方入门](https://vite.dev/guide/)，Node 最低版本要求。

上述页面于 2026-10-15 实际读取。组件化/AI 约束依据和固定 commit 见独立调研报告。技术选择与目录规则是本项目决策，不是上述项目统一标准。
