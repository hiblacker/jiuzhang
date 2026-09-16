# 九章产品工作台

Vue 3、TypeScript、Naive UI 与 Vite，固定依赖见 `package-lock.json`。工作台提供账号登录、接入管理、资产目录、数据开发、数据服务、运行中心及项目设置；使用 Spring Security 同源会话和 CSRF，不把凭证写入浏览器存储。

在仓库根目录执行：

```bash
npm ci --prefix apps/console --ignore-scripts --cache work/npm-console-cache
npm run dev --prefix apps/console
```

开发代理指向本机 `60185`。运行 `npm run build --prefix apps/console` 后再打 Java 包，`dist` 会纳入 JAR。容器也可使用 `deploy/Dockerfile.console` 构建独立静态服务，由同源代理转发 `/api/v1/` 请求和会话 Cookie。

发布后先使用 `tools/product-bootstrap.py` 创建一次性邀请，再用账号登录；页面不接收 Admin Token。操作、安装、升级和验证见[工作台手册](../../docs/41-product-workbench-runbook.md)。

常用检查：

```bash
npm run licenses --prefix apps/console
npm run typecheck --prefix apps/console
npm run build --prefix apps/console
python3 tools/verify-product.py
```

`npm test --prefix apps/console` 运行真实产品浏览器验收，需要手册指定的隔离集成环境。`tests/product-browser.mjs` 是当前工作台的端到端测试。`tests/console-ui.mjs`、`tests/schema-review-ui.mjs` 以及 `apps/console/tests/` 属于上一版令牌连接界面的回归资产，不作为当前账号工作台的通过证据。

一期静态页面保留在 [legacy.html](legacy.html)。生产环境使用 HTTPS；独立控制台服务器仅代理固定的控制 API 地址，不能作为任意转发器。
