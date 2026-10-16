# 九章 UI 与 Vue 开发约定

> 2026-10-15 · 行为规范。核心组件和本地检查脚本已建立；候选清单中未被真实消费者使用的项目不要求生成空实现，完整交互验收仍在进行。
> 技术基线：Vue 3 + TypeScript + Pinia + Naive UI。来源：[new-api 对照研究](research/new-api-adaptation.md)。
> 本文维护 UI 行为契约；分层见 [前端设计](frontend-design.md)，执行流程和门禁见 [AI 开发规范](ai-development.md)，验收见 [页面矩阵](frontend-page-map.md)。

## 1. 复用顺序与组件所有者

新增或修改 UI 先搜索已有行为，再选择基础控件。只用了同一套按钮、弹窗，并不意味着复用了提交、确认、复制等行为。

1. 按用途检索所属 modules、shared/ui、shared/composables；阅读候选实现、公开入口和至少一个实际调用示例。既要查组件名，也要查行为，例如“删除/确认/pending”。
2. 同领域已有业务组件，优先复用；跨领域通过页面协调公开组件，不为复用深入导入别的 module。
3. 已有通用行为组件，优先使用它的 props、emits、slots；需要扩展时保持既有消费者契约。
4. 当前没有对应行为所有者，使用 Naive UI 组合实现；明确职责后放在领域内或 shared。
5. 引入另一套实现前，记录候选路径、缺失能力、不能组合或兼容扩展的原因。文案、图标、颜色、尺寸不同通常不是理由。

基础层直接使用 Naive UI。具有多步交互、焦点管理、错误恢复、统一布局语义的封装才有独立价值；不建立只透传 NButton/NInput 属性的 AppButton/AppInput。

| 类别 | 位置 | 负责 | 不负责 |
|---|---|---|---|
| 基础控件 | naive-ui 包 | 按钮、输入、菜单、原生组件能力 | 每个业务操作的请求与成功语义 |
| 通用行为 | shared/ui、shared/composables | 确认、复制、异步状态、通用列表布局 | 数据源/数据集/任务规则、领域请求 |
| 技术集成 | shared/editors、shared/graph | 第三方实例、resize、销毁、只读接口 | 数据集发布、SQL 执行与权限决策 |
| 业务组件 | modules/<domain>/components | 本域表单、列定义、状态解释和操作 | 跨域内部实现、全局主题配置 |
| 页面容器 | pages | 路由、跨域组合、页面布局与导航 | 重新实现复制/确认/错误恢复 |

复杂公共组件以独立目录组织，index.ts 是公开入口；README 记录契约与真实消费者，__tests__ 保存行为测试。简单纯工具可以单文件，不为统一形式增加空目录。不得建立聚合全部 shared 或全部 modules 的总出口。

## 2. 公共能力建设清单

以下是计划和首批消费者，不是已有组件索引。B0 只建立实际使用的能力；B1/B2 遇到稳定共同契约时补齐，其余不提前生成空文件。

| 候选公开入口（相对 apps/web/src） | 契约和职责 | 首批真实场景 | 批次 |
|---|---|---|---|
| shared/ui/page-header | 标题、说明、面包屑、actions slot；不读路由或领域 Store | 工作台、数据源列表 | B0/B1 |
| shared/ui/async-state | 无缓存首屏的 loading/error/empty/success；retry emit 与成功内容 slot | 概览、源列表/详情 | B0/B1 |
| shared/ui/confirm-dialog | 受控开关、pending、错误、确认/取消及焦点；不发请求 | 删除数据源、删除数据集 | B1/B2 |
| shared/ui/copy-button | 复制值、可访问名称、成功/失败反馈与复位 | 源 ID、任务 runId | B1/B3 |
| shared/ui/query-toolbar | 搜索/筛选/操作 slots 与响应式排列；不定义业务筛选 | 源列表、数据集列表 | B1/B2 |
| shared/ui/list-page | 工具栏、表格区、批量区、分页区的组合布局；不接管数据 | 源列表、数据集列表 | B1/B2，经第二个场景再确认 |
| shared/composables/use-clipboard | 浏览器复制、结果和清理；供 CopyButton 复用 | ID、错误 requestId | 随 CopyButton |

SourceConnectionForm、DatasetFieldTable、ScheduleForm、RunTimeline、MaskRuleEditor 等仍归各自领域。StatusBadge 的通用外观可以复用 NTag；把业务状态映射为文字和严重程度的规则仍归领域。全局提供者和主题装配只在 app 中定义一次。

## 3. 弹层与提交生命周期

### 3.1 控件选择

| 场景 | Naive UI 基础能力 | 业务约定 |
|---|---|---|
| 简短提示、操作结果 | NMessageProvider / useMessage | 一次操作只产生一次提示；失败不能伪装成功 |
| 就地警告、说明 | NAlert | 可行动错误留在当前上下文 |
| 危险操作确认 | NModal 的 dialog preset，组合 ConfirmDialog | 显示对象及影响，确认后等待实际 mutation 结果 |
| 用户输入/编辑 | NModal + NForm，或领域表单页 | 明确标题、验证、dirty 和失败恢复 |
| 详情/筛选侧栏 | NDrawer + NDrawerContent | 标题、关闭路径、焦点恢复与未保存保护 |
| 短上下文操作 | NPopover / NDropdown | 键盘入口与关闭行为一致 |
| 列表空态/首屏占位 | NEmpty / NSkeleton，经 AsyncState 协调 | 未加载不展示空态，有旧数据时不整页闪白 |
| 状态和轻量进度 | NTag、NProgress、NSpin | 状态同时有文字；演示指标标明 Mock |

不得套用 shadcn 的 asChild/render、组件 Group 层级、Spinner 写法或 class API。以实际安装版本的 Naive UI 类型、文档和本地封装为准；普通按钮可直接使用其 loading/disabled 能力。

### 3.2 ConfirmDialog 的可审查契约

- 输入：show、title、description、pending、error、confirmText、cancelText、destructive、disabled；复杂说明使用 slot，不传业务实体使组件猜操作。
- 输出：confirm、cancel、update:show。confirm 只表达意图；Vue emit 不承诺等待调用方的异步函数。
- 父级交互所有者负责 pending/error、mutation、缓存刷新和关闭。只有成功才关闭；失败保留弹层并显示可重试原因。
- pending 时防止重复点击，禁用确认、取消、遮罩关闭与 Escape；这里不承诺可以取消已经发出的写请求。非 pending 时有明确取消路径。
- 有可访问标题和描述；危险操作初始焦点偏向取消；关闭后回到触发点。删除后触发点消失，回到列表中稳定的下一项或标题。
- destructive 只改变视觉和交互语义，不执行删除。默认确认组件不弹全局错误 toast，避免与父级重复。

示例所有者：SourceDeleteAction 负责源 ID、引用冲突说明和 useDeleteSource；ConfirmDialog 负责交互；repository 只负责 HTTP。错误 409 留在弹层；成功关闭并刷新对应列表/详情，当前页空且页码大于 1 时退回上一页再查询。

### 3.3 编辑表单

- 首期使用 NForm + FormRules；纯业务校验函数位于领域 model/validation，再被规则适配。不要同时维护 NForm、Zod、另一套表单库三份等价字段规则。
- OpenAPI 是传输类型来源，FormDraft 可独立于 DTO；mapper 明确默认值、空值、类型转换、只读字段和敏感字段处理。前端体验校验不替代后端验证。
- 初始化生成脱离 Query cache 的草稿；组件不修改 props 的嵌套对象。首次加载与同一资源后台刷新区分，刷新不能覆盖用户正在编辑的 dirty 草稿。
- 资源 ID 改变时，按是否有未保存草稿处理；异步校验结果需确认属于当前字段/当前资源，过期结果不覆盖新输入。
- 提交先校验；无效时定位首个错误。合法提交进入 submitting，重复点击不产生第二次写请求；错误保留输入。
- API 字段错误由模块 mapper 转换到 FormDraft 字段路径，通过 NFormItem 的反馈/验证状态呈现；无法匹配的错误放表单顶部。
- 取消、路由离开、切资源使用同一 dirty 决策；保存成功后建立新的 clean 基线。不得通过刷新整页同步数据。

## 4. 表格与 URL 状态

采用“Naive 表格 + 通用布局/交互 + 领域列定义”，保留 NDataTable 的能力，不创建万能 JSON 表格引擎。

- module 拥有 columns、领域状态文案、行级权限、行操作、Query keys 和 repository。shared 不接收 entityType 后自行请求。
- page 拥有 URL；领域函数解析并归一化 query。关键词、筛选、排序、页码参与 query key；缺省值、非法值、允许排序字段和最大 pageSize 有明确规则。
- URL 是可分享条件的权威来源。搜索框可有尚未提交的局部文本；提交或 debounce 后统一写 URL，筛选变更重置 page=1；不使用两个 watch 互相同步并触发两次请求。
- 处理前进/后退、直接链接、刷新；去掉空参数和默认参数。不能盲信 route.query 的类型。
- rows/total 是 Query 数据，selection 是当前交互状态。行 key 使用稳定业务 ID，不使用数组下标；筛选、资源/工作区变化时清理不再有效的选择。
- 默认“已选”仅作用于当前可见页；如业务需要跨页选择，必须明确提示范围并设计独立状态，不能隐式对未见数据批量操作。
- 首屏无数据的失败用 AsyncState；后台刷新失败保留旧表格并显示提示/重试。empty 区分“没有资源”和“筛选无结果”。
- 分页和虚拟滚动按数据量选择。日志、字段等长列表不能一次挂载全部节点；宽表有横向滚动、稳定操作列、长文本完整查看路径。
- CopyButton、ConfirmDialog 已存在时行操作直接复用，不在 columns render 中重复实现定时器、剪贴板 fallback、弹窗状态机。

## 5. Vue 响应式与数据所有权

| 原则 | 九章实现 |
|---|---|
| 派生状态 | computed；不把计算结果复制进 Pinia 或 watch 链 |
| 输入契约 | defineProps/defineEmits 明确类型与语义；受控组件由父级写状态 |
| Pinia 订阅 | 状态/getter 需要解构时使用 storeToRefs；action 可单独解构 |
| props 读取 | 默认 props.xxx；不机械照搬 React 的“禁止解构”。依赖响应性时明确 refs/getter，按已锁 Vue 版本验证 |
| 领域 composable | 组合 Query/mutation、编辑会话与生命周期，不把所有页面逻辑堆到 useEverything |
| 查询 | 保留响应式 ID/筛选，传递 AbortSignal；不要把 props.id 的初始快照永久用作 query key |
| 副作用 | watch 用于外部状态同步；事件处理用户动作；computed 处理纯派生。无正当理由不 deep watch 整份表单或全局 Store |
| 清理 | onScopeDispose/onUnmounted 释放事件、timer、editor/chart 实例；watch 清理处理过期异步任务 |
| 昂贵实例 | 经实际需要使用 shallowRef/markRaw，不对编辑器/图实例做无意义深响应转换 |
| 性能优先级 | 先消除独立请求串行、按路由加载与减少重型依赖；再基于实测处理局部计算/渲染 |

使用 Vue 3.5+ 的 onWatcherCleanup 时在同步回调阶段注册，不能等 await 后才注册；采用 watch 提供的 onCleanup 也需在任务失效前建立取消路径。API 请求优先走现有 Query/repository，不因为提供此规则在组件中另写请求 watcher。[V1][V2]

不机械迁移 useMemo/useCallback/React.memo、Rules of Hooks 或 Server Components 规则；不为了性能牺牲单一状态所有者。Provide/inject 只用于明确的上下文能力，必须有类型、provider 归属和缺失处理，不能成为隐藏的全局业务服务定位器。

## 6. 主题、文案与可访问性

### 6.1 主题

- shared/theme 定义语义 token：surface、surfaceRaised、textPrimary、textSecondary、border、accent、success、warning、danger，以及 spacing/radius/density。app/theme 将其装配为 Naive themeOverrides 和 CSS variables；组件不反向 import app。
- 一份语义色表驱动 Naive 和自定义区域。颜色、圆角、间距新增先查 token；业务组件不随手堆 hex/rgb 或独立暗色体系。
- 图表序列颜色、用户设置的业务标签色可有专门调色板，放在负责模块并说明用途，不通过检查器全局放宽主题限制。
- 统一 NConfigProvider/消息/弹层 provider 的装配；不在每页创建一套。弹层层级跟随库与布局设计，不靠随意增加 z-index 修遮挡。
- scoped CSS 负责组件布局，CSS Grid/Flex 与 gap 组织间距；不引入 Tailwind/UnoCSS 来迁移参考项目的 class 写法。

### 6.2 文案与国际化基线

B0 接入 Vue I18n，首期只交付完整 zh-CN 文案，不新增英文翻译工作量和语言切换页面。i18n 是文案所有权与后续扩展能力，不把“有语言框架”报告为“已支持多语言”。

- app/i18n 负责装配；shared/i18n 拥有通用消息；modules/<domain>/locales/zh-CN 拥有业务消息，并经该模块专用公开入口 locales/index.ts 提供。该轻量入口只导出词典，由 app/i18n.ts 按需加载，不 re-export 组件或业务 index；ARCH-03 仅允许此装配方访问。纯函数返回 code/labelKey，由展示层翻译。
- 启动只加载公共词典；路由异步加载其领域公开出口的词典，完成后再渲染。跨域页面声明所需词典，避免首次展示 key；不得为了词典在 app 启动时静态导入全部 module 入口而提前加载所有页面/编辑器。
- 枚举仅存 labelKey，渲染时 t(labelKey)；禁止在模块顶层执行 t 并缓存最终文案。Query cache 保存稳定业务 code，不存翻译结果。
- API 错误由 code 映射可信前端文案，不直接展示任意后端堆栈；用户输入的资源名、SQL、字段名不作为翻译 key。
- 共享层不 import 业务词典；页面可提供翻译后的内容。Naive UI locale/dateLocale 与当前界面语言一致。
- 日期、数字通过统一格式化入口，保留原始 ISO 时间和明确时区；时间显示规则不随某个组件的默认 locale 改变。
- B0 校验当前 zh-CN 必需 key 存在；增加第二种语言时再加 key 一致性和切换测试，动态 key 必须来自可枚举的领域字典。

### 6.3 可访问性

- 当前安装的 Naive UI Tabs 未提供完整键盘与 ARIA 语义，六处消费者统一复用 shared/ui/accessible-tabs 指令；NTabs 须绑定翻译后的区域名称，check:ui 验证入口。它补充水平 Tab 的单一 Tab 停靠点、左右/Home/End 移动焦点、Enter/Space 激活、tablist/tab/tabpanel 关联、焦点轮廓、激活/聚焦/尺寸变化时的视口内滚动和卸载清理，不拥有领域状态或请求。
- 可分享 Tab 统一使用 shared/composables/use-route-tab：白名单解析、默认项回退、保留其他 query 参数、push 支持前进后退。编辑器仅切 Tab 不丢草稿，离开资源仍由 useEditGuard 决定；页面传入自身合法 Tab，不新增业务万能 Tabs 组件。

表单 label 正确关联输入；纯图标操作有可访问名称；装饰图标隐藏；状态不能仅靠颜色。弹层标题、焦点约束与恢复、Escape 行为、错误定位、键盘操作必须在浏览器检查。避免 Tooltip 作为唯一解释，不能以组件库已实现底层能力为理由跳过组合后的验证。

## 7. 请求与错误展示只设一个所有者

| 层 | 责任 | 不做 |
|---|---|---|
| shared/api | 标准化 ApiError，含 code/status/requestId/fieldErrors；传递取消信号 | toast、路由跳转、自动把失败改为空列表 |
| repository | 端点请求和 DTO/FormDraft/ViewModel 映射 | 调用 useMessage/useRouter、读写 Mock DB |
| 领域 query/mutation | query key、重试策略、状态、缓存失效、编辑会话 | 建第二套 Pinia 服务端缓存 |
| page/领域交互组件 | 字段/弹层/页面错误位置；保存成功后提示/导航 | 再次对同一错误重复 toast |
| app 会话协调 | 会话失效统一处理与跳转去重 | 对每个 401 独立弹窗/导航 |

列表读取失败优先就地重试；表单错误先字段或表单顶部；危险操作错误保留确认弹层。全局 Query handler 只处理明确委托的错误，局部消费与全局兜底互斥。查询取消不展示失败；写入失败默认不自动重试，除非契约明确幂等。

CopyButton 同样只选一种结果提示所有者：composable 返回结果，由组件提示；不让 composable 与组件同时 toast。真实浏览器复制失败必须保持失败状态。

## 8. 行为验证与落地顺序

| 改动 | 最小有意义的验证 |
|---|---|
| 确认交互 | 双击只触发一次；失败仍打开；成功关闭；pending 的关闭限制；焦点恢复 |
| 表单 | 无效输入；服务端字段错误；失败保留草稿；取消不改缓存；后台刷新不覆盖编辑 |
| 表格 | 过滤重置页码；前进后退恢复；删除最后一行；空态与刷新失败；稳定选择范围 |
| 复制 | 成功/拒绝；正确反馈；timer 清理，不用固定 sleep |
| 共享组件 | 搜索并列出受影响消费者；验证不同 slot、只读、pending 等真实使用方式 |
| 布局/可访问性 | 浏览器验证滚动、焦点、键盘和视口行为；jsdom 不能证明真实布局 |
| 低风险文案/颜色 | 按影响范围视觉复核与已有检查，不新增仅镜像实现的测试 |

组件测试位于所属目录 __tests__，按 validation/selection/confirmation 等职责命名；集成与 E2E 放 apps/web/tests。优先标准测试 API，断言用户可见结果和公共回调，不测私有 state、不做整页 DOM/class 快照。异步等待可观察状态，Mock 外部网络/时钟/存储，不 Mock 被测模块本身。

B0：确定主题/文案装配，建立实际使用的 PageHeader/AsyncState，验证提供者、导航和 Mock 错误路径。B1：源列表和编辑/删除/复制形成首个完整样板。B2：第二领域验证哪些契约确实可复用，更新公共 API 和消费者清单。门禁与测试命令状态以 [AI 规范](ai-development.md) 为准。

## 一手技术核对

2026-10-15 实际读取以下官方源文件；B0 仍须以最终锁定版本的类型、构建和浏览器结果验收。

- [V1] [Vue Watchers](https://github.com/vuejs/docs/blob/main/src/guide/essentials/watchers.md)：异步依赖追踪和清理时机。
- [V2] [Pinia Core Concepts](https://github.com/vuejs/pinia/blob/v3/packages/docs/core-concepts/index.md)：storeToRefs 与 action 解构。
- [N1] [Naive Form 文档源](https://github.com/tusen-ai/naive-ui/blob/main/src/form/demos/enUS/index.demo-entry.md)：FormRules、字段错误与 validate。
- [N2] [Naive Modal 文档源](https://github.com/tusen-ai/naive-ui/blob/main/src/modal/demos/enUS/index.demo-entry.md)：dialog/card preset 与关闭配置。

## 当前复用记录

2026-10-15：用户、质量和脱敏编辑抽屉原本各自缺少统一退出判断。已有 ConfirmDialog 专用于删除，不能直接承担编辑会话；新增 shared/composables/use-edit-guard 仅拥有 dirty/pending 离开决策与 beforeunload 生命周期，领域请求和草稿仍归各页面。服务编辑页复用该能力，后台 Query 更新不得覆盖 dirty 草稿。仓库统计扩展既有 TrendChart 可选系列名称，未复制图表生命周期。


2026-10-15 追加：ConfirmDialog 支持确认文案、非删除主操作与禁用状态，版本恢复复用同一失败保持/重试生命周期。useEditGuard 同时处理离开路由、同组件切资源和 beforeunload；任务与导入也复用。Naive NInput 的可访问名称通过 inputProps 放到实际输入节点，而非只标注外层 div；数据集字段及节点配置已按此修正并用浏览器按名称定位输入。来源对象树与字段血缘分别归 sources/governance，不向 shared 搬运业务规则。
