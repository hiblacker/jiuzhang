# 产品工作台运行与操作手册

配套 [实施进度](40-product-workbench-progress.md)、[验收契约](39-next-product-acceptance-contract.md)。本手册对应新版 Vue 工作台与 Worker v2；一期历史证据保留在 [37 号记录](37-phase-one-acceptance.md)。

## 1. 新安装与登录

运行边界：PostgreSQL 保存控制元数据与候选/发布数据；Java 同时提供工作台与控制 API；Node 执行入湖；Python/dbt 执行模型。两个 Worker 使用不同数据库角色。HTTP 请求只提交任务或协调有界元数据。

依赖使用现有固定版本：Node 22.23.1、Java 21、Python 3.12、Maven 3.9；前端、Python、镜像及系统包分别由锁文件固定。新依赖下载使用 npm 中国镜像、Aliyun Maven 和清华 Python 镜像。容器构建使用新标签，拒绝覆盖已有标签。

```bash
python3 tools/product-config.py --root work/product-next --env-file secrets/product-next.env
python3 tools/product-build.py
docker compose --env-file secrets/product-next.env -p jiuzhang-next -f deploy/compose.product.yaml config --quiet
docker compose --env-file secrets/product-next.env -p jiuzhang-next -f deploy/compose.product.yaml up -d
python3 tools/product-bootstrap.py --api http://127.0.0.1:60283 --settings secrets/product-next.json \
  --identity platform_admin --display-name 平台管理员 --output secrets/product-next-invitation.json
```

打开 `http://127.0.0.1:60284`，选择“使用邀请码开户 / 重置密码”，从生成的私有邀请文件取值并设置密码，再用账号登录。邀请 24 小时有效、仅使用一次。页面不要求填管理令牌。60283 与 60284 都映射同一 Java 服务；选定一个地址持续使用，Cookie 按同源会话工作。新环境尚无业务来源和模型任务。

管理员在“项目与设置”创建项目、执行环境和资源。默认本机注册表为环境 `local-product`、文件资源/共享组 `daily-files`、Worker ID `lake-worker`；页面登记必须匹配这些实际引用。修改批准资源边界后只重启相应 Worker；业务通道新增、配置版本、预检、计划由工作台保存，日常接入不修改服务器 JSON。

原生开发：`npm ci --prefix apps/console`、`npm run build --prefix apps/console` 后再打 Java 包；dist 进入 JAR。开发服务器 `npm run dev --prefix apps/console` 默认代理本机 60185。生产 HTTPS 网关应设置 `BROWSER_COOKIE_SECURE=true`，本地回环示例为 false。实例的“生产/测试”标签仅用于目录分类，不增加权限。

## 2. 负责人：登记系统并接入每天的数据

1. **登记系统。** 在“接入管理”填写稳定编码、名称、业务/技术责任人、组织和并行任务上限，新增测试或生产实例。系统/实例暂停会阻止后代的新任务；在途任务按预览说明排空或取消。
2. **选择批准资源建立连接。** 一个系统实例可同时有 MySQL、目录和 REST 连接；同一连接可建立多个独立采集通道。页面不接收宿主绝对路径、任意 URL 或密码。
3. **目录入湖。** 外部工具把文件送达批准目录即可。选择相对路径、是否按 `YYYY-MM-DD` 分目录、每日文件集或交付清单、完成信号、应到时间、空交付/修订规则。逐格式配置 CSV 编码与分隔符、Excel 工作表与区域、JSON 记录路径；Parquet 自动读取结构。同名 `.done` 表示文件关闭；清单模式使用 `_delivery.json` 及完成标记。未交付、合法空包和部分到达分开记账。
4. **MySQL 整库。** 默认发现整库基础表；可显式限制表范围。预检只读元数据，页面展示基础表和不支持对象。确认后同批完成一致性快照；新增表/结构改变先阻断并审阅清单，旧批次不改写。MySQL 当前态不能补造过去历史。已授权测试源的 TLS 例外仍只对批准配置摘要生效。
5. **REST API。** 选择管理员批准的网络资源与认证引用，填写受限路径、记录路径、分页/最大页数及业务成功字段。平台保存响应并处理重复、限速与重试。next-link 不允许越过批准源。没有真实 API 合约时只使用模拟服务验收。
6. **测试与启用。** 保存草稿→Worker 预检→确认对象范围→填写业务时区、日期和时间→启用计划。文件/API 当前只支持 `Asia/Shanghai`，其他时区被明确拒绝；MySQL 支持有效时区。日常定时调度持续执行，今日手动采集复用幂等窗口。
7. **变更与交付约定。** 连接新版本不会静默迁移旧通道；调整通道时显式选择版本，先看差异、在途任务及下游影响，填写原因，重新测试和启用。在实例“每日交付”设置必需/可选通道和截止时间；冻结后的历史分母不随新约定变化。

资源共享组由管理员按实际数据库/目录/API 登记；别名须使用同一组。系统、执行环境、资源组都限制并发，API 还共享请求速率。配额等待不扣失败次数。预算中的文件大小指单文件、API 大小指单响应，MySQL 指完整快照；总磁盘容量另由 Worker 心跳展示，不能把这些上限当成总日吞吐或总容量保证。

## 3. 工程师：资产、模型与自动交付

管理员把 Git 仓库放在持久 `models/`，在 Worker v2 中批准仓库引用、模型子目录和实际项目 ID，在页面登记相同引用和授权。新安装的模型 Worker 没有批准仓库时空闲，不使用虚构项目 ID。该批准边界只需在接入新仓库时配置；仓库内日常模型提交无需重建 Worker 镜像。

1. 在“资产目录”按来源/对象搜索并分页查看批次、业务窗口、结构和完成状态。
2. 在“数据开发”选批准 Git 项目与分支/标签，提交打包。Worker 解析提交、封存已提交文件及摘要；未提交工作区文件不进入模型包。
3. 选择包、填写数据集名称，按输入别名选择项目资产对象，保存模型版本。选择完整资产批次并构建；同源多对象须来自同一完整批次。
4. 查看质量与节点依赖。非空、唯一、枚举、数值范围、引用、类型、新鲜度及行数变化规则在 Git 契约中版本化；阻断失败保留上次发布。
5. 负责人给出发布原因。后台再次检查当前模型、预期发布、输入新旧、来源状态与权限，随后原子切换。
6. 配置每日刷新：服务身份、模型版本、输入业务日偏移、工作日、触发/截止时间、最大跨源时差和新鲜度。默认人工发布；自动发布要求同模型已有人工首发及独立 OWNER 服务身份。
7. 同一完整输入集合只创建一次构建。更正包形成新集合；失败/取消可在窗口详情填写原因，用原固定输入重试，保留前次构建。质量失败须修复模型/输入。迟到人工策略需批准；暂停/撤权阻止后续领取或发布。

刷新计划固定采集计划版本，采集定义改变后必须审阅刷新计划。自动回看近 31 个业务日，更早更正按日手动对账。已发布、过期、等待输入和当前构建状态分别展示。

## 4. 查看者与日常运营

负责人在“项目与设置”邀请账号或创建独立服务身份，在“数据服务”配置允许字段和多个同时满足的行条件。查看者选择固定 release、字段、类型化筛选/排序查询，CSV 导出当前有界页；分页始终携带同一 release。查询审计保存身份、发布/策略版本、条件摘要、行数、耗时与请求 ID，不保存筛选原值和查询数据。

“运行中心”按系统、实例、连接、通道编码和状态组合筛选，查看执行/窗口、失败类别、重试、取消和结构审批；异常确认只记录责任人及处理意见，只有真实完整交付或成功发布才转恢复。站内异常不向外部发送通知。工作台汇总是当前项目范围；部分展示明确标识，不冒充全量。

## 5. 从一期升级和恢复

1. 暂停新增工作，排空/取消在途任务，联合备份 PostgreSQL、湖目录、Git 仓库与私有配置。已封存模型包默认在湖目录内，随湖备份；自定义 packageRoot 在湖外时必须另行联合备份。
2. 停止旧采集与模型进程，再升级 API/Worker；旧共享账本和新按来源账本不能同时被两版 Worker 写入。
3. 显式执行追加迁移 V018–V026，逐文件核对已执行校验和并配置角色。禁止编辑旧 V001–V017；应用启动不自动更新 Schema。
4. 先用 `existingSourceId` 补录原来源的系统、实例、连接和通道关联，保留 source/计划/批次/资产 ID、原件哈希及模型/release。审核资源边界后再预检和启用新计划。旧 v1 profile 兼容，直到显式切换。
5. 停旧独立静态页，使用新 JAR 的同源入口。容器两个 Worker 共享 API 网络命名空间，更新 API 容器时同时重建 Worker 容器。旧 Compose 配置需补充 `PRODUCT_MODELS_ROOT` 持久目录，并审查 v2 注册表。
6. 核对既有全库对象、原件引用、发布查询及无权访问拒绝后恢复计划。回退应用仍保留追加表和迁移账本，使用向前修复；不要以删卷、DROP 或复用 source 编码恢复。

独立恢复验收（新目录，保留原服务）：

```bash
python3 tools/local-stack.py restore --backup work/backups/warehouse-20260916-01 --destination work/product-upgrade-check
work/lake-review/dbt-venv/bin/python tests/product-upgrade-integration.py \
  --config secrets/local-stack.local.json --restored-root work/product-upgrade-check
```

该专用测试识别包含真实 157 表源的一期备份，比较备份发布表与升级后真实 HTTP 查询，不接触业务源。物理备份的 PostgreSQL 主版本必须匹配；原生 17 的备份不能直接交给容器 16。

## 6. 可重复验证与交付边界

[合成 CI](../.github/workflows/product.yml)固定 Action 提交、Node/Java/Python 和 PostgreSQL 镜像。安装锁定依赖后，提供独立回环 PostgreSQL 的 `LAKE_REVIEW_JDBC_URL`（库名必须 `lake_review`）、`LAKE_REVIEW_DB_OWNER`、`LAKE_REVIEW_DB_OWNER_PASSWORD`，设置 `LAKE_REVIEW_ALLOW_MIGRATIONS=isolated`、已安装文件解析 Python 的 `LAKE_PYTHON` 和 dbt Python 的 `LAKE_REVIEW_DBT_PYTHON`，运行：

```bash
python3 tools/verify-product.py
```

脚本运行前端类型/构建、Node、Python、真实 PostgreSQL/API/Worker/dbt、浏览器、规模、文档与 diff 检查。它不安装依赖、不读 secrets、不连接真实源。输出仅放 `work/product-review/`，含合成账号的私有文件不上传 CI artifact。未推送的工作流不声称 GitHub CI 已运行。

浏览器自动化与真实使用者验收分别记录。A18 需要一位未参与开发的使用者按上述步骤完成三条主流程；连续真实每日窗口、真实目录/API、NAS 和生产上线也须各自留证，不能由合成回放或等待分钟数替代。
