# 九章入湖控制台

这是一个无构建依赖的只读控制台，调用控制 API 的 `/api/v1/lake/summary`、`/runs` 和 `/deliveries` 查询入湖账本。它不保存令牌，也不允许在浏览器中执行 SQL。

本地调试可以在仓库根目录执行：

```bash
python3 -m http.server 4173 --directory apps/console
```

然后打开 `http://127.0.0.1:4173`，输入控制 API 地址和 Admin Token。生产部署应由现有网关提供同源静态文件，并配置 HTTPS、CSP 和后端 CORS 策略。

如果控制 API 直接运行在 `http://127.0.0.1:8080`，需要在 API 进程环境中显式设置 `CONTROL_API_ALLOWED_ORIGINS=http://127.0.0.1:4173,http://localhost:4173`；不设置时保持同源/网关模式，不接受跨域请求。
