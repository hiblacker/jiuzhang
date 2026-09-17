# 完整产品本地运行包

当前 [Compose](compose.product.yaml)提供 PostgreSQL、显式迁移、Java 控制 API、独立 Vue 工作台、Node 接入 Worker 和 Python/dbt 模型 Worker。新版安装、初始化邀请、三条操作主流程及升级步骤以 [产品工作台手册](../docs/41-product-workbench-runbook.md)为准。控制 API 的 JAR 仍包含同一份页面，可用于不启用独立控制台的部署。

## 固定构建

```bash
python3 tools/product-config.py --root work/product-next --env-file secrets/product-next.env
python3 tools/product-build.py
docker compose --env-file secrets/product-next.env -p jiuzhang-next -f deploy/compose.product.yaml config --quiet
docker compose --env-file secrets/product-next.env -p jiuzhang-next -f deploy/compose.product.yaml up -d
```

配置工具只创建新目录，默认不登记业务来源。API 使用 60283，工作台使用 60284；独立控制台通过同源代理转发会话 Cookie 与 CSRF 请求。页面使用账号会话，初始化使用 `tools/product-bootstrap.py`，不在页面粘贴 Admin Token。

Node 22.23.1、Python 3.12.14、PostgreSQL 16.15、MySQL CLI 8.0.43、57 个 Linux wheel、Debian 包与基础镜像版本继续固定。前端先 `npm ci` 和构建，再打 Java 包及独立控制台；Worker 镜像包含完整采集模块。API 默认标签为 `0.2.0-dev.18`、Worker 为 `0.2.0-dev.24`，控制台为 `0.2.0-dev.18`；已有标签拒绝覆盖。

构建默认复用 Maven 缓存；缺包时加 `--online-maven` 使用 [Aliyun 配置](maven-settings.xml)。npm 使用 npmmirror，Python 使用清华镜像且逐包校验哈希。[运行锁](product-runtime-lock.json)、[Python 锁](product-requirements.txt)、[Debian 锁](product-apt-packages.txt)和 [前端锁](../apps/console/package-lock.json)共同约束依赖。构建跳过测试，不能替代验收。

## 持久目录与兼容

- `PRODUCT_LAKE_ROOT`：原件、按来源账本、执行回执、模型工作目录与封存包。
- `PRODUCT_INBOX_ROOT`：外部工具落文件的目录，只读挂载；平台不依赖具体传输工具。
- `PRODUCT_CONFIG_ROOT`：批准资源注册表、认证引用与私有环境文件。
- `PRODUCT_MODELS_ROOT`：管理员批准的 Git 仓库，按实际项目授权；页面日常模型更新不重建镜像。
- 命名卷 `product-db-data`：PostgreSQL。禁止以 `down -v` 更新。

默认 Worker v2 仅登记文件资源边界；模型 Worker 在无批准仓库时空闲。旧 v1 profile 和镜像内 `/models.git` 只为兼容保留。批准边界配置修改后重启对应 Worker；业务连接/通道/计划修改通过控制面保存版本。

两个 Worker 共享 API 网络命名空间；更新 API 容器时一并重建 Worker。旧安装须补 `PRODUCT_MODELS_ROOT` 并停止旧静态页。切换按来源账本前先停旧采集进程，不让新旧 Worker 同时写同一湖目录。

## 验证和恢复

[一期验收](../docs/37-phase-one-acceptance.md)保留旧 V001–V017 容器与真实 MySQL 证据；[新版进度](../docs/40-product-workbench-progress.md)记录本批实际检查，不能混用。

已有合成容器环境可运行 `tests/product-compose-integration.py` 验证 v1 兼容；新版动态接入与浏览器流程使用 `tools/verify-product.py`；批准 `daily-files` 资源尚未登记的全新容器测试环境，可用 `python3 tests/product-compose-managed.py --settings secrets/product-next.json` 验证运行中的 v2 Worker 无需重启即可接入新通道。仅针对隔离合成环境运行，禁止套用在已投入使用的目录。

升级采用“暂停和排空 → 联合备份 → 停 Worker/API → 校验与追加迁移 → 配置角色 → 启动新版 → 核对旧 release → 恢复计划”。保留已执行迁移和历史数据，以向前修复恢复。原生 PostgreSQL 17 物理备份不能直接由容器 16 打开；异机/NAS/生产恢复须独立演练。
