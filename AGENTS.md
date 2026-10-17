# 九章项目开发规范

## 项目概览与当前阶段

九章是三层数仓管理平台：数据源接入 → 数据集清洗/加工/脱敏/调度 → 仓库读写服务。任务、治理、血缘、审计和权限是配套能力。

当前已建立 Vue Mock 前端、OpenAPI 契约、依赖锁文件和本地质量检查；没有后端服务。已新增前端 GitHub Actions 配置，远端执行尚未验证。当前执行范围是 38 个路由的纯 Mock 前端，已完成 1280×1000 本地桌面验收；具体行为、证据与边界以 [页面矩阵](docs/frontend-page-map.md) 为准。后端与仓库设计属于后续阶段，不为完成前端而启动基础设施。

## 技术栈与选型状态

| 范围 | 项目决策 | 状态与边界 |
|---|---|---|
| 前端 | Vue 3、TypeScript strict、Vite、Vue Router | 已实现基础应用；使用 Composition API / script setup |
| UI | Naive UI、CSS variables、scoped CSS | 已选；不叠加 React/shadcn/Tailwind |
| 状态 | Pinia + TanStack Vue Query | 客户端跨页状态 / HTTP 资源缓存分别归属 |
| 表单与文案 | NForm/FormRules、Vue I18n | 首期仅 zh-CN；领域校验、labelKey 有所有者 |
| 接口 | OpenAPI 3.1、openapi-typescript、openapi-fetch | 唯一传输契约，生成文件不手改 |
| Mock | MSW、IndexedDB/idb | 只通过 HTTP 模拟接口；统一且可重置的数据源 |
| 编辑器/画布/图表 | CodeMirror 6、Vue Flow、ECharts | 按页面加载，不进入默认首页依赖 |
| 包管理与质量 | pnpm workspace、ESLint、vue-tsc、Vitest、Playwright | 本地命令已实现；根命令委托到所属包 |
| 未来后端 | Java + Spring Boot，API 与 Worker 两个进程 | 候选；JDK/框架/驱动兼容组合实施时验证并锁定 |
| 未来存储 | PostgreSQL 元数据、S3 兼容对象存储、Doris 分析仓库 | 规划；Redis 可选，不承诺多种元数据库同时兼容 |
| 未来调度与工程 | Quartz、Maven Wrapper/Flyway/ArchUnit/Testcontainers | 规划；具体版本与验证命令在后端启动阶段落实 |

前端精确版本以实际 package.json、.node-version 和 pnpm-lock.yaml 为准；后端 wrapper 仍为规划，CI 执行状态以实际记录为准。参考项目只贡献适用原则，不自动迁移语言、工具链或其专用规则。

## 架构与职责

- 前端：app → pages → modules → shared；app 装配，pages 处理路由和跨域协调，modules 拥有领域行为，shared 只存与业务无关的能力。
- 请求：page → 领域 composable → repository/mapper → 统一 HTTP client → MSW/真实 API；组件不直接请求或读取 fixture/Mock DB。
- 模块外只用公开入口；不深路径导入其他领域，不建全项目总 barrel；跨域例外记录原因、消费者和无环验证。
- packages/contracts 只拥有传输 schema、生成类型和虚构示例，不依赖前端、后端、ORM 或应用配置；不复制一套 DTO。
- 未来后端：Controller → Application → Domain/Port；Infrastructure 实现 Port，由应用入口装配；领域不导入 Web/ORM/数据库驱动。
- 仓库布局：apps/web 是前端，apps/api 与 apps/worker 是后端入口，modules/platform 是首期 Java 领域库（按包隔离），connector-* 按需建立；packages/contracts 是协议边界。详见 [全栈目录](docs/architecture.md#10-全栈仓库目录)。
- pnpm 只管理 web/契约工具，Maven 只管理 Java 应用/库；前端 src/modules 不等于根 modules。不为前端启动增加 JDK、后端或容器依赖。
- Connector SPI 与仓库 Port 不依赖宿主应用、鉴权、调度或数据库实现；具体适配器依赖 Port。抽成独立模块后必须单独构建/测试，根应用通过不能代替独立性验证。
- API 管用例与元数据；Worker 管受控读源、转换、质量、脱敏和发布。元数据库、原始对象存储与分析仓库各有职责，浏览器不连接真实源或仓库。

## 通用代码质量与复用

- 代码直接可读：明确命名、提前返回、清晰分支，避免多层嵌套和机械拆小函数。
- 单次使用的简单步骤保留在调用处；复杂领域规则、必要回调、公开接口或有独立验证价值的逻辑可单独命名，不把“只有一个调用方”作为禁止提取的绝对规则。
- 新增/修改 UI 前按行为检索现有业务组件、shared/ui 和 composables，读实现及调用方；先复用已有交互，再组合 Naive UI。新增说明候选路径与具体缺口。
- 按所有者和生命周期拆分；不按行数强拆、不空包装基础控件、不建立万能表单/表格或 common/helpers 大杂烩。
- 共享变化检查消费者；新依赖须说明能力缺口、兼容性和构建影响，不凭未来猜想增加包或微服务。
- 尊重工作区既有变更；不恢复已清理工程，不批量暂存无关变更，不改生成文件或削弱规则以通过检查。

## 契约与数据正确性

- 明确缺失、null、空字符串、0、false 的不同语义；PATCH 只更新提供字段，清空必须被契约允许，不能用 truthy/falsy 丢掉有效零值。
- ID 与超出安全整数范围的计数用字符串；高精度数据有精度/尺度定义，禁止隐式 Number 转换、截断、溢出或悄悄替换为 0。
- 发布版本不可变；运行绑定版本；重试生成新运行并关联旧运行。取消、失败、阻断不更新成功游标，终态及恢复遵循 [架构不变量](docs/architecture.md#64-数据正确性不变量)。
- 连接器声明的能力与真实验证匹配；Mock 的测试连接、SQL、Cron、吞吐与脱敏效果不构成真实能力或安全保证。
- 未来数据库/驱动/迁移变更按支持矩阵验证真实引擎，覆盖新建、升级、重启/重跑；Mock 和编译不等于数据库兼容。只验证受影响且承诺支持的引擎，不照搬参考项目的全数据库要求。

## 安全与配置边界

- 真实凭证、Token、连接串敏感部分和客户数据不进入源码、VITE_*、fixture、浏览器持久化、日志或错误详情。
- 当前演示身份只控制 UI；接真实后端后，由服务端检查对象权限、会话、导出、脱敏和状态迁移。
- 涉及真实认证/会话变更时查适用 OWASP ASVS 与专题指南，记录版本/适用控制和失败验证；不把文档要求当作已通过认证。
- 外部 HTTP/数据库访问只经受控适配器；查询参数绑定、标识符校验、超时、资源上限和密钥引用有统一所有者。
- 数据转换/序列化/错误处理放在已有边界；不在业务层重复构建 HTTP client、JSON 配置、日期/数值格式或脱敏日志工具。

## 规则入口与变更路径

- 产品与未来后端：[总体架构](docs/architecture.md)；当前阶段：[前端设计](docs/frontend-design.md)。
- UI 契约：[UI 与 Vue 约定](docs/ui-conventions.md)；执行协议/门禁：[AI 开发规范](docs/ai-development.md)。
- 前端先读 [apps/web/AGENTS.md](apps/web/AGENTS.md)，契约先读 [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md)。
- 修改未来后端 `apps/api`、`apps/worker`、根 `modules` 或 `infra/migrations` 时，须显式阅读并遵守 [后端规则](apps/api/AGENTS.md)。该文件是后端共用规则入口，不依赖对同级目录的自动继承；后续各目录规则只补充本地差异，不复制通用规则。
- 每次功能按契约 → Mock → repository → composable/组件 → 页面完成可验证闭环。契约变化同步生成、Mock、mapper、测试及受影响消费者。
- 文档优先更新已有权威文件；只有独立且长期维护的主题才新增，禁止把同一规则复制成多份。涉及第三方代码时保留实际许可与署名，仓库身份变更遵循用户明确范围。

## Git 分支、提交与合并

### 分支模型

- 采用 main 主干 + 短期任务分支，不默认增加长期 develop、frontend 或 backend 分支。前后端在同一仓库按功能协作，跨端契约变更可在同一任务分支完成。
- main 保持可集成；正式变更通过任务分支和 PR 合入。仓库当前主分支为 main，但首次进入其他检出仍须核对实际默认分支与任务基线，不能猜远端或覆盖已有约定。
- 人工任务分支使用 `feat/<scope>-<topic>`、`fix/<scope>-<topic>`、`docs/<topic>`、`refactor/<scope>-<topic>`、`test/<scope>-<topic>`、`chore/<topic>`；紧急修复用 `hotfix/<topic>`。名称使用小写英文、数字与连字符。
- AI 创建分支统一使用 `codex/<type>-<scope>-<topic>`，例如 codex/feat-web-source-editor、codex/docs-git-layout。已有同一任务分支则继续使用，不为每轮对话重建；用户指定名称优先。
- `release/<version>` 仅在确有并行版本维护时建立；发布标签使用 `v<semver>`，对应已验证提交。当前阶段不预建发布分支或标签。

### 开始任务与工作区保护

- 写代码前核对当前分支、任务基线、已暂存/未暂存/未跟踪变更、相关差异和已有 worktree；大规模清理用统计与目标路径检查，避免全仓刷屏。
- 新任务从已确认且包含必要前置工作的基线建分支；继续现有任务不得擅自切走。默认分支或远端归属不明确时先查证，不自动拉取并覆盖当前工作。
- 未提交修改跟随工作区，不因新建分支就实现隔离；不得把用户既有删除/修改顺带提交。新 worktree 默认也不带未提交内容，不得因从旧 HEAD 建工作区而复活已清理工程。
- 工作区存在无关变更时，优先保持现状并精确编辑/暂存；需要切分任务再选择可靠的提交基线或独立 worktree。不得自动 stash、reset、restore、clean 或丢弃变更以制造干净环境。
- 每个并行任务独立分支/工作区；单任务无需额外 worktree。为分支整理而移动、重建或删除工作区前确认变更归属与可恢复性。

### 提交与同步

- 采用功能块增量提交：一个功能块完成实现及对应验证后，立即在当前任务分支本地提交，不积攒到整个项目结束。功能块应是可独立审查的闭环（实现、契约/生成、Mock、必要测试和文档保持一致），不按文件数量机械拆分；未完成或验证失败的内容不得混入已完成块。
- 用户要求“完成一块提交一块”即授权当前任务后续按此节奏执行本地提交，无需逐次询问；该授权不包含 push、创建/合并 PR、标签或发布。工作区已有大量未提交成果时，先按依赖形成可验证基线，再逐块提交后续变更，禁止夹带旧工程清理或无关修改。
- 一个提交表达一个可审查目的，遵循 type(scope): summary，例如 feat(web): 支持数据源编辑；type 可为 feat/fix/docs/refactor/test/chore。契约变更将 schema、生成结果、Mock、mapper 与必要测试保持一致。
- 只精确暂存本任务路径或 hunks；暂存删除须逐项确认归属。禁止 git add .、git add -A 或 git commit -a 把历史清理/无关修改纳入提交。
- 提交前检查已暂存差异、空白错误、凭证/生成文件、相关验证结果；不得修改 Git 身份、伪造作者或为通过检查跳过已启用 hooks。
- 同步前确认目标 remote/branch。主干更新只快进；未共享的本人任务分支可在无关变更受保护且基线明确时 rebase，已共享/他人分支默认 merge，不改写他人历史。
- 解决冲突按双方业务意图处理，不整片采用 ours/theirs；契约/生成冲突先解决来源再重新生成，完成后复跑受影响检查。不确定的业务取舍才请求澄清。

### PR、发布与清理

- PR 说明问题、最终行为、范围、契约/迁移影响、实际验证和未验证项；UI 功能提供可审查的浏览器证据。先确认目标仓库/基线，不能仅凭 remote 名称向外提交。
- 默认 squash merge 一个聚焦任务；需要保留独立可追溯提交时说明理由并沿用仓库策略。合入前分支基于最新目标验证，检查和审查要求应由远端保护规则执行。
- 建议保护 main：禁止直接 push/force push，PR 检查与审查通过后合并；规则是否已配置须实查，文档不等于远端保护已启用。
- 提交、推送、创建/合并 PR、发布标签或删除分支按用户已授权范围执行；修改规范不代表要求立即执行这些操作。已明确授权的后续步骤不重复索要确认。
- 禁止普通 force push 和改写 main；确需改写本人已推送分支时，须有明确授权、核对远端最新提交并使用带预期提交值的 force-with-lease，遇到他人更新立即停止覆盖。
- 合并后清理仅限已完成且无独有未合入工作的任务分支/worktree；squash 后不能只靠祖先关系判断。先核对 PR/最终内容与工作区状态；未推送提交、未跟踪/忽略文件先保留，不自动强删。

## 验证与交付

以下命令已实现并可本地执行：check:contracts、check:boundaries、check:ui、check:i18n、lint、format:check、typecheck、test:unit、test:e2e、build、build:real。根 pnpm check 串联静态检查、单元/HTTP 集成测试及两种构建；浏览器流程另执行 pnpm test:e2e。本地通过不代表远端 CI 或分支保护已启用。

- 检查与风险相称，测试保护真实行为、跨模块契约和数据不变量；小改动优先扩展已有测试，不沿调用链每层复制同一组断言。
- 独立模块变化验证独立构建；持久化变化验证真实引擎；共享 UI 变化验证实际消费者；页面交付检查浏览器中的主要成功/失败/取消路径。
- 固定输入和可控时间，异步等待明确状态；不以随机数据、sleep、空 smoke 或覆盖率数字冒充质量。
- 交付说明变更、实际命令及结果、未验证项；区分方案、实现、测试和浏览器验收。没有运行的检查不得报通过。

AGENTS 是协作规则，不是沙箱或自动强制；机器规则需允许/拒绝样例和 CI 证明，语义复用与职责仍需评审。
