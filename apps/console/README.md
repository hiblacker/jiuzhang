# 九章入湖控制台

Vue 3 + TypeScript + Naive UI + Pinia 控制台，覆盖运行、来源、接入计划、交付、资产、模型与数据集、项目权限。前端实现、构建及本机隔离浏览器验证已完成；真实 API 联调和容器运行尚未验证。功能范围见 [UI-02 实施记录](../../docs/38-vue-console.md)，最新结构和门禁见 [UI-03 重构记录](../../docs/39-console-refactor.md)。

固定依赖已于 2026-09-16 获用户批准。在 `apps/console` 目录执行（Node >=22.13；项目级国内镜像；禁用安装脚本）：

```bash
npm ci --ignore-scripts --cache ../../work/npm-console-cache
npm run dev
```

打开 `http://127.0.0.1:4173`，输入控制 API 地址和访问令牌。管理员选择平台管理；项目成员选择项目成员。令牌仅保存在内存，401 或重新连接会清除会话和数据。

如果控制 API 直接运行在 `http://127.0.0.1:8080`，需要在 API 进程环境中显式设置 `CONTROL_API_ALLOWED_ORIGINS=http://127.0.0.1:4173,http://localhost:4173`；不设置时保持同源/网关模式，不接受跨域请求。

计划的执行配置名对应 Worker 本地注册表。模型固定 Git 提交、模型包摘要和数据契约，候选通过质量门禁后才能发布。查询返回的 releaseId 用于后续翻页及当前页导出，修改表单不会悄悄改变已显示结果的导出范围。

构建与测试：

```bash
npm run licenses
npm run check
npm test
```

`npm test` 先构建，再运行浏览器测试。浏览器测试使用固定 Playwright 1.62.1；默认使用其 Chromium，也可通过 `PLAYWRIGHT_CHANNEL=msedge` 复用本机 Edge。本次使用 Edge 153.0.4234.32 验证。设置 `CONSOLE_URL` 可测试已启动的编译产物服务，不再启动 Vite。`tests/console.spec.mjs` 的 HTTP 替身全部为合成数据；`tests/server.spec.mjs` 额外验证真实本地同源代理，二者都不是 Java/数据库/Worker 联调。

真实接口回归入口已迁移到 Vue 控件：在仓库根目录设置 `LAKE_UI_URL`、`LAKE_UI_API`、`LAKE_UI_TOKEN` 后运行 `node tests/console-ui.mjs`。仅接受本地隔离测试 API，会创建合成来源、计划、项目、身份和成员，最后暂停测试计划但保留登记记录。可选 `LAKE_UI_WORKER_TOKEN` 增加文件 Worker/原件重解析；可选 `LAKE_UI_MODEL_PROJECT` 检查既有测试模型版本、发布、查询和导出。`node tests/schema-review-ui.mjs` 另需 Worker 令牌，用合成清单验证结构审批。上述入口尚待实际浏览器运行，不把源码迁移视为验收通过。

不依赖前端包的传输与服务行为测试可在仓库根目录运行：

```bash
node --experimental-strip-types --test tests/console-transport.test.mjs tests/console-server.test.mjs
```

构建产物为 `dist`，包含运行依赖 NOTICE。原生部署运行 `node server.mjs`；`PORT` 默认 4173，`HOST` 默认 127.0.0.1，`CONSOLE_API_ORIGIN` 默认 `http://127.0.0.1:8080`。访问页面同源地址即可通过受控代理连接 API。正式环境由 HTTPS 网关代理，不能将开发服务器作为生产服务。

容器入口为 [Dockerfile.console](../../deploy/Dockerfile.console)，Compose 中独立使用 `jiuzhang/console:0.2.1-dev.1`；此标签尚未构建或部署，不覆盖旧标签。无数据库迁移；恢复旧页面时同步恢复旧页面部署入口，不修改任何数据发布记录。

## 开发约束

- `app` 负责装配、布局、导航和会话协调；`stores` 仅保存共享状态。
- `features` 按业务组织 API、类型、页面和具名表单；不增加通用 Model/Repository 层。
- API 模块不得依赖 Pinia、Vue 组件或应用装配；ESLint 强制检查该边界。
- 令牌在会话协调层内存闭包中，不进入 Pinia state/action 参数或持久化；临时签发令牌仅在组件中展示。
- `npm run lint:fix` 修复 JS/TS/Vue；`npm run format:css` 只格式化 CSS。组件局部 CSS 通过 scoped src 引用。
- `npm run check` 执行零告警 lint、CSS 格式检查、单元测试、类型检查、构建和 NOTICE 打包；浏览器测试仍需单独运行。
