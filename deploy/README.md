# 部署入口

当前 Compose 是正式平台骨架的开发/测试部署入口，可在本地 Docker Desktop 和后续 NAS Compose v2.40.3 使用。它不会启动 `poc/` 中的实验组件。

## 本地启动

1. 在 `deploy/` 创建不提交的 `.env`，设置高强度 `WAREHOUSE_DB_PASSWORD`，以及至少 24 字符且两两不同的 `CONTROL_API_DB_PASSWORD`、`INGESTION_WORKER_DB_PASSWORD`、`CONTROL_API_ADMIN_TOKEN`、`CONTROL_API_WORKER_TOKEN`；可参考 `.env.example`。数据库拥有者、控制 API 登录和 Worker 登录不得复用同一密码。
2. 在仓库根目录执行：

```powershell
docker compose -p bydw -f deploy/compose.yaml config
docker compose -p bydw -f deploy/compose.yaml up -d --build
```

3. 检查 `http://127.0.0.1:8080/actuator/health` 和 `http://127.0.0.1:8080/api/v1/status`。来源/任务管理和失联批次对账接口使用 Admin Token；批次开始、心跳、完成、失败、重试和取消接口使用 Worker Token；检查点读取允许两者。除健康/状态接口外均须携带对应的 Bearer Token。

迁移服务必须成功退出，随后 `provision-roles` 为 `bydw_control_api_login` 和 `bydw_ingestion_worker_login` 设置登录密码，API 才会以受限控制角色启动。已经执行的迁移按文件名和 SHA-256 记录；不要修改已有迁移文件，变更使用新的 `VNNN__name.sql`。失败或取消批次通过 Worker Token 调用 retry/cancel 接口，不能直接修改数据库状态。独立 Worker 镜像 `bydw/ingestion-worker:0.1.0-dev.1` 使用 Worker Token 和 `bydw_ingestion_worker_login`。先由管理员创建并激活任务，再执行 `docker compose -p bydw -f deploy/compose.yaml --profile worker run --rm ingestion-worker`。本切片只读取合成夹具，不连接 DevOps MySQL。

本项目镜像必须使用明确且唯一的版本标签。代码变化后递增开发版本序号，例如从 `0.1.0-dev.1` 升至 `0.1.0-dev.2`；禁止覆盖已被容器使用的标签，否则旧容器会在 Docker 界面中退回显示内部镜像 ID。Compose、Dockerfile 和运行命令均不得使用 `latest`、镜像 ID 或 digest 引用。

批次租约默认 300 秒，通过 `BATCH_LEASE_DURATION_SECONDS` 配置，允许范围为 30–3600 秒。Worker 应在租约过半前发送 heartbeat；管理员调度以小于租约时长的周期调用 `POST /api/v1/ingestion-batches/reconcile-expired?limit=100`。V007 升级会将没有租约的旧 RUNNING 批次标记为 `FAILED/LEASE_MIGRATION_REQUIRED`，升级前应等待在途批次结束或准备升级后重试。

## NAS 前置条件

- 使用 `/root/.docker/cli-plugins/docker-compose` v2.40.3，不混用 PATH 中的旧版本。
- 先确认 SSH/部署通道、x86_64 镜像支持、持久化目录、磁盘空间、备份目录和端口占用。
- `.env` 在 NAS 本地创建，权限限制为部署账号可读；不得通过 Git 保存或打入镜像。
- 首次 NAS 部署前导出 `docker compose config` 检查，不直接覆盖现有服务或复用未知数据卷。

当前尚未在 NAS 实测。外部 SSH 端口不可达时，只能完成本地部署验证，不能把 Compose 文件存在视为 NAS 部署完成。
