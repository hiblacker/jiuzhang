# 17 合成数据 SQL PoC：P0 实施契约

日期：2026-09-10。范围：本地 Docker Desktop、纯合成数据。不连接 DevOps，不部署 NAS，不对外提供服务。用户已同意先进行合成数据 PoC；本文件的模拟规则不等于真实业务口径批准。

## 1. 工作包与验收

允许修改 `poc/synthetic-sql/`、对应测试及本次文档导航。用现有 Node 内置模块作为实验驱动、PostgreSQL 作为计算与查询存储。没有改选 Node 作为正式控制面：Java 21/Spring Boot、Vue/Naive UI、SeaTunnel、DolphinScheduler、dbt 仍按09号文档分切片准入。

P0 验收：固定合成输入 → 留存来源与批次 → 标准事件和团队区间 → 日/月指标与贡献明细 → 质量检查 → 不可变版本与原子指针 → 数据库授权视图。第二个模拟工单主题复用处理核心。通过黄金断言验证重复、冲突、迟到、重开、缺失/负耗时、未知状态、团队变更、上海跨日/月、缺失历史、月报B修订、旧运行拒绝发布和SQL权限。

不在本切片验收：真实源历史还原、用户真实审批、完整控制台/调度链路、百万行容量、300QPS、NAS兼容、生产安全或客户交付许可。

## 2. 执行前版本与依赖审查

精确值见 [实验依赖锁](../poc/synthetic-sql/dependencies.lock.json)。本机观察：Node 22.23.2、Docker Engine 27.5.1、Compose 2.32.4-desktop.1；NAS指定2.40.3尚未运行。运行引用使用明确版本 `postgres:16.15` 且仅允许使用本机缓存；不使用 `latest`，也不称其为“最新稳定版”。没有新增npm包、JDBC驱动或Python依赖。

已检查45个APK包名称/版本/许可证，以及另行构建的PostgreSQL、镜像脚本、gosu 1.19及其Go运行时/moby user/x/sys依赖。`.postgresql-rundeps`没有许可证字符串，但实查为0字节、无文件的虚拟依赖包，不是未识别程序；实际依赖逐项列入锁文件。APK中包含GPL/LGPL、Apache、MIT/BSD等，不能把镜像整体称为PostgreSQL许可。现有Node版本的LICENSE含其内置第三方声明；测试工具不随客户镜像分发。

本次评估仅支持本地、无分发、无业务数据实验：不修改这些第三方组件、不产生对外交付镜像。没有发现清单中的非商业许可；不等于法务签字、完整SBOM二进制证明、CVE扫描或Docker Desktop组织使用资格确认。生产/客户交付仍阻断在固定源码对应性、NOTICE/源码提供义务、漏洞和组织授权复核；不把已有Docker Desktop视为本项目可再分发开源组件。

公开证据于2026-09-10通过HTTP获取，内容摘要哈希入锁文件；浏览搜索无可用结果，没有伪造浏览引用。镜像实际源提交未建立签名证明；当前公开Dockerfile仅用于解释构建方式，不充当精确来源证明。

- PostgreSQL许可：https://www.postgresql.org/about/licence/
- 镜像脚本MIT：https://raw.githubusercontent.com/docker-library/postgres/master/LICENSE
- 镜像构建：https://raw.githubusercontent.com/docker-library/postgres/master/16/alpine3.24/Dockerfile
- gosu许可/依赖：https://raw.githubusercontent.com/tianon/gosu/1.19/LICENSE ，https://raw.githubusercontent.com/tianon/gosu/1.19/go.mod
- moby user许可：https://raw.githubusercontent.com/moby/sys/user/v0.1.0/LICENSE
- x/sys许可：https://raw.githubusercontent.com/golang/sys/v0.1.0/LICENSE
- Go运行时：https://raw.githubusercontent.com/golang/go/go1.24.6/LICENSE
- Node与内置第三方：https://raw.githubusercontent.com/nodejs/node/v22.23.2/LICENSE
- PostgreSQL视图及锁：https://www.postgresql.org/docs/16/sql-createview.html ，https://www.postgresql.org/docs/16/explicit-locking.html

## 3. 合成口径（仅实验）

来源状态映射在主题模型中：DevOps模拟 `todo/done/reopened`；工单模拟 `new/resolved`。不是实际STORY/DEFECT值映射。核心只处理通用 `open/done/unknown`。不支持的删除事件阻断构建，不自动当关闭或直接丢弃；真实删除语义仍待确认。

- RAW键 `(domain,event_id)`；同键同内容重放幂等，同键异内容报错，不静默覆盖。首入仓时间/批次保留；重复传输的逐次审计留待后续。
- 对象键 `(domain,object_id)`；团队历史键增加 `valid_from`；半开区间禁止重叠，缺团队归属为 `UNKNOWN`。没有完整历史声明时，期末库存为NULL而非0。
- 事件保留事件时间、来源更新时间、入仓时间、批次。构建以显式入仓水位过滤；历史团队和映射为本轮固定模型输入，版本随代码固定，暂不支持在线修改。
- 上海时间半开日/月窗。模拟完成状态事件次数、周期内完成对象去重数、有效耗时总秒数/样本数/均值。月值重扫月明细，不加日均值或日去重数。
- 完成事件显式提供本次周期开始时间；不从不可靠旧日志猜起点。缺起点/负时长排除耗时分母并记录质量项；零样本均值NULL及原因。重开再完成是第二个事件、同一对象。
- 完成流量归属事件时团队；期末存量归属期末之前团队。各团队distinct不能无条件再次加总为跨团队distinct。期末取边界前最后事件；未知状态或历史不完整导致该分组库存NULL并给出原因。
- 日/月贡献明细保存release_id，报表必须先固定release_id再查询/下钻。授权按独立数据库身份对应主题/团队，统计归属与当前访问授权分开。

## 4. 发布与月报B

整个实验数据集版本独立构建，保存规则版本/输入水位/指标/明细，校验后READY；发布在事务中锁活动指针，比对预期旧版本、生成序号与水位，拒绝过期覆盖。首次月结及月结后修订都要求显式审批记录。测试使用明确标识为synthetic的审批身份，只验证门禁，不代表用户已批准任何真实月报；月结日仍未定，不自动按5日关账。

月内版本可滚动替换，旧版本留存；月结后新数据生成新revision，审批后切指针，原版本不改。版本内容和状态推进置于事务；生产审批权限分离/防篡改审计、规则及维度独立版本管理是后续任务。

## 5. 运行与恢复

执行入口、迁移校验和及实验结果见 [PoC说明](../poc/synthetic-sql/README.md)。每次验证使用专用容器内一个新的合成数据库，不修改既有实验库；保留数据卷与所有实验结果。不执行 `down -v`、不清理源库或已有容器。初版迁移完成执行后不得原地修改；本轮已含V001/V002，后续按V003+前向迁移，失败时保留旧发布并重新构建。

## 6. 实际执行记录

2026-09-10本地两次独立实验库运行均通过，未清理前次数据。检查结果：37项Node测试（原有32项+5项P0静态/契约测试）、36项SQL/集成断言。后者包含两个独立数据库会话同时竞争同一指针，一次成功、一次CAS拒绝；不是仅用内存模拟并发。Compose项目`bdw-synthetic-p0`为healthy，未映射主机端口。完整原始实验结果留在忽略的`work/`；可提交的合成摘要见[执行结果](../poc/synthetic-sql/results.json)。

| 合成DevOps / alpha / 2026年1月 | 原版本 | 迟到修订版本 |
|---|---:|---:|
| 完成事件次数 | 4 | 5 |
| 完成对象去重数 | 3 | 4 |
| 有效耗时总秒数 | 21600 | 43200 |
| 有效样本数 | 2 | 3 |
| 平均耗时（小时） | 3 | 4 |
| 月末未完成存量 | 1 | 0 |

unknown状态/不完整历史分组库存为NULL；不是全部分组均为上述完整值。完成流量仅统计明确的合成完成事件，未知状态不猜为完成；正式发布还需按数据集阻断未知状态或暴露流量完整性，不能将P0的软告警默认用于真实报表。两个主题只证明生命周期模型与发布复用，并不证明财务等不同粒度主题无需新增模型。

本次未执行：真实源联调、Java/Naive UI、SeaTunnel/调度/dbt整链路、真实数据库登录/用户认证、查询限流与连接池、生产审批权限分离、漏洞扫描、备份恢复、NAS部署、百万行/300QPS。P0模拟审批不是用户验收。下一切片优先补流量完整性门禁、独立执行/发布/登录账号及发布失败恢复，然后逐项接入控制面和开源执行组件；每新增依赖先固定版本并审查许可。

## 7. 切片2执行记录（2026-09-11）

范围：流量完整性硬门禁、独立执行/发布/登录账号、发布失败恢复。仍在`poc/synthetic-sql/`本地合成实验内，无新增npm/Python依赖，`dependencies.lock.json`不变；新增前向迁移V003（V001/V002未改动，校验和复核一致）。

### 已实现与验证

- **按数据集的流程完整性门禁**：`warehouse.flow_status`在构建期按domain聚合事件与快照完整性（未知状态、无归属对象、不完整快照任一存在即该domain不完整）；发布时未通过domain必须有带审批人与理由的`warehouse.flow_exception`豁免记录，否则拒绝发布。豁免与月结审批相互独立；月结先查审批再查豁免。`flow_status`受BUILDING期不可变触发器约束，发布后不可改判。报表侧新增`reporting.release_flow`，与指标同一授权范围可见各domain完整性，不完整可见而非伪造。
- **发布失败恢复**：门禁拒绝后断言release保持READY、活动指针不变，补记豁免后同一版本重试发布成功；原有"构建失败保旧指针"与并发CAS单胜者断言继续通过。
- **账号分离**：`p0_worker`（NOLOGIN）只能经SECURITY DEFINER函数调用`raw.ingest`与`warehouse.build`，对raw/warehouse表无任何直接权限；`p0_publisher`（NOLOGIN）只能调用`warehouse.publish`并写审批/豁免表，不能构建、接入、改状态或读raw。报表角色`p0_report_a/b`升级为真实LOGIN身份，密码为每次运行随机生成的hex，仅经stdin注入，不进argv、迁移文件、日志或报告；已验证pg_authid中为SCRAM-SHA-256存储，并以独立会话以`p0_report_a`登录探测`session_user`。
- **已观察边界**：该镜像本地socket认证为trust（来自`pg_hba_file_rules`实测），密码在TCP+TLS下的强制执行属于生产化工作，本切片未验证；结果JSON如实记录该限制。

### 验证与未测试范围

两次独立实验库运行均通过：Node测试39项（37+2静态契约），SQL/集成断言52项（原36+16项，含门禁拒绝/恢复、worker与publisher各自越权拒绝、报表完整性可见性）。并发发布仍为真实双会话CAS竞争。提交前执行语法检查、`node --test`、`node tools/check-docs.mjs`、`git diff --check`及暂存区敏感内容检查。

仍未执行：真实源联调、查询限流与连接池、报表产品对接、控制台/调度/开源执行组件、容量与恢复演练、NAS部署；模拟豁免与模拟审批不代表任何真实业务口径或用户验收。
