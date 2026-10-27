# 自媒体内容运营工作台 · 产品官网 PRD

| 项目 | 内容 |
|---|---|
| 文档 | `website.prd` v0.1（草案） |
| 日期 | 2026-10-26 |
| 产品 | 自媒体内容运营工作台 / WeMedia Creator Workstation |
| 站点 | 面向终端用户的静态营销官网，中英双语 |
| 目标 | 让访客快速理解价值 → 下载桌面版 → 购买授权 |
| 价格 | 月付 ¥49.9 / 年付 ¥500 / 终身 ¥980 |

> 本文档定义"卖产品"的官网，不是用户手册。功能描述一律翻译成用户收益；操作细节、配置说明、故障排查不放官网，最多以博客文章形式服务 SEO 获客。

---

## 1. 产品一句话

**中文：** 把选题、排期、发布、复盘、沉淀收进一张工作台，让一个人也能稳定运营八个平台。

**英文：** One local-first workspace to plan, publish, and review content across eight Chinese platforms — without juggling tabs or copying numbers by hand.

**官网主张（Hero）：**

> 八个平台，一张工作台。
> 你负责创作，发布和抄数交给它。

**English:**

> Eight platforms. One workbench.
> You create. It publishes, tracks, and reports back.

---

## 2. 背景与官网要解决的问题

### 2.1 用户现状

- 一条内容要发到抖音、视频号、快手、B 站、微博、小红书、知乎、公众号，重复上传、重复填标题封面、重复勾选项。
- 数据散落在各个创作者后台，复盘靠手抄，做完一轮已经不想再优化。
- 通用定时工具大多依赖平台开放接口，个人创作者拿不到资质；能用 Cookie 的工具又常常要求把账号交给云端。
- 素材、成稿、语音复盘散在网盘、备忘录和聊天记录里，下一条内容又要从头找。

### 2.2 我们卖的不是"功能"，是三种结果

| 用户痛点 | 官网要传达的结果 |
|---|---|
| 多平台重复发布，耗时且容易漏发 | **一次排期，八个平台自动完成** |
| 数据靠手抄，复盘流于形式 | **数据自动回流，打开就能复盘** |
| 账号和数据放在第三方云端不放心 | **数据留在自己电脑，不用注册云账号** |
| 平台经常改版，工具用着用着就失效 | **桌面客户端持续更新，改版跟着适配** |

### 2.3 官网目标

1. **看懂**：首屏 5 秒说清"是什么、替我省什么"。
2. **相信**：真实界面、真实流程、诚实边界，不夸大、不伪造客户。
3. **行动**：下载桌面版、选择授权、提交购买咨询或产品建议。
4. **被 AI 推荐**：成为"多平台发布工具 / 自媒体运营工具"这类问题的标准答案之一。

### 2.4 成功指标（上线后 90 天）

| 指标 | 目标 |
|---|---|
| 自然搜索访问占比 | ≥ 40% |
| 首页 → 下载页点击率 | ≥ 18% |
| 价格页 → 支付/咨询转化率 | ≥ 6%（基线待验证） |
| 视频播放率（≥ 10 秒） | ≥ 35% |
| 每周有效反馈 | ≥ 10 条 |
| AI 引擎引用（人工抽查） | 每月至少 1 个核心问题出现品牌 |

---

## 3. 产品能力盘点（用于官网取材）

> 只列会影响购买决策的能力。官网按"收益"表达，不按模块说明书表达。

### 3.1 核心能力

| 能力 | 事实 | 官网表达 |
|---|---|---|
| 多平台自动发布 | 抖音、视频号、快手、B 站、微博、小红书、知乎、公众号，共 8 个平台 | "八个平台，一次排期" |
| 内容形态 | 各平台支持视频 / 图文（按平台能力）、多比例封面裁切 | "视频、图文、封面，一次准备好" |
| 定时与队列 | 到点自动执行，任务排队，失败可重试，发布后自动核验 | "到点自己发，发完自己核对" |
| 数据回流 | 抖音、小红书、视频号、公众号数据自动写入复盘 | "四个平台的数据，自动回到同一张表" |
| 数据复盘 | 阅读播放、点赞、涨粉、转化；互动率、涨粉率、更新频率实时计算 | "不用再手抄后台数字" |
| 选题与排期 | 选题池、内容日历、九个制作阶段、负责人、平台多选 | "从灵感到上线，一条线走完" |
| 素材沉淀 | 成稿、配图说明、关键词、语音复盘、关联选题与排期 | "好内容不再用完就丢" |
| 一键登录 | 独立浏览器窗口扫码登录，Cookie 只存本机，不用申请 API | "不用开发者资质，也不用交出账号" |
| 本地优先 | SQLite 本地存储、每日快照、CSV 导出、多标签页实时同步 | "数据只属于你" |
| 桌面常驻 | 关闭窗口最小化到托盘，定时任务继续跑；客户端自动更新 | "关掉窗口，任务照常跑" |
| 跨平台 | Windows 安装包、macOS dmg/zip、Linux AppImage/deb | "三大系统都能用" |

### 3.2 诚实边界（官网必须写清楚，反而增强信任）

- 需要本机安装 Chrome 或 Edge；发布与部分数据采集依赖它。
- 首次使用需在独立窗口登录自己的平台账号；Cookie 过期后重新登录即可。
- 自动发布覆盖 8 个平台；自动数据回流目前覆盖 4 个平台（抖音、小红书、视频号、公众号）。
- 单机单用户，暂不支持多人协作或云端同步。
- 桌面应用界面目前为简体中文；英文站为营销与购买入口，需在 FAQ 注明。
- macOS 版本暂未签名，首次打开需右键"打开"，且不支持自动更新。
- 平台自动化存在风控与改版风险；我们会持续更新适配，但不能承诺 100% 不受平台策略影响。

### 3.3 差异化（官网只讲三点，讲透）

1. **真本地**：账号登录态、内容、数据都在自己电脑，不需要把平台账号交给云端服务。
2. **真闭环**：不是只帮你"发"，还把数据收回来看；发布、复盘在同一张工作台完成。
3. **真能长期用**：桌面客户端 + 自动更新 + 买断选项，平台改版时不用重新找工具。

---

## 4. 目标用户与购买动机

### 4.1 用户画像

| 画像 | 典型情况 | 最在意 | 官网应打动他的点 |
|---|---|---|---|
| 一人创作者 / 副业博主 | 每周 3–10 条，分发 4–8 个平台 | 时间、漏发、数据看不清 | "一个人也能稳定日更" |
| 小团队主理人 | 1–3 人，编辑 + 运营 | 排期、审稿、复盘口径 | "整月节奏一张表看清" |
| 企业新媒体运营 | 单品牌多平台，考核数据 | 稳定性、数据留存、合规 | "数据在本机，发布有记录" |
| 海外中文创作者 | 人在海外，运营国内平台 | 工具稳定、支付方便、界面语言 | "跨时区也能按时发布" |

### 4.2 购买触发点

- 刚经历过一次"漏发 / 发错平台 / 数据抄错"的事故。
- 平台数量从 2 个增加到 4 个以上，手工发布开始不可持续。
- 准备认真做账号，需要一个能长期用的工作流，而不是零散脚本。
- 对比订阅制工具后，发现买断更符合自己的使用周期。

### 4.3 反对意见与官网回应

| 反对意见 | 页面回应 |
|---|---|
| "会不会把我账号封了？" | 使用你自己的浏览器登录态，不共享账号；提供风控说明与失败重试机制 |
| "数据安全吗？" | 本地 SQLite，不上传云端；可随时导出 CSV |
| "平台改版怎么办？" | 客户端自动更新，发布适配持续维护 |
| "我不会配置 API。" | 不需要 API，一键登录，扫码即用 |
| "为什么不做网页版？" | 本地运行才能安全复用登录态、处理大文件、后台定时发布 |
| "值这个价吗？" | 用"每月省下的时间"和"一次买断"算账 |

---

## 5. 定位与信息架构

### 5.1 定位语

> 给认真做内容的人的本地发布与复盘工作台。
> A local-first publishing and analytics workbench for creators who are serious about content.

### 5.2 站点地图

| 页面 | 中文 URL | 英文 URL | 作用 | 主要 CTA |
|---|---|---|---|---|
| 首页 | `/` | `/en/` | 讲清价值、建立信任、分流 | 下载桌面版 / 查看价格 |
| 功能 | `/features/` | `/en/features/` | 用收益讲功能 | 下载体验 |
| 平台 | `/platforms/` | `/en/platforms/` | 覆盖与能力对照 | 查看价格 |
| 平台落地页 ×8 | `/platforms/douyin/` 等 | `/en/platforms/douyin/` 等 | 承接"XX 一键发布"搜索 | 下载 / 购买 |
| 价格 | `/pricing/` | `/en/pricing/` | 完成购买决策 | 立即购买 / 咨询 |
| 使用场景 ×3 | `/use-cases/solo/` 等 | `/en/use-cases/solo/` 等 | 让用户对号入座 | 下载 |
| 下载 | `/download/` | `/en/download/` | 降低安装门槛 | 下载对应系统 |
| 博客 | `/blog/` | `/en/blog/` | SEO/GEO 获客 | 订阅 / 下载 |
| 常见问题 | `/faq/` | `/en/faq/` | 消除疑虑 | 购买 / 反馈 |
| 反馈 | `/feedback/` | `/en/feedback/` | 收集意见与购买咨询 | 提交 |
| 关于 | `/about/` | `/en/about/` | 建立信任 | 下载 |
| 更新日志 | `/changelog/` | `/en/changelog/` | 证明持续维护 | 下载 |
| 隐私政策 | `/legal/privacy/` | `/en/legal/privacy/` | 合规 | — |
| 服务条款 | `/legal/terms/` | `/en/legal/terms/` | 合规 | — |
| 404 | `/404` | `/en/404` | 挽回流量 | 回首页 |

**不做：** 文档中心、API 手册、安装教程库、用户社区。需要教程时以博客形式发布，承担获客任务。

### 5.3 全局导航

- 顶部：Logo｜功能｜平台｜价格｜场景｜资源（博客/FAQ/更新日志）｜语言切换｜**下载桌面版**
- 移动端：抽屉菜单 + 固定底部 CTA（下载 / 价格）
- 页脚：产品（功能、平台、价格、下载、更新日志）｜资源（博客、FAQ、反馈、媒体资料）｜关于（故事、联系）｜法务（隐私、条款）｜备案号｜版权｜GitHub（可选）

### 5.4 转化路径

```
搜索/分享 → 首页或平台落地页 → 视频/截图建立理解 → 价格页 → 下载 → 激活购买
                         ↘ 场景页对号入座 ↗        ↘ 购买咨询（反馈表单）
```

所有页面至少有一个主 CTA；价格页同时提供"立即购买"和"购买咨询"两条路径。

---

## 6. 页面规格与文案

### 6.1 首页（最重要）

**页面任务：** 5 秒讲清是什么；60 秒建立信任；给出下一步。

| # | 区块 | 内容 | 说明 |
|---|---|---|---|
| 1 | Hero | H1、副标题、双 CTA、系统支持微文案、**产品演示视频** | 视频是首屏主角，右侧 16:9，移动端置底 |
| 2 | 平台条 | 8 个平台名称/图标横排 | 让访客立刻确认"有我用的平台" |
| 3 | 痛点 → 结果 | 3 组对比卡片：重复上传 / 手抄数据 / 账号交云端 | 用用户原话，不用功能名 |
| 4 | 五步工作流 | 选题 → 排期 → 发布 → 复盘 → 沉淀，配真实截图 | 解释产品怎么融入日常 |
| 5 | 功能收益网格 | 6–8 张卡片，每张"动作 + 结果" | 不写参数，写省下什么 |
| 6 | 数据与隐私 | 本地 SQLite、每日快照、CSV 导出、不注册云账号 | 建立信任的关键区块 |
| 7 | 桌面体验 | 托盘常驻、后台定时、自动更新、三系统 | 解释"为什么是桌面应用" |
| 8 | 价格预览 | 三张卡：月 / 年 / 终身，年付标"最受欢迎"，终身标"最省心" | 点击进入价格页 |
| 9 | 适用人群 | 3 类画像，各一句"这就是给你的" | 帮用户自我归类 |
| 10 | FAQ | 6 个购买前问题 | 同时服务 SEO/GEO |
| 11 | 反馈入口 | "告诉我们你想要什么" + 表单入口 | 低门槛互动 |
| 12 | 页脚 | 导航、法务、备案、语言 | — |

**首屏文案（中文）**

- H1：**八个平台，一张工作台。**
- 副标题：选题、排期、发布、复盘、沉淀，全在一个本地应用里完成。到点自动发布，数据自动回填，账号与素材始终留在你自己的电脑上。
- 主 CTA：**下载桌面版**
- 次 CTA：查看价格
- 微文案：Windows 10+ · macOS 11+ · Ubuntu 22.04+ ｜ 无需申请 API ｜ 数据保存在本机

**首屏文案（英文）**

- H1：**Eight platforms. One workbench.**
- Sub：Plan, schedule, publish, and review everything from one local-first desktop app. It publishes on time, pulls the numbers back, and keeps your accounts and files on your own machine.
- Primary CTA：**Download for desktop**
- Secondary CTA：See pricing
- Microcopy：Windows 10+ · macOS 11+ · Ubuntu 22.04+ | No API keys | Data stays local

**功能收益卡片（中 / 英）**

| 中文标题 + 描述 | English |
|---|---|
| **选题池：灵感有处安放** 记录平台、角度、标签和爆款潜力评分，搜索、筛选、导出，下一条内容不再靠翻备忘录。 | **A home for every idea.** Capture platform, angle, tags, and potential score. Search, filter, export — never dig through notes again. |
| **内容日历：整月节奏一眼看清** 九个制作阶段、负责人、内容形式和发布时间，一张时间轴排完整个月。 | **See the whole month at a glance.** Nine production stages, owners, formats, and publish times on one timeline. |
| **发布中心：排好队，它自己发** 八个平台一次排期，视频、图文、多比例封面；失败可重试，发布后自动核验。 | **Queue it. It publishes.** Schedule all eight platforms at once — video, image posts, multi-ratio covers. Retry on failure, verify after publishing. |
| **数据复盘：不用再手抄** 抖音、小红书、视频号、公众号数据自动回流，互动率、涨粉率、更新频率实时算好。 | **Stop copying numbers by hand.** Performance from four platforms flows back automatically, with engagement and growth rates calculated for you. |
| **素材库：好内容可以复用** 成稿、配图说明、关键词、语音复盘统一归档，和选题、排期互相打通。 | **Reuse what works.** Manuscripts, image notes, keywords, and voice memos archived and linked to topics and schedules. |
| **一键登录：不用申请 API** 独立浏览器窗口扫码登录，Cookie 只留在本机；过期了重新登录即可。 | **No API keys. No developer account.** Sign in through an isolated browser window. Cookies stay on your machine. |
| **本地优先：数据只属于你** SQLite 存储、每日快照、CSV 导出；不用注册云端账号。 | **Local-first by design.** SQLite storage, daily snapshots, CSV export. No cloud account required. |
| **桌面常驻：关窗也在跑** 最小化到托盘，定时发布和数据同步继续；客户端自动更新，平台改版跟着适配。 | **Close the window. Keep the schedule.** Runs in the tray, keeps publishing and syncing. Auto-updates as platforms change. |

### 6.2 功能页

结构：一句话总览 → 六大能力（选题、排期、发布、数据、素材、连接）→ 每块一张真实截图 + 三个收益点 → 与"手工做"的对比表 → CTA。

写作规则：
- 标题用动词和结果，不用模块名：不写"发布任务队列"，写"到点自己发，发完自己核对"。
- 每个功能必须回答"这替我省了什么"。
- 截图使用真实界面，示例数据需标注"演示数据"。

### 6.3 平台页与平台落地页

**总览页：** 8 个平台卡片，标注支持内容（视频 / 图文）、数据回流（有 / 无）、登录方式（一键登录）。附一句诚实说明：自动化受平台风控影响，失败可重试。

**单个平台落地页模板（SEO 主力）：**

| 区块 | 内容 |
|---|---|
| H1 | "抖音内容一键发布与数据复盘，用一张工作台完成" |
| 首段 | 40–60 字直接回答：能做什么、适合谁、需要什么 |
| 能力清单 | 该平台支持的形态、封面比例、数据指标、注意事项 |
| 工作流截图 | 该平台真实发布过程（脱敏） |
| 与手工对比 | 时间成本对照（注明为估算） |
| FAQ | 该平台特有的 3 个问题 |
| CTA | 下载 / 查看价格 |

> 8 个平台 × 中英 = 16 个页面。每个页面必须有独立文案与截图，禁止复制粘贴，避免被判低质。

### 6.4 价格页

**页面任务：** 把"值不值"变成"选哪种付款方式"。

| 方案 | 价格 | 定位 | 文案 |
|---|---|---|---|
| 月付 | **¥49.9 / 月** | 先试水 | 按月续费，随时停止 |
| 年付 | **¥500 / 年** | **最受欢迎** | 相当于 ¥41.7/月，比月付省 ¥98.8（约 8.4 折） |
| 终身 | **¥980 一次买断** | **最省心** | 约等于 20 个月月付，长期使用更划算 |

三档功能一致，差异只在付款周期与有效期。页面元素：

1. 三张价格卡（年付高亮，终身加"一次买断"徽章）。
2. "每个方案都包含"清单：8 平台发布、4 平台数据回流、全部功能、更新、邮件支持。
3. 价格计算器（可选）：滑块选择每周发布条数，估算每月节省时间；注明为估算。
4. 授权条款摘要：设备数、更新范围、退款政策（待确认，见第 12 节）。
5. 支付方式图标与安全说明。
6. 购买 FAQ：发票、换电脑、退款、升级/补差价（待确认）。
7. 双 CTA：**立即购买** / **购买咨询**（跳转反馈表单，类型预选"购买咨询"）。

**英文价格文案：**

> One license. Three ways to pay.
> Same features in every plan. Choose the rhythm that fits your cash flow.
> Monthly ¥49.9 · Yearly ¥500 (save ¥98.8) · Lifetime ¥980 (one-time).
> Prices are in CNY.

### 6.5 使用场景页（3 个）

| 页面 | 标题 | 核心叙事 |
|---|---|---|
| `/use-cases/solo/` | 一个人，也能稳定运营八个平台 | 时间碎片化，靠排期和自动发布保持节奏 |
| `/use-cases/team/` | 小团队的排期、审稿与复盘，放在同一张表 | 负责人、阶段、数据口径统一 |
| `/use-cases/overseas/` | 人在海外，内容按时出现在国内平台 | 跨时区定时、桌面常驻、支付与语言说明 |

每页结构：一天的工作流故事 → 三个关键场景截图 → 数据/时间收益（估算）→ CTA。

### 6.6 下载页

- 自动识别系统，突出对应下载按钮；其余系统折叠显示。
- 三平台说明：Windows 安装包（无需管理员）、macOS dmg/zip（未签名，右键打开）、Linux AppImage/deb。
- 系统要求、文件大小、版本号、更新日期、SHA256。
- 安装后如何激活（三步：下载 → 登录平台 → 输入授权码）。
- 数据目录说明：换电脑时复制数据目录即可迁移。
- 常见安装问题（SmartScreen、macOS Gatekeeper）折叠展示。
- 版本信息从发布清单自动同步，避免手改。

### 6.7 博客 / 资源

以获客为目标，不做说明书。首批 8 篇：

| 标题方向 | 目标搜索意图 | 漏斗位置 |
|---|---|---|
| 一条视频发八个平台，怎样不崩溃 | 多平台发布流程 | 顶部 |
| 自媒体内容日历怎么排才有用 | 内容日历模板 | 顶部 |
| 抖音/小红书/视频号数据在哪里看 | 数据导出与复盘 | 中部 |
| 公众号数据监控：手动抄数之外的办法 | 公众号数据分析 | 中部 |
| 个人创作者需要怎样的发布工具 | 工具选型 | 中部 |
| 本地部署 vs 云端 SaaS：内容数据放哪 | 数据安全 | 底部 |
| 一周五更的排期模板（可下载） | 模板/lead magnet | 顶部 |
| 平台改版后发布失败，怎么降低损失 | 稳定性 | 底部 |

每篇文章：一个明确结论开头、可引用的事实、站内链接到功能/价格页、文末 CTA。

### 6.8 FAQ 页

按五组组织，每问首句直接回答（服务 GEO）：

1. **产品**：它是什么？和浏览器插件/定时工具有什么不同？支持哪些平台？
2. **使用**：需要什么系统？要装 Chrome 吗？要申请 API 吗？账号安全吗？
3. **数据**：数据存在哪？能导出吗？换电脑怎么办？会自动同步哪些平台？
4. **购买**：三种价格有什么区别？能开发票吗？支持退款吗？终身版包含更新吗？
5. **限制**：为什么不支持多人协作？macOS 为什么不能自动更新？英文界面有吗？

### 6.9 反馈页

见第 9 节。入口：顶部导航"反馈"、页脚、价格页"购买咨询"、首页底部区块。

### 6.10 关于页

- 为什么做这个产品：创作者的真实一天，而不是"AI 颠覆内容"。
- 三条原则：本地优先、诚实自动化、持续维护。
- 团队/作者介绍（真实姓名或品牌名，不虚构团队规模）。
- 联系方式与反馈入口。
- 可选：公开产品路线图（只放已承诺事项）。

### 6.11 更新日志

- 与版本发布同步，按月份分组，突出"平台适配"和"新增能力"。
- 作用：证明产品活着、更新及时，直接影响购买信心与 GEO 新鲜度。

---

## 7. 双语方案

- 默认 `zh-CN` 在根路径；英文在 `/en/` 前缀下，路径结构保持一致。
- 不做 IP 自动跳转（伤害 SEO）；首次访问可用顶部语言提示条，用户选择后记住。
- `hreflang` 双向标注，`x-default` 指向中文。
- 英文站不是逐字翻译：价格保留人民币并注明 `Prices are in CNY`；产品界面语言在 FAQ 明确说明。
- 日期、数字、货币格式按语言本地化；截图中的中文界面在英文页配英文注释。
- 所有页面标题、描述、OG 图、结构化数据双语独立维护。

---

## 8. 视觉与交互

### 8.1 设计方向

- **关键词**：专业、克制、编辑感、可信。避免"AI 紫色渐变 + 火箭"式俗套。
- **色彩**：沿用产品界面——主色 `#090c0d`，背景 `#f8f9fc`，金色强调 `#ffd975`，深色容器 `#202224`。
- **字体**：标题 Plus Jakarta Sans，正文 Be Vietnam Pro；中文回退 Noto Sans SC / 系统字体。自托管并子集化。
- **组件**：大圆角卡片（16–32px）、胶囊按钮、细边框、轻阴影；深色 Hero 视频区与浅色内容区交替。
- **图像**：真实产品截图为主，配少量创作者工作场景照片；不用假仪表盘和假头像。
- **动效**：克制的进入动画；尊重 `prefers-reduced-motion`。

### 8.2 信任设计

- 首屏下方直接展示真实界面截图，而不是插画。
- 诚实边界放在 FAQ 和平台页，不藏在条款里。
- 更新日志公开可见，显示最近更新时间。
- 没有真实客户评价前，不伪造证言；用"产品数据"（8 平台、4 数据源、三系统）和创始人故事替代。

### 8.3 响应式

- 断点：360 / 768 / 1024 / 1440。
- 移动端首屏视频改为点击播放，避免流量与性能损耗。
- 价格卡移动端纵向排列，年付默认展开权益。

---

## 9. 首页视频方案

### 9.1 目标

用 60 秒让访客相信："这就是我每天要用的工具。"

### 9.2 形式

- 主片 16:9，60–75 秒；另剪 9:16 竖版用于社交传播。
- 实拍 + 屏幕录制结合：创作者在桌前（B-roll）+ 真实产品操作（主画面）。
- 中文配音 + 中英字幕；英文站使用英文字幕版（可同一画面）。
- 背景音乐使用可商用授权曲目，音量低于人声。

### 9.3 分镜脚本

| 时间 | 画面 | 旁白（中） |
|---|---|---|
| 0–5s | 创作者桌上同时打开多个平台后台，标签页堆叠；字幕："一条内容，八个后台" | 一条内容，八个平台，你是不是也在重复上传？ |
| 5–15s | 快速剪辑：复制标题、改封面、勾选项、切账号；时间流逝 | 标题复制八遍，封面裁八次，发完还要一个个抄数据。 |
| 15–25s | 切到工作台：选题池 → 日历排期，一条内容拖到"待发布" | 现在，把选题、排期和素材放进同一张工作台。 |
| 25–40s | 发布中心：八个平台任务依次执行；绿色"已发布"；失败任务重试 | 到点，它用你自己的登录态，逐个平台发布、核对结果。 |
| 40–52s | 数据复盘：四条曲线/数字自动出现；互动率、涨粉率 | 数据自动回来，互动率、涨粉率已经算好。 |
| 52–60s | 合上笔记本，创作者离开；托盘图标继续运行 | 关掉窗口也没关系，任务在后台继续。 |
| 60–68s | Logo + 主张 + CTA | 八个平台，一张工作台。现在下载。 |

### 9.4 制作与网页规格

- 录制：1920×1080 / 30fps 起，界面放大到 125%，鼠标高亮；演示数据全部脱敏并标注"演示"。
- 文件：MP4（H.264）+ WebM（VP9），首屏文件 ≤ 12MB；另备 720p 移动版。
- 播放：桌面端静音自动循环，提供声音开关；移动端显示 poster + 播放按钮。
- 无障碍：中英 VTT 字幕、可展开文字稿、键盘可控制、`prefers-reduced-motion` 时只显示 poster。
- 技术：`preload="metadata"`、固定宽高比防 CLS、OSS/CDN 支持 Range 请求。
- 结构化数据：`VideoObject`（name、description、thumbnailUrl、uploadDate、duration、contentUrl、embedUrl、transcript）。

---

## 10. 反馈与购买咨询

### 10.1 定位

不是客服工单系统，而是"让潜在用户低门槛开口"和"让老用户参与产品方向"。

### 10.2 表单字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| 反馈类型 | 单选 | 是 | 功能建议 / 问题反馈 / 购买咨询 / 合作 |
| 内容 | 多行文本 | 是 | 20–2000 字，提示"你希望它替你解决什么" |
| 联系方式 | 文本 | 否 | 邮箱或微信，便于回复 |
| 使用系统 | 下拉 | 否 | Windows / macOS / Linux / 还没用 |
| 当前版本 | 文本 | 否 | 自动带出可选项 |
| 页面来源 | 隐藏 | 自动 | 提交页 URL、语言、UA 摘要 |
| 隐私同意 | 复选框 | 是 | 同意按隐私政策处理反馈内容 |
| 蜜罐字段 | 隐藏 | — | 机器人识别 |

### 10.3 提交与处理

- 静态站通过独立接口提交（推荐阿里云函数计算 + 表格存储/OSS，或 MVP 阶段用 Formspree/Getform）。
- 成功后展示明确结果，并给出"继续下载 / 查看价格"的下一步，不浪费转化。
- 防滥用：蜜罐、每 IP 每小时限 5 次、正文长度限制、CORS 白名单。
- 通知：飞书/企业微信机器人 + 邮件；购买咨询单独标记，承诺 1 个工作日内回复。
- 处理节奏：每周汇总一次，公开"已采纳建议"到更新日志（可选，增强参与感）。

---

## 11. 技术方案（静态站）

### 11.1 选型

- **Astro 5 + TypeScript + Tailwind CSS**：默认输出静态 HTML，零客户端框架；内置 i18n 路由、内容集合、图片优化，适合 SEO/GEO。
- 交互岛仅用于：视频播放器、反馈表单、价格切换、移动端菜单。
- 备选：Eleventy（更轻但 i18n/图片需自建）。不选 Next.js 静态导出（客户端 JS 偏重，收益不明显）。

### 11.2 目录结构

```
website/
  astro.config.mjs
  src/
    pages/                  中文页面
    pages/en/               英文页面
    layouts/BaseLayout.astro
    components/             Header / Footer / HeroVideo / Pricing / FeedbackForm / FAQ / SEO
    content/blog/           博客（中英分目录）
    content/changelog/      更新日志
    i18n/zh.ts, en.ts       文案与元数据
    data/plans.ts           价格单一信息源
    data/platforms.ts       平台能力单一信息源
    styles/global.css
  public/
    video/ captions/ og/ favicon/ llms.txt
  scripts/fetch-releases.mjs  构建时拉取版本与安装包信息
```

### 11.3 部署

- 构建产物上传阿里云 OSS（`site/` 前缀），CDN 加速 + 自定义域名 + HTTPS。
- 中国大陆域名需 ICP 备案；未备案可用香港节点或海外静态托管（速度取舍写入技术决策）。
- 缓存：HTML 短缓存（60s）并在发布后刷新 CDN；静态资源 `immutable` 长缓存；视频支持 Range。
- CI：GitHub Actions，`website/**` 变更触发构建与上传；发布新版本时通过 `repository_dispatch` 重建下载页。
- 安全头：CSP、HSTS、`X-Content-Type-Options`、`Referrer-Policy`；表单接口校验 Origin。

### 11.4 版本与下载同步

- 构建脚本读取 OSS 上的 `latest.yml` / `latest-mac.yml` / `latest-linux.yml`，生成版本号、文件大小、SHA256、下载地址。
- 拉取失败时回退到仓库内静态清单，保证构建不中断。
- 下载按钮不直接硬编码版本号。

### 11.5 支付与授权（购买闭环）

- 静态站不处理支付，跳转托管收银台（如 Paddle / Stripe Checkout / 支付宝商户页），支付成功后邮件发放授权码。
- 桌面端需新增授权激活能力（当前版本没有）：输入授权码、本地验签、显示有效期/设备数；订阅到期前提醒。
- 建议授权模型：月/年付按有效期，终身版永久有效；建议 3 台设备（待确认）；离线宽限 30 天。
- 支付渠道、发票、退款政策见第 13 节待确认项。

---

## 12. SEO 规范

### 12.1 关键词地图

| 页面 | 中文主词 | 英文主词 | 意图 |
|---|---|---|---|
| 首页 | 自媒体内容运营工作台 | multi-platform content publishing tool | 品牌 / 商业 |
| 功能 | 自媒体发布工具 | content operations software | 商业调研 |
| 平台总览 | 多平台一键发布 | publish to Chinese social platforms | 高意向 |
| 抖音页 | 抖音一键发布工具 | Douyin publishing tool | 高意向 |
| 小红书页 | 小红书批量发布 | Xiaohongshu publishing tool | 高意向 |
| 视频号页 | 视频号定时发布 | WeChat Channels scheduler | 高意向 |
| 公众号页 | 公众号数据监控 | WeChat Official Account analytics | 高意向 |
| 价格 | 自媒体工具价格 / 终身授权 | creator tool pricing | 交易 |
| 下载 | 自媒体工作台下载 | desktop app download | 交易 |
| 场景页 | 自媒体运营流程 | creator workflow | 信息 |
| 博客 | 内容日历 / 数据复盘 / 平台数据导出 | content calendar, analytics | 信息 |
| FAQ | 多平台发布常见问题 | publishing FAQ | 信息 |

### 12.2 页面规范

- 每页唯一 H1，标题层级不跳级；首段 40–60 字直接回答问题。
- 标题 ≤ 60 字符（中文约 30 字），描述 70–155 字符，包含主词与行动词。
- 每页 3–8 个站内链接：功能 ↔ 平台 ↔ 价格 ↔ 相关博客。
- 图片必须有描述性 alt；截图文件名语义化。
- URL 使用小写英文短横线，保持稳定，改版必须 301。

### 12.3 技术 SEO

- 静态预渲染；核心内容不依赖 JS。
- `sitemap.xml`（含 hreflang）、`robots.txt`、canonical、RSS（博客）。
- 结构化数据：
  - 全站：`Organization`、`WebSite`
  - 首页/下载页：`SoftwareApplication` + 三个 `Offer`
  - 视频：`VideoObject`
  - FAQ：`FAQPage`
  - 层级：`BreadcrumbList`
- 性能预算：LCP < 2.0s（移动 4G）、INP < 200ms、CLS < 0.05、首屏 JS < 100KB、首屏视频 ≤ 12MB。
- 字体子集化、图片 AVIF/WebP、懒加载、CDN、Brotli。
- 搜索引擎：Google、Bing、百度（主动推送 + 站点地图）、360/搜狗基础适配。

### 12.4 内容 SEO

- 博客每篇一个搜索意图，不做关键词堆砌。
- 平台落地页必须有独立截图、独立 FAQ、独立案例描述；内容重复会导致整站降权。
- 每月更新更新日志；每季度审查价格页与 FAQ 的事实准确性。
- 外链：平台开发者社区、创作者论坛、工具导航站；不做垃圾外链。

---

## 13. GEO（生成式引擎优化）规范

### 13.1 目标

让 ChatGPT、Claude、Perplexity、Gemini、豆包、Kimi 等在回答"多平台发布工具推荐""自媒体数据复盘工具"时，能准确提到并引用本站。

### 13.2 做法

1. **答案先行**：每个页面开头用 40–60 字给出可被直接引用的定义。
   - 示例："自媒体内容运营工作台是一款本地优先的桌面应用，支持抖音、视频号、快手、B 站、微博、小红书、知乎、公众号 8 个平台的内容排期与自动发布，并把 4 个平台的数据自动汇总到本地复盘表。"
2. **实体一致性**：产品名、一句话介绍、价格、平台列表在官网、GitHub、媒体资料、社交简介中保持完全一致。
3. **可引用的事实块**：平台数量、价格、支持系统、数据存储方式，用短句和表格呈现，避免营销形容词。
4. **对比表**：手工发布 / 通用定时工具 / 本工作台的差异，用中性表述，不说竞品坏话。
5. **FAQ 结构化**：每问先给一句结论，再展开；同步 `FAQPage` 标记。
6. **来源与日期**：涉及平台能力的描述标注核查日期；引用平台官方说明时给出链接。
7. **llms.txt**：根目录提供 `llms.txt`（产品事实、页面索引、价格、限制）与 `llms-full.txt`（完整文案）。
8. **AI 爬虫策略**：`robots.txt` 明确允许 GPTBot、OAI-SearchBot、ChatGPT-User、ClaudeBot、PerplexityBot、Google-Extended；是否允许 Bytespider 由运营决定。
9. **媒体资料包**：Logo、产品截图、一句话介绍、价格表、创始人简介，方便第三方与 AI 引用。
10. **新鲜度**：更新日志、博客持续更新；每季度复核事实。

### 13.3 监测

- 每月用固定 10 个问题在主流 AI 引擎抽查是否被提及、描述是否准确。
- 记录 AI 来源引荐流量（referrer 含 chatgpt.com、perplexity.ai、claude.ai 等）。
- 发现错误描述时，优先修正站内事实块与 llms.txt。

---

## 14. 商业化与授权（上线前必须定）

### 14.1 价格与权益

| 方案 | 价格 | 有效期 | 建议权益 |
|---|---|---|---|
| 月付 | ¥49.9/月 | 1 个月，自动续费 | 全部功能 + 订阅期内更新 + 邮件支持 |
| 年付 | ¥500/年 | 12 个月 | 同上，约 8.4 折 |
| 终身 | ¥980 一次买断 | 永久 | 全部功能 + 长期更新（范围待确认） |

- 三档功能完全一致，避免"低价版缺功能"造成决策负担。
- 建议同时激活设备数：3 台（待确认）。
- 建议 14 天无理由退款（待确认）；若不做退款，必须在价格页显著说明。
- 发票类型与开票主体待确认。

### 14.2 购买流程

```
价格页 → 托管收银台 → 支付成功 → 邮件发送授权码 → 下载桌面版 → 输入授权码激活
```

- 支付渠道候选：Paddle / Lemon Squeezy（MoR，省税务合规）、Stripe + 支付宝/微信、国内聚合支付。需结合主体资质与目标用户选择。
- 授权码建议使用非对称签名，本地离线验签；订阅到期前 7 天提醒。
- 下载可公开，使用需激活；更新源保持公开以简化客户端逻辑。

### 14.3 依赖的产品改动

| 改动 | 说明 | 优先级 |
|---|---|---|
| 授权激活页 | 输入授权码、显示方案与到期日、错误提示 | P0 |
| 本地验签 | 内置公钥，离线校验签名与有效期 | P0 |
| 到期提醒 | 订阅到期前 7 天与到期当天提示 | P1 |
| 设备数限制 | 首次激活上报设备指纹，可选 | P1 |
| 续费/升级 | 价格页与客户端跳转续费 | P2 |

---

## 15. 文案库（中英）

### 15.1 Meta 标题与描述

| 页面 | 中文 title | 中文 description | English title | English description |
|---|---|---|---|---|
| 首页 | 自媒体内容运营工作台｜八平台一键发布与数据复盘 | 本地优先的自媒体运营工具：选题、排期、8 平台自动发布，抖音/小红书/视频号/公众号数据自动复盘。Windows / macOS / Linux。 | WeMedia Creator Workstation \| Multi-platform publishing & analytics | A local-first desktop workspace to plan, schedule, auto-publish to 8 Chinese platforms, and review performance. Your data stays on your machine. |
| 功能 | 功能｜选题、排期、发布、复盘、素材一体化 | 看看工作台如何替你做重复劳动：八平台发布、四平台数据回流、本地存储与语音复盘。 | Features \| Plan, publish, and review in one workspace | See how the workbench handles repetitive publishing, pulls performance data back, and keeps everything local. |
| 平台 | 支持平台｜抖音、视频号、快手、B 站、微博、小红书、知乎、公众号 | 一张工作台管理八个平台的内容发布与数据回流，无需申请 API。 | Platforms \| Publish to 8 Chinese social platforms | Schedule and publish to Douyin, WeChat Channels, Kuaishou, Bilibili, Weibo, Xiaohongshu, Zhihu, and WeChat Official Accounts. |
| 价格 | 价格｜月付 ¥49.9、年付 ¥500、终身 ¥980 | 一份授权，三种买法。全部功能一致，年付省 ¥98.8，终身一次买断。 | Pricing \| Monthly ¥49.9, yearly ¥500, lifetime ¥980 | One license, three payment options. Same features in every plan. Save with yearly billing or pay once for lifetime. |
| 下载 | 下载｜Windows / macOS / Linux 桌面版 | 下载自媒体内容运营工作台，安装后登录平台、输入授权码即可开始。 | Download \| Windows, macOS, and Linux | Download the desktop app, sign in to your platforms, and activate with your license key. |
| FAQ | 常见问题｜账号安全、数据存储、价格与授权 | 关于多平台发布、本地数据、授权与退款的常见问题，一次说清。 | FAQ \| Accounts, data, pricing, and licensing | Straight answers about platform logins, local data storage, licensing, and limitations. |
| 反馈 | 反馈与购买咨询 | 告诉我们你希望工作台替你解决什么；购买问题我们会尽快回复。 | Feedback & purchase inquiries | Tell us what you want the workbench to solve, or ask us anything about licensing. |

### 15.2 通用 CTA 与微文案

| 场景 | 中文 | English |
|---|---|---|
| 主 CTA | 下载桌面版 | Download for desktop |
| 次 CTA | 查看价格 | See pricing |
| 购买 CTA | 立即购买 | Buy now |
| 咨询 CTA | 购买咨询 | Ask about licensing |
| 价格页提示 | 价格为人民币；授权与退款条款以购买页为准。 | Prices are in CNY. Licensing and refund terms are shown at checkout. |
| 下载页提示 | 先下载，安装后再选择授权。 | Download first. Choose a license after installation. |
| 表单成功 | 收到，谢谢你。我们会尽快回复（购买咨询 1 个工作日内）。 | Thanks — we've got it. We reply to purchase inquiries within one business day. |
| 空状态 | 还没有内容。 | Nothing here yet. |
| 404 | 这个页面走丢了。回首页看看？ | This page wandered off. Back to home? |

### 15.3 购买 FAQ（中 / 英）

1. **月付、年付、终身有什么区别？** 功能完全一致，只是有效期与付款方式不同。年付比月付省 ¥98.8，终身一次买断。
   **What's the difference between monthly, yearly, and lifetime?** Same features; only billing and duration differ. Yearly saves ¥98.8, and lifetime is a one-time payment.
2. **数据存在哪里？** 全部存在你电脑上的 SQLite 数据库，不上传云端；可随时导出 CSV。
   **Where is my data stored?** In a local SQLite database on your computer. Nothing is uploaded; you can export CSV anytime.
3. **需要把账号密码给你们吗？** 不需要。你在独立浏览器窗口自行登录，登录态只保存在本机。
   **Do I need to hand over my passwords?** No. You sign in yourself in an isolated browser window; the session stays on your machine.
4. **平台改版导致发布失败怎么办？** 客户端会持续更新适配；失败任务可重试，发布结果会自动核验。
   **What happens when a platform changes its page?** The client keeps receiving compatibility updates. Failed tasks can be retried, and results are verified automatically.
5. **支持几台电脑？** 建议授权 3 台设备（最终以购买页条款为准）。
   **How many computers can I use?** Three devices per license is the recommended policy; see the checkout terms for the final rule.
6. **macOS 为什么不能自动更新？** 当前版本未签名，需要手动下载新版本；功能与 Windows 版本一致。
   **Why doesn't macOS auto-update?** The current build is unsigned, so updates are manual. Features match the Windows version.

---

## 16. 埋点与转化分析

| 事件 | 触发 | 关键参数 |
|---|---|---|
| `page_view` | 页面加载 | path、lang、referrer |
| `video_play` / `video_progress` / `video_complete` | 视频交互 | percent、autoplay |
| `cta_download_click` | 任意下载按钮 | os、page、position |
| `pricing_view` | 价格页可见 | lang |
| `plan_select` | 选择方案 | plan |
| `checkout_start` | 跳转收银台 | plan、provider |
| `feedback_open` / `feedback_submit` | 表单打开/提交 | type、page |
| `language_switch` | 切换语言 | from、to、path |
| `faq_expand` | 展开问题 | question |
| `download_complete`（可选） | 下载页回调或客户端上报 | os、version |

分析工具：优先 Umami（自托管，无 Cookie）或 Plausible；国内可加百度统计。配置 Search Console、Bing Webmaster、百度搜索资源平台。UTM 规范：`utm_source`、`utm_medium`、`utm_campaign` 统一小写。

---

## 17. 里程碑

| 阶段 | 周期 | 交付 |
|---|---|---|
| M0 内容与素材 | 第 1 周 | 文案定稿、真实截图、视频脚本、域名/备案启动 |
| M1 设计与骨架 | 第 2–3 周 | 视觉稿、Astro 工程、首页/功能/价格/下载（中文） |
| M2 双语与 SEO | 第 4 周 | 英文站、hreflang、结构化数据、sitemap、博客框架 |
| M3 视频与反馈 | 第 5 周 | 视频拍摄剪辑、字幕、反馈接口、通知 |
| M4 购买闭环 | 第 5–6 周 | 收银台、授权码发放、桌面端激活页（依赖产品改动） |
| M5 上线与监测 | 第 6 周 | 上线检查、索引提交、埋点验证、GEO 基线 |

---

## 18. 验收标准

### 18.1 内容与说服力

- [ ] 首屏 5 秒内能回答"是什么、给谁、省什么"。
- [ ] 每页只有一个主 CTA，价格页同时有购买与咨询入口。
- [ ] 所有截图来自真实产品，演示数据已标注。
- [ ] 诚实边界在 FAQ 与平台页可见，无夸大承诺。
- [ ] 中英文内容均完整，不是机器直译。

### 18.2 商务

- [ ] 三档价格、折扣计算、权益说明准确无误。
- [ ] 支付 → 授权码 → 激活全链路可用。
- [ ] 退款/发票/设备数条款与购买页一致。
- [ ] 下载链接指向最新版本，SHA256 可核对。

### 18.3 SEO / GEO

- [ ] 每页 title/description/canonical/hreflang 正确。
- [ ] 结构化数据通过 Rich Results Test。
- [ ] sitemap、robots、llms.txt 可访问且内容准确。
- [ ] 移动端 Lighthouse：SEO ≥ 95、可访问性 ≥ 95、性能 ≥ 90。
- [ ] 中英文页面互相链接，无死链。

### 18.4 功能

- [ ] 视频桌面自动播放静音、移动端点击播放、字幕可切换、文字稿可展开。
- [ ] 反馈表单提交成功、失败有提示、防刷生效、通知可达。
- [ ] 语言切换保持当前页面；不自动跳转。
- [ ] 360 / 768 / 1024 / 1440 布局正常。
- [ ] 无 Cookie 追踪需求时不弹 Cookie 横幅；如使用追踪 Cookie，必须提供同意管理。

---

## 19. 风险与待确认

| # | 事项 | 影响 | 建议 |
|---|---|---|---|
| 1 | 正式域名与备案主体 | 无法上线国内 CDN | 先定域名与主体，备案周期按 2–3 周计 |
| 2 | 支付渠道与商户资质 | 购买闭环无法上线 | 优先评估 Paddle / Stripe / 支付宝商户 |
| 3 | 是否提供试用与退款 | 影响转化与纠纷 | 建议 14 天无理由退款；试用可选"功能受限"或"7 天体验码" |
| 4 | 授权设备数与终身更新范围 | 影响定价公平性与成本 | 建议 3 台设备、终身含常规更新，重大版本另议 |
| 5 | 视频由谁拍摄与配音 | 首页核心素材 | 先拍屏幕演示版，再补真人 B-roll |
| 6 | 英文站是否显示美元价格 | 海外转化 | 首发保留人民币并注明；后续按支付渠道决定 |
| 7 | 产品界面暂为中文 | 英文用户体验 | FAQ 明示；界面国际化列入产品路线图 |
| 8 | 没有客户评价 | 信任建立慢 | 用真实截图、更新日志、创始人故事替代，禁止伪造 |
| 9 | 平台商标与图标使用 | 合规风险 | 仅作"支持平台"说明，遵守各平台品牌规范 |
| 10 | 自动化与平台条款 | 账号风险 | 官网如实披露，避免"绕过风控"等表述 |

---

## 20. 附录

### 20.1 结构化数据示例（SoftwareApplication）

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "自媒体内容运营工作台",
  "alternateName": "WeMedia Creator Workstation",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Windows, macOS, Linux",
  "description": "本地优先的自媒体内容运营桌面应用，支持 8 个平台的内容排期与自动发布，并将 4 个平台的数据自动汇总到本地复盘表。",
  "offers": [
    { "@type": "Offer", "name": "月付", "price": "49.9", "priceCurrency": "CNY" },
    { "@type": "Offer", "name": "年付", "price": "500", "priceCurrency": "CNY" },
    { "@type": "Offer", "name": "终身", "price": "980", "priceCurrency": "CNY" }
  ]
}
```

### 20.2 hreflang 示例

```html
<link rel="alternate" hreflang="zh-CN" href="https://<DOMAIN>/pricing/">
<link rel="alternate" hreflang="en" href="https://<DOMAIN>/en/pricing/">
<link rel="alternate" hreflang="x-default" href="https://<DOMAIN>/pricing/">
```

### 20.3 robots.txt 示例

```txt
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: https://<DOMAIN>/sitemap.xml
```

### 20.4 llms.txt 示例

```markdown
# 自媒体内容运营工作台 / WeMedia Creator Workstation

> 本地优先的自媒体内容运营桌面应用。支持抖音、视频号、快手、B 站、微博、小红书、知乎、公众号 8 个平台的排期与自动发布；抖音、小红书、视频号、公众号 4 个平台的数据自动回流到本地复盘表。数据存储在用户本机 SQLite，不上传云端。

## 关键事实
- 支持系统：Windows 10+、macOS 11+、Ubuntu 22.04+
- 价格：月付 ¥49.9；年付 ¥500；终身 ¥980（人民币）
- 使用要求：本机安装 Chrome/Edge，登录自己的平台账号
- 不支持：多人协作、云端同步；界面目前为简体中文

## 页面
- [首页](https://<DOMAIN>/)
- [功能](https://<DOMAIN>/features/)
- [平台](https://<DOMAIN>/platforms/)
- [价格](https://<DOMAIN>/pricing/)
- [下载](https://<DOMAIN>/download/)
- [FAQ](https://<DOMAIN>/faq/)
```

### 20.5 品牌与法律备注

- "抖音""视频号""快手""B 站""微博""小红书""知乎""公众号"等名称与图标归各自权利人所有，仅用于说明兼容性。
- 不使用"官方合作""唯一""100% 安全"等无法证实的表述。
- 价格、功能、限制变更时，同步更新：价格页、FAQ、llms.txt、结构化数据、购买页条款。
