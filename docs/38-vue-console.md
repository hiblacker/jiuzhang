# Vue / Naive UI 控制台建设

工作包：UI-02。范围为 `apps/console`、前端测试、页面部署入口及相关文档。后端业务契约、数据库迁移、Worker 和模型计算规则沿用一期实现。

## 验收范围

| 工作区 | 必须保留或补齐的操作 |
|---|---|
| 运行概览 | 来源筛选、运行摘要、最近系统运行、每日交付账本、运行详情 |
| 数据来源 | 登记来源、凭证引用、分页，超过 100 个来源仍可访问 |
| 接入计划 | 新建/修改不可变版本、保留交付契约、暂停/恢复、日期/时区/尝试/超时配置 |
| 执行与交付 | 触发、修订、检查遗漏、取消/重试、原件重解析、Schema 差异与理由审批、交付窗口 |
| 资产目录 | 项目范围、分页、结构/来源、系统批次覆盖 |
| 模型与数据集 | 模型登记、版本/契约、变更影响、候选构建、质量/依赖、取消、发布理由、发布历史 |
| 数据消费 | 固定 release 查询、筛选、列选择、分页、当前页 CSV 导出、行列授权 |
| 项目权限 | 项目、来源归属、身份签发/撤销、成员角色、OWNER/ENGINEER/VIEWER 控件边界 |

所有操作调用既有 `/api/v1` 接口。客户端隐藏控件仅改善使用体验，最终授权仍由服务端强制执行。模型 SQL 继续在 Git 维护，页面不执行任意 SQL 或 shell。

## 状态与安全约束

- 访问令牌只存在于内存；退出或 401 后销毁会话并中止请求，不写 localStorage/sessionStorage。
- 项目、数据集和身份切换时销毁旧视图及结果；过期请求不能回填到其他身份/项目。
- 查询响应中的 releaseId 固定用于翻页及当前页导出；修改表单但未重新查询不改变已显示结果的导出范围。
- 变更计划提交读取到的 expectedVersion；版本冲突保留表单并展示错误，不自动覆盖。
- 取消、暂停、重试、重处理和撤销需要确认；发布及 Schema 审批需要理由。
- 新身份令牌仅在独立对话框显示，关闭后清除，不混入操作详情或截图。
- 连接仅接受 HTTPS 或回环 HTTP；不接受 URL 中的凭证、查询参数和片段，不跟随重定向。

## 固定依赖

此次用户已要求完成 Vue/Naive UI 前端，沿用已批准技术路线；2026-09-16 用户以“没问题，批准。”批准以下固定组合安装。安装前已生成锁文件并核对官方元数据。

| 组件 | 精确版本 | 许可证 |
|---|---|---|
| Vue | 3.5.42 | MIT |
| Naive UI | 2.45.3 | MIT |
| Vite | 8.3.0 | MIT |
| @vitejs/plugin-vue | 6.0.9 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| vue-tsc | 3.3.11 | MIT |
| lucide-vue-next | 1.0.0 | ISC |
| @playwright/test | 1.62.1 | Apache-2.0 |

开发宿主为已有 Node 22.23.2 / npm 10.9.8，满足构建器 Node >=22.12 要求。容器沿用已锁定 Node 22.23.1-bookworm-slim。本切片使用 npm lockfile v3；仓库此前没有前端 pnpm 工程，为复用现有 npm 不额外引入包管理器。

完整直接/传递清单见 [dependency-review.json](../apps/console/dependency-review.json)，精确包及 SHA-512 见 [package-lock.json](../apps/console/package-lock.json)。安装脚本全部关闭。96 项包版本、完整性及许可证声明与官方 npm 元数据比对通过；2026-09-16 的 `npm audit --package-lock-only --registry https://registry.npmjs.org` 报告 0 项漏洞。这是该次公开数据库查询结果，不代替正式发布安全审批。

Lightning CSS 1.33.0 及其平台二进制使用 MPL-2.0，仅用于构建，未修改覆盖文件，也不复制进静态页面运行镜像。分发构建环境时须保留许可并履行覆盖源代码提供义务。其余依赖声明为 MIT、ISC、Apache-2.0、BSD-2-Clause、BSD-3-Clause。构建已打包 46 个运行依赖的 `third-party-notices.txt`。

4 个固定包未在 npm 发行物中附带许可文件：css-render 及两个插件的 MIT 文本来自发布提交的根 LICENSE，已保留[来源与全文](../apps/console/licenses/css-render-MIT.txt)；vdirs 0.1.8 的固定发行物只提供 author=07akioni / license=MIT 声明，补充[声明和标准 MIT 文本](../apps/console/licenses/vdirs-MIT.txt)，未虚构版权年份或声称找到了缺失的上游文件。补充规则绑定精确包名与版本，不自动豁免新依赖。以上是内部开发记录；对外分发前仍须组织许可审查。

## 验证与交付状态

UI-02 前端实现及本机隔离交互验证完成。7 个工作区覆盖上表的既有接口操作；后端、数据库迁移和 Worker 执行逻辑未修改。此结论仅指 Vue/Naive UI 前端，不是生产上线、真实业务数据验收或整个平台回归全绿声明。

验证环境：Windows、Node 22.23.2、npm 10.9.8、Microsoft Edge 153.0.4234.32，日期 2026-09-16。安装提示 lucide-vue-next 1.0.0 已弃用并推荐 @lucide/vue；本次保留已批准锁定版本，后续迁移须重新核对版本和许可。

| 验证 | 结果与证据范围 |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --cache ../../work/npm-console-cache` | 安装通过；未启用安装脚本 |
| `npm run licenses` | 96 项固定依赖与官方完整性、许可声明再次核对通过 |
| `npm audit --package-lock-only --registry https://registry.npmjs.org` | 0 项已知漏洞；不代表永久无漏洞 |
| `npm run build` | Vue/TypeScript 类型检查、Vite 构建、46 项运行许可打包通过；工作区按需加载，无超 500 kB 的单块 |
| `PLAYWRIGHT_CHANNEL=msedge npm test` | 构建后启动开发入口，24 项浏览器测试通过；使用已安装的 Edge，不另装浏览器 |
| `CONSOLE_URL=http://127.0.0.1:4174 PLAYWRIGHT_CHANNEL=msedge npm test` | 编译产物通过真实 Node 静态服务进行相同测试；24 项通过，业务 API 使用合成 HTTP 替身 |
| 独立同源代理浏览器测试 | `server.spec.mjs` 不拦截 HTTP 请求，使用真实本地 HTTP 上游，验证构建资源/CSP、代理鉴权、内存令牌和 NOTICE；不是 Java API 联调 |
| 截图与布局 | 7 个工作区在 1440×1000、390×844 下检查；计划表单补充 320×740，检查滚动、输入宽度、取消和无误提交 |
| 部署静态检查 | `docker compose -f deploy/compose.product.yaml config --no-interpolate --quiet` 与 `tools/product-build.py` 的 Python 语法编译通过；不代表镜像构建或启动通过 |

行为测试见 [console.spec.mjs](../apps/console/tests/console.spec.mjs) 与 [server.spec.mjs](../apps/console/tests/server.spec.mjs)。覆盖超过 100 个来源、来源凭证引用、计划版本与契约保留、时区/修订、恢复操作确认、Schema 理由审批、资产分页与项目切换、模型版本/影响/构建/取消/发布、固定 release 查询分页与 CSV、成员角色/行列授权、身份令牌销毁、401/403/409/503、迟到响应隔离、空项目、键盘标签页和桌面/手机布局。截图为 `work/console-{workspace}-{width}.png` 与 `work/console-plan-form-{width}.png`，仅含合成数据，不进 Git。

已执行的独立行为验证：`node --experimental-strip-types --test tests/console-transport.test.mjs tests/console-server.test.mjs tests/docker-image-policy.test.mjs`，8/8 通过。覆盖旧身份 401 迟到、响应解析期间登出/项目视图销毁、请求取消、令牌/重定向边界、CSV 内容保真、静态资源路径、代理限制和固定镜像版本。

旧 `tests/console-ui.mjs` 和 `tests/schema-review-ui.mjs` 已改用 Vue/Naive UI 控件，保留真实 HTTP 队列、可选独立文件 Worker、原件重处理、模型读取/导出及合成 Schema 审批测试。脚本通过 `node --check`；本机当前没有运行中的隔离控制 API，因此这些端到端测试尚未执行。

仓库扩大回归 `node --experimental-strip-types --test tests/*.test.mjs`：114 项中 80 通过、33 失败、1 跳过。将未修改的 `11322a0` 导出到隔离目录后同机复跑：107 项中 73 通过、相同 33 项失败、1 跳过；逐名比较无新增失败。失败涉及 Windows 目录 fsync 的 EPERM、路径分隔符、进程身份/恢复检查；未通过削弱数据持久化保障来让前端工作包变绿。结果日志位于 `work/ui02-current-tests.log` 和 `work/ui02-baseline-tests.log`。因此本次保留功能分支，不自动合入 main。

未执行：真实 Java API/Worker/数据库端到端联调、Linux console 镜像构建与 Compose 运行、NAS、容量与生产验证。当前 Docker daemon 不可用，旧本地隔离 API 也未运行；不使用旧 JAR 或虚构凭证替代当前后端。开发入口偶发 Vite/Naive UI `ResizeObserver loop completed with undelivered notifications` 提示；编译产物的对应操作和错误断言通过。未关闭 Vite 错误报告来掩盖提示。

完成检查：`node tools/check-docs.mjs` 校验 49 个 Markdown 文件和 13 条研究证据通过，`git diff --check` 与 `git diff --cached --check` 通过；暂存差异复核及已知密钥格式扫描未发现真实密钥、运行数据或构建二进制。此扫描不是企业级 DLP 保证。没有人工同行评审、远程推送、标签发布或生产部署。

## 部署与恢复

页面通过 Vite 编译至 `apps/console/dist`；原生运行入口为 `node apps/console/server.mjs`，端口由 `PORT` 配置，绑定地址由 `HOST` 配置，默认仅回环。固定管理员环境变量 `CONSOLE_API_ORIGIN` 指向控制 API；同源 `/api/v1` 代理只支持 GET/POST，拒绝重定向并限制请求体，不接受请求传入上游地址。

新增独立镜像 `jiuzhang/console:0.2.0-dev.1`，Compose 不再使用 Python 直接提供源码目录。构建入口为 `deploy/Dockerfile.console`；原生配置模板指向编译后服务。Worker 镜像移除旧控制台源码复制，构建默认标签递增为 `jiuzhang/product-worker:0.1.0-dev.4`；只改打包，不改执行逻辑，也未实际构建该新镜像。无数据库迁移和数据重算。需要恢复旧页面时，使用旧 Git 提交的页面和匹配的旧部署入口；不改变已发布数据 release 或模型版本。
