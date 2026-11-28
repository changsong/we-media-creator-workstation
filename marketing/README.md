# 营销工作台（Marketing）

面向多平台创作者（抖音/快手/小红书/视频号/B站）的营销工作台：名单归一化 → 话术起草 → 人工发送 → 回复建议 → 转化看板。

## 合规边界（先读）

- 只联系公开主页的创作者，只使用主页上公开的资料（简介里公开的商务邮箱/微信可以保留）；不抓取私信、粉丝列表或非公开联系方式。
- **不做全自动群发**：每条消息由运营人员在浏览器里粘贴并亲手发送，脚本只负责排队、起草、复制文案、自动打开私信面板和记录。
- 单账号每天最多 40 条（硬上限 40），同一人 30 天内只触达一次；遇到平台验证提示立即停止。
- 不承诺“不会被封”“100% 安全”；对方表示不需要时不再联系。
- 收到投诉或明确拒绝的账号，把状态改为 `blocked`（数据库里手动更新即可）。

## 目录

```
marketing/
  outreach/
    templates.json          私信话术 + 回复知识库 + 限额配置
    niches.json             统一领域清单（各采集脚本默认遍历的领域与平台搜索词）
    lists/douyin-sample.csv 抖音名单模板（真实名单不要提交到 git）
    lists/multi-sample.csv  多平台名单模板（含 platform 列）
  scripts/
    leads.mjs               导入名单、平台看板、状态流转
    collect-douyin.mjs      按关键词采集公开创作者主页
    collect-bilibili.mjs    B站 UP 主采集（公开搜索接口）
    collect-kuaishou.mjs    快手用户采集（浏览器登录后抓搜索页）
    fill-kuaishou-followers.mjs 补全快手名单粉丝数（顺序请求主页 SSR）
    collect-xiaohongshu.mjs 小红书达人采集（灰豚数据接口）
    detail-xiaohongshu.mjs  小红书达人灰豚详情补全（按粉丝数从高到低，受每日额度限制）
    fix-xhs-links.mjs       把回退的灰豚达人页链接补换成真实小红书主页
    send.mjs                抖音半自动私信（登录 / dry-run / --live）
    send-live.cmd           在 PowerShell 新窗口启动抖音 --live
    reply.mjs               回复建议（关键词模板，可选 Claude）
    collect-comments.mjs    评论区采集：搜视频 + 抓公开评论 + 意图打分
    comments.mjs            评论库命令行：列表 / AI 起草 / 打开预填 / 记录 / 统计
    serve.mjs               本地营销看板服务（HTTP + JSON API）
    lib/                    SQLite、浏览器会话、领域清单加载、工具函数
  web/
    index.html              看板页面（平台概览 + 名单）
    send.html               发送台（待发队列 + 平台轮询 + 复制/记录）
    videos.html             视频评论库（按视频汇总合格评论 + 点评论定位 + 自动复制推广词）
  content/
    douyin-content-plan.md  抖音内容选题与账号包装
  data/                     数据库、浏览器 profile、截图（已 gitignore）
```

## 快速开始

环境：Node >= 22.5、本机 Chrome 或 Edge。

```bash
# 1. 首次登录（扫码，登录态保存在 marketing/data/chrome-profile）
node marketing/scripts/send.mjs --login

# 2. 导入名单（多平台用 multi-sample.csv，按 URL 自动识别平台）
node marketing/scripts/leads.mjs import marketing/outreach/lists/multi-sample.csv

# 3. 预览今天要发的抖音名单和文案（不会发送）
node marketing/scripts/send.mjs --limit 5

# 4. 正式逐条发送
node marketing/scripts/send.mjs --live --limit 10
#    或双击 / 运行 send-live.cmd，在新 PowerShell 窗口里跑
```

`--live` 流程：脚本打开目标主页并尝试自动点开「私信」面板 → 文案已复制到剪贴板 → 你在私信框 Ctrl+V 后亲手点发送 → 回终端按 `y`/Enter 记录。快捷键：`j`/`k` 上下切换名单、`s` 跳过、`r` 重新复制、`o` 重开私信面板、`q` 退出（←/→ 等同 `k`/`j`）。全程单键操作，但发送动作始终由你完成。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--limit N` | 本次最多处理几条（默认 10，最多 20） |
| `--cap N` | 覆盖每日上限（硬上限 40） |
| `--min-followers N` | 只看粉丝数不低于 N 的名单 |
| `--max-followers N` | 只看粉丝数不高于 N 的名单（冷启动建议先跑 1w–10w） |
| `--template A-pain` | 固定使用某套话术（默认按名单轮换） |
| `--no-wait` | 跳过条目间的随机等待（不建议） |
| `--id N --force` | 对已标记发送的名单再发一次 |

## 统一领域清单

所有采集脚本共用 `outreach/niches.json` 里的领域清单。不带 `--keyword` 运行时，脚本会按清单顺序遍历全部领域；不同平台需要不同搜索词时，用 `keywords` 覆盖。

```json
{ "domain": "读书分享", "keywords": { "default": "读书分享", "douyin": "读书博主" } }
```

- `domain` 是领域名，记录到名单的 `niche` 字段；`keywords.default` 是默认搜索词，平台键（`douyin` / `bilibili` / `xiaohongshu` / `kuaishou`）可单独覆盖。
- 增删领域只改这个文件，四个采集脚本自动生效。
- 跑全部领域：`node marketing/scripts/collect-douyin.mjs --import --yes`（或对应平台的采集脚本，省略 `--keyword` 即可）。名单的 `niche` 记领域名（如 `办公软件`），搜索用平台关键词（如抖音的 `PPT模板`）；`--limit` 按每个关键词分别计数，多个领域互不挤占。

## 采集抖音名单

在已登录的浏览器里按关键词搜索，滚动收集公开主页，自动按粉丝数过滤并去重。

```bash
# 首次登录（和 send.mjs 共用同一个浏览器 profile）
node marketing/scripts/collect-douyin.mjs --login

# 搜用户：每个词滚动 4 屏，最多保留 50 个 1k–50w 粉的主页
node marketing/scripts/collect-douyin.mjs --keyword "自媒体运营,职场口播" --limit 50

# 搜视频作者：结果更偏近期活跃，适合找还在更新的账号
node marketing/scripts/collect-douyin.mjs --keyword "美食探店" --mode video --import
```

- 输出到 `outreach/lists/douyin-collected-日期-时间.csv`；加 `--import` 直接导入名单库。
- 只读取搜索结果里公开的昵称、粉丝数、简介片段和主页链接，不采集手机号、粉丝列表或私信。
- 每屏滚动间隔 1.6–3.2 秒，关键词间隔 10–18 秒；遇到“安全验证/操作频繁”立即停止并截图。
- 每个关键词最多保留 100 个主页（`--limit` 按领域分别计数，多个关键词互不挤占），建议每天不超过一轮；粉丝数解析失败的账号默认丢弃，可用 `--keep-unknown` 保留。
- 已登录后加 `--yes` 可跳过确认，适合放进任务计划程序每天自动采集。
- 采集结果只是候选，发送前仍要人工看主页确认内容方向是否匹配。

## 采集其他平台名单

| 平台 | 采集方式 | 现状 |
| --- | --- | --- |
| B站 | `collect-bilibili.mjs`，复用主应用「连接设置 · B站」的 SESSDATA 调公开搜索接口；接口 -412 时自动回退网页搜索页解析 | 可用；B站限流很严（错误码 -412），需低频、每个关键词单独跑 |
| 小红书 | `collect-xiaohongshu.mjs`，走灰豚数据 `searchAnchor`（站内抓取风控严重，按既定方案走灰豚） | 脚本就绪；需先在「连接设置 · 灰豚数据」重新登录 |
| 快手 | `collect-kuaishou.mjs`，在自动化浏览器里登录后抓搜索用户页 | 脚本就绪；需先 `--login` 扫码（网页搜索必须登录） |
| 视频号 | 无公开的创作者搜索 | 网页端不可采集；走官方互选/广告平台或人工名单 |

```bash
# B站：按关键词搜 UP 主，粉丝默认 1000–50 万，导出 CSV 并导入
node marketing/scripts/collect-bilibili.mjs --keyword "母婴育儿" --pages 2 --import

# 每个关键词单独跑一次，避免像一次跑多个词那样触发 -412
node marketing/scripts/collect-bilibili.mjs --keyword "知识分享" --pages 1 --import
```

- 输出 `outreach/lists/bilibili-collected-日期-时间.csv`，加 `--import` 直接入库。
- 只采公开信息（昵称、粉丝、简介、主页链接），不含手机号/私信。
- 接口遇到 `-412` 会自动改用网页搜索页解析（仍拿公开卡片资料）；两边都失败才停止，建议等 10 分钟再换关键词。
- 入库前默认用公开卡片接口逐条核验主页（`space.bilibili.com/<mid>`）：昵称、粉丝以接口为准，昵称不一致的条目直接丢弃；已入库的 `profile_url` 不再重复核验、沿用原资料；核验接口被限流时跳过剩余核验并提示。不想核验可加 `--no-verify`。

```bash
# 小红书：先在「连接设置 · 灰豚数据」扫码登录，再按关键词搜达人
node marketing/scripts/collect-xiaohongshu.mjs --keyword "母婴育儿" --limit 30 --import

# 快手：首次先在自动化浏览器里扫码登录（和抖音采集共用 chrome-profile）
node marketing/scripts/collect-kuaishou.mjs --login
node marketing/scripts/collect-kuaishou.mjs --keyword "美食探店" --limit 30 --import

# 快手：补全已有名单的粉丝数（顺序 1.2–2.2 秒一条，遇到限流自动暂停，可重复跑到补完）
node marketing/scripts/fill-kuaishou-followers.mjs
node marketing/scripts/fill-kuaishou-followers.mjs --limit 200
```

- 小红书走灰豚接口，输出 `xiaohongshu-collected-日期-时间.csv`；能拿到小红书 userId 时用小红书主页链接，否则回退灰豚达人页链接（可用 `fix-xhs-links.mjs` 次日补换）。
- 灰豚免费版额度：`anchor/queryId` 500 次/天、`anchor/detail` 100 次/天，额度用完后接口返回「每天最多可以访问 100 次」，等到第二天再跑即可。
- 每条名单的 `note` 是简介原文（保留博主公开的商务邮箱/微信/QQ）+ 一行 `[灰豚]` 数据摘要（类型、职业、标签、小红书号、地域、获赞、笔记数、图文/视频报价、MCN、评分）；`extra` 列存灰豚返回的完整公开字段 JSON，详情补全后字段更全（粉丝画像、注册时间、CPM/CPE 等）。
- 快手是浏览器采集，输出 `kuaishou-collected-日期-时间.csv`；搜索页必须登录，未登录会提示先跑 `--login`。
- 快手搜索页现在分「视频 / 用户」两个 tab，脚本会自动切到「用户」再解析 `.user-card`；主页链接用卡片上的快手号拼成 `kuaishou.com/profile/<快手号>`。
- 卡片本身不显示粉丝数，脚本会再用登录 Cookie 批量请求各自详情页（读取服务端 HTML 里的 `ownerCount.fan`），3 路并发；遇到验证/限流、或连续多次拿到 200 但页面没有粉丝数据（疑似限流降级页）会自动停止，剩余账号按粉丝未知处理。加 `--no-followers` 可跳过这一步。
- 快手主页接口有滚动配额，短时间内大量请求后会对后续请求返回没有数据的页面；跑完后若大量名单粉丝为 0，用 `fill-kuaishou-followers.mjs` 隔一段时间补全（可反复跑，已补过的自动跳过）。
- 粉丝未知的账号默认保留（`--drop-unknown` 可丢弃）；`--min-followers` / `--max-followers` 照常生效。
- 两者都只采公开资料（昵称、粉丝、简介、主页链接）；简介原样保留，包含博主自己公开的商务邮箱/微信。
- 小红书主页链接通过灰豚 `anchor/queryId` 换成真实 userId（`xiaohongshu.com/user/profile/<userId>`）；个别取不到时回退灰豚达人页，备注里始终保留小红书号。

```bash
# 次日额度恢复后：把回退成灰豚达人页的名单补换成真实小红书主页
node marketing/scripts/fix-xhs-links.mjs

# 给已有小红书名单补全灰豚详情（每天最多 100 条，按粉丝数从高到低，额度用完自动停）
node marketing/scripts/detail-xiaohongshu.mjs --limit 100
node marketing/scripts/detail-xiaohongshu.mjs --limit 50 --min-followers 10000
```


## 多平台名单与转化看板

一个 SQLite 工作台统管抖音 / 快手 / 小红书 / 视频号 / B站：名单归一化、状态流转、回复知识库、回复率与转化率统计。

CSV 表头（新增 `platform` 列，可省略，按 URL 自动识别）：

```csv
platform,nickname,profile_url,followers,last_active,niche,source,note,extra
```

- `extra` 可省略，存平台返回的完整公开字段 JSON（灰豚采集会写全量字段到这一列）。

- `platform` 取值：`douyin` / `kuaishou` / `xiaohongshu` / `channels` / `bilibili`；留空时按域名自动识别（douyin.com、kuaishou.com、xiaohongshu.com/xhslink.com、channels.weixin.qq.com、bilibili.com/b23.tv），识别不了记为 `unknown`。
- CLI 里 `--platform` 同时接受中文别名（抖音/快手/小红书/视频号/B站）和简写（dy/ks/xhs/sph/bili）。
- 重复导入按 `profile_url` 更新资料，不会重置发送状态。
- 名单来源建议：关键词搜索作者、官方达人平台（蒲公英/磁力聚星/花火/互选）、热门评论区；筛选 1k–50w 粉、近 7 天更新。

```bash
# 导入（multi-sample.csv 演示 platform 列）
node marketing/scripts/leads.mjs import marketing/outreach/lists/multi-sample.csv

# 按平台查看
node marketing/scripts/leads.mjs list --platform xiaohongshu --status new --limit 20

# 看板：各平台 总数 / 已触达 / 回复 / 转化 / 回复率 / 转化率
node marketing/scripts/leads.mjs stats

# 状态流转：new → queued → sent → replied → converted；拒绝或投诉标 blocked
node marketing/scripts/leads.mjs mark --id 12 --status converted
```

口径：`已触达 = sent + replied + converted`，回复率 = `(replied + converted) / 已触达`，转化率 = `converted / 已触达`。

> 发送自动化目前只有抖音（人工确认的 `send.mjs`）。快手/小红书/视频号/B站请走官方达人平台或人工私信；工作台只负责名单、话术与转化统计，不做跨平台自动群发。

## 本地看板服务

```bash
node marketing/scripts/serve.mjs               # http://127.0.0.1:4173
node marketing/scripts/serve.mjs --port 8080   # 换端口
node marketing/scripts/serve.mjs --host 0.0.0.0 # 局域网可访问（自行评估隐私）
```

- 看板页 `/`：顶部看板（总数/今日已发/回复/转化）+ 平台概览表（已触达、回复率、转化率）+ 名单表（按平台/状态/关键词筛选，行内改状态）。
- 发送台 `/send.html`：按平台轮询排出待发队列（抖音 → B站 → 小红书 → 视频号 循环，每个平台各自取候选，避免抖音大户挤占）；页面加载后自动准备第一条（复制文案 → 打开主页 → 抖音自动开私信）；你在平台 Ctrl+V 粘贴并亲手点发送，发出后点「我已确认发送」，60–120 秒倒计时结束自动准备下一条，到今日上限自动停。主按钮「开始这条」可随时手动重做这一串动作。
- 暂时不参与发送的平台在 `templates.json` 的 `settings.sendExcludePlatforms` 里配置（默认 `["kuaishou"]`，因为快手没有网页端私信）；发送台顶部会显示本轮跳过的平台，改完配置重启 `serve.mjs` 生效。
- 抖音「打开主页」走服务端 CDP：复用 `lib/browser.mjs` 打开主页并尝试点开私信面板，面板出现在 `marketing/data/chrome-profile` 那个 Chrome 窗口（与 `send.mjs` 同一登录态，需先 `--login`）；其它平台仍是新标签打开、手动点私信。
- JSON API：`GET /api/overview`、`GET /api/leads?...`、`GET /api/queue?limit=`、`POST /api/leads/:id/open`（仅抖音）、`POST /api/leads/:id/status`、`POST /api/leads/:id/sent`、`POST /api/leads/:id/skip`。
- **发送动作始终由人完成**：服务只做排队、生成文案、复制、记录状态，不自动填入或发送。
- 关于「自动核验是否发送成功」：网页无法读取其它平台的标签页（跨域限制），所以「我已确认发送」就是人工核对后的确认点，服务据此把状态改为 `sent`。
- 默认只绑定 `127.0.0.1`，不加 `--host` 外部访问不到。

## 回复建议

```bash
node marketing/scripts/reply.mjs --text "这个多少钱？"
node marketing/scripts/reply.mjs --copy --text "会封号吗？"
node marketing/scripts/reply.mjs --ai --log 12 --text "支持哪些平台？"
```

- 默认按关键词匹配 `templates.json` 的回复库。
- `--ai` 需要 `ANTHROPIC_API_KEY`，调用 Claude 生成；失败或出现夸大承诺会回退模板。
- `--log <id>` 把对方消息和意图记到最近一次触达记录，名单状态改为 `replied`。

## 评论区雷达（评论截流）

按关键词搜视频，抓视频下的公开评论，找出正在问「多平台发布 / 多账号管理 / 自媒体管理工具」的人，用 DeepSeek 结合视频和评论上下文生成回复，再由人确认发送。

### 1. 配置 DeepSeek

把 key 写到 `marketing/.ai.json`（已 gitignore）：

```json
{
  "apiKey": "sk-你的 DeepSeek key",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat"
}
```

也支持环境变量 `DEEPSEEK_API_KEY` 或 `MARKETING_AI_KEY`。没有 key 时自动回退内置模板，不会阻断流程。

### 2. 采集评论

```bash
# 先登录需要登录的平台（抖音 / 快手 / 小红书；B站用主应用连接设置里的 SESSDATA）
node marketing/scripts/collect-comments.mjs --login --platform douyin,kuaishou,xiaohongshu

# 按默认搜索词跑全部平台（视频号会提示手动导入）
node marketing/scripts/collect-comments.mjs --platform all --yes

# 只跑抖音 + B站，自定义关键词
node marketing/scripts/collect-comments.mjs --platform douyin,bilibili --keyword "自媒体工具,多平台发布" --yes
```

- 默认搜索词在 `outreach/comments.json` 的 `search.keywords`：`自媒体工具 / 如何做自媒体 / 自媒体运营 / 短视频运营 / 矩阵号运营`。
- 默认每个关键词取前 **100 个视频**（`--videos` 可调，上限 100）；抖音/快手/小红书会滚动搜索页，B站会自动翻页。
- 100 个视频会逐个打开详情页抓评论，耗时较长；建议一次只跑 1–2 个关键词。只想少开详情页时用 `--videos 2`。
- 默认每条视频抓 **全部评论**（单视频安全上限 `settings.maxCommentsPerVideo`，默认 1000）；所有评论都会做意图打分，只有命中的进入视频评论库。
- 全部评论会显著增加耗时，建议一次只跑 1 个关键词；想限制单视频评论数用 `--comments 20`。
- 意图词库也在 `outreach/comments.json`：多平台发布/同步、多账号/矩阵、管理工具/排期、发布痛点、安全风控、求推荐、竞品讨论。
- 负向词（招聘、代运营、收徒、互关涨粉、刷量等）直接忽略；视频作者本人的评论、竞品工具号也会跳过。
- 视频按 `(platform, video_id)` 去重；评论优先按平台评论 ID 去重，拿不到 ID 时按「同视频 + 同作者 + 同内容」兜底去重，跨天重跑不会重复入库。
- 采集只读公开评论，不碰私信、手机号、粉丝列表。
- 遇到验证码/操作频繁会停止并截图到 `data/screenshots/`。

### 进度与续跑

采集进度写入 SQLite 的 `collect_progress` 表，按「平台 + 关键词 + 视频 ID」记录：

```bash
# 查看进度
node marketing/scripts/collect-comments.mjs --progress --platform douyin

# 默认续跑：已完成的视频下次自动跳过
node marketing/scripts/collect-comments.mjs --platform douyin --keyword "自媒体工具" --videos 100 --comments 10 --yes

# 已完成视频也重新抓
node marketing/scripts/collect-comments.mjs --platform douyin --keyword "自媒体工具" --no-resume

# 清空所选平台/关键词的进度，从头开始
node marketing/scripts/collect-comments.mjs --platform douyin --keyword "自媒体工具" --restart
```

- 搜索列表顺序变化不影响续跑，因为记录的是视频 ID。
- 进度会记录当时的评论上限；从固定条数改成「全部」时，旧记录会自动失效并重抓，不会误跳过。
- 中途遇到验证码停止时，正在抓的视频保持 `in_progress`，下次会重试。
- 已完成 / 已跳过的视频默认不再打开；要重抓用 `--no-resume` 或 `--restart`。

### 3. 生成与回复

```bash
# 看待处理队列
node marketing/scripts/comments.mjs list --status new --limit 20

# 批量生成草稿（DeepSeek 出 3 版，自选最佳；失败回退模板）
node marketing/scripts/comments.mjs draft --limit 5

# 打开原视频，定位评论，打开回复框并预填（发送仍由人点）
node marketing/scripts/comments.mjs open --id 12

# 人点完发送后记录
node marketing/scripts/comments.mjs sent --id 12

# 交互式跑一批：y 已回复 / s 跳过 / j 下一条 / r 重贴 / q 退出
node marketing/scripts/comments.mjs run --limit 5
```

也可以直接用网页版：

```bash
node marketing/scripts/serve.mjs
# 看板：      http://127.0.0.1:4173/
# 视频评论库： http://127.0.0.1:4173/videos.html
```

- 「视频评论库」按视频汇总命中推广意图的评论；点评论原文会打开视频并定位到那条评论，同时自动生成并复制 AI 推广词，你到平台里粘贴、手工发送即可。
- 推广词可以直接在页面里修改；页面加载时会给前 8 条缺失推广词的评论自动生成，也可以点「批量生成推广词」。

### 4. 视频号

视频号没有公开的网页视频/评论搜索入口，无法自动采集。用「手动添加」把视频链接和评论原文导进来，AI 出稿后复制到微信里回复：

```bash
node marketing/scripts/comments.mjs add --platform channels \
  --video-url "https://..." --title "视频标题" --text "评论原文" --draft
```

网页版在视频评论库点「手动添加视频号」也可以。

### 5. 限额与注意

- 每天总共 10–15 条，单平台默认 5 条；同一视频最多 1 条；同一用户 30 天冷却；发送间隔 3–8 分钟随机。
- 回复会直接带试用信息（`outreach/comments.json` 的 `settings.ctaMode`，默认「官网 + 31 天试用」）。
- 评论里提到易创精灵、易媒等竞品时也会进入「竞品讨论」候选；AI 会先认可对方体验，不点名、不贬低竞品，再说明媒管家的差异。
- 评论区是公开场景，**不要批量刷屏、不要重复文案**；回复里明确说明自己是工具方，不伪装路人。
- 自动预填依赖平台页面结构，页面改版后可能失效；失败时会退化成「复制文案 + 打开原视频」，手动粘贴即可。
- 小红书/快手风控更严，建议低频、固定账号跑；遇到验证立即停。

## 每日流程（约 40 分钟 + 间隔等待）

1. 补 30–40 条新名单，导入。
2. `send.mjs` 跑 dry-run 检查文案和人群。
3. `--live --limit 10` 逐条发送（每条按 `y` 记录），间隔 3–8 分钟。
4. 有新回复时用 `reply.mjs` 生成回复，手工发送。
5. 每周看一次统计：`leads.mjs stats`，记录回复率和试用领取数。

## 数据与隐私

- 数据库：`marketing/data/marketing.db`（SQLite，含名单和触达记录）。
- 浏览器登录态：`marketing/data/chrome-profile`，只在本机。
- 风控截图：`marketing/data/screenshots/`。
- 以上目录已 gitignore；名单 CSV 默认不提交，示例文件除外。

## 指标与目标

| 指标 | 观察方式 | 首月目标 |
| --- | --- | --- |
| 日发送量 | `leads.mjs stats` | 10–20 |
| 回复率 | 有回复记录 / 已发送 | 5%–10% |
| 试用领取 | Keygate 后台 | 回复者的 30% |
| 激活率 | 客户端登录数据 | 领取者的 50% |

## 预算说明

¥100 级别的预算不适合投信息流（起量门槛通常更高）。建议用在：给 1–2 个 1w–10w 粉的运营类博主寄试用 + 专属折扣码，或做一次小额投放测试，重点看“试用领取成本”，不要只看播放量。
