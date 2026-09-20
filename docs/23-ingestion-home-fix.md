# 接入管理首页可见性修复

## 范围

`/systems` 首页默认展示“数据源”，同级页签为“采集数据集”和“业务系统”。前两个列表使用现有项目级分页目录接口；打开记录复用原配置流程。新增接入仍通过“管理业务系统与新增接入”进入原流程，不代表独立数据源创建工作流已经完成。

OWNER / ENGINEER 可查询列表；VIEWER 可见页签和权限提示，但不请求工程目录接口。业务系统页保留原操作。`/assets` 仍是资产目录，不是接入管理。

## 原因与兼容性

此前页签仅位于业务系统详情内。另在当前锁定组件版本中，仅设置 TabPane 的 `tab` 属性会生成空标题；本次使用显式 `#tab` 插槽并用浏览器验证文字实际可见。不升级依赖，不修改数据库、权限或 API 契约，无迁移和历史重算。

## 验证与本地更新

- `npm run build --prefix apps/console`：类型、格式、静态检查和打包。
- `npm run test:unit --prefix apps/console`：控制台单元测试。
- `node tests/ingestion-home-browser.mjs`：启动本地已构建控制台，以合成 API 响应验证三个角色、首屏标题、列表切换、详情打开与返回及手机视口。
- `CONSOLE_TEST_URL=http://127.0.0.1:60284 node tests/ingestion-home-browser.mjs`：验证运行容器提供的真实静态资源，仍模拟 API，不写真实业务记录；不替代真实账号端到端验收。
- `node tools/check-docs.mjs` 与 `git diff --check`。

本地控制台镜像固定为 `jiuzhang/console:0.2.0-dev.27`；只更新 console，不重建 API、worker 或数据库。更新前保留原 console 容器为停止状态的回退副本。若需回退，停止新 console 后恢复原容器名称并启动；同时将 Compose 的 console 标签恢复到回退镜像版本，避免下次启动再次切换。此操作仅为本地开发服务更新，不代表生产发布或数据验收。
