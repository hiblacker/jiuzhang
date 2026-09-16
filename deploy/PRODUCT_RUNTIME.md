# 完整产品本地运行包

当前入口为 [compose.product.yaml](compose.product.yaml)：PostgreSQL、显式迁移、角色配置、Java 控制 API、Node 接入 Worker、Python/dbt 模型 Worker、独立 Vue 控制台。前端构建与本机隔离浏览器验证已完成；本次 console 镜像和完整 Compose 尚未运行，边界见 [UI-02](../docs/38-vue-console.md)。原 [compose.yaml](compose.yaml) 保留早期合成 Worker 验证。已有真实数据的本机原生环境使用 [LOCAL_RUNTIME.md](LOCAL_RUNTIME.md)。

## 新环境启动

需要现有 Docker Compose、Java 21、Maven、Python 3.12 和 Git。当前容器固定为 linux/amd64；macOS arm64 验证使用 Docker 模拟，未验证 NAS。默认只监听本机回环。配置工具创建新目录及随机独立凭证，拒绝覆盖；不要复用其他项目的数据卷。

在仓库根目录执行：

```bash
python3 tools/product-config.py --root work/product-local --env-file secrets/product-local.env
python3 tools/product-build.py
docker compose --env-file secrets/product-local.env -p jiuzhang-product -f deploy/compose.product.yaml config --quiet
docker compose --env-file secrets/product-local.env -p jiuzhang-product -f deploy/compose.product.yaml up -d
docker compose --env-file secrets/product-local.env -p jiuzhang-product -f deploy/compose.product.yaml ps
```

页面 `http://127.0.0.1:60284`，API `http://127.0.0.1:60283`，数据库回环端口 57224。页面默认使用同源 API 代理，输入配置文件中的 Admin Token；令牌不保存到浏览器存储。可继续使用显式回环 API 地址与已批准 CORS。默认配置没有登记数据源或启动采集任务。

构建默认复用 Maven 本地缓存；缓存不完整时加 `--online-maven`，通过 [Aliyun 配置](maven-settings.xml) 下载。Python 从清华源下载精确版本并逐包校验哈希；镜像通过国内镜像路径取得。57 个 wheel 哈希已与官方 PyPI 元数据逐项核对。锁及内部许可边界见 [运行锁](product-runtime-lock.json)、[Python 锁](product-requirements.txt)、[Debian 锁](product-apt-packages.txt)。

默认生成 `control-api:0.1.0-dev.17`、`product-worker:0.1.0-dev.4`、`console:0.2.0-dev.1`。Worker 新标签仅反映镜像不再复制控制台源码，执行逻辑未修改；原有 dev.3 镜像不覆盖。已有标签时构建拒绝覆盖；代码变化后给对应的 `--api-tag`、`--worker-tag` 或 `--console-tag` 新值，并同步 Compose。`deploy/artifacts/build.json` 保存模型 Git revision、JAR 摘要、镜像标签和构建时工作树状态。API 构建步骤跳过测试；控制台构建执行类型检查但不执行浏览器测试，均不能替代验收检查。

仅更新页面可独立构建新标签的 `deploy/Dockerfile.console` 并更新 Compose 的 console 服务；构建使用国内 npm 源、精确锁文件及关闭安装脚本。运行镜像仅带编译产物、第三方 NOTICE、静态服务和 Node 运行时，不含 npm 构建依赖。固定前端依赖安装已获批准；以下镜像构建仍待可用 Docker 环境验证：

```bash
docker build --platform linux/amd64 -f deploy/Dockerfile.console -t jiuzhang/console:0.2.0-dev.1 .
```

执行前确认目标标签尚不存在；后续修改使用新标签。页面独立镜像尚未在本机实际构建。

## 接入配置与操作

1. 在页面创建项目、登记来源、将来源绑定到项目；实际目录和凭证由管理员配置到 `config/`，HTTP 不接收任意执行路径。
2. 目录默认 `daily-files` 对应 `folder-source`；外部把 CSV、xlsx、JSON/JSONL、Parquet 放入 `inbox/YYYY-MM-DD/`，以同名 `.done` 或已约定的交付清单闭合。按[交付契约](../docs/33-lake-implementation-design.md)配置单文件/多文件包、空交付、等待期和解析规则。平台不依赖具体传输工具。
3. 创建 FILE_SCAN 计划，runtimeRef 填 `daily-files`。后台每日触发，文件未齐按契约自动复查；页面提供暂停、补采、重试、取消、原件重解析和结果查询。
4. MySQL 与 API profile 使用[注册表模板](../docs/templates/lake-runtime.example.json)，路径改为容器内 `/run/secrets/` 和 `/data/lake/`。将所需配置、inventory、CA 放在 `config/`；源认证环境变量放 `config/source.env`。MySQL 默认严格 TLS，单次原始快照默认上限 4 GiB，可在受控 profile 设置 `maxSnapshotBytes`；超限不提交完成批次。仅已有测试例外可配置 `allowUnverifiedTestTls: true`，同时提供与源配置哈希一致的 `mysql-development-tls-authorization.local.json`；不会自动扩大授权。
5. 来源 Schema 改变时先阻断，页面展示差异；管理员写明理由后批准新清单/计划，下一执行使用新版本。旧原件和发布保留。
6. SQL 在 Git 模型目录修改并提交。模型镜像内 `/models.git` 是构建时的 Git bundle；新 SQL 提交需重建新的 Worker 镜像。填写 `model-runtime.json` 中实际项目 ID、来源映射，使用[模型登记工具](../apps/model-worker/README.md)描述或登记固定版本。页面选择输入资产，构建、查看质量、发布，再给用户配置数据集行列权限。

配置在 Worker 启动时读取；修改配置后重启对应 Worker。共享 API 网络命名空间，使 Worker 继续通过回环访问控制 API。更新 API 容器时一起重新创建两个 Worker 和页面。

## 验收、升级及恢复

独立合成环境的容器验收命令如下；会新增合成项目、来源和数据集，保留数据，最后暂停合成计划。不要对已投入使用的目录运行此测试。

```bash
# 使用已安装模型依赖的 Python；settings 与 env 来自同一次配置生成
python tests/product-compose-integration.py --settings secrets/product-local.json \
  --env-file secrets/product-local.env --project-name jiuzhang-product
```

已实际验证：V001–V017 新库迁移、已有迁移校验、三类数据库角色、容器文件入湖、真实 dbt SQL、质量发布、精确小数/前导零、VIEWER 行列授权和 Worker 重启。容器 MySQL 8.0.43 CLI 对真实测试源完成只读结构检查：157 表、0 未支持对象，与原生最新 Schema 相同。真实整库数据及每日主链路在原生环境验证，见[最终验收](../docs/37-phase-one-acceptance.md)。

已有环境按“暂停计划并等待任务结束 → 备份 → 停 Worker/API → 追加迁移及校验 → 配置角色 → 更新镜像并启动 → 核验旧 release → 恢复计划”前向升级；不要编辑已经执行的 V001–V017。失败保留数据和迁移账本，修正后继续前向恢复。

本轮实际联合备份还原使用原生 PostgreSQL 17 工具，见[手册与证据](LOCAL_RUNTIME.md)。容器 PostgreSQL 16 不能直接打开该物理备份。容器迁移到另一宿主前须停止写入并联合保留命名卷、湖区、Git 模型与私有配置；异机/生产恢复尚未演练，不把原生恢复结果套用于不同主版本。

本机验证环境可以 `docker compose ... stop` 停止并保留数据；禁止用 `down -v` 作为更新方式。当前未配置自动删除原件。单次快照限额不能代替磁盘容量监控及业务保留期。
