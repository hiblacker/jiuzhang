# 九章数据平台部署入口

当前 Compose 是正式平台骨架的开发/测试部署入口，可在本地 Docker Desktop 和后续 NAS Compose v2.40.3 使用。它不会启动 `poc/` 中的实验组件。

## 名称与兼容性

产品名称为九章 · Jiuzhang，完整名称为九章数据平台 / JiuzhangData Platform。当前本地构建镜像为 `jiuzhang/control-api:0.1.0-dev.7` 和 `jiuzhang/ingestion-worker:0.1.0-dev.2`；这些名称不表示镜像已经推送到远程仓库。

Compose 示例继续使用 `-p bydw`，服务键和数据卷键保持原值，保证现有部署在更新镜像时继续定位原有资源。已有环境须沿用实际创建时的项目名（如 `bydw` 或 `bydw-foundation`）；仅修改项目名会创建另一组容器和数据卷，不会迁移原数据。重命名仓库目录后仍应显式指定同一项目名。

Java/Maven 命名空间 `com.bydw`、`bydw.*` 配置键、数据库名和角色名保持兼容，已执行迁移无需变更。API 状态接口的 `service` 字段改为 `jiuzhang-control-api`；依赖旧服务名的监控匹配规则需同步更新。Worker 的 Spring 应用名为 `jiuzhang-ingestion-worker`。旧版本验证记录中的镜像名称仍表示当时实际使用的制品。

应用回退使用原有明确版本镜像，并同步恢复监控匹配规则；本次改名不需要数据库迁移或数据重算。

## 本地启动

1. 在 `deploy/` 创建不提交的 `.env`，设置高强度 `WAREHOUSE_DB_PASSWORD`，以及至少 24 字符且两两不同的 `CONTROL_API_DB_PASSWORD`、`INGESTION_WORKER_DB_PASSWORD`、`CONTROL_API_ADMIN_TOKEN`、`CONTROL_API_WORKER_TOKEN`；可参考 `.env.example`。数据库拥有者、控制 API 登录和 Worker 登录不得复用同一密码。
2. 在仓库根目录执行：

```powershell
docker compose -p bydw -f deploy/compose.yaml config
docker compose -p bydw -f deploy/compose.yaml up -d --build
```

3. 检查 `http://127.0.0.1:8080/actuator/health` 和 `http://127.0.0.1:8080/api/v1/status`。来源/任务管理和失联批次对账接口使用 Admin Token；批次开始、心跳、完成、失败、重试和取消接口使用 Worker Token；检查点读取允许两者。除健康/状态接口外均须携带对应的 Bearer Token。

迁移服务必须成功退出，随后 `provision-roles` 为 `bydw_control_api_login` 和 `bydw_ingestion_worker_login` 设置登录密码，API 才会以受限控制角色启动。已经执行的迁移按文件名和 SHA-256 记录；不要修改已有迁移文件，变更使用新的 `VNNN__name.sql`。失败或取消批次通过 Worker Token 调用 retry/cancel 接口，不能直接修改数据库状态。独立 Worker 镜像 `jiuzhang/ingestion-worker:0.1.0-dev.2` 使用 Worker Token 和 `bydw_ingestion_worker_login`。先由管理员创建并激活任务，再执行 `docker compose -p bydw -f deploy/compose.yaml --profile worker run --rm ingestion-worker`。本切片只读取合成夹具，不连接 DevOps MySQL。

本项目镜像必须使用明确且唯一的版本标签。代码变化后递增开发版本序号，例如从 `0.1.0-dev.1` 升至 `0.1.0-dev.2`；禁止覆盖已被容器使用的标签，否则旧容器会在 Docker 界面中退回显示内部镜像 ID。Compose、Dockerfile 和运行命令均不得使用 `latest`、镜像 ID 或 digest 引用。

批次租约默认 300 秒，通过 `BATCH_LEASE_DURATION_SECONDS` 配置，允许范围为 30–3600 秒。Worker 应在租约过半前发送 heartbeat；管理员调度以小于租约时长的周期调用 `POST /api/v1/ingestion-batches/reconcile-expired?limit=100`。V007 升级会将没有租约的旧 RUNNING 批次标记为 `FAILED/LEASE_MIGRATION_REQUIRED`，升级前应等待在途批次结束或准备升级后重试。

## NAS 前置条件

- 使用 `/root/.docker/cli-plugins/docker-compose` v2.40.3，不混用 PATH 中的旧版本。
- 先确认 SSH/部署通道、x86_64 镜像支持、持久化目录、磁盘空间、备份目录和端口占用。
- `.env` 在 NAS 本地创建，权限限制为部署账号可读；不得通过 Git 保存或打入镜像。
- 首次 NAS 部署前导出 `docker compose config` 检查，不直接覆盖现有服务或复用未知数据卷。

当前尚未在 NAS 实测。外部 SSH 端口不可达时，只能完成本地部署验证，不能把 Compose 文件存在视为 NAS 部署完成。

## 入湖执行入口

真实 MySQL 测试源的本地原始接收由仓库根目录的 `tools/lake-ingest.mjs` 执行，默认写入 Git 忽略的 `.lake-data/`。测试源的 TLS 身份例外必须显式传入，不能写进通用默认配置：

```bash
node tools/lake-ingest.mjs --full --allow-unverified-test-tls
node tools/lake-ingest.mjs --daily --window 2026-09-15 --allow-unverified-test-tls
```

每日目录文件由外部传输工具放入管理员配置的 `--inbox`，每个文件用同名 `.done` 标志闭合，或在已完成复制后显式使用 `--assume-ready`。数据库、目录和可选 REST API 可以由单一入口编排，避免重复调度：

```bash
node tools/lake-daily.mjs --window 2026-09-15 \
  --inbox /data/inbox/source --allow-unverified-test-tls \
  --register --control-api http://127.0.0.1:8080
```

`--register` 会先用 Admin Token 登记清单，再用 Worker Token 登记数据库批次；两个令牌只从 `CONTROL_API_ADMIN_TOKEN` 和 `CONTROL_API_WORKER_TOKEN` 环境变量读取。未提供控制 API 时可省略该选项，原始文件仍按本地 manifest 封存。

REST API 配置只保存批准的 HTTPS 域名、分页契约和环境变量名；令牌通过运行环境注入，不写入 JSON、manifest 或浏览器存储。`apps/console` 是只读控制台，不能替代后台编排，也不需要页面保持打开。
