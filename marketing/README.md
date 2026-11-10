# 营销工作台（Marketing）

面向抖音创作者的半自动触达工具：名单管理 → 文案起草 → 人工确认发送 → 回复建议 → 转化记录。

## 合规边界（先读）

- 只联系公开主页的创作者，不抓取手机号、微信、私域联系方式。
- **不做全自动群发**：每条消息由运营人员在浏览器里确认后发出，脚本负责排队、起草、复制和记录。
- 单账号每天最多 20 条（硬上限 30），同一人 30 天内只触达一次；遇到平台验证提示立即停止。
- 不承诺“不会被封”“100% 安全”；对方表示不需要时不再联系。
- 收到投诉或明确拒绝的账号，把状态改为 `blocked`（数据库里手动更新即可）。

## 目录

```
marketing/
  outreach/
    templates.json          私信话术 + 回复知识库 + 限额配置
    lists/douyin-sample.csv 名单模板（真实名单不要提交到 git）
  scripts/
    leads.mjs               导入名单、查看统计与队列
    send.mjs                半自动私信（登录 / dry-run / --live）
    reply.mjs               回复建议（关键词模板，可选 Claude）
    lib/                    SQLite、浏览器会话、工具函数
  content/
    douyin-content-plan.md  抖音内容选题与账号包装
  data/                     数据库、浏览器 profile、截图（已 gitignore）
```

## 快速开始

环境：Node >= 22.5、本机 Chrome 或 Edge。

```bash
# 1. 首次登录（扫码，登录态保存在 marketing/data/chrome-profile）
node marketing/scripts/send.mjs --login

# 2. 导入名单
node marketing/scripts/leads.mjs import marketing/outreach/lists/douyin-sample.csv

# 3. 预览今天的名单和文案（不会发送）
node marketing/scripts/send.mjs --limit 5

# 4. 正式逐条发送（每条发送后回车记录）
node marketing/scripts/send.mjs --live --limit 10
```

`--live` 流程：脚本打开目标主页 → 把文案复制到剪贴板 → 你在浏览器点「私信」粘贴发送 → 回终端按 Enter 记录。输入 `s` 跳过，`q` 退出。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--limit N` | 本次最多处理几条（默认 10，最多 20） |
| `--cap N` | 覆盖每日上限（硬上限 30） |
| `--min-followers N` | 只看粉丝数不低于 N 的名单 |
| `--template A-pain` | 固定使用某套话术（默认按名单轮换） |
| `--no-wait` | 跳过条目间的随机等待（不建议） |
| `--id N --force` | 对已标记发送的名单再发一次 |

## 名单格式

CSV 表头：

```csv
nickname,profile_url,followers,last_active,niche,source,note
```

- `profile_url` 必须是 `https://www.douyin.com/user/...`，否则导入或发送时跳过。
- 重复导入按 `profile_url` 更新资料，不会重置发送状态。
- 名单来源建议：关键词搜索作者、热门视频评论区活跃用户、公开榜单；筛选 1k–50w 粉、近 7 天更新、简介含运营/矩阵/接单。

## 回复建议

```bash
node marketing/scripts/reply.mjs --text "这个多少钱？"
node marketing/scripts/reply.mjs --copy --text "会封号吗？"
node marketing/scripts/reply.mjs --ai --log 12 --text "支持哪些平台？"
```

- 默认按关键词匹配 `templates.json` 的回复库。
- `--ai` 需要 `ANTHROPIC_API_KEY`，调用 Claude 生成；失败或出现夸大承诺会回退模板。
- `--log <id>` 把对方消息和意图记到最近一次触达记录，名单状态改为 `replied`。

## 每日流程（约 40 分钟 + 间隔等待）

1. 补 10–20 条新名单，导入。
2. `send.mjs` 跑 dry-run 检查文案和人群。
3. `--live --limit 10` 逐条确认发送，间隔 3–8 分钟。
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
