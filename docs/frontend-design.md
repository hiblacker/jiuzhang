# 九章前端架构

> 更新：2026-10-21。前端开发和生产均通过 HTTP 调用真实 API；自动化测试可在网络边界替换响应，但应用启动不装配测试服务或本地业务数据库。
> [根开发规范](../AGENTS.md) · [UI 与 Vue 约定](ui-conventions.md) · [AI 开发规范](ai-development.md) · [总体架构](architecture.md) · [数据集快速操作](dataset-quick-start.md)

## 1. 当前范围

前端是全栈仓库中的 `apps/web`，承载数据源、数据集、任务、数仓、治理和系统管理页面。当前数据集有两个独立维度：定义方式为可视化选表或自定义只读 SQL；提供方式为直连数据源或写入数仓。当前 SQL、直连与快照入仓范围见[总体架构](architecture.md)和[数据集快速操作](dataset-quick-start.md)。

未开放的真实能力由服务端明确返回未实现或校验错误。页面不以本地样例结果替代真实请求，不连接源数据库或 Doris。

## 2. 技术栈

| 职责 | 选型 | 责任边界 |
|---|---|---|
| 应用与构建 | Vue 3、TypeScript strict、Vite、Vue Router | Composition API / `script setup`；页面懒加载 |
| 组件与样式 | Naive UI、CSS variables、scoped CSS | 复用现有主题和共享交互，不叠加另一套 UI 框架 |
| 客户端状态 | Pinia | 主题、导航和需要跨页保留的客户端状态 |
| 服务端状态 | TanStack Vue Query | HTTP 资源缓存、请求生命周期和失效刷新 |
| 接口 | OpenAPI 3.1、openapi-typescript、openapi-fetch | OpenAPI 是唯一传输契约；生成文件不手改 |
| 表单与文案 | Naive UI Form / FormRules、Vue I18n | 草稿与查询缓存分开；首期 zh-CN |
| SQL 编辑器 | CodeMirror 6 | 只负责编辑和语法高亮；服务端负责校验、执行和限制 |
| 数据流画布 | Vue Flow | 编辑节点与连线；具体支持范围由数据集服务端规则决定 |
| 图表 | ECharts | 按页面加载，图表数据来自真实接口 |
| 自动化测试 | Vitest、Vue Test Utils、Playwright、MSW | 网络替身只在自动化测试中使用 |
| 质量工具 | pnpm workspace、ESLint、vue-tsc、Prettier | web 与 contracts 分开构建，根命令委托给所属包 |

## 3. 目录和依赖

```text
apps/web/src/
  app/          应用装配、路由、导航、全局 provider
  pages/        页面级路由和跨领域协调
  modules/      sources、datasets、jobs、warehouse、governance、identity 等领域
  shared/       HTTP client、主题、无领域归属的 UI 与工具
apps/web/tests/ 自动化测试、测试网络替身与测试数据
packages/contracts/
  openapi.yaml  唯一接口契约
  generated/    由契约生成的 TypeScript 类型
apps/api/       Spring Boot HTTP 入口
apps/worker/    后台执行入口
modules/        Java 领域库
```

依赖方向为 `app -> pages -> modules -> shared`。页面可以组合多个领域的公开出口；领域模块之间不深路径互相导入。跨模块共享先检查已有公开 API 和实际消费者，只有能力有独立所有者时才抽取共享实现。

`apps/web/src/modules` 是前端领域目录；仓库根目录的 `modules` 是 Java 后端库，两者不共享源码或配置。契约包不依赖 Vue、Spring、ORM 或应用配置。

## 4. 请求与状态

请求链路统一为：

```text
Page -> domain composable -> repository/mapper -> shared HTTP client -> API
```

页面和业务组件不直接调用 `fetch`/Axios，不读测试数据。Repository 负责 HTTP 与 DTO 映射，不弹消息、不导航；错误展示由一个明确的页面或交互所有者处理。API 变化先更新 OpenAPI，再生成类型并同步 repository、mapper、界面和受影响测试。

状态所有权：

- Vue Query 保存服务端资源；Pinia 不复制列表、详情或权限数据。
- Pinia 保存跨页面客户端状态；组件用 `ref` / `reactive` 管理局部交互。
- 可分享的筛选、分页、排序和当前详情 tab 放在 URL。
- 编辑表单从查询对象建立独立草稿；取消不污染缓存，成功后刷新受影响查询。
- 测试替身、固定 seed 和模拟持久化只放在测试目录，不得从应用入口或运行时代码导入。

## 5. 组件化与复用

- 页面负责装配和路由协调；业务规则归对应 `modules/<domain>`；跨领域页面编排放在 `pages`。
- 新增 UI 前检索同领域组件、`shared/ui` 和 composables，读取实现与消费者；先复用已有行为，再组合 Naive UI。
- 简单基础控件直接使用 Naive UI；不为单次调用空包装基础组件，也不按行数拆分组件。
- 共享组件必须有清晰所有者和真实消费者；复用共享行为后验证所有受影响页面。
- 领域模块对外只通过 `index.ts` 暴露稳定入口，不创建覆盖全仓的万能 barrel。

## 6. 界面行为

页面使用统一的加载、空、失败和成功状态。表单包含领域校验、提交中防重、失败保留草稿和取消保护；请求错误只显示一次。Naive UI 的 `message`、`notification`、`dialog` 通过应用现有 provider 使用，不在 repository 或底层 API client 弹提示。

颜色和明暗主题使用语义 token；领域文案由 Vue I18n 管理。按钮、表格、选择器、焦点和错误行为遵守 [UI 与 Vue 约定](ui-conventions.md)，新增路由同步[页面矩阵](frontend-page-map.md)。

### 6.1 SQL 数据集工作区（2026-10-21）

参考 DataEase **v2.0.0**（提交 `4061cb39c4cf46255e786aa8c1a071c6e8c8df48`）的 [AddSql.vue](https://github.com/dataease/dataease/blob/4061cb39c4cf46255e786aa8c1a071c6e8c8df48/core/core-frontend/src/views/visualized/data/dataset/form/AddSql.vue) 与 [数据集定义表单](https://github.com/dataease/dataease/blob/4061cb39c4cf46255e786aa8c1a071c6e8c8df48/core/core-frontend/src/views/visualized/data/dataset/form/index.vue)，直接读取源码核对：前者 `getSQLPreview` 运行入口、左侧表/字段参考、右侧编辑器及其下方结果、可调整高度；后者提供字段管理与刷新数据。借鉴这些交互原则，不复制实现、不引入 Element Plus，也不把 BI 维度/指标、SQL 参数、多源关联视为本轮能力。

- 新建和编辑路由使用 `fullscreen` 元数据，WorkspaceLayout 保留身份/时区提供者，隐藏导航和通用页头，移除内容区外边距；不调用浏览器 Fullscreen API。编辑器采用固定页头、三步导航、固定底部操作栏和内部滚动，按 1280×1000 验收。主题操作仍由 app 通过 slot 装配。
- 流程为「定义取数 → 清洗与脱敏 → 输出与保存」。第一步只选源及表/SQL，成功读取结构后才能继续；第二步配置字段映射、trim、质量和脱敏（选表的可视化过滤也在这里），成功预览处理结果后才能进入第三步。名称、负责人和提供方式移到第三步；保存只更新草稿，发布仍在详情页单独执行。编辑已保存定义可沿用其结构进入第二步，处理预览仍需重新运行。
- 复用 `sources/SourceObjectList`、`SourcePicker`、`shared/editors/SqlEditor`、`DataPreview`、`CopyButton` 与 Naive UI `NSplit`。原组件缺少 SQL 与查询结果的联合布局，因此新增领域组件 `DatasetSqlWorkspace`，通过 reference slot 由页面装配来源，不让 datasets 深入 sources。共享编辑器和结果表的契约未改。
- `useDatasetDraftPreview` 分开拥有取数结果、处理结果及其有效性。第一步仅一次查询：SQL 使用空映射，选表使用恒等字段映射，发送的副本去掉清洗、图加工和治理配置，独立调试取数；第二步使用当前完整加工配置再查一次。结果分别明确标注「清洗与脱敏前」「已应用字段转换、清洗与脱敏」。两次受限查询不承诺来自同一源快照；原始取数结果继续要求服务端 `readSensitive` 权限。
- 修改 SQL/来源使两类结果与取数确认失效并返回第一步；字段/规则/画布变动仅清空处理结果，名称及输出配置变动不清空预览。独立修订号阻止过期取数/处理响应写回；同步互斥防止重复请求。治理检查以正式直连查询或完整入库运行为准，样本处理预览不承诺全量通过。
- 映射按源字段名保留用户设置与顺序，新字段追加，移除字段提醒；转换失败保留草稿以供调整。不把 SQL 类型变化静默覆盖用户设定的目标类型。切源/切定义方式清理字段，不让旧请求写回新草稿。API 失败仅由应用错误桥调用 Naive message。
- 复用评审：`DatasetSqlWorkspace` 扩展为全高布局；查询和处理缺少统一结果状态，新增领域展示组件 `DatasetPreviewPanel`，仍复用 `DataPreview`，不请求、不弹消息。输出配置以 `DatasetDeliverySettings` 维护发布锁和受控更新；主题/仓库词典由 app/page 装配。页面保留跨域的 SourcePicker/SourceObjectList/GovernanceBindingSelect 协调，不向领域组件引入其他领域内部实现。未增加依赖或后端/协议。

## 7. 验证与本地运行

`pnpm check` 执行契约生成、依赖边界、UI/i18n、lint、格式、类型、单元/HTTP 集成测试和构建。`pnpm test:e2e` 需要已经启动的本地真实服务，并运行数据集浏览器闭环；完整本地引擎验收使用 `bash tools/local.sh verify`。不把测试网络替身的结果当作真实 API 或引擎验证。

桌面浏览器验收固定 `1280×1000`，当前阶段不新增小屏专项。真实服务启动、账号位置、环境变量和验证入口见 [README](../README.md)；项目规范不记录个人 WSL 路径、工具安装位置或其他机器专属配置。
