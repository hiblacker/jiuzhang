# 47 控制台前端架构规范与重构方案（已确认，待开工）

> 状态：**7 项决策已全部确认（2026-09-17）**，本文只给设计与步骤，尚未改动任何代码。所有"现状"数据都在本机实测，命令与口径见 §1.4；外部参考的抓取记录见[前端架构参考证据](research/frontend-architecture-2026-09-17.json)。
> 关联：[44 号控制台重构计划](44-console-redesign-plan.md)（页面级交互设计）、[45 号 SQL 接入方案](45-sql-ingestion-with-seatunnel.md)（本轮新增的 SQL 面板）、[09 号工程治理](09-engineering-governance.md)（依赖与许可纪律）。

## 0. 结论摘要

当前控制台的问题不是"功能不够"，而是**结构约束缺失**：27 个源文件、1289 行里塞进了全部页面逻辑，最长单行 4096 字符，没有 lint/格式化/路由/状态库，68 处内联样式，5 个文件是死代码，`src/api.ts` 同时并存两套鉴权客户端。

> **已确认决策（2026-09-17）**：① 格式化统一到 **Prettier**（ESLint 只管正确性、分层与体量规则）；② **不保留** token 客户端（统一到会话客户端）；③ 引入 Vitest；④ **要**"每个页面一个网址"（vue-router）；⑤ `views/` 保留并作为页面层；⑥ 不启用自动导入；⑦ 用 `views/` 表示页面（不用 `features/`）；文件行数上限 **800** 行。

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
| `prettier` | 格式化 | 已确认采用；只做格式化，不承担 lint 规则 |
| `eslint`、`@eslint/js` | lint 核心 | flat config；**许可阻塞待决**：ESLint 10 的核心依赖 minimatch@10（BlueOak-1.0.0，dev-only）不在仓库许可白名单，ESLint 9 路线则引入 argparse（Python-2.0）；证据见[许可记录](research/frontend-lint-license-2026-09-17.json) |
| `eslint-plugin-vue` | Vue 规则 | `flat/recommended` |
| `typescript-eslint` | TS 规则 + 类型感知 | `recommendedTypeChecked`；版本受许可约束：8.70 引入 minimatch@10（BlueOak），8.55 的 peer 不接受 ESLint 10 |
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
| 1 | 格式化工具 | **已确认：Prettier 管格式，ESLint 管正确性** | §4.1、§4.4 |
| 2 | token transport 客户端 | **已确认：不保留**，统一到会话客户端；`transport.ts` 与 `tests/console-transport.test.mjs` 一并删除 | §6.1 |
| 3 | 引入 Vitest | **已确认：是** | §9、P5 |
| 4 | 每个页面一个网址（路由） | **已确认：要**（解释见 §11.1） | §5 |
| 5 | 旧 `views/*` 五个文件 | **已确认：保留 `views/` 目录作为页面层**；旧文件内容被真实页面覆盖（§3.3） | §3.1、§3.3 |
| 6 | 自动导入 | **已确认：不启用** | §4.3 |
| 7 | 页面层命名 | **已确认：`views/`**（不再用 `features/`） | §3.1 |
| — | 单文件行数上限 | **已确认：800 行**（原建议 300） | §8 |

### 11.1 第 4 项的动因（大白话）

现在的控制台，**所有页面共用同一个网址**（比如都是 `http://127.0.0.1:60284/`），页面切换只改内存里的一个变量。带来四个具体后果：

1. **不能把链接发给同事**：你把地址发过去，对方打开看到的永远是"工作台"，不是你看的那一页。
2. **刷新就回首页**：在"接入管理"里填了一半，按 F5 就回到工作台，填的内容没了。
3. **浏览器后退键没用**：按返回不会回到上一页。
4. **收藏/书签没用**：只能收藏首页。

采用路由后（`http://…/systems`、`http://…/runs/12`）：上面四条全部成立——地址可直接分享、刷新停在原页、前进后退可用、可收藏具体页面。代价是 P1 需要多花约 1 人日做导航改造与守卫。

**决定：要**。因此 P1 引入 vue-router，上述四条问题一并解决；代价约 1 人日。

## 12. 明确不做

不重写视觉与交互（那是 44 号文档的范畴）；不更换组件库（沿用 Naive UI，ADR-010）；不改任何 API 契约、后端或数据库；不引入 SSR、微前端、TypeScript 装饰器、状态机或代码生成；不做"全量重写"，一律按页迁移；不为"用上新东西"而引入依赖（每个新增依赖都要能回答"解决哪个具体问题"）。

## 13. 参考依据

- 本次抓取记录（含未核验项与原因）：[frontend-architecture-2026-09-17.json](research/frontend-architecture-2026-09-17.json)
- [ESLint 配置文件（flat config）](https://eslint.org/docs/latest/use/configure/configuration-files)
- [eslint-plugin-vue 用户指南](https://eslint.vuejs.org/user-guide/)
- [typescript-eslint 类型感知检查](https://typescript-eslint.io/getting-started/typed-linting/)
- 说明：本次会话 `web_search` 通道返回 HTTP 503，上述页面均通过直接 HTTP 抓取获得；`DataEase`、`vue-pure-admin` 与 Vue/Pinia 官方页面未在本次抓取，故方案中不引用其具体结论。

## 14. 开工顺序与执行记录

决策已全部确认，按 P0 → P1 → P2 → P3 → P4 → P5 执行；每期独立提交，提交前跑 `npm run lint`、`npm run format:check`、`npm run typecheck`、`node --test tests/*.test.mjs`、`node tools/check-docs.mjs`、`git diff --check`，并给出对应浏览器验收结果。P0 的提交**只含工具链与格式化**，不含任何行为改动，并写入 `.git-blame-ignore-revs`。

### 14.1 P0-1（Prettier 格式化）：已完成 2026-09-17

| 项 | 结果 |
|---|---|
| 依赖 | `prettier 3.9.7`（精确锁定，唯一新增；`npm run licenses` PASS：124 个精确依赖，官方完整性/许可声明一致） |
| 配置 | `apps/console/.prettierrc.json`、`.prettierignore`；`printWidth 120`、`singleQuote`、`trailingComma all` |
| 脚本 | `format`、`format:check`，并接入 `check` 与 `build` |
| 格式化范围 | `src/**/*.{ts,vue,css,json}` + `vite.config.ts`（27 个源文件） |
| 规模变化 | 1289 行 → **6274 行**；最长单行 4096 → 141 字符 |
| 验证 | `npm run build`（含 typecheck 与 format:check）通过；`node --test tests/*.test.mjs` 134 项（132 通过、1 跳过、1 项为宿主机缺 openpyxl 的既存失败）；控制台镜像 `0.2.0-dev.13` 重建后 `tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS（资产 3 行）；`node tools/check-docs.mjs`、`git diff --check` 通过 |
| 提交 | `chore(console): adopt Prettier formatting…` + `.git-blame-ignore-revs` 记录该提交，避免机械重排淹没作者信息 |

执行中发现并记录的格式化陷阱：`semi: false` 下 Prettier 会把**多语句内联事件处理器**拆成多行并去掉分隔符（如 `@click="a=1;b=2"` → 两行），Vue 解析即失败（构建报 `Error parsing JavaScript expression`）。共 29 处，全部集中在「翻页/刷新」类模板逻辑。P0 选择保留 `semi: true` 让这 29 处重新合法（语义与格式化前一致），并把"把模板逻辑抽成命名方法"列入 P4；抽出后即可回到 `semi: false`。

### 14.2 P0-2（ESLint）：已完成 2026-09-17

**决策（用户批准方案 A）**：接受 BlueOak-1.0.0 作为 **dev-only** 依赖许可例外，采用 ESLint 10 + typescript-eslint 8.70（含类型感知规则）。例外在门禁里是**按包作用域**放的，不是全局放宽：

```js
// apps/console/scripts/dependencies.mjs
const devOnlyAccepted = new Set(['BlueOak-1.0.0']);
const devOnlyException = !!item.dev && devOnlyAccepted.has(item.license);
```

即：只有 `dev` 包能用该许可证，任何会进入控制台分发物的运行时依赖仍必须落在原白名单内。许可证据与 SPND 属性见[许可记录](research/frontend-lint-license-2026-09-17.json)。

| 项 | 结果 |
|---|---|
| 依赖 | `eslint 10.10.0`、`@eslint/js 10.0.1`、`typescript-eslint 8.70.0`、`eslint-plugin-vue 10.11.0`、`eslint-config-prettier 10.1.8`、`globals 17.12.0`（全部精确锁定） |
| 门禁 | `npm run licenses` **PASS：226 个精确依赖**（含 dev-only 例外校验） |
| 配置 | `apps/console/eslint.config.js`：flat config，`js.configs.recommended` + `recommendedTypeChecked`（`parserOptions.projectService`）+ `pluginVue.configs['flat/recommended']`，`eslint-config-prettier` 收尾（格式归 Prettier，配置里不再写布局规则） |
| 脚本 | `lint`（`--max-warnings 316` 基线封顶）、`lint:fix`；`lint` 已接入 `check` 与 `build` |
| 首次测量 | 334 条存量违规（error 256 / warn 78），涉及 25 个文件 |
| 规则策略 | **error**：正确性（`no-console` 限 warn/error、`vue/no-mutating-props`）、体量上限（`max-lines` 800）；**warn（基线 316，只减不增）**：`no-unsafe-*` 系列、`no-explicit-any`、`restrict-template-expressions`、`no-base-to-string`、`no-misused-promises`（均源于未类型化的 API/DTO 层，P2 建立 `api/` 类型后收口）、`complexity`（6 处，P4 拆分 god component 时收口）、`max-lines`（1 处：`IngestionManager.vue` 824 行，P4 拆分） |
| 已修的真问题 | 未用导入/变量 3 处、属性顺序 5 处、多余类型断言 1 处、`v-for` 变量遮蔽同名 prop 1 处、可选函数 prop 缺默认值 1 处、无 await 的 async 3 处（旧 `views/` 文件中为满足类型声明保留 `async`，改为带原因的定点抑制） |
| 关闭的误报规则 | `vue/no-deprecated-filter`：Vue 3 无过滤器，该规则只会命中绑定属性里的 TS 联合类型（如 `:value="x as string \| number"`） |
| 验证 | `npm run build`（typecheck + format:check + lint + vite + notices）通过；控制台镜像 `0.2.0-dev.14` 重建成功（镜像内 `npm run build` 同样过 lint 门禁）；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS（资产 3 行）；`node --test tests/*.test.mjs` 134 项（132 通过、1 跳过、1 项为宿主机缺 openpyxl 的既存失败）；`node tools/check-docs.mjs`、`git diff --check` 通过 |

**基线只减不增**：修掉违规时把 `package.json` 里的 `--max-warnings` 同步下调；任一阶段（P1 路由、P2 类型化、P4 拆分）完成后必须下调该数字，最终目标是 0。

### 14.3 P1（vue-router + 页面层）：已完成 2026-09-17

| 项 | 结果 |
|---|---|
| 依赖 | `vue-router 4.6.4`（精确锁定；选 4.x 而非 5.x，因为 5.x 的 peer 里带 `pinia`/`@pinia/colada`/`vite` 等额外约束，对本项目没有必要） |
| 路由 | `src/router/routes.ts`（路由表 + `meta{title,menu,public,roles}`，类型通过 `declare module 'vue-router'` 扩展）、`src/router/index.ts`（`createWebHistory` + 守卫） |
| 守卫 | 首次导航前先跑 `bootstrapSession()`（否则硬刷新会把已登录用户弹回登录页），再判登录态、`meta.roles`；未登录访问受保护路径会带 `redirect` 回登录页 |
| 布局 | `src/layouts/AppLayout.vue`（侧边栏**由路由表派生**、页头标题取 `route.meta.title`、项目切换弹窗）、`src/layouts/BlankLayout.vue`（登录外壳） |
| 页面层 | 现 13 个根组件用 `git mv` 迁入 `views/<领域>/`：`overview/OverviewView`、`ingestion/{IngestionView,ChannelWizard,SqlDefinitionPanel,DeliveryPanel,OperationBar}`、`assets/{AssetsView,AssetPicker,DeliveryLedger}`、`models/ModelsView`、`datasets/DatasetsView`、`runs/RunsView`、`settings/SettingsView`；新增 `views/session/LoginView.vue`、`views/NotFoundView.vue` |
| 清理 | 删除 5 个 0 引用的旧 `views/*.vue` 与仅被它们使用的 `tabs.ts`（其内容属已废弃的 token 客户端那一代） |
| 入口 | `App.vue` 只剩 `NConfigProvider` + `RouterView`；`main.ts` 装路由；会话/项目状态暂存 `src/stores/session.ts`（P2 拆成 Pinia） |
| 别名与静态服务 | 启用 `@/`（vite `resolve.alias` + tsconfig `paths`）；`base` 改为 `/`；`server.mjs` 增加 SPA 回退（**无扩展名**的未知路径返回外壳，带扩展名的仍 404），`tests/console-server.test.mjs` 补断言 |
| 许可 | vue-router 的运行时依赖 `@vue/devtools-api@6.6.4` 声明 MIT 但发布包不含许可文件；按既有做法新增 `licenses/devtools-api-MIT.txt` 补件并登记到 `scripts/notices.mjs`（`npm run licenses` 仍 PASS，通知打包 48 个运行时依赖） |
| 验证 | `npm run build`（typecheck + format:check + lint + vite + notices）通过；lint 警告 **295**（316 → 296 → 295，基线随之下调）；`node --test tests/*.test.mjs` 134 项（132 通过、1 跳过、1 项既存 openpyxl 失败）；控制台镜像 `0.2.0-dev.15` 重建；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS，并新增三条断言：**深链 `/assets` 直接打开且刷新停在原页**、**浏览器后退回到上一页**、**未知路径渲染 404 页而不是白屏**（探针实测 `/assets`、`/models`、`/no-such-page` 均按预期渲染，无页面错误） |

本阶段的两处有意偏差与欠账：

1. 平台管理员**没有项目**时，原实现会直接把"项目与设置"页当作落地页；现在改为一张明确的引导卡片（"还没有可用的项目" + 选择项目按钮），设置页仍从菜单可达。
2. 视图仍在通过 `AppLayout` 的 `pageProps` 计算属性收 props（保持原契约）；P2 建 Pinia 后改为视图直接读 store，届时删除这个垫片。
3. 角色拒绝路径（如 VIEWER 直接访问 `/models`）未放进浏览器验收（需要第二个 VIEWER 账号），改由 P5 的路由守卫单元测试覆盖；浏览器验收只覆盖了"菜单按角色隐藏"与 404。

### 14.4 P2（Pinia + 统一 API 客户端 + 删除 token 层）：已完成 2026-09-17

| 项 | 结果 |
|---|---|
| 依赖 | `pinia 3.0.4`（精确锁定；选 3.x，peer 只有 vue/typescript，不引入 4.x 的 `@vue/devtools-api ^8` 额外 peer） |
| API 层 | `src/api/http.ts`（唯一的 HTTP 客户端：会话 cookie + CSRF + 统一 `ApiError` + `exportCsv`）、`src/api/types.ts`（`Project`/`Identity`/`Page`）、`src/api/index.ts` 统一出口——**所有既有 `import { api } from '@/api'` 调用点零改动** |
| 状态层 | `src/stores/session.ts`（身份、bootstrap、登出、`isAdmin`）、`src/stores/project.ts`（项目列表/当前项目/分页/选择器/`syncRole`）、`src/stores/permission.ts`（`role`/`canManage`/`canIngest`/`canOperate`，唯一的能力来源） |
| 视图 | 7 个页面改为直接读 store（`canManage`/`canIngest`/`canOperate`/`admin`/`identity`/`projectId` 由 store 派生），**删除 `AppLayout` 的 `pageProps` 垫片**；`AppLayout`、`LoginView`、路由守卫全部走 store |
| 结构归位 | `src/types.ts` → `src/types/index.ts`（`@/types` 说明符不变，零导入改动） |
| 删除 | `src/api.ts`、`src/transport.ts`（令牌传输层）与其测试 `tests/console-transport.test.mjs` |
| 验证 | `npm run build`（typecheck + format:check + lint + vite + notices）通过；lint 警告 **294**（316 → 296 → 295 → 294）；`node --test tests/*.test.mjs` **129 项**（127 通过、1 跳过、1 项既存 openpyxl 失败）——总数从 134 降到 129 是随令牌层删除掉的 5 个传输层测试，属预期缩减；控制台镜像 `0.2.0-dev.16` 重建；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS（含深链/刷新/后退/404 四条路由断言），说明整条 Pinia 化路径在真机上仍可用 |

**一处事实更正**：P0 阶段我按宽泛 grep 判断"只有 `DatasetService.vue` 一个存活页面在用 token 客户端"；本次逐文件核对导入后确认**没有任何存活使用者**（`DatasetService` 命中的是它自己的局部 `request()` 函数）。因此 token 层的删除是纯减法，不需要迁移任何页面。

**欠账（顺延）**：视图里仍有大量 `Record<string, any>` 行数据（294 条告警的主体）。P2 解决的是**层面**问题（单一类型化客户端 + 类型化 store + 无传输层分支），逐页 DTO 化与拆页同时进行更安全，故并入 P4；`max-lines`（`IngestionManager.vue` 824 行）与 6 处 `complexity` 同样在 P4 收口。

### 14.5 P3（通用组件）：已完成 2026-09-17（部分，其余并入 P4）

先量化再封装，避免造出没人用的组件：

| 模式 | 实测重复 | 处置 |
|---|---|---|
| `<pre class="json-detail">{{ JSON.stringify(x, null, 2) }}</pre>` | 6 个文件 9 处（含 1 处预置字符串、1 处多行表达式） | 抽出 `src/components/AppJsonBlock.vue`，9 处全部改接 |
| `<n-pagination v-model:page :item-count :page-size="25" class="gap" />` | 7 个文件 8 处 | 抽出 `src/components/AppPager.vue`（`defineModel` + pageSize 默认 25），8 处全部改接，7 个视图里随之无用的 `NPagination` 导入一并删除 |
| 旧共享组件 `DataGrid.vue`/`DetailDrawer.vue`/`ActionForm.vue` | **0 使用者**（只被 P1 删掉的旧 views 引用） | 删除（死代码） |
| 状态→文案/颜色映射 | 仅 `ChannelWizard.vue` 一处定义；其余视图直接显示原始状态 | **未封装**：`AppStatusTag` 目前无 ≥3 处真实重复，造出来只会新增代码。并入 P4 逐页重写时统一（与控件文案变更一起做，避免现在仅为抽象而改动界面文案） |
| 原因输入（暂停/重试/结构差异） | 4 个文件 6 处，但外层是弹窗/表单不同的容器与文案 | **未封装**：同上，P4 重写这些弹窗时一并抽 `AppReasonField`/`AppReasonDialog` |
| 搜索栏（输入 + 搜索按钮） | 5 处，但外层结构（form/space）与回车行为不完全一致 | **未封装**：P4 逐页重写时统一为 `AppFilterBar` |

验证：`npm run build` 通过；lint 警告 **292**（294 → 292）；`node --test tests/*.test.mjs` 129 项（127 通过、1 跳过、1 项既存 openpyxl 失败）；控制台镜像 `0.2.0-dev.17` 重建；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS。

### 14.6 P4（页面拆分与组合式函数）：已完成 2026-09-17

| 项 | 结果 |
|---|---|
| 组合式函数 | `src/composables/usePagedQuery.ts`（列表页通用的"查询＋分页＋竞态丢弃＋resetKey 重置"）、`src/composables/useAsync.ts`（按钮动作的 busy/error/run）。已改接 `views/assets/AssetsView.vue`、`views/assets/AssetPicker.vue` |
| 拆页 | `views/ingestion/ChannelWizard.vue` **827 → 735 行**：两个"变更确认"弹窗抽为 `ConnectionChangeModals.vue`（`defineModel` 双向绑定 + 两个事件）；`settings()` 抽为纯函数 `views/ingestion/channelSettings.ts`（含 `ChannelFormState` 类型，表单在两处共用同一形状） |
| 规则收紧 | `max-lines` 由 warn **恢复为 error**（800 行），当前无违规；`complexity`/`max-lines-per-function` 仍为 warn（`resume()` 复杂度 52 等 6 处，属后续拆页工作） |
| 类型化 | `ApiError` 去掉 TS 参数属性（显式字段 + 赋值），使 `api/http.ts` 可被纯 Node 直接导入（单测无需构建步骤）；`channelSettings` 的参数由 `Record<string, any>` 换成 `ChannelFormState` |
| 验证 | `npm run build` 通过；lint 警告 **290**（294 → 292 → 290，且 `max-lines` 由 warn 变 error 属额外收紧）；控制台镜像 `0.2.0-dev.18` 重建；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS |

未改接的 5 个列表页（`IngestionView`/`RunsView`/`ModelsView` 双列表/`DatasetsView` 基于 offset 的分页/`DeliveryLedger` 双列表）保留各自实现：它们的筛选条件、双列表与 offset 分页与 `usePagedQuery` 的契约不同，强行套用会引入行为差异；随这些页面的拆分一起迁移。

### 14.7 P5（单元测试与门禁）：已完成 2026-09-17

不新增依赖：使用仓库既有的 Node 测试运行器（`node --test`），把控制台逻辑的单测放进 `tests/console-*.test.mjs`，因此 CI（`tools/verify-product.py` 第 32 行）与本地同一命令即可覆盖。

| 测试文件 | 覆盖 |
|---|---|
| `tests/console-channel-settings.test.mjs` | 全库/表清单/注册 SQL 三种 MySQL 形态、文件通道的交付契约与三种解析器分支、REST 通道在连接模板上的覆盖 |
| `tests/console-stores.test.mjs` | 项目 store 的加载/总数/默认选中、角色→能力（VIEWER/ENGINEER/OWNER 三档）、**过期响应丢弃**（先发的请求不得覆盖后发的页） |
| `tests/console-composables.test.mjs` | `usePagedQuery` 的分页/搜索/失败报告/resetKey 回到第一页 |
| `tests/console-routes.test.mjs` | 只有登录页是 `public`、`/` 重定向到工作台、菜单与 `meta.title` 一一对应、**仅"数据开发"受角色限制**、页面名唯一、未知路径落到 404 |

配套改动：`tests/helpers/console-alias.mjs` + `console-alias-hooks.mjs` 提供"TypeScript 风格解析"（`@/` 别名、无扩展名相对导入、裸包解析到 `apps/console/node_modules`），让单测直接加载**与打包器相同的源文件**，而不必把相对路径塞进应用代码；`tools/verify-product.py` 与 `apps/console` 的 `test:unit` 脚本都带上该加载器。

验证：`node --import ./tests/helpers/console-alias.mjs --test tests/*.test.mjs` → **144 项（142 通过、1 跳过、1 项既存 openpyxl 失败）**；新增 15 项控制台单测全绿。

### 14.8 阶段状态

| 阶段 | 状态 | 备注 |
|---|---|---|
| P0 工具链（Prettier + ESLint） | ✅ 完成 | 见 §14.1、§14.2；警告基线 316 → 290 |
| P1 路由与页面层 | ✅ 完成 | 见 §14.3 |
| P2 Pinia 与统一 API 客户端 | ✅ 完成 | 见 §14.4；token 层已删除 |
| P3 通用组件 | ✅ 完成 | 见 §14.5；仅抽出有真实重复的组件 |
| P4 页面拆分与组合式函数 | ✅ 完成 | 见 §14.6；`max-lines` 已收紧为 error |
| P5 单元测试与门禁 | ✅ 完成 | 见 §14.7；无新增依赖 |

**仍未完成（明确不在本次范围或属后续工作包）**：`complexity`/`max-lines-per-function` 仍为 warn（6 处复杂函数，随剩余页面拆分收口）；剩下约 290 条告警主体是未类型化的行数据（逐页 DTO 化）；`AppStatusTag`/`AppReasonField`/`AppFilterBar` 待相应页面重写时抽取；文档 44 的界面重构（Monaco、DiffView、全屏抽屉）未纳入本次迁移。

### 14.9 反馈统一到 UI 库的 Message（2026-09-17 修复）

用户报告：进入「资产目录」立即出现一个**空错误框**，且要求所有信息提示改用 UI 库的 Message，而不是放在页面里。

**根因**：`useAsync()` 返回的是普通对象，模板对它内部的 ref **不做自动解包**；`AssetsView` 的模板写了 `v-if="listError || inspect.error"`，`inspect.error` 是 ref 对象本身（恒为真），于是空框常显。同一类写法在别处也可能踩到，所以顺手在模板中只使用解构后的 ref。

**改法**：新增 `src/composables/notify.ts`（`createDiscreteApi(['message'])`，懒创建、无 DOM 时回退 `console.warn`，因此单测可直接导入）与 `src/composables/useErrorToast.ts`（`useToast(ref, level)`：监听到消息→弹 toast→清空来源 ref）。12 个视图与 `AppLayout` 的页内错误/成功提示全部改为 toast；`ConnectionChangeModals` 去掉与父级重复的错误框；`ChannelWizard` 的预检失败改为 toast。

**保留为页内内容的提示**（不是通知，不该消失）：SQL 面板的规则说明与校验问题列表、「按表清单/整表」等策略说明、预检发现的表数量与不支持对象、RunsView 的"确认含义"说明、SettingsView 的资源类型说明。这些是页面内容的一部分，转成 toast 会让用户无法回看。

**验证**：`npm run build` 通过（0 error / 290 warning 不变）；`/assets` 与 `/runs` 实测 **0 个页内 alert**（探针脚本 `work/diagnostics/alert-probe2.mjs`）；`tests/sql-ingestion-ui.mjs` 更新为断言 `.n-message` 中的 `EXTRACTION_MODE_NOT_IMPLEMENTED`，真实浏览器验收 PASS；控制台镜像 `0.2.0-dev.19`；全量测试 144 项（142 通过、1 跳过、1 项既存 openpyxl 失败）。

### 14.10 列表页迁移（继续）：IngestionView 已完成

`views/ingestion/IngestionView.vue` 的"系统列表"改用 `usePagedQuery`：删掉手写的 `generation` 竞态守卫、`load()`、分页与项目切换的 watcher，改由组合式函数统一处理；保留 `load`（动作后原地刷新）与 `search`（回车/搜索按钮回到第一页）两种语义，模板里的内联 `page = 1; load();` 处理器一并改为 `search()`。净效果：该文件少约 20 行重复代码，行为不变。

验证：`npm run build` 通过（0 error / 290 warning）；控制台镜像 `0.2.0-dev.20` 重建；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS（该用例正好覆盖"接入管理 → 搜索系统 → 选择连接 → 打开向导 → SQL 面板"整条路径）。

**仍未迁移**：`RunsView`（多 tab，按 tab 切换路由与筛选）、`ModelsView`（数据集与模型包两个列表）、`DatasetsView`（offset 分页 + 导出）、`DeliveryLedger`（两个列表）——它们的契约与当前 `usePagedQuery` 不同，需要先扩展组合式函数（多列表/offset 模式）再迁移。

### 14.11 列表页迁移（继续）：RunsView 已完成

`views/runs/RunsView.vue` 改用 `usePagedQuery`：路由按 `tab` 分支（采集执行 / 查询审计 / 站内异常）仍写在调用处的 `route` 闭包里，`resetKey` 为 `[projectId, tab]`；手写的 `generation` 守卫、`load()`、`page` watcher 与"切 tab 重置"里的分页逻辑删除，筛选条件的清空与详情面板关闭保留在视图自己的 watcher 中。行数据类型由 `Record<string, any>` 收紧为 `Record<string, unknown>`。

效果：告警 290 → **288**（基线同步下调）；镜像 `0.2.0-dev.21`；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS（用例进入运行中心，覆盖该页渲染与菜单路由）。

### 14.12 浏览器验收覆盖全部页面（Round 2）

`tests/sql-ingestion-ui.mjs` 末尾新增一轮页面冒烟：依次打开 `/overview`、`/models`、`/datasets`、`/settings`，断言**页头标题**（`header h1`，即路由 `meta.title` 的唯一来源）与该页至少一张卡片可见，并沿用全局的 `pageerror` 收集（任何一页抛错都会让用例失败）。此前验收只覆盖接入管理、资产目录、运行中心三页，`/models`、`/datasets`、`/settings` 的重构没有真机守护。

顺带记录一个坑：最初用 `getByRole('heading', {name})` 定位页头会失败（页面里存在同文本的其它元素/角色歧义），改用 `header h1` 选择器后稳定。

验证：`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS（新增 4 条 `page renders with its heading and content`）。

**下一步（Round 3 起）**：迁 `DeliveryLedger` 需要先把 `load()` 的"计划 + 分页窗口"合并取数拆成两段（组合式函数管窗口分页，计划单独取），再迁 `ModelsView` 的双列表与 `DatasetsView` 的 offset 分页——这几处契约与 `usePagedQuery` 现有能力不同，属于"扩展组合式函数"的前置工作。

### 14.13 列表页迁移（继续）：DeliveryLedger 已完成

`views/assets/DeliveryLedger.vue`（交付账本，出现在"数据开发"页）原先的 `load()` 把**计划**与**分页窗口**合并成一次 `Promise.all` 取数，并自带 `generation` 守卫，窗口分页因此游离在组合式函数之外。现拆成：

- `usePagedQuery` 管窗口分页（`route` 为 `${route()}/windows?limit&offset`，`resetKey` 为 `[props.project, props.dataset]`）；
- `loadPlan()` 单独取计划（失败进 `planError`，由 toast 提示）；
- `load()` 保留原语义（动作后同时刷新计划与窗口），因此 `configure`/`reconcile`/`retry` 等调用点无需改动。

过程记录：脚本化删除时按"从 `let generation` 到 `load()` 结束"切片，误删了夹在中间的 `retry()`，被 `vue-tsc` 立刻抓出并补回——说明"机械替换 + 类型检查"这一组合确实有效。

效果：告警 288 → **286**（基线同步下调）；镜像 `0.2.0-dev.22`；`tests/sql-ingestion-ui.mjs` 真实浏览器验收 PASS（含 `/models` 页面渲染断言，账本即在该页）。

**剩余**：`ModelsView`（数据集 + 模型包两个列表）、`DatasetsView`（offset 分页 + CSV 导出）需要先给组合式函数加"offset 模式/多列表"能力；随后是逐页 DTO 类型化与 complexity 收口。
