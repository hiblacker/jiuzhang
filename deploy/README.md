# 部署入口

当前 Compose 是正式平台骨架的开发/测试部署入口，可在本地 Docker Desktop 和后续 NAS Compose v2.40.3 使用。它不会启动 `poc/` 中的实验组件。

## 本地启动

1. 在 `deploy/` 创建不提交的 `.env`，至少设置高强度 `WAREHOUSE_DB_PASSWORD`；可参考 `.env.example`。
2. 在仓库根目录执行：

```powershell
docker compose -p bydw -f deploy/compose.yaml config
docker compose -p bydw -f deploy/compose.yaml up -d --build
```

3. 检查 `http://127.0.0.1:8080/actuator/health` 和 `http://127.0.0.1:8080/api/v1/status`。

迁移服务必须成功退出后 API 才会启动。已经执行的迁移按文件名和 SHA-256 记录；不要修改已有迁移文件，变更使用新的 `VNNN__name.sql`。

## NAS 前置条件

- 使用 `/root/.docker/cli-plugins/docker-compose` v2.40.3，不混用 PATH 中的旧版本。
- 先确认 SSH/部署通道、x86_64 镜像支持、持久化目录、磁盘空间、备份目录和端口占用。
- `.env` 在 NAS 本地创建，权限限制为部署账号可读；不得通过 Git 保存或打入镜像。
- 首次 NAS 部署前导出 `docker compose config` 检查，不直接覆盖现有服务或复用未知数据卷。

当前尚未在 NAS 实测。外部 SSH 端口不可达时，只能完成本地部署验证，不能把 Compose 文件存在视为 NAS 部署完成。
