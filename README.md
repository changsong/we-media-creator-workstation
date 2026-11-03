# 自媒体内容运营工作台

选题 → 排期 → 发布 → 复盘 → 沉淀，一个单页工作台配四张业务表。数据存在本机 SQLite，页面写入立即落库，多标签页通过 SSE 实时同步。

- **前端**：原生 HTML/CSS/JS，无构建、无依赖，五个视图（首页 / 选题池 / 内容日历 / 数据复盘 / 素材库）
- **后端**：Node 内置 `http` + 内置 `node:sqlite`，零第三方依赖
- **存储**：`data/workbench.db`，WAL 模式、约束与索引、每日整库快照

## 启动

需要 Node ≥ 22.5（内置 SQLite 从 22.5 开始提供）。

```bash
cd D:\workspace\we-media-creator-workstation
npm start                 # 默认 http://127.0.0.1:5180
npm start -- --port 8080  # 换端口
```

也可以双击 `start.bat`。首次启动（且 `data/` 为空）会自动写入 4 条选题、4 条排期、7 条复盘快照、1 篇素材的示例数据。

> 只监听 `127.0.0.1`。需要局域网访问时用 `npm start -- --host 0.0.0.0`，自行确认网络安全。

## 桌面版（Windows / macOS / Linux）

桌面版用 Electron 外壳托管同一个本地服务：主进程挑一个空闲端口启动 `server.js` 子进程，窗口加载 `http://127.0.0.1:<port>/`。关闭窗口只是隐藏到托盘，定时发布、数据同步继续在后台运行；托盘菜单可以重新打开窗口、打开数据目录、检查更新或退出。

- **Windows**：NSIS 一键安装（无需管理员），支持自动更新
- **macOS**：dmg / zip（x64 与 arm64），当前未签名，首次打开需右键「打开」绕过 Gatekeeper；不支持自动更新，升级请重新下载安装包
- **Linux**：AppImage（支持自动更新）与 deb（需手动升级）

打包（需要 Node ≥ 22.5）：

```bash
npm install
npm run dist:win     # dist/WeMedia-Workstation-Setup-<version>.exe
npm run dist:mac     # 需在 macOS 上执行
npm run dist:linux   # 建议在 Ubuntu 22.04 上执行
```

国内网络下载 Electron / NSIS 工具链较慢时，可以加镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist:win
```

运行数据放在系统用户目录，不在安装目录：

| 平台 | 数据目录 |
|---|---|
| Windows | `%APPDATA%\WeMedia Creator Workstation\data` |
| macOS | `~/Library/Application Support/WeMedia Creator Workstation/data` |
| Linux | `~/.config/WeMedia Creator Workstation/data` |

同级 `logs/server.log` 是本地服务日志（超过 5 MB 自动轮转）。从源码版迁移时，把原 `data/` 复制到上表目录即可。发布功能仍依赖本机安装的 Chrome / Edge（可用 `CHROME_PATH` 指定）。

### 自动更新与发布

客户端用 `electron-updater` 的 generic provider：构建时把 `PUBLISH_BASE_URL` 写入 `app-update.yml`，各平台从 `${PUBLISH_BASE_URL}/we-media/${os}/${arch}` 拉取 `latest*.yml` 和安装包。Windows 安装版与 Linux AppImage 会在启动 10 秒后检查一次、之后每 4 小时检查一次，下载完成后提示重启安装；deb 和未签名的 macOS 版本需要手动升级。

发布流程：

1. 修改 `package.json` 的 `version` 并提交。
2. 打 tag 推送：`git tag v2.0.1 && git push origin v2.0.1`。
3. GitHub Actions（`.github/workflows/release.yml`）校验 tag 与版本一致、执行 `npm run check`，然后构建 win-x64 / linux-x64 / mac-x64 / mac-arm64 四份产物。
4. `publish` job 用 `tools/upload-oss.js` 上传到阿里云 OSS；`latest*.yml` 设为不缓存，安装包长期缓存。

仓库需要的配置：

- Actions 变量 `PUBLISH_BASE_URL`：OSS 公网访问地址（不带末尾斜杠）
- Actions secrets：`OSS_REGION`、`OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`

## 目录

```
server.js                    HTTP 服务、REST 接口、SSE 推送、静态文件
lib/schemas.js               四张表的字段定义（前端表单与后端校验共用）
lib/mapping.js               中文业务字段 ↔ SQLite 列名映射
lib/db.js                    连接、DDL、索引、事务、每日备份
lib/store.js                 查询/写入/校验/自动编号/CSV
lib/migrate.js               旧 JSON 导入、示例数据写入
lib/seed.js                  示例数据内容
lib/proxy-tunnel.js          本地无认证代理转发层（替 Chrome 注入上游代理鉴权）
lib/proxy-config.js          住宅代理配置（data/proxy.json、掩码、会话模板）
public/                      index.html / style.css / app.js
data/workbench.db            数据库（运行时生成）
data/backups/                每日整库快照，保留 7 天
data/legacy/                 迁移前的 JSON 存档
tools/migrate-json-to-sqlite.js  迁移命令
tools/smoke-test.js          页面冒烟测试（需要 jsdom）
tools/sync-test.js           SSE 同步验证
tools/verify-proxy.js        代理模块自检（本地 mock 上游，无需真实代理）
desktop/main.js              Electron 主进程：窗口、托盘、服务子进程、日志
desktop/updater.js           自动更新（electron-updater）
electron-builder.yml         桌面打包与发布源配置
tools/upload-oss.js          CI 上传构建产物到阿里云 OSS
.github/workflows/release.yml 三平台构建与发布
```

## 表设计

页面仍用中文业务字段，库里统一 snake_case，映射写在 `lib/mapping.js`，所以可以直接用 SQL 查库。

```
topics                      选题池
  id              TEXT PK       内部主键
  code            TEXT UNIQUE   业务编号 TP2610-01
  title           TEXT NOT NULL 选题
  platform        TEXT NOT NULL 平台
  angle           TEXT          切入角度
  status          TEXT          待写/写作中/已发布/废弃
  score           REAL CHECK 0..10   爆款潜力评分（人工打分）
  tags            TEXT JSON     标签数组
  reference_url   TEXT          参考链接
  created_on      TEXT          创建日期
  created_at/updated_at TEXT

schedules                   内容日历
  id, code (SC2610-01), topic_code → topics.code
  title, platform, publish_at (YYYY-MM-DDTHH:mm), stage, owner, format,
  publish_url, note, created_at, updated_at

reviews                     数据复盘（快照）
  id, code (RV2610-01), schedule_code, platform, stat_date,
  reads / likes / followers / conversions  INTEGER CHECK >= 0,
  note, created_at, updated_at
  UNIQUE (schedule_code, stat_date)   -- 一条排期每天只能一条快照

assets                      素材库
  id, code (AS2610-01), topic_code, schedule_code,
  title, platform, manuscript_md, image_spec, keywords JSON,
  archived_on, word_count, publish_url, manuscript_doc_url, image_doc_url,
  created_at, updated_at

sequences                   业务编号计数器（只增不减）
  table_key PK, month, value

meta                        schema_version
```

索引：`schedules(publish_at / platform / stage / topic_code)`、`reviews(stat_date / platform / schedule_code)`、`topics(platform / status / score DESC)`、`assets(topic_code / schedule_code / archived_on)`。

设计取舍：

- **关联用业务编号，不建外键**。删上游记录不会连带删下游，也不会把下游的关联字段置空——这跟页面「删除只影响本表」的语义一致。健康检查会统计悬空引用：`GET /api/health → orphans`
- **复盘唯一约束**落在库上：同一排期同一天再插一条会被拒绝，提示改用编辑
- **编号计数器独立成表**：删掉记录后编号不会被复用，避免旧链接指向新内容
- **标签/关键词存 JSON**：SQLite 里就是文本，读出来再反序列化；需要时可用 `json_each` 展开
- **派生指标不落库**：互动率、涨粉率、趋势、周频率都由页面实时算

## 数据迁移

旧版 JSON（`data/store.json`）已经迁到 SQLite，原文件存档在 `data/legacy/store-20261017125428.json`。

- 手动迁移：`npm run migrate`（源文件不在 `data/store.json` 时用 `-- --source 路径`）
- 重复导入：加 `-- --force`，否则库里已有数据时会拒绝执行
- 自动迁移：启动时若 `data/store.json` 存在且四张表都为空，会自动导入并把原文件移到 `data/legacy/`
- 迁移会逐表核对条数，不一致就整体报错、不移动原文件；单条触发约束（如重复快照）会记录到 `skipped` 并继续
- 编号计数器一并继承，迁移后新建记录的编号接着旧序号往下走

迁移结果（本次）：

| 表 | 条数 |
|---|---|
| 选题池 | 4 |
| 内容日历 | 4 |
| 数据复盘 | 7 |
| 素材库 | 1 |

## 备份与恢复

- 每天第一次写入前执行 `VACUUM INTO data/backups/workbench-YYYY-MM-DD.db`，保留最近 7 天
- 手动备份：`npm run migrate` 不会备份，直接拷 `data/workbench.db`（先停止服务）或执行 `VACUUM INTO` 更稳妥
- 恢复：停止服务 → 用备份文件覆盖 `data/workbench.db` → 删掉 `data/workbench.db-wal` 和 `-shm` → 启动

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 版本、库路径、`integrity_check`、各表条数、悬空引用 |
| GET | `/api/schema` | 四张表的字段定义 |
| GET | `/api/schema/:table` | 单表字段定义 |
| GET | `/api/tables/:table/records?pageSize=200&cursor=0&q=关键词` | 分页读取，`q` 对文本列做 LIKE 检索 |
| GET | `/api/tables/:table/records/:id` | 单条读取 |
| POST | `/api/tables/:table/records` | 新建，`{ "properties": {...} }` |
| PATCH | `/api/tables/:table/records/:id` | 局部更新 |
| DELETE | `/api/tables/:table/records/:id` | 删除 |
| GET | `/api/tables/:table/export.csv` | 导出 CSV（带 BOM） |
| GET | `/api/events` | SSE，写入时推送 `change` 事件 |

字段值支持裸值（`"平台": "小红书"`）或类型包装（`"平台": {"select": "小红书"}`）。服务端按 schema 统一校验：选项不在候选、评分越界、链接非 http(s)、必填为空、复盘同日重复、编号冲突，都会返回 400/409 和中文原因。

## 文案提取（爆款雷达）

「选题池 → 爆款灵感雷达 → 文案提取」可以把视频里的口播文案转成可编辑文本，完成后可复制、下载 TXT、转成选题或存进素材库。

- **输入**：粘贴 B站 / 抖音 / 小红书 / 快手视频链接；短链（`b23.tv`、`v.douyin.com`、`xhslink.com`、`v.kuaishou.com`）会自动展开。也可以直接选择或拖入本地视频/音频（最大 2GB）。
- **链接来源**：优先读取平台自带字幕（B站字幕 JSON、抖音 `caption_infos`）；小红书、快手字幕覆盖有限，没有字幕时会提示下载视频后在本页上传，不会伪造结果。
- **本地文件**：ffmpeg 抽取 16kHz 单声道音频，再用内置 whisper.cpp 在本机转写；音视频不会上传云端。模型不随安装包分发，首次转写按需下载 `small` 模型（约 466MB）到 `data/models`，之后离线可用。
- **任务模型**：串行执行，同一时间只跑一个任务，进程内保留最近 20 个结果；刷新页面后需要重新发起。上传的临时文件在任务结束后删除，残留文件按 24 小时清理。
- **接口**：
  - `POST /api/trends/transcript` 提交 `{ "url": "https://..." }` 或 `{ "fileId": "...", "name": "..." }`，返回 202 与任务快照；`GET /api/trends/transcript/:id` 轮询状态、分段与整篇文本。
  - `POST /api/trends/transcript/upload?name=xxx.mp4` 以原始二进制流上传，返回 `{ fileId, name, size }`。
  - `GET /api/asr/status` 查看 ffmpeg / whisper.cpp / 模型状态；`POST /api/asr/model` 开始下载模型。
  - `WB_TRENDS_MOCK=1` 时返回演示文案，便于无网络测试；`WB_WHISPER_MODEL` 可切换 `tiny/base/small/medium/large-v3`，`WB_ASR_LANG` 指定识别语言（默认 `auto`）。
- **二进制**：`npm run vendor` 会把 ffmpeg-static 复制到 `vendor/ffmpeg`，并准备 whisper.cpp CLI 到 `vendor/whisper/<platform>-<arch>`；`vendor/` 不入库。Windows / Linux 下载官方预编译包，`npm run dist:win` / `dist:linux` 会自动准备；macOS 在打包时（`npm run dist:mac`）从源码编译 universal `whisper-cli`（arm64 + x86_64），需要构建机具备 Xcode Command Line Tools 与 cmake，产物同时写入 `vendor/whisper/darwin-arm64` 和 `darwin-x64`。可用 `WB_WHISPER_SRC` 指定本地源码、`WB_WHISPER_BUILD` 指定版本、`WB_WHISPER_MAC_METAL=0` 强制纯 CPU 构建，或用 `WB_WHISPER_PATH` / `WB_FFMPEG_PATH` 指向自定义程序。
- **合规**：提取结果仅供个人学习、研究与选题参考；视频与文案著作权归原作者，不得直接搬运发布或冒充原创（见官网《服务条款》「文案提取与知识产权」）。

## 网络代理（爆款雷达 / 小红书·抖音登录）

小红书、抖音对无头浏览器搜索的访问限制主要来自 IP。可在「连接设置 · 网络代理」为每个创作者本机配置自己的 HTTP 代理（用户名 + 密码），雷达搜索与小红书/抖音一键登录会经同一出口访问；其它浏览器流程默认仍直连。

- 配置落盘 `data/proxy.json`，读取掩码、密码不回显；也可用环境变量 `WB_PROXY_ENABLED / SCHEME / HOST / PORT / USER / PASS / SESSION / TEMPLATE / AUTO_ROTATE` 覆盖（环境变量优先）。
- Chrome 启动参数无法携带代理密码，服务会在 `127.0.0.1` 起一个仅本机可连的转发代理，替 Chrome 注入 `Proxy-Authorization`。
- **粘性会话**：一套安装持有一个 `sessionId`；若会话模板含 `{session}`（如 `user-session-{session}`），会注入到代理用户名里固定出口 IP（能否固定取决于代理商）。设置后可在界面「更换出口 IP」。
- **失败即停**：代理已启用但配置不完整时，雷达/登录会直接报错而不是静默改走直连，避免泄漏本机真实 IP。
- **访问受限重试**：命中平台访问限制时最多重试 1 次（指数退避 + 同平台 4 分钟冷却），不自动更换出口 IP，避免破坏登录与搜索同 IP 的前提。
- 接口：`GET/PUT /api/proxy`、`POST /api/proxy/test`（探测抖音 443 并尽量返回出口 IP）、`POST /api/proxy/rotate`（有浏览器任务时返回 409）。

**合规约定**：本应用只提供代理配置入口，不内置、不代售、不托管任何代理或 IP 资源。代理账号由使用者自行提供并保证来源合法；使用者应遵守各平台用户协议与所在地法律法规，不得将本功能用于规避国家网络管理、跨境违规访问、批量注册、刷量或其他违法用途。详细约定见官网《服务条款》中「网络代理与访问出口」一节。

## 验证

```bash
npm start                                  # 另开一个终端
set NODE_PATH=C:\Users\Intel\.workbuddy\binaries\node\workspace\node_modules
node tools/smoke-test.js                   # 25 项页面交互
node tools/sync-test.js                    # SSE 推送
node tools/verify-proxy.js                 # 代理转发/配置自检（无需真实代理）
node tools/verify-trends.js                # 雷达搜索 + 文案提取（含本地上传）+ 代理 Tab（演示模式）
```

最近一次结果：`verify-trends` 62/62 通过；本地 whisper.cpp 链路用合成语音验证通过（tiny 模型，12 秒音频约 43 秒转写）。

## 常见改动

- **加平台**：改 `lib/schemas.js` 的 `PLATFORMS`，页面下拉自动跟着变（列是 TEXT，不用改库）
- **加字段**：`lib/schemas.js` 加一项 + `lib/mapping.js` 加列映射 + `lib/db.js` 里 `ALTER TABLE`（或重建库）；列表展示还要改 `public/app.js` 对应视图
- **改阶段**：`STAGES` 决定顺序与颜色；写回选题状态的规则在 `public/app.js` 的 `syncTopicStatus()`
- **直接查库**：`node --experimental-sqlite -e "..."`，或用任意 SQLite 客户端打开 `data/workbench.db`（建议只读，写入请走页面/接口以保证校验）

## 与资料库页面的关系

资料库里还有一份云端版（`资料库 → 自媒体内容运营工作台`），数据存在资料库表格中，适合多设备查看。这份本地工程是自托管版本：数据完全在本机、写入更快、便于二次开发。两边字段结构一致，CSV 可以互导。

## 官网（`website/`）

面向终端用户的中英双语产品站。构建产物是纯静态目录，反馈表单由 `website/server.mjs` 接收并写入本地 SQLite。

```bash
npm run site:build             # 生成 website/site（63 页，含 /en/ 全量镜像）
PORT=8788 npm run site:serve   # 本地预览 + /api/feedback
npm run site:deploy            # 构建并发布到生产服务器（SSH 上传 + 重启 + 健康检查）
npm run site:releases          # 从 OSS 拉取 latest*.yml，更新 src/data/releases.json
```

- 页面与文案：首页在 `website/src/lib/home.mjs`，其余页面在 `lib/pages.mjs`；结构化数据在 `website/src/data/`
- 版本与安装包：来自 `website/src/data/releases.json`。桌面版发版后先跑 `npm run site:releases`，再重新构建
- 构建环境变量：`SITE_URL`（canonical / OG 绝对地址）、`SITE_BASE`（子路径部署）、`FEEDBACK_ENDPOINT`、`CHECKOUT_URL`、`CONTACT_EMAIL`
- 部署：把 `website/site/` 上传到静态托管（Nginx / OSS + CDN），并把 `/api/feedback` 反向代理到 `node website/server.mjs`；反馈数据落在 `website/data/feedback.db`
- 反馈管理：`GET /api/feedback?format=csv`，请求头 `Authorization: Bearer $FEEDBACK_ADMIN_TOKEN`。默认限流 5 次/小时（`FEEDBACK_RATE_LIMIT`），跨域白名单 `ALLOWED_ORIGINS`
