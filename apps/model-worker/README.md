# SQL 模型执行器

Git 固定的 dbt 项目、原始资产版本 → 隔离 PostgreSQL 关系表 → dbt 测试与平台唯一性/非空检查 → 冻结候选 → 项目管理员发布 → 按身份行列授权查询。平台 API 不接收 SQL、shell 或运行路径。合成主题位于 [models](../../models/commerce/contract.json)，它们不代表真实业务口径获批。

## 本机运行

先执行迁移 V001–V015，并为 `bydw_model_worker_login` 设置独立密码及 LOGIN。应用角色只继承冻结数据的读取权限；模型 Worker 只能为有效租约分配构建 Schema，冻结后丢失写权限。此实现的候选业务表与元数据位于同一 PostgreSQL 数据库内的不同 Schema/角色，物理分库尚未实现。

使用独立 Python 3.12 环境安装 [固定依赖](requirements.txt)：

```bash
python3 -m venv /path/to/model-venv
/path/to/model-venv/bin/python -m pip install --require-hashes --no-deps -r apps/model-worker/requirements.txt
/path/to/model-venv/bin/python -m pip check
```

当前 wheel 哈希锁对应 macOS arm64 本机验收组合：Python 3.12.14、dbt Core 1.11.15、dbt-postgres 1.11.0，54 个包。Linux amd64 的同版本发行物及三项文件解析依赖另有[57 包哈希锁](../../deploy/product-requirements.txt)，已实际构建和执行，见[完整容器运行包](../../deploy/PRODUCT_RUNTIME.md)。

原 PoC 的 1.12.4 锁保留。本轮 [PyPI 固定版本元数据](https://pypi.org/pypi/dbt-core/1.11.15/json) 和实际发行物核对后，选择不依赖下载式实验解析器的 Python v1 组合；全部包从清华源取得。具体版本、wheel 哈希和许可记录见 [runtime-lock.json](runtime-lock.json)。沿用项目既有内部验证许可边界；对外分发须包含 NOTICE 并复核锁中的 LGPL/Artistic/MPL 条目。

按[配置模板](../../docs/templates/model-runtime.example.json)登记项目 ID、Git 路径、输入来源映射和数据库凭证环境变量。凭证不放 Git。先从控制台创建项目、分配来源、完成入湖。

```bash
# WAREHOUSE_EDITOR_TOKEN：有该项目数据开发权限的身份，或本机管理员
/path/to/model-venv/bin/python apps/model-worker/register.py \
  --registry /private/model-runtime.json --ref commerce --code orders --name 订单明细 \
  --api http://127.0.0.1:8080 --revision HEAD

# CONTROL_API_WORKER_TOKEN、MODEL_DATABASE_PASSWORD 由环境注入
/path/to/model-venv/bin/python apps/model-worker/worker.py \
  --registry /private/model-runtime.json --api http://127.0.0.1:8080 --instance model-worker
```

`register.py --describe` 输出可在页面登记的模型 JSON。登记引用不可变 Git 提交与整个模型包摘要；未提交的 SQL 不会被执行。Worker 将输入来源绑定与 Git 契约核对，逐文件校验哈希后按声明类型装载，运行真实 `dbt build`。来源无历史时不凭当前状态补造历史。

页面中选择数据集，填输入映射如 `{"orders":"external:123"}` 并构建。质量通过的候选由项目管理员发布；并发候选检查同一预期 release，较旧输入拒绝晋级。模型版本、原件、输入时间、dbt 节点结果和发布原因保留。

查询参数仅支持 release、列、等值条件与有界分页；VIEWER 必须获得数据集授权，OWNER/ENGINEER 可在项目内查看。数值以 SQL 文本返回，避免浏览器丢失大整数/小数精度。CSV 导出使用同一授权和指定 release，响应给出 release/策略版本/行数；对公式起始字符添加文本前缀。

## 验证及恢复

[真实数据库集成测试](../../tests/model-product-integration.py)由 Java 的隔离数据库测试启动：目录接收 → 两套 Git/dbt 主题 → 真实 SQL → 质量失败保旧 → 冻结表禁止 Worker 修改 → 行列过滤 → 固定版本查询/导出 → 并发发布/旧输入拒绝。每个临时夹具仓库、工作目录和模型运行互相隔离。

回执先落 outbox 后提交；响应丢失重放相同完成请求。进程在回执落盘前终止时，租约过期后保留失败构建，重新请求新构建，不修改旧 Schema。恢复必须保留 PostgreSQL、湖区、模型工作目录和 Git 对象。联合备份恢复已通过本机 PostgreSQL 17 实测，见[运行手册](../../deploy/LOCAL_RUNTIME.md)；持续跨日与 Linux 打包分别验收。
