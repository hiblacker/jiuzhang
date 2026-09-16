# 九章产品工作台

Vue 3、TypeScript、Naive UI 与 Vite，固定依赖见 package-lock.json。工作台提供接入管理、资产目录、数据开发、数据服务、运行中心及项目设置；使用 Spring Security 同源会话和 CSRF。

```bash
npm ci --prefix apps/console
npm run dev --prefix apps/console
```

开发代理指向本机 60185。运行 `npm run build --prefix apps/console` 后再打 Java 包，dist 自动纳入 JAR。发布使用 Java 同源入口，先以一次性邀请开户，再用账号登录；凭证不写入浏览器持久存储。

操作、安装、升级和验证见 [工作台手册](../../docs/41-product-workbench-runbook.md)。`npm test --prefix apps/console` 运行新版浏览器验收，需要手册指定的隔离集成环境；常用总入口为 `python3 tools/verify-product.py`。

一期静态页面保留在 [legacy.html](legacy.html)，旧 `tests/console-ui.mjs` 与 `tests/schema-review-ui.mjs` 为历史页面验收，不能作为新版通过证据。新版端到端测试是 [product-browser.mjs](../../tests/product-browser.mjs)。
