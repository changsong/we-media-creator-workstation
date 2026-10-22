# 自媒体内容运营工作台 · 产品需求文档（As-Built PRD）

> 版本：2.0.0（应用版本，对应 `package.json`） · 数据 schema_version：1
> 文档性质：**现状文档（As-Built）**，依据已实现的工程代码（`D:\workspace\we-media-creator-workstation`）逐条总结，不做未来扩展假设。
> 定位：本地自托管的「选题 → 排期 → 发布 → 复盘 → 沉淀」单页工作台，零第三方依赖（Node ≥ 22.5 内置 `node:sqlite`）。

---

## 1. 产品概述

### 1.1 一句话定位
把自媒体的全流程内容运营收敛到「四张业务表 + 一个首页总览」里，所有写入即时落库、多标签页实时同步、派生指标页面实时算不落库。

### 1.2 目标用户与场景
| 角色 | 典型场景 | 对应模块 |
|---|---|---|
| 个人/小团队内容运营者 | 脑子里一堆选题，需要一个池子统一收口 | 选题池 |
| 排期负责人 | 把选题落到具体平台与发布时间，盯发布进度 | 内容日历 |
| 数据分析者 | 发布后每天记数据，看单篇与整体表现 | 数据复盘 |
| 内容沉淀者 | 成稿、配图说明归档，按关键词检索复用 | 素材库 |
| 自己（总览） | 一屏看本周要发布什么、哪篇逾期、今天该录什么 | 首页总览 |

### 1.3 设计原则（来自代码取舍）
- **唯一 ID 关联**：跨表用业务编号（TP/SC/RV/AS + YYMM + 序号）关联，**不建外键**，删除上游不级联下游。
- **派生指标不落库**：互动率、涨粉率、趋势、周频率全部页面实时算。
- **字段双名映射**：页面/API 用中文业务字段名，库内统一 `snake_case`，映射集中在 `lib/mapping.js`。
- **校验前后端同源**：一份 `schemas.js` 同时驱动前端表单渲染和后端类型校验。
- **零依赖**：前端原生 HTML/CSS/JS；后端 Node 内置 `http` + `node:sqlite`。

### 1.4 非目标（当前版本不做）
多用户/账号体系、权限、云同步、自动抓取平台真实数据、富文本/所见即所得编辑器、自动化发布。

---

## 2. 信息架构与导航

顶部结构：
- **品牌区**：标题「自媒体内容运营工作台」+ 副标题「选题 → 排期 → 发布 → 复盘 → 沉淀，一个页面管好你的内容全流程」。
- **工具区**：
  - 实时同步指示灯（圆点 + 文案：`未连接 / 正在连接… / 已同步 · N 条记录 / 实时同步已连接 / 同步失败 / 实时同步断开，正在重连…`）。
  - 平台筛选 `pfFilter`（全部平台 / 各平台），全局生效（首页统计、选题、日历、复盘、素材均受它过滤）。
  - 「导出 CSV」按钮（按当前视图对应表导出：首页→日历表，其余→当前表）。
  - 「刷新」按钮（手动 `loadAllData`）。
- **五个标签页**：首页总览（`home`） / 选题池（`topic`，带待写数徽标 `badgeTopic`） / 内容日历（`calendar`） / 数据复盘（`review`） / 素材库（`asset`）。
- **底部**：写入即时生效说明 + 四表 CSV 直链。
- **抽屉编辑器**（右侧 480px 滑出）与**删除确认弹窗**、**toast 提示区**为全局浮层。

---

## 3. 功能模块详述

### 3.1 首页总览（viewHome）

布局自上而下：KPI 行 → 两栏（本周待发布 + 近 7 天趋势）→ 每周频率 → 两栏（逾期排期 + 今日待录数据）。

**KPI 卡片（4 张，`grid-kpi`）**
| 卡片 | 计算口径 | 副文案 |
|---|---|---|
| 待写选题 | `选题池` 中 `状态=待写` 的条数 | 选题池里状态为「待写」 |
| 本周待发布 | `内容日历` 中发布时间落在本自然周（周一~周日）且阶段∈{待审核, 待发布} 的条数 | 本周区间文本 |
| 本周已发布 | 发布时间落在本周且阶段∈{已发布, 二次分发, 已复盘} 的条数 | 含二次分发与已复盘 |
| 近 7 天涨粉 | 近 7 天（含今天）所有复盘快照按 `统计日期` 聚合的涨粉之和 | 同期阅读合计 |

> 自然周定义：`startOfWeek` 以**周一**为起点（`(getDay()+6)%7`）。全部受全局平台筛选影响。

**本周待发布（右栏卡片）**
- 筛选：`解析发布时间 ∈ [本周一, 下周一)` 且 阶段∈{待审核, 待发布}，按发布时间升序。
- 空态：提示「去内容日历里加一条排期」。
- 每行：发布时间、标题、排期ID·负责人、平台 chip、**行内阶段下拉**（`quickSelect`）、「标记已发布」按钮。

**近 7 天数据趋势（右栏卡片）**
- 取近 7 天（今天及前 6 天），按 `统计日期` 把复盘快照的 阅读/播放、点赞、涨粉、转化 累加。
- 三行 sparkline（`sparkRow`）：阅读/播放、点赞、涨粉；每条显示「最新值 / 7 日合计」。
- 页脚：互动率（7 日点赞 ÷ 7 日阅读）、转化合计。

**每周更新频率（整宽卡片）**
- 近 8 周柱状图（`weekBars`）：每周内发布时间落在该周且阶段∈{已发布, 二次分发, 已复盘} 的条数；柱高按比例，无数据显 2px 灰条；底部「合计 N 条」。

**逾期排期（痛点 4，两栏左）**
- 筛选：`解析发布时间 < 今天 0 点` 且 阶段∉{已发布, 二次分发, 已复盘}，按发布时间升序。
- 每行：红色「N 天前」徽标（`.ov`）、标题·排期ID·负责人、平台 chip、**行内阶段下拉**（改完即时存，联动选题状态）。
- 空态：「没有逾期排期」。

**今日待录数据（痛点 5，两栏右）**
- 筛选：阶段∈{已发布, 二次分发, 已复盘} 且 `今天` 在 `复盘` 表里没有该排期ID 的快照（`hasSnapshotToday`）。
- 每行：标题·排期ID·已发布、平台 chip、「记一条」按钮 → 打开复盘抽屉，预填 `排期ID` + `平台`。
- 空态：「今天都记过了」。

### 3.2 选题池（viewTopics）

- 表格列：选题、选题ID、平台、状态、爆款评分(num)、切入角度、标签、参考、操作。
- 排序：爆款潜力评分降序。
- **搜索**（输入框 `qTopic`，即时过滤）：匹配 选题 / 切入角度 / 选题ID（小写包含）。
- **状态筛选** `statusFilter`：全部 / 待写 / 写作中 / 已发布 / 废弃。
- **行内状态下拉**（`quickSelect(topic,'状态')`）：选完即存（PATCH），toast 反馈。
- **排期按钮**（仅当状态∈{待写, 写作中} 显示，`toSchedule`）：打开日历抽屉，预填 `选题ID / 标题 / 平台`，副文案提示选好发布时间。
- **编辑 / 删除**：删除走确认弹窗，提示「关联的其它表记录不会自动清除」。
- 标签以 chip 展示；参考为外链「链接」。

### 3.3 内容日历（viewCalendar）

- **月历网格**：42 格（周一起始），今天高亮；每格最多显示 2 条事件（按时间排序），超出显示「还有 N 条」；事件左侧色条按平台色，显示「时:分 标题(截断9字)」。
- 点击格子里的「+」（`act=day`）：打开日历抽屉，预填该日 `计划发布时间 = 日期T20:00`。
- **月份导航**：上一月 / 下一月 / 回到本月。
- **阶段筛选** `stageFilter`：全部 / 9 个阶段。
- **本月排期表**：计划发布、标题、排期ID、平台、阶段(**行内下拉**)、负责人、形式、操作。
- 阶段下拉改动即时存并触发 `syncTopicStatus`（联动选题状态）与（若为「已发布」）`askTodaySnapshot`。

### 3.4 数据复盘（viewReview）

- 顶部**分段切换** `seg`：流水账 / 按排期聚合（`state.reviewMode`）。
- **+ 记录一条数据** 新建复盘快照。

**流水账视图**
- 列：统计日期、平台、排期ID、阅读/播放、点赞、涨粉、转化、互动率、涨粉率、复盘备注、操作。
- 排序：统计日期降序，同日期按复盘ID 降序。
- **互动率 = 点赞 ÷ 阅读播放**，**涨粉率 = 涨粉 ÷ 阅读播放**：页面实时算（`.calc` 类），**不写入库**。
- 空态：「还没有数据快照，发布后每天记一条」。

**按排期聚合视图（痛点 6）**
- 一篇（一个排期ID）一行（`reviewGroups`）：
  - 排期ID、平台、标题（排期已删除则显示「(排期已删除)」）、阶段、快照数、最新日期、最新阅读、最新涨粉、互动率（最新快照算）、**发布以来走势 sparkline**（`miniSpark`，取该排期所有快照的阅读序列）。
  - 操作：「记一条」（预填排期ID+平台）+ 若排期存在则「看排期」（跳编辑日历）。
- 排序：按最新快照日期降序。
- 顶部说明：「一篇一行，展示最新快照与发布以来走势」。

### 3.5 素材库（viewAssets）

- **卡片网格**（2 列）：标题、摘要（成稿 Markdown 去 `#`、去空行、截断 90 字）、页脚（平台 chip、素材ID、选题、排期、字数、归档日期）、可选成稿文档/配图说明外链。
- **全文检索**（`qAsset`，即时过滤）：标题 / 成稿Markdown / 配图说明 / 素材ID / 关联选题ID / 关联排期ID / 关键词。
- 排序：归档日期降序。
- **点击卡片** → 素材详情（`viewAssetDetail`）：Markdown 渲染（标题 h1–h3、引用、有序/无序列表、行内粗体/代码/链接、代码块），左成稿右配图说明双栏；相关文档/发布外链；编辑按钮。
- **归档一篇成稿** 新建。

### 3.6 通用编辑交互（抽屉表单）

- 右侧抽屉（480px），含标题、副文案、字段区、底部（提示 + 取消/保存）。
- **字段类型渲染**（`fieldHtml`）：
  - `text`：单行输入；`long_text`（切入角度/备注/复盘备注/成稿Markdown/配图说明）：多行文本区，成稿Markdown 用 `.tall` 高区。
  - `select`：下拉，含空选项「请选择」。
  - `multi_select`：checkbox chip 组（标签、关键词）。
  - `number`：`step=any`。
  - `date`：`datetime-local`（含 hh 格式字段如计划发布时间）或 `date`。
  - `url`：占位「粘贴链接地址」。
  - `checkbox`：是/否（schema 当前未使用，但框架支持）。
  - `readonly`（选题ID/排期ID/复盘ID/素材ID）：灰底只读，提示「保存后自动生成」。
- **默认值**（`applyDefaults`，仅新建）：选题→状态=待写/创建日期=今天/平台=当前筛选（若筛选为 all 则该默认被跳过，因 all 非合法选项）；日历→阶段=选题确认/形式=图文/平台=当前筛选；复盘→统计日期=今天/平台=当前筛选；素材→归档日期=今天/平台=当前筛选。
- **预填**（`preset.fill`）：一键排期 / 记一条 等场景带出关联字段，且不触发草稿恢复。
- **草稿缓存**：抽屉输入/变更后 300ms 防抖写入 `localStorage`（`wb_workbench_draft_<表>_<id|new>`）；仅新建时打开会 `restoreDraft` 并提示「已恢复上次未保存的草稿」。
- **收集与校验**（`collectProps`）：按类型包成 `{text/number/select/multi_select/date/url/checkbox: value}`；url 必须 http(s) 开头；空值忽略（除必填校验）；提交前校验表结构已知字段。
- **必填硬性校验**（`saveRecord` 的 `must`）：选题→选题；日历→标题+计划发布时间；复盘→排期ID+统计日期；素材→标题。
- **保存流程**：`collectProps` → 必填校验 → `suppressUntil=now+1500ms` → POST/PATCH → `loadTable` 回读 → `verifyWrite`（按 `_id` / 业务ID / 探测值确认落库，否则抛「回读未找到这条记录，请刷新确认」）→ 清草稿 → toast「已保存 · 时:分」→ 关闭抽屉 → 渲染 → 若日历则 `syncTopicStatus`。失败：保留抽屉、提示「未写入，草稿已保留」+ 错误 toast。

### 3.7 实时同步与草稿（SSE）

- 启动即 `EventSource('/api/events')`。
- 服务端每次写操作 `broadcast({table, action, id, at})`。
- 客户端收到 `change`：若 `Date.now() < suppressUntil`（自己刚写的 1.5s 内）忽略；若正在编辑抽屉则标记 `staleWhileEditing=true`（关闭抽屉后重载）；否则 200ms 防抖 `loadAllData`。
- 同步指示灯随连接状态变化。

### 3.8 流程断点打通（痛点 1–6，已实现）

| 痛点 | 能力 | 实现位置 |
|---|---|---|
| 1 行内快捷改状态/阶段 | 选题状态、日历阶段下拉，选完即存 | `quickSelect` / `quickUpdate` / `$('view') change` 委托 |
| 2 选题一键转排期 | 待写/写作中选题出现「排期」按钮，预填选题ID/标题/平台 | `toSchedule` → `openEditor('calendar', {fill})` |
| 3 标记已发布引导录快照 | 首页「标记已发布」或行内改到已发布 → 弹提示「记一条/先不记」→ 预填复盘表单 | `markPublished` / `askTodaySnapshot` / `promptToast` |
| 4 逾期排期清单 | 首页反向视角，逾期天数徽标 + 行内可改阶段 | `viewHome` overdue 段 |
| 5 今日待录数据清单 | 首页列出「已发布但今天无快照」的排期，一键记 | `viewHome` toRecord 段 + `rec` 动作 |
| 6 复盘聚合视图 | 按排期聚合一篇一行 + 走势 sparkline + 快速补快照 | `reviewAggregateHtml` / `miniSpark` / `rvMode` |

> 说明：当初分析共识别 8 个运营痛点，1–6 已实现；7–8（如跨模块检索/批量操作等）未在本版本落地，见第 11 节。

---

## 4. 数据模型

### 4.1 表清单与字段

统一约定：`id` 内部主键（`PREFIX_<randomhex>`，不参与业务）；`code` 业务编号，UNIQUE；`created_at/updated_at` ISO 时间。JSON 字段以文本存储，读出反序列化。

**topics（选题池，前缀 TP）**
| 中文 | 列 | 类型 | 约束/默认 |
|---|---|---|---|
| 选题ID | code | TEXT | UNIQUE，自动生成 `TPYYMM-NN` |
| 选题 | title | TEXT | NOT NULL |
| 平台 | platform | TEXT | NOT NULL |
| 切入角度 | angle | TEXT | — |
| 状态 | status | TEXT | DEFAULT '待写' |
| 爆款潜力评分 | score | REAL | CHECK 0..10（可空） |
| 标签 | tags | TEXT(JSON) | DEFAULT '[]' |
| 参考链接 | reference_url | TEXT | — |
| 创建日期 | created_on | TEXT | — |
| 内部 | created_at/updated_at | TEXT | NOT NULL |

**schedules（内容日历，前缀 SC）**
| 中文 | 列 | 类型 | 约束/默认 |
|---|---|---|---|
| 排期ID | code | TEXT | UNIQUE |
| 选题ID | topic_code | TEXT | — |
| 标题 | title | TEXT | NOT NULL |
| 平台 | platform | TEXT | NOT NULL |
| 计划发布时间 | publish_at | TEXT | NOT NULL，`YYYY-MM-DDTHH:mm` |
| 当前阶段 | stage | TEXT | DEFAULT '选题确认' |
| 负责人 | owner | TEXT | — |
| 内容形式 | format | TEXT | — |
| 发布链接 | publish_url | TEXT | — |
| 备注 | note | TEXT | — |

**reviews（数据复盘，前缀 RV）**
| 中文 | 列 | 类型 | 约束/默认 |
|---|---|---|---|
| 复盘ID | code | TEXT | UNIQUE |
| 排期ID | schedule_code | TEXT | NOT NULL |
| 平台 | platform | TEXT | NOT NULL |
| 统计日期 | stat_date | TEXT | NOT NULL |
| 阅读播放 | reads | INTEGER | DEFAULT 0, CHECK ≥ 0 |
| 点赞 | likes | INTEGER | DEFAULT 0, CHECK ≥ 0 |
| 涨粉 | followers | INTEGER | DEFAULT 0, CHECK ≥ 0 |
| 转化 | conversions | INTEGER | DEFAULT 0, CHECK ≥ 0 |
| 复盘备注 | note | TEXT | — |
| **唯一约束** | — | — | `UNIQUE(schedule_code, stat_date)` 同一排期每天仅一条快照 |

**assets（素材库，前缀 AS）**
| 中文 | 列 | 类型 | 约束/默认 |
|---|---|---|---|
| 素材ID | code | TEXT | UNIQUE |
| 关联选题ID | topic_code | TEXT | — |
| 关联排期ID | schedule_code | TEXT | — |
| 标题 | title | TEXT | NOT NULL |
| 平台 | platform | TEXT | — |
| 成稿Markdown | manuscript_md | TEXT | — |
| 配图说明 | image_spec | TEXT | — |
| 关键词 | keywords | TEXT(JSON) | DEFAULT '[]' |
| 归档日期 | archived_on | TEXT | — |
| 字数 | word_count | INTEGER | CHECK ≥ 0（可空） |
| 发布链接 | publish_url | TEXT | — |
| 成稿文档链接 | manuscript_doc_url | TEXT | — |
| 配图文档链接 | image_doc_url | TEXT | — |

**sequences（编号计数器）**：`table_key` PK、`month`、`value`（只增不减，删除不回收）。
**meta**：`key` PK、`value`（存 `schema_version`）。

### 4.2 业务编号规则
- 格式：`PREFIX + YYMM + '-' + NN`（NN 两位零填充，如 `TP2610-01`）。
- `nextBusinessId`：在 `LIKE 'PREFIXYYMM-%'` 中取最大序号，并与 `sequences` 当前月值取大；分配后写入 `sequences`（只增）。
- 允许显式指定编号（创建/更新均可），写入前校验 UNIQUE，冲突返回 409。
- **先校验唯一性再分配序号**：避免失败的写入白白消耗一个序号（尤其复盘同日重复）。
- `makeId` 内部主键用 `crypto.randomBytes(6)` 的 hex。

### 4.3 字段候选值（枚举）
- **平台 PLATFORMS**：抖音 / 视频号 / 快手 / 微博 / 公众号 / 小红书 / B站 / 知乎
- **阶段 STAGES（顺序即色阶）**：选题确认 / 脚本撰写 / 待补素材 / 制作中 / 待审核 / 待发布 / 已发布 / 二次分发 / 已复盘
- **状态 STATUSES**：待写 / 写作中 / 已发布 / 废弃
- **内容形式 FORMATS**：图文 / 长图 / 短视频 / 直播 / 音频
- **标签 TAGS**：干货 / 观点 / 故事 / 合集 / 热点 / 测评
- **素材关键词**：TAGS + 封面 / 标题 / 排版 / 转化

> 增平台/标签：改 `lib/schemas.js` 数组即可，列是 TEXT，无需改库；阶段顺序/颜色由 `STAGES` 与 `stageClass` 决定。

### 4.4 关联与约束
- 跨表关联靠业务编号（选题ID / 排期ID），**无外键**。删除上游不级联、不置空下游（与「删除只影响本表」语义一致）。
- 唯一性：各表 `code` 唯一；复盘 `(schedule_code, stat_date)` 唯一。
- 数值约束：评分 0–10；阅读/点赞/涨粉/转化/字数 ≥ 0。
- 健康检查 `/api/health` 的 `orphans` 统计三类悬空引用：
  - `schedules_without_topic`：有 topic_code 但对应 topics 不存在
  - `reviews_without_schedule`：对应 schedules 不存在
  - `assets_without_refs`：关联选题或排期指向不存在记录

### 4.5 索引
- `topics`：platform, status, score DESC
- `schedules`：publish_at, platform, stage, topic_code
- `reviews`：stat_date, platform, schedule_code
- `assets`：topic_code, schedule_code, archived_on

---

## 5. 业务规则与校验

后端 `store.js`（`coerce` / `buildRecord`）统一执行：
- **未知字段** → 400「字段不在表结构里」。
- **number**：去千分位后 parseFloat；越界（min/max）或 precision 处理；非数 → 400。
- **select**：值必须落在候选 options，否则 400。
- **multi_select**：按 `,` `，` `|` 拆分，每项需在候选内，去重；越界项 400。
- **date**：含 `hh` 的格式按 `YYYY-MM-DDTHH:mm` 归一，否则按日；非法 → 400。
- **url**：必须 `http://` 或 `https://` 且 `new URL` 合法，否则 400。
- **text/long_text**：trim；超 `maxLength`（选题 60、标题 80） → 400。
- **必填**：`required` 且为空/空数组 → 400「XX 不能为空」。
- **DB 约束翻译**（`translateDbError`）：将 SQLite 报错转中文（同日复盘冲突 409、编号冲突 409、评分越界 400、负数指标 400、字数负数 400）。
- 值接受「裸值」或「类型包装」（如 `"平台":"小红书"` 或 `{"select":"小红书"}`），前端统一用包装提交。

---

## 6. API 接口

基址默认 `http://127.0.0.1:5180`（`--host` / `--port` 可调，默认仅监听本机）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 返回 `version`(`package.json`)、`storage:'sqlite'`、`db` 路径、`integrity`(PRAGMA)、`tables` 各表条数、`orphans` 悬空引用、`time` |
| GET | `/api/schema` | 四张表字段定义（精简版，去内部备注） |
| GET | `/api/schema/:table` | 单表字段定义 |
| GET | `/api/stats` | 各表条数 |
| GET | `/api/events` | SSE：连接发 `ready`，写操作发 `change` 事件；25s 心跳 `: ping` |
| GET | `/api/tables/:table/records?pageSize=200&cursor=0&q=关键词` | 分页读取；`q` 对可搜索列做 LIKE；pageSize 限 1–500 |
| GET | `/api/tables/:table/records/:id` | 单条读取 |
| POST | `/api/tables/:table/records` | 新建，body `{ "properties": {...} }` |
| PATCH/PUT | `/api/tables/:table/records/:id` | 局部更新 |
| DELETE | `/api/tables/:table/records/:id` | 删除 |
| GET | `/api/tables/:table/export.csv` | 导出 CSV（带 BOM，UTF-8），文件名 `表名-日期.csv` |

其它：请求体上限 4MB（超限 413）；静态文件 `Cache-Control: no-store`；未知接口 404 JSON；方法不允许 405。

---

## 7. 技术架构

### 7.1 前端（public/）
- 原生 HTML/CSS/JS，单文件 `app.js`（IIFE），无构建、无依赖。
- 状态 `state`：`view/platform/status/stage/q/month/assetId/reviewMode`。
- 数据全量缓存在 `DATA`（`topic/calendar/review/asset` 四数组），写后 `loadTable` 回读刷新。
- 渲染为字符串模板 + `innerHTML`，事件用委托（`$('view')` 的 click/change）。
- Markdown 渲染 `mdToHtml` 为轻量自实现（覆盖标题/列表/引用/代码/行内），非完整 CommonMark。

### 7.2 后端（server.js + lib/）
- Node 内置 `http`，自写路由；`serveStatic` 提供 `public/`。
- CRUD 委托 `lib/store.js`；SSE 用 `clients` Set 广播。
- `lib/schemas.js` 双端共用；`lib/mapping.js` 中文字段↔列名；`lib/db.js` 连接/DDL/事务/备份；`lib/migrate.js` 迁移与种子；`lib/seed.js` 示例数据。

### 7.3 存储与备份（lib/db.js）
- `node:sqlite`（`DatabaseSync`），WAL 模式，`synchronous=NORMAL`，`busy_timeout=5000`。
- 启动时执行 DDL（表/索引/sequences/meta），校验 `schema_version`（高于程序版本则拒绝启动）。
- **每日备份**：当天首次写入前 `VACUUM INTO data/backups/workbench-YYYY-MM-DD.db`，保留最近 7 天（`touchBackup` 标志一天只备一次）。
- 目录：`data/workbench.db`、备份 `data/backups/`、旧 JSON 存档 `data/legacy/`。
- `integrity()`：`PRAGMA integrity_check`，`/api/health` 暴露。

### 7.4 迁移与种子（lib/migrate.js + lib/seed.js）
- **自动迁移**：启动时若 `data/store.json` 存在且四表皆空 → 导入并归档原文件到 `data/legacy/`。
- **手动迁移**：`npm run migrate [-- --force] [-- --source 路径]`；库非空且无 `--force` 拒绝。
- 事务内逐表插入；`restoreSequences` + `applySourceSequences` 继承旧计数器（新建编号接着旧序号走）。
- **条数核对**：期望与实际不一致整体报错，不移动原文件；单条触发约束（如重复快照）记入 `skipped` 并继续。
- **种子**：首次启动且库空 → `seedToDatabase(populate)` 写 4 选题 / 4 排期 / 7 复盘快照 / 1 素材（覆盖多平台、多阶段、近 7 天趋势）。

---

## 8. 质量保障（测试）

- **`tools/smoke-test.js`**（jsdom 跑真实页面）：覆盖加载、4 张 KPI、趋势折线、逾期/今日待录卡片、选题新建/校验失败/平台筛选/一键排期预填/行内改状态、日历渲染/阶段筛选/标记已发布→快照引导预填、复盘实时算率/聚合视图/sparkline、素材全文检索/详情 Markdown、删除。当前 **43 项全绿**。
- **`tools/sync-test.js`**：订阅 SSE → API 改一条 → 确认收到 `change` 推送。
- **`npm run check`**：对各 JS 文件做 `--check` 语法校验。
- 日常验证命令见 README：`npm start` 后 `node tools/smoke-test.js` 与 `node tools/sync-test.js`。

---

## 9. 已知限制与设计权衡

1. **无外键、删除不级联**：上游删除后下游悬空引用会累积（仅 `/api/health` 暴露计数，不自动清理）。
2. **平台筛选为「全部」时不能默认进新记录**：`applyDefaults` 遇到 `all` 会跳过该默认（避免写入非法选项）。
3. **单用户、本地、无鉴权**：默认监听 `127.0.0.1`；局域网需用 `--host 0.0.0.0` 自担风险。
4. **派生指标不落库**：互动率/涨粉率/趋势等每次前端重算，不占存储，但无法做历史时点回溯。
5. **CSV 导出为全表**：不带当前筛选条件；首页导出对应日历表。
6. **无编辑历史/审计**：覆盖式更新，无版本留痕。
7. **评分人工写入**：爆款潜力评分为人工打分，无算法。
8. **Markdown 渲染为轻量子集**：非完整 CommonMark，复杂语法可能不还原。
9. **内存全量缓存**：表数据一次性载入 `DATA`，超大表（万级）需改造分页渲染。

---

## 10. 待办 / 未实现（后续可规划）

- 痛点 **7–8**（原分析识别出的其余运营痛点，如跨模块统一检索、批量操作/批量导出等）本版本未落地。
- 反向清单已做（逾期、今日待录），但**正向的「本周计划完成率 / 阶段分布」**等看板仍可增强。
- 自动化：平台真实数据回采、定时提醒（今日待录可通过系统通知而非仅页内 toast）。
- 多设备/云端同步（现有云端资料库版字段同构，可 CSV 互导）。

---

## 附录 A：文件清单

```
server.js                         HTTP 服务 / REST / SSE / 静态
lib/schemas.js                   四表字段定义（前后端共用）
lib/mapping.js                   中文字段 ↔ SQLite 列名
lib/db.js                        连接 / DDL / 索引 / 事务 / 每日备份
lib/store.js                     查询 / 写入 / 校验 / 编号 / CSV
lib/migrate.js                   旧 JSON 导入 / 种子写入 / 计数器继承
lib/seed.js                      示例数据内容
public/index.html               页面骨架（顶栏 / 标签 / 抽屉 / 弹窗 / toast）
public/style.css                 设计系统（颗粒绿主色、阶段 9 色、卡片/表格/日历/抽屉）
public/app.js                    全部前端逻辑与视图
data/workbench.db                运行时数据库（WAL）
data/backups/                    每日整库快照（7 天）
data/legacy/                    迁移前 JSON 存档
tools/migrate-json-to-sqlite.js 迁移命令
tools/smoke-test.js             页面冒烟测试（需 jsdom）
tools/sync-test.js              SSE 同步验证
README.md                       使用与维护说明
start.bat                       一键启动（Windows）
```

## 附录 B：阶段→选题状态联动规则

`syncTopicStatus(calRec)` 依据日历阶段反写选题状态：
- 阶段 = 选题确认 → 选题状态 = 待写
- 阶段 ∈ {已发布, 二次分发, 已复盘} → 选题状态 = 已发布
- 其它（脚本撰写/待补素材/制作中/待审核/待发布）→ 选题状态 = 写作中
- 若选题已「废弃」或已等于目标状态，则不改动（不覆盖人工废弃）。
