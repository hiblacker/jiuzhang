# 九章数据仓库工作台

2026-10-19：第一版本地单机真实闭环已实现，保留独立的 38 路由 Mock 前端。桌面验证固定 1280×1000。

## 第一版功能

- 系统账号登录/改密、用户管理、固定角色权限、审计。
- MySQL 只读连接、目录/字段发现、管理员原始预览、InnoDB 一致性全量读取。
- 单源单表数据集：字段选择/改名/精确转换、等值过滤、trim、必填/范围质量、字符串部分脱敏；草稿、不可变发布版本和恢复。
- 手动运行、日志、取消、新运行重试，同数据集最多一个活动运行。
- Doris 完整快照替换、表浏览、受控查询、本人 CSV 导出（24 小时过期）。
- 首次空批允许；非空→零行默认阻断，管理员可批准本次空覆盖，不能绕过读取/质量错误。当前快照保留，历史最多三份且被替换后最多七天。

暂缓其他连接器、CDC/增量/upsert、Join/聚合/任意 SQL 加工、Cron/依赖/补数/自动重试、多工作区、数据服务及生产集群。未实现入口显示说明，真实模式不回退 Mock。

## 启动真实版本

准备 .node-version 指定的 Node、根 package.json 指定的 pnpm、JDK 21、Python 3、OpenSSL 和可访问的 Docker Engine/Compose v2。在仓库根目录执行：

~~~bash
bash tools/local.sh up
~~~

顺序完成私有配置→PostgreSQL/MySQL/Doris/S3 就绪→源与仓库账号初始化→冻结安装依赖→Maven verify→显式 Flyway 迁移→API/Worker/真实前端。系统管理员由 API 首次启动初始化。首次需联网下载。Doris 需要足够内存/磁盘；Linux vm.max_map_count 建议至少 2000000，脚本只提示、不改宿主。

访问 **http://localhost:5175/login**。初始化账号/随机密码见未跟踪的 .env：JIUZHANG_BOOTSTRAP_USER / JIUZHANG_BOOTSTRAP_PASSWORD，在编辑器内查看，不复制到聊天/日志/Git。仅空账号表创建管理员，不覆盖已有账号。

~~~bash
bash tools/local.sh status
bash tools/local.sh stop            # 仅停止本脚本受管进程，保留数据卷
bash tools/local.sh start           # 使用已有构建，不安装/迁移
bash tools/local.sh stop worker
bash tools/local.sh start worker
bash tools/local.sh prepare         # 停止应用后安装/构建/迁移
bash tools/local.sh infra           # 单独准备基础服务
~~~

日志在 .local/logs/{api,worker,web}.log。升级先 stop 再 up，迁移时不能保留旧 API/Worker 连接。脚本不终止其他方式启动的进程，不清空卷，不修改 Docker 权限。使用同一具备 Docker 权限的账号，避免私有文件归属冲突；不要使用 --remove-orphans 或 down -v 清理数据。

手动三终端模式：bash tools/backend.sh api、bash tools/backend.sh worker、pnpm dev:real；进程由终端管理。启动采用不可变 jar 副本，后续构建不覆盖运行文件。

## 操作流程

1. 新建 MySQL 源：127.0.0.1:13306 / demo_retail / jiuzhang_reader，密码为 .env 的 SOURCE_READ_PASSWORD。本地关闭 TLS 使用固定公钥；外部源须启用 TLS。服务器不限制数据库主机白名单，但会拒绝未指定、IPv6、未分配、组播及链路本地地址。
2. 测试/保存→orders→创建数据集→配置字段/质量/脱敏→保存/发布→运行。
3. 仓库表查看当前快照→SQL 工作台→查询→导出 CSV→导出中心下载。

SQL 仅支持 SELECT *|字段列表 FROM 单逻辑表 [LIMIT 1–1000 [OFFSET n]]，默认 100 行、15 秒、10 MiB；拒绝函数/JOIN/子查询/多语句/内部表。CSV 只导出该查询结果。

## 权限与限制

admin 可管理用户/审计/原始预览和一次空覆盖；developer 可配置/发布/运行；viewer 可读仓库、查询和导出本人结果。当前无逐对象授权和独立 export 权限，私有结果按创建者隔离。敏感输出必须绑定启用脱敏，质量在脱敏前执行。

PostgreSQL 保存元数据及有上限的已处理查询/导出；原始所选字段批次存私有 SeaweedFS S3，Doris 存脱敏输出。历史与失败暂存产物回收。原始对象未启用服务端加密，本地基础服务之间未启用 TLS；生产密钥、TLS、备份、独立原始保留及负载验证待后续完成。

保护上限：200 表/200 字段、源扫描 100 万行/600 秒、原始批次 256 MiB、输出字符串 65533 字节。上限不是已压测容量。运行列表/部分累计统计最多最近 10000 次，首页汇总完整；仓库容量/趋势未采集。API/基础服务端口仅绑定回环地址，非生产部署方案。

## Mock 演示

~~~bash
pnpm install --frozen-lockfile
pnpm dev
~~~

访问 **http://localhost:5174**，无需后端/容器。MSW/IndexedDB 保存虚构数据；更多连接器、画布、前台调度、导入/血缘/服务为交互演示。端口/浏览器数据独立，重置清除本地修改；勿输入真实凭证/客户数据。

## 验证

~~~bash
pnpm check
./mvnw -B verify
pnpm --filter @jiuzhang/web exec playwright install chromium
bash tools/local.sh verify
~~~

verify 先在独立临时 PostgreSQL 库验证空库 V001–V006 与重复迁移，再按依赖创建合成源/数据集，验证真实接口/引擎/桌面流程，生成 .local/*-test.json；不能对生产运行。

本地完整重启验收会停止/重启受管应用并重新构建；存储故障验收会短暂停止本项目 S3 与 Doris FE，仅在没有其他运行时单独执行：

~~~bash
python3 tools/test-local-lifecycle.py
python3 tools/test-storage-recovery.py
~~~

独占 Worker 的真实崩溃测试（约三至五分钟等待自然租约到期）：

~~~bash
bash tools/local.sh stop worker
set -a; source .env; set +a
python3 tools/test-worker-recovery.py
bash tools/local.sh start worker
~~~

覆盖 MySQL 等待读取时 SIGKILL，以及 Doris VIEW 已更新而 PostgreSQL 成功事务未提交时 SIGKILL；结束移除专用触发器并停止自建 Worker。

2026-10-19 已运行 Maven verify（13 项）、pnpm check（93 项/双构建）、真实 API/引擎/1280×1000 页面；完整启停重建/数据保留、空库/重复迁移、MySQL 1200 行一致性扫描/并发写入/DDL 等待/取消、S3/Doris 故障恢复、历史表/对象回收、查询流式结果预算及过期 CSV 正文清理通过。相关 Mock 页面专项 23 项通过，历史 Mock 全量为 2026-10-17 的 190 项，不等同本次全量重跑。详细证据见总体架构 §14.7–§14.10。远端 CI/main 保护未验证，无生产性能结论。

## 工程入口

apps/web 前端；apps/api HTTP；apps/worker 执行；modules/platform 后端库；packages/contracts/openapi.yaml 唯一协议；infra/migrations/postgresql 迁移。pnpm/Maven 独立构建。

[总体架构](docs/architecture.md) · [页面矩阵](docs/frontend-page-map.md) · [开发规范](AGENTS.md) · [AI 规范](docs/ai-development.md)。
