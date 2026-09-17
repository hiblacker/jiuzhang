# 47 控制台前端架构规范与重构方案（评审稿，先不改代码）

> 状态：**待评审**。本文只给设计与步骤，不含代码改动。所有"现状"数据都在本机实测，命令与口径见 §1.4；外部参考的抓取记录见[前端架构参考证据](research/frontend-architecture-2026-09-17.json)。
> 关联：[44 号控制台重构计划](44-console-redesign-plan.md)（页面级交互设计）、[45 号 SQL 接入方案](45-sql-ingestion-with-seatunnel.md)（本轮新增的 SQL 面板）、[09 号工程治理](09-engineering-governance.md)（依赖与许可纪律）。

## 0. 结论摘要

当前控制台的问题不是"功能不够"，而是**结构约束缺失**：27 个源文件、1289 行里塞进了全部页面逻辑，最长单行 4096 字符，没有 lint/格式化/路由/状态库，68 处内联样式，5 个文件是死代码，`src/api.ts` 同时并存两套鉴权客户端。

> **已确认决策（2026-09-17，用户答复）**：② 不保留 token 客户端（统一到会话客户端）；③ 引入 Vitest；⑤ `views/` 保留并作为页面层；⑥ 不启用自动导入；⑦ 用 `views/` 表示页面（不再用 `features/`）；文件行数上限由 300 放宽到 **800** 行。
> **仍待确认**：① 格式化是否引入 Prettier；④ 是否需要"每个页面一个网址"（下方 §5.1 用大白话解释）。这两项在确认前不进入 P0。

建议按 6 期推进，**先做 P0+P1（收益最大、风险最低）**：

| 期 | 内容 | 是否改变行为 | 预估 |
|---|---|---|---|
| P0 | 工具链：Prettier 格式化 + ESLint flat config（含类型感知规则）+ 脚本门禁 | 否（纯机械 diff） | 1–1.5 人日 |
| P1 | 引入 vue-router + 布局拆分：App.vue 拆成 AppLayout 与 7 个页面视图 | 是（导航实现方式变，行为不变） | 2–3 人日 |
| P2 | 引入 Pinia：session/project/permission 三个基础 store，统一 API 客户端 | 是（内部重构） | 2–3 人日 |
| P3 | 通用组件封装：DataTable / StatusTag / FormModal / ReasonDialog 等 | 否 | 3–5 人日 |
| P4 | 页面拆分与组合式函数：按体积逐页拆分，轮询统一 | 否 | 5–8 人日 |
| P5 | 测试与 CI 门禁：Vitest 单测 + 删除死代码 | 否 | 2–3 人日 |

行为契约由现有 8 个验收脚本守护（其中 4 个是真实浏览器验收），每期独立提交、可单独回滚。

## 1. 现状体检（本机实测）

### 1.1 规模与密度

| 指标 | 实测值 | 说明 |
|---|---|---|
| 源文件 / 总行数 | 27 个 / 1289 行 | 行数看着少，是因为几乎不换行 |
| 最长单行 | `ProjectSettings.vue` 4096 字符 | 其次是 `DatasetService.vue` 2634、`RefreshPanel.vue` 2176、`IngestionManager.vue` 1931 |
| `>200` 字符的行数 | `IngestionManager.vue` 40 行；`ModelWorkspace.vue` 21；`ProjectSettings.vue` 20；`SqlIngestion.vue` 19 | 全仓 27 个文件里 17 个含超长行 |
| `any` 出现 | 76 处 | 类型系统基本失效 |
| `ref(` 出现 | 154 处 | 状态散落在各页面组件内 |
| `await api` 调用 | 88 处 | 组件直接发请求，无中间层 |
| 内联 `style="…"` | 68 处 | 组件内 `<style>` 块 **0** 个；全局样式表仅 11 条类规则 |
| props / emits | 17 / 7 | 13 个根组件平均只有 1 个 prop（`project`），内部全靠自己 fetch |

### 1.2 依赖与门禁

- 运行时依赖：`vue 3.5.42`、`naive-ui 2.45.3`、`lucide-vue-next 1.0.0`。
- 开发依赖：`vite 8.3.0`、`@vitejs/plugin-vue 6.0.9`、`typescript 5.9.3`、`vue-tsc 3.3.11`、`playwright 1.62.1`。
- **已有**：`vue-tsc --noEmit` 类型检查（`build` 前置，见 [apps/console/package.json](../apps/console/package.json)）；8 个验收脚本（见 §9）。
- **没有**：vue-router、Pinia、ESLint、Prettier、Vitest、任何组件/单元测试、任何 lint 规则。

### 1.3 结构性问题（按影响排序）

1. **App.vue 一人分饰四角**：登录/开户、全局布局、页面切换、项目上下文全在 80 行里；用 `page` ref + `v-if` 链当路由（见 [App.vue](../apps/console/src/App.vue)）。后果：URL 不可分享、无法深链、无导航守卫、无法 keep-alive、刷新即回首页。
2. **每个页面都是 god component**：13 个根组件各自持有全部状态、直接请求 88 处、自己渲染整页表格与弹窗；跨页面复用只剩 3 个组件。
3. **无格式化/校验**：单行 4096 字符不是风格偏好，而是评审与排错事故；76 处 `any` 让类型检查形同虚设，`vue-tsc` 通过不等于类型安全。
4. **样式策略缺失**：68 处内联样式 + 空全局表 + 0 个 scoped style，视觉一致性靠复制粘贴维持。
5. **双 API 客户端并存**：同一个 `src/api.ts` 里既有会话 cookie 的 `api()`（19 个组件在用），又有 token transport 的 `useApi()/session/projects/projectId/owner/engineer/exportCsv`（另有 5 个组件在用）。新同学无法判断该用哪个。
6. **死代码**：`src/views/*`（5 个文件、约 335 行）**0 引用**，但它其实是"按视图编排 + 复用 DataGrid/DetailDrawer"的更合理分层，被搁置而非采用。

### 1.4 复现口径

```bash
cd apps/console
find src -name "*.vue" -o -name "*.ts" | xargs wc -l | sort -rn
for f in $(find src -name "*.vue"); do awk '{if(length($0)>m)m=length($0)}END{print m}' "$f"; done
grep -ro '\bany\b' src | wc -l ; grep -ro 'ref(' src | wc -l ; grep -ro 'await api' src | wc -l
grep -ro 'style="' src | wc -l ; grep -rl '<style' src | wc -l
grep -rl "views/" src --include=*.vue   # 结果为空：views/ 无人引用
```

### 1.5 这不是纸上问题

2026-09-17 的 P0-b 收尾中，真实浏览器验收（[tests/sql-ingestion-ui.mjs](../tests/sql-ingestion-ui.mjs)）一次抓到 3 个缺陷：表树因分组规则判空、预览表格只渲染行号列（`columns` 是常量而非响应式）、全量模式保存版本被自己传的 `null` 字段拒绝。后两者正是"缺组件测试 + 缺类型/结构约束"的典型产物——同样的错误在成熟结构下会在单测或 lint 阶段就被拦住。反过来，这些浏览器脚本也证明了：**重构有真实安全网，改坏了会被抓到。**

## 2. 参考的成熟做法（本次实际抓取）

目录分层（两个活跃的 Vue 3 后台模板，均为目录清单实测，非印象）：

| 项目 | `src/` 下的一级结构 |
|---|---|
| vbenjs/vue-vben-admin（`apps/web-antd/src`） | `adapter` `api` `layouts` `locales` `router` `store` `views` + `app.vue` `bootstrap.ts` `preferences.ts` `main.ts` |
| soybeanjs/soybean-admin | `assets` `components` `constants` `enum` `hooks` `layouts` `locales` `plugins` `router` `service` `store` `styles` `theme` `typings` `utils` `views` + `App.vue` `main.ts` |

两者共同点，也是我们直接照搬的部分：

1. **按职责分目录**：路由、状态、接口、布局、视图、通用组件、工具、类型各自独立，不在视图目录里放请求逻辑。
2. **视图只做编排**：数据获取与副作用下沉到 `store`/`hooks`/`service`，视图是"组装 + 展示"。
3. **主题与样式独立**于组件，不在模板里写内联样式。

官方工具链（照搬配置要点，版本在安装时锁定）：

- ESLint flat config：`eslint.config.js` 导出配置对象数组，用 `defineConfig()`，以 `files`/`ignores`/`plugins`/`rules` 组合；单独成对象的 `ignores` 是全局忽略 —— [eslint.org 配置文档](https://eslint.org/docs/latest/use/configure/configuration-files)。
- eslint-plugin-vue：`...pluginVue.configs['flat/recommended']`；要求 ESLint `^8.57 || ^9 || ^10`、Node `^18.18 || ^20.9 || >=21.1`（本机 Node 22.23.1 满足）；TS 项目要把 TS 解析器放在 `languageOptions.parserOptions.parser`；与 Prettier 组合时把 `eslint-config-prettier` **放在数组最后** —— [eslint-plugin-vue 用户指南](https://eslint.vuejs.org/user-guide/)。
- 类型感知检查：`tseslint.configs.recommendedTypeChecked` + `languageOptions.parserOptions.projectService: true`，能报出 `no-floating-promises`、`no-misused-promises` 等真 bug；官方承认慢一点但**强烈建议启用** —— [typescript-eslint 类型感知](https://typescript-eslint.io/getting-started/typed-linting/)。

> 边界声明：只参考目录分层与工具配置思路，不复制任何项目代码、不因此引入它们的其他依赖。DataEase 仅作为产品交互参考（GPL-3.0，只读，见 46 号文档），本方案不取其前端代码；vue-pure-admin 与 Vue/Pinia 官方页面本次未抓取，故不作具体结论。

## 3. 目标架构

### 3.1 目录架构图（按已确认决策）

```text
apps/console/src/
  main.ts                       # 入口：装配 Pinia / Router / Naive UI Provider
  App.vue                       # 只放 <RouterView> 与全局 Provider，不含业务与导航逻辑
  router/
    routes.ts                   # 路由表：路径、页面、标题、角色、是否要求项目
    guards.ts                   # 守卫：未登录、无项目、角色不足
  layouts/
    AppLayout.vue               # 侧边栏（菜单由路由派生）+ 头部 + 项目切换 + 内容区
    BlankLayout.vue             # 登录 / 开户页外壳
  views/                        # 【页面层】一个页面对应一个路由视图；页面私有部件放同目录
    overview/
      OverviewView.vue          # 工作台
    ingestion/
      IngestionView.vue         # 接入管理（系统 / 实例 / 连接 / 通道 / 交付计划）
      SystemPanel.vue           #   页面私有：系统与实例
      ChannelWizard.vue         #   页面私有：三步向导
      SqlDefinitionPanel.vue    #   页面私有：注册 SQL 面板（现 SqlIngestion.vue）
      DeliveryPanel.vue         #   页面私有：交付约定
    assets/
      AssetsView.vue            # 资产目录
      DeliveryLedger.vue        #   页面私有：交付账本
    models/
      ModelsView.vue            # 数据开发
    datasets/
      DatasetsView.vue          # 数据服务
    runs/
      RunsView.vue              # 运行中心
    settings/
      SettingsView.vue          # 项目与设置
    NotFoundView.vue            # 404
  components/                   # 【通用组件】无业务词汇，跨页面复用
    AppDataTable.vue  AppFilterBar.vue  AppFormModal.vue  AppReasonDialog.vue
    AppStatusTag.vue  AppMaskedValue.vue  AppJsonBlock.vue  AppEmptyHint.vue
  composables/
    useAsync.ts  usePagedQuery.ts  usePolling.ts  usePermission.ts
    useFormatters.ts  useConfirmReason.ts
  stores/                       # 【Pinia】领域状态与异步动作
    session.ts  project.ts  permission.ts
    ingestion.ts  sqlDefinition.ts  runs.ts  assets.ts  models.ts  datasets.ts
  api/                          # 【唯一 HTTP 层】会话 cookie + CSRF + 错误映射 + 取消
    http.ts                     #   底层客户端（唯一出网口）
    types.ts                    #   分页/错误等通用响应类型
    session.ts  project.ts  ingestion.ts  sql.ts  runs.ts  assets.ts  models.ts  datasets.ts
  types/                        # 领域模型与 DTO（单一来源）
  constants/                    # 状态文案与颜色映射、枚举
  styles/                       # 设计令牌、主题覆盖、基础样式（禁止模板内联样式）
```

命名与归位规则：

| 内容 | 放哪里 | 说明 |
|---|---|---|
| 路由页面 | `views/<领域>/XxxView.vue` | 每个路由一个 `*View.vue`；文件名与路由一一对应 |
| 页面私有部件 | `views/<领域>/XxxPanel.vue` | 只被本页面使用，不进 `components/` |
| 跨页面复用组件 | `components/AppXxx.vue` | 统一 `App` 前缀，禁止出现业务词汇（如"SQL""订单"） |
| 可复用逻辑 | `composables/useXxx.ts` | 不依赖具体页面 |
| 领域状态与请求编排 | `stores/useXxxStore.ts` | 组件不直接发请求 |
| 后端接口函数 | `api/<领域>.ts` | 只做"请求 + 类型"，不含 UI 状态 |
| 类型 | `types/` | 组件内不再就地声明接口 |

### 3.2 依赖方向（写进 lint，不允许反向 import）

| 层 | 允许依赖 | 禁止 |
|---|---|---|
| `app`（main.ts/App.vue） | 全部 | 业务逻辑（只做装配） |
| `layouts/` | `router/`、`stores/`、`components/`、`types/` | `api/` 直连 |
| `views/` | `components/`、`composables/`、`stores/`、`types/`、`constants/`、本领域子部件 | 其他 `views/` 目录内的文件、`api/` 直连 |
| `components/`、`composables/` | `types/`、`constants/`、`styles/` | `views/`、`stores/`、`api/`、`router/` |
| `stores/` | `api/`、`types/`、`constants/` | `views/`、`components/` |
| `api/`、`types/` | 无上层依赖 | 一切 UI |

约定：启用 `@/` 别名指向 `src/`，禁止 `../../../`；组件文件 `PascalCase.vue`，组合式函数 `useXxx.ts`，store `useXxxStore`，接口模块小写领域名。

### 3.3 遗留 `views/` 文件的处理

现有 `views/OverviewView.vue`、`IngestionView.vue`、`ModelsView.vue`、`AccessView.vue`、`AssetsView.vue` 五个文件是**未被引用的旧版本**（0 引用），且依赖即将删除的 token 客户端、调用已过期的接口。保留 `views/` **目录与"一页一视图"的做法**，但这五个文件的内容重写：P1 先把现有真实页面（现根目录的 13 个组件）按上表迁入，P4 再逐页拆分。旧文件在迁入时被覆盖，不保留其实现。

## 4. 工具链与规范（P0）

### 4.1 新增依赖（候选，全部需按 ADR-008 录许可证据并锁版本）

| 包 | 用途 | 备注 |
|---|---|---|
| `prettier` | 格式化 | **待确认（决策①）**：采用则只做格式化、不做 lint |
| `eslint`、`@eslint/js` | lint 核心 | flat config |
| `eslint-plugin-vue` | Vue 规则 | `flat/recommended` |
| `typescript-eslint` | TS 规则 + 类型感知 | `recommendedTypeChecked` |
| `eslint-config-prettier` | 关闭与 Prettier 冲突的规则 | 放数组末尾 |
| `vue-router` | 路由 | 生态默认（待评审确认，见 §11） |
| `pinia` | 状态管理 | 同上 |
| `vitest`、`@vue/test-utils`、`happy-dom` | P5 单测与组件测试 | 可选期 |

纪律：新增前用 `npm run licenses`（`scripts/dependencies.mjs`）核对许可并更新 notices；许可证据写入 `docs/research/`；版本精确锁定，禁止 `^`/`~`。

### 4.2 脚本门禁（package.json）

```text
lint          eslint . --max-warnings 0
lint:fix      eslint . --fix
format        prettier --write "src/**/*.{ts,vue,css,json}"
format:check  prettier --check "src/**/*.{ts,vue,css,json}"
typecheck     vue-tsc --noEmit            # 已有
test:unit     vitest run                  # P5
test:ui       node ../../tests/sql-ingestion-ui.mjs   # 已有浏览器验收
build         npm run lint && npm run format:check && npm run typecheck && vite build && node scripts/notices.mjs
```

### 4.3 ESLint 配置结构（分段，可读优先）

1. 全局 `ignores`：`dist`、`node_modules`、`scripts/notices*`。
2. `js.configs.recommended`。
3. `...tseslint.configs.recommendedTypeChecked` + `parserOptions.projectService: true`。
4. `...pluginVue.configs['flat/recommended']`，`.vue` 用 `languageOptions.parserOptions.parser = tseslint.parser`。
5. 分层边界 `no-restricted-imports`（按 §3 的依赖方向，`features` 之间互禁、`components` 禁连 `services`）。
6. 体量规则（§8）。
7. `eslint-config-prettier` 收尾。

### 4.4 Prettier 配置（与现有风格对齐，减少机械 diff 噪音）

```json
{ "semi": false, "singleQuote": true, "printWidth": 120, "trailingComma": "all", "arrowParens": "always", "vueIndentScriptAndStyle": false }
```

## 5. 路由设计（P1）

| 路径 | 视图 | meta |
|---|---|---|
| `/login` | 登录/开户（BlankLayout） | `public: true` |
| `/` | 重定向到 `/overview` | — |
| `/overview` | 工作台 | `title: 工作台` |
| `/systems`、`/systems/:systemId` | 接入管理 | `title: 接入管理`、`roles: [OWNER, ENGINEER]` |
| `/assets`、`/assets/:assetId` | 资产目录 | `requiresProject: true` |
| `/models` | 数据开发 | `roles: [OWNER, ENGINEER]` |
| `/datasets` | 数据服务 | `title: 数据服务` |
| `/runs`、`/runs/:runId` | 运行中心 | `title: 运行中心` |
| `/settings` | 项目与设置 | `roles: [OWNER]` |
| `/:pathMatch(.*)*` | 404 | — |

要点：菜单由 `routes.ts` 派生（不再手写 `menu` 数组）；守卫统一处理"未登录 → /login"、"无项目 → 项目选择"、"角色不足 → 403 提示"；视图全部懒加载；列表页保留查询参数以便分享（`?q=&page=`）。登录后 `session-expired` 事件改为守卫 + store 行为，不再各处 `addEventListener`。

## 6. 状态管理（P2）

| store | 状态 | 动作 |
|---|---|---|
| `useSessionStore` | 身份、platformAdmin、CSRF、就绪标志 | `identify()`、`login()`、`activate()`、`logout()`、`onExpired()` |
| `useProjectStore` | 项目列表、当前项目、分页/搜索、角色 | `load()`、`select()`、`reload()` |
| `usePermissionStore` | 由角色派生的能力位（`canManage`/`canIngest`/`canOperate`） | 纯 getter，替代散落模板里的 `role==='OWNER'` 判断 |
| `useIngestionStore` | 系统/实例/连接/通道/计划/预检 | 各 `loadXxx`、`activatePlan`、`trigger` |
| `useSqlDefinitionStore` | 草稿、校验问题、预览、版本、轮询句柄 | `validate`、`saveDraft`、`preview`、`saveVersion`、`enable` |
| `useRunStore`、`useAssetStore` | 运行/异常/操作条、资产/交付账本 | 列表加载、分页、操作 |

规则：

- store 拥有**领域状态与异步动作**；组件只保留瞬时 UI 状态（表单输入、弹窗开关、当前 tab）。
- 禁止组件之间靠 store 互相写；跨领域协作走 action 或路由参数。
- 持久化只允许"当前项目 id"（sessionStorage）；**任何 token/密码都不落前端存储**（沿用现有安全约束）。
- API 客户端收敛为一个 `api/http.ts`（会话 cookie + CSRF + 统一错误映射 + 取消）。**已确认删除 token transport**，删除清单见 §6.1。
### 6.1 删除 token transport 的清单（已确认）

实测影响面很小——**只有 1 个存活页面**在用：

| 对象 | 处置 | 说明 |
|---|---|---|
| `src/DatasetService.vue` | 迁移到会话客户端 `api()` | 它调用的 `/warehouse/catalog/projects/{p}/datasets`、`/warehouse/projects/{p}/datasets/{id}`、`/warehouse/projects/{p}/members` 都是产品接口，会话身份本就可访问；页面里展示的 `Authorization: Bearer <服务令牌>` 是给数据服务调用方的**示例文本**，保留 |
| `src/transport.ts` | 删除 | 令牌传输层（`createTransport`/`validateBase`/`session` 快照） |
| `src/api.ts` 中的令牌半区 | 删除 | `useApi`/`request`/`session`/`projects`/`projectId`/`owner`/`engineer`/`exportCsv`/`createTransport`/`validateBase` 导出 |
| `src/views/*.vue`（5 个旧文件） | 随 §3.3 重写 | 它们依赖被删的客户端 |
| `tests/console-transport.test.mjs` | **删除** | 该测试直接测 `transport.ts`；层级删除后测试一并删除，属预期缩减，不作为"测试变少"隐瞒 |

验收：删除后 `src` 中不再出现 `createTransport`/`validateBase`/`session.token`；控制台全部浏览器验收通过；DatasetService 的发布/查询/授权流程逐项回归。

- 轮询（预览/构建/运行状态）统一为 `usePolling`：带中止、退避、组件卸载清理；替换现在的 `for + setTimeout` 手写循环。

## 7. 通用组件与组合式函数（P3/P4）

| 组件 | 现状替身 | 解决的问题 |
|---|---|---|
| `AppDataTable` | 各页直接 `n-data-table` + 手写 columns | 统一 loading/空态/错误、分页、行操作、列宽约定 |
| `AppStatusTag` | 各页 `stateLabels[...]` 内联映射 | 状态→文案/颜色单一来源 |
| `AppFormModal` / `AppReasonDialog` | `n-modal` 复写 + 必填原因 | 确认类操作（暂停/启用/重算）行为一致 |
| `AppFilterBar` | 各自 `<form class="toolbar">` | 搜索/筛选布局统一，回车即搜 |
| `AppMaskedValue` | 后端 `***` 直接展示 | 遮罩列的显示与"不可复制"提示 |
| `AppJsonBlock` | `<pre class="json-detail">` | 详情/变更影响展示统一 |
| `AppEmptyHint`、`AppAsyncSection` | `n-empty` + 手动 v-if | 空态与"加载/错误/重试"三态统一 |

组合式函数：`useAsync`（loading/error/run/重试）、`usePagedQuery`（分页+搜索+竞态丢弃）、`usePolling`、`usePermission`、`useFormatters`（日期/数字/中文排序）、`useConfirmReason`。

`types/` 作为 DTO 单一来源：所有接口响应有明确类型，禁止 `any`（用 `unknown` + 收窄函数）。本轮 `SqlIngestion.vue` 的 `Preview`/`Version` 这类内联 interface 应上收。

## 8. 可读性硬约束（写进 lint，不靠自觉）

| 规则 | 取值 | 理由 |
|---|---|---|
| `max-lines` | **800**（用户确认） | 抑制"单文件塞进整个模块"；单行 ≤120 仍由 Prettier 兜底 |
| `max-lines-per-function` | 80 | 现有函数动辄数百字符 |
| `complexity` / `max-depth` | 12 / 4 | 抑制深层嵌套的模板逻辑 |
| `@typescript-eslint/no-explicit-any` | error | 现状 76 处，必须止血 |
| `@typescript-eslint/no-floating-promises` | error | 未 await 的请求会静默失败 |
| `vue/max-attributes-per-line` | 每行 1 个 | 让模板可 diff |
| `vue/block-order` | script → template → style | 统一阅读顺序 |
| `vue/component-name-in-template-casing` | PascalCase | 与文件命名一致 |
| `no-restricted-imports` | 分层边界 | 见 §3 |
| `no-console` | 允许 `warn`/`error` | 禁止调试残留 |
| 行宽 | 120 | 4096 字符的行从此不可能出现（由 Prettier 或 ESLint 执行，取决于决策①） |

注释纪律：只写"为什么"（如此前 `columns` 非响应式的踩坑说明），不写"是什么"。

## 9. 测试策略

现有安全网（重构期间必须常绿，**这是本方案最重要的资产**）：

| 脚本 | 层次 | 覆盖 |
|---|---|---|
| `tests/console-server.test.mjs` | Node | 控制台服务端行为 |
| `tests/console-transport.test.mjs` | Node | 传输层（token transport） |
| `tests/console-browser.mjs`、`tests/console-ui.mjs` | 真实浏览器 | 控制台交互 |
| `tests/schema-review-ui.mjs` | 真实浏览器 | 结构评审交互 |
| `tests/product-browser.mjs` | 真实浏览器 | 三条主流程（隔离环境） |
| `tests/sql-ingestion-ui.mjs` | 真实浏览器 | SQL 面板逐控件（本轮新增） |
| `tests/sql-ingestion-integration.py` | HTTP/worker | 端到端入湖 |

新增（P5）：Vitest + `@vue/test-utils` + `happy-dom`，只对 `store`/`composable`/通用组件写单测（不测模板细节），覆盖率阈值先设 `stores/composables/utils` 语句 60%，随后只升不降。

CI 门禁顺序：`lint → format:check → typecheck → test:unit → build →` 现有浏览器验收（沿用 `tools/verify-product.py` 与 `.github/workflows/product.yml` 的既有位置，不新增流水线）。

## 10. 分期迁移计划

| 期 | 内容 | 风险控制 | 验收 |
|---|---|---|---|
| P0 | Prettier 全量格式化 + ESLint 落地 + 脚本门禁 | 单独提交，**只含格式化**；在 `.git-blame-ignore-revs` 记录该提交 | `npm run lint`/`format:check`/`typecheck` 通过；`node --test tests/*.test.mjs` 不变；控制台构建产物可加载 |
| P1 | vue-router + AppLayout + `views/` 页面层（现 13 个根组件迁入）；菜单由路由派生 | 保留项目选择弹窗；守卫逐条对照现有 v-if 权限；旧 `views/*` 五个文件在此被真实页面覆盖 | 浏览器验收补齐"菜单导航 + 直接访问 URL + 无权限不可见"断言 |
| P2 | Pinia 基础 store + 统一 http 客户端 + **删除 token transport**（§6.1） | 先迁移 session/project，再迁移各页；DatasetService 单独提交并逐项回归 | 会话过期、项目切换、角色能力三类行为回归；数据服务的发布/查询/授权流程回归 |
| P3 | 通用组件（先替换 3 处以上重复） | 一次只封装一个组件，替换点集中提交 | 组件单测 + 视觉抽查 |
| P4 | 页面拆分（按体积：ProjectSettings → IngestionManager → RefreshPanel → RunCenter → ModelWorkspace → DatasetService → SqlIngestion） | 每页独立提交；`views/` 结构承接编排，业务拆到 `features/` | 每页拆分后跑对应浏览器验收 |
| P5 | Vitest 引入 + 覆盖率门禁 + 清理未用导出 | 删代码前用 `grep -rl` 复核引用为 0 | 单测门禁接入 `build`；全量验收绿 |

顺序理由：P0 让后续所有 diff 可读（否则重构 diff 本身就是灾难）；P1 收益最大（深链、守卫、可导航）；P2 解除 prop 打洞；P3/P4 是把 god component 拆开的体力活；P5 收口。**P0+P1 完成后已经拿到大部分可读性收益**，可以按你的节奏决定是否继续。

## 11. 决策记录

| # | 决策 | 结果 | 落地位置 |
|---|---|---|---|
| 1 | 格式化工具 | **待确认**：是否引入 Prettier（"统一"的含义需你确认，见下方问题） | §4.1、§4.4 |
| 2 | token transport 客户端 | **已确认：不保留**，统一到会话客户端；`transport.ts` 与 `tests/console-transport.test.mjs` 一并删除 | §6.1 |
| 3 | 引入 Vitest | **已确认：是** | §9、P5 |
| 4 | 每个页面一个网址（路由） | **待确认**：解释见 §11.1 | §5 |
| 5 | 旧 `views/*` 五个文件 | **已确认：保留 `views/` 目录作为页面层**；旧文件内容被真实页面覆盖（§3.3） | §3.1、§3.3 |
| 6 | 自动导入 | **已确认：不启用** | §4.3 |
| 7 | 页面层命名 | **已确认：`views/`**（不再用 `features/`） | §3.1 |
| — | 单文件行数上限 | **已确认：800 行**（原建议 300） | §8 |

### 11.1 第 4 项的大白话解释

现在的控制台，**所有页面共用同一个网址**（比如都是 `http://127.0.0.1:60284/`），页面切换只改内存里的一个变量。带来四个具体后果：

1. **不能把链接发给同事**：你把地址发过去，对方打开看到的永远是"工作台"，不是你看的那一页。
2. **刷新就回首页**：在"接入管理"里填了一半，按 F5 就回到工作台，填的内容没了。
3. **浏览器后退键没用**：按返回不会回到上一页。
4. **收藏/书签没用**：只能收藏首页。

采用路由后（`http://…/systems`、`http://…/runs/12`）：上面四条全部成立——地址可直接分享、刷新停在原页、前进后退可用、可收藏具体页面。代价是 P1 需要多花约 1 人日做导航改造与守卫。

**如果选"不要"**：保持现在的内存切换，P1 只做 App.vue 拆分（不引入 vue-router），省 1 人日，但上述四条永久成立。

## 12. 明确不做

不重写视觉与交互（那是 44 号文档的范畴）；不更换组件库（沿用 Naive UI，ADR-010）；不改任何 API 契约、后端或数据库；不引入 SSR、微前端、TypeScript 装饰器、状态机或代码生成；不做"全量重写"，一律按页迁移；不为"用上新东西"而引入依赖（每个新增依赖都要能回答"解决哪个具体问题"）。

## 13. 参考依据

- 本次抓取记录（含未核验项与原因）：[frontend-architecture-2026-09-17.json](research/frontend-architecture-2026-09-17.json)
- [ESLint 配置文件（flat config）](https://eslint.org/docs/latest/use/configure/configuration-files)
- [eslint-plugin-vue 用户指南](https://eslint.vuejs.org/user-guide/)
- [typescript-eslint 类型感知检查](https://typescript-eslint.io/getting-started/typed-linting/)
- 说明：本次会话 `web_search` 通道返回 HTTP 503，上述页面均通过直接 HTTP 抓取获得；`DataEase`、`vue-pure-admin` 与 Vue/Pinia 官方页面未在本次抓取，故方案中不引用其具体结论。

下一步：你确认 §11 的决策后，我从 P0 开始（第一个提交只含工具链与格式化，不含任何行为改动），每期结束给出测试与浏览器验收结果。
