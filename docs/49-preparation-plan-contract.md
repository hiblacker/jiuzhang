# 数据集加工计划契约

状态：PREP-03 后端基础切片，尚未接入控制 API、编辑器和 Worker。不是新版数据准备整体交付。

## 实现范围

[PreparationPlan](../apps/control-api/src/main/java/com/bydw/warehouse/PreparationPlan.java) 将结构化步骤编译为 PostgreSQL 参数化查询。数据库执行继续复用 PostgreSQL，不引入 SQL 解析器、脚本引擎或新依赖。既有 Git/dbt 模型不变；本切片没有迁移、服务升级、业务数据修改或发布操作。

允许写入范围为该编译器、对应测试及此契约。完整功能范围继续以[数据准备实施记录](48-data-preparation-implementation.md)为准。

## 计划结构

```json
{
  "version": 1,
  "grain": "一订单一行",
  "uniqueKey": ["order_id"],
  "steps": [
    {"id": "source", "type": "INPUT", "binding": "orders"},
    {
      "id": "clean",
      "type": "SELECT",
      "input": "source",
      "fields": [
        {"name": "order_id", "expression": {"field": "id"}},
        {"name": "team", "expression": {"op": "TRIM", "args": [{"field": "team"}]}}
      ]
    }
  ],
  "output": "clean"
}
```

`binding` 只引用输入别名。真实表位置、字段类型与可加总语义由调用方在服务端完成授权、固定资产/发布版本后传入 `Input`，不能直接反序列化客户端 JSON 得到。编译器本身不负责鉴权、发布版本解析或读取真实源。

`Compiled` 返回查询、按占位符顺序排列的不可变参数列表、输出字段、实际引用的输入别名、拓扑排序后的步骤 ID。共享节点只生成一次 CTE；计划数组不必提前排序。

## 步骤与规则

| 类型 | 配置 | 已实现行为 |
|---|---|---|
| INPUT | binding | 读取服务端解析的输入表及字段，不接受原始 SQL |
| SELECT | input、fields | 字段选择、重命名、显式转换和受限表达式 |
| FILTER | input、mode、conditions | ALL/ANY；EQ/NE/GT/GTE/LT/LTE；IS_NULL/IS_NOT_NULL |
| DEDUPLICATE | input、keys、order | 按键去重；非键字段全部需要显式排序及空值先后，避免隐式决定保留记录 |
| JOIN | left、right、mode、on、fields | INNER/LEFT；同类型等值键；输出字段和左右来源显式指定 |
| UNION | inputs、mode | ALL/DISTINCT；字段名称、顺序、类型和语义标记必须相同 |
| AGGREGATE | input、groupBy、measures | SUM、AVG、COUNT、COUNT_ROWS、COUNT_DISTINCT、MIN、MAX |

表达式仅支持字段、类型化常量、CAST、TRIM、LOWER、UPPER、ADD、SUBTRACT、MULTIPLY、DIVIDE、COALESCE、CONCAT。转换失败由执行过程报告，不静默置空；COALESCE 的替代值必须显式配置。CONCAT 使用 SQL 空值传播，不隐式把空值改为空字符串。

- 平均值必须配置 `sumName`、`countName`，同时输出总和、非空有效样本数和均值。
- DIVIDE 的零分母返回 NULL；使用 numeric 运算避免整数相除及浮点精度损失。
- `ValueKind` 为 DETAIL、ADDITIVE、NON_ADDITIVE。平均值、去重计数、极值及比值属于 NON_ADDITIVE；禁止直接 SUM/AVG。服务端解析上游数据集时必须保留该标记。
- 字段选择、重命名、转换、空值处理和关联不会抹掉非可加总标记。复杂计算保守标记为不可直接加总。
- 语义标记只阻断已知错误，不证明不同批次/维度的统计总体互不重叠。跨周期合并仍须检查粒度、窗口、来源和契约。
- 不推断业务删除、负数、状态、历史归属和缺失快照规则。

## 校验与执行边界

未知配置属性、运算、字段、类型，重复步骤或输出字段，缺失引用、循环依赖、无关节点、缺失粒度和输出唯一键都会被拒绝。计划至多 64 步、200 输出字段、131072 字符；表达式深度至多 12、绑定参数至多 2000；常量长度及数值精度/指数另有限制。

所有标识符经过已有标识符白名单及引用函数；用户常量只进入 JDBC 参数，不拼入查询。测试覆盖注入形态文本不会成为 SQL。

编译成功仅证明结构和类型兼容，**不证明输出键唯一或数据质量合格**。后续 Worker 必须在隔离构建中执行、设置超时/时区/行数与输出体积上限，检查空键、重复键和其他质量规则；不能把预览 LIMIT 用作完整构建的截断。关联可能放大行数，正式发布必须经过质量门禁。

步骤 DAG 的循环检查不等于跨数据集依赖检查。后续保存服务必须在事务中检查数据集级依赖，运行固定上游发布版本、水位与授权范围；发布失败保旧、陈旧运行拒绝覆盖。当前尚未实现这层集成。

## 验证记录

2026-09-20，在单独创建的临时 PostgreSQL 16.15 容器中执行合成夹具，未连接运行中的业务数据库或源数据库。

- `PreparationPlanTest`：15 项通过；覆盖结构校验、注入形态、字段/类型、DAG、确定性去重、输出契约、聚合与非可加总属性传播。
- `PreparationPlanDatabaseTest`：4 项通过；实际运行清洗/过滤/去重/聚合、LEFT JOIN、UNION 两种模式、NULL、零分母、超过 JavaScript 安全整数范围的精确金额、共享 DAG 参数顺序和重复执行。
- 后端完整 `mvn test`：85 项通过，14 项既有环境条件集成测试跳过，0 失败。跳过项不作为通过证据。

复现命令（端口替换为独立测试容器发布端口）：

```bash
PREPARATION_TEST_JDBC_URL=jdbc:postgresql://127.0.0.1:51948/preparation_test \
  mvn -o -q -s deploy/maven-settings.xml -f apps/control-api/pom.xml test
```

测试仅接受回环地址及 `preparation_test` 数据库名，使用事务内临时表，结束回滚。测试入口不能指向产品数据库。没有完成端到端权限、实际源输入、跨数据集引用、Worker 运行、发布竞态及 60284 页面验收。

## 恢复

本切片无表结构和持久化契约变更，旧服务无需迁移。编译器尚无生产调用方；不改变现有模型执行或发布结果。后续集成需另附新增迁移和向前恢复说明，不得修改已执行迁移。
