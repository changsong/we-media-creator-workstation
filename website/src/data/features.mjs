export const FEATURE_BLOCKS = [
  {
    id: 'radar',
    icon: 'travel_explore',
    titleZh: '爆款灵感雷达：先看热度，再动笔',
    titleEn: 'Viral radar: check the heat before you write',
    bodyZh:
      '输入关键词，一次搜索小红书、抖音、B站的同题内容，按互动热度跨平台统一排序。看到合适的作品点「转选题」，标题、切入角度和参考链接会直接带进选题弹窗。结果保存在本地，刷新页面仍能看到上一次搜索，历史保留 30 天。',
    bodyEn:
      'Enter a keyword and search Xiaohongshu, Douyin, and Bilibili at once, with results ranked by engagement across platforms. Turn any result into a topic with one click, prefilled with the title, angle, and reference link. Searches are saved locally, so a refresh keeps your last results, with 30 days of history.',
    bulletsZh: ['一次搜索覆盖小红书、抖音、B站', '跨平台按热度统一排序，高互动的排在前面', '一键转选题，自动带入标题、角度与参考链接', '结果本地保存，刷新后仍保留上次搜索'],
    bulletsEn: ['Search Xiaohongshu, Douyin, and Bilibili in one job', 'One heat ranking across platforms, hottest first', 'One-click topic conversion with title, angle, and link prefilled', 'Results stay local, so a refresh keeps your last search'],
  },
  {
    id: 'ideas',
    icon: 'psychology',
    titleZh: '选题池：灵感有处安放',
    titleEn: 'Idea pool: a home for every idea',
    bodyZh:
      '记录切入角度、标签和爆款潜力评分，搜索、筛选、导出，下一条内容不再靠翻备忘录。选题池和日历、素材库互相关联，一个想法可以从灵感阶段一直走到复盘。',
    bodyEn:
      'Capture the angle, tags, and potential score. Search, filter, and export so the next idea is not buried in a notes app. Ideas stay linked to the calendar and asset library from first thought to review.',
    bulletsZh: ['按标签和状态筛选，快速找到能复用的旧选题', '潜力评分帮你决定先做哪一条', '一键导出 CSV，选题会也能离线讨论'],
    bulletsEn: ['Filter by tag and status to reuse older ideas', 'A potential score helps you choose what to make next', 'Export CSV for offline planning sessions'],
  },
  {
    id: 'calendar',
    icon: 'date_range',
    titleZh: '内容日历：整月节奏一眼看清',
    titleEn: 'Content calendar: see the whole month',
    bodyZh:
      '九个制作阶段、负责人、内容形式和发布时间，一张时间轴排完整个月的生产节奏。文案、粗剪、精剪、成片、审核各自有状态，团队沟通不必再靠追问「到哪一步了」。',
    bodyEn:
      'Nine production stages, owners, formats, and publish times on one timeline. Copy, rough cut, fine cut, final, and review each have a status, so nobody has to ask which stage a piece is in.',
    bulletsZh: ['九个阶段覆盖从文案到成片的全过程', '按月查看节奏，提前发现空档和撞车', '负责人和平台多选，一眼知道谁在等谁'],
    bulletsEn: ['Nine stages from copy to final cut', 'Month view surfaces gaps and collisions early', 'Owners and platform tags show who is waiting on whom'],
  },
  {
    id: 'publish',
    icon: 'rocket_launch',
    titleZh: '发布中心：排好队，它自己发',
    titleEn: 'Publish center: queue it and walk away',
    bodyZh:
      '八个国内平台一次排期，视频、图文、多比例封面；失败可重试，发布后自动核验。公众号支持自动发表，B站投稿失败会自动重试。海外另支持 YouTube 与 TikTok：用你自己申请的开发者应用走官方 OAuth，YouTube 直传，TikTok 进入收件箱后在 App 内确认发布。任务按时间顺序执行，本机浏览器窗口固定尺寸，减少误点与漏发。',
    bodyEn:
      'Schedule all eight domestic platforms at once — video, image posts, multi-ratio covers. Retry failures and verify results automatically, with automated Official Account publishing and automatic retries for Bilibili uploads. Overseas, YouTube and TikTok connect through official OAuth using your own developer app: YouTube uploads directly, while TikTok sends the video to your inbox for you to confirm in the app. Tasks run in time order with a fixed browser window to reduce mis-clicks and missed posts.',
    bulletsZh: ['八个国内平台统一队列，按平台筛选与分页', 'YouTube / TikTok 官方 OAuth 发布，TikTok 走收件箱上传', '发布后核验作品状态，失败保留可重试'],
    bulletsEn: ['One queue for eight domestic platforms with filters and paging', 'YouTube and TikTok via official OAuth, with TikTok inbox upload', 'Verify each post and retry failures safely'],
  },
  {
    id: 'studio',
    icon: 'movie_edit',
    titleZh: '视频工坊：从选题直接做到成片',
    titleEn: 'Video workshop: take an idea all the way to a finished cut',
    bodyZh:
      '把选题带进创作简报，生成或手写脚本，拆成分镜，逐镜配画面与配音，最后在本机渲染成片。开「保真脚本」时，旁白按原句切镜，AI 只补画面；也可以上传一段参考视频，按旁白比例抽帧作为首帧。角色库按账号共享，同一个角色在多个项目里都能用。',
    bodyEn:
      'Carry a topic into the creative brief, generate or write a script, break it into scenes, add visuals and voiceover scene by scene, then render the final cut locally. Faithful mode splits narration at your own sentences so AI supplies visual prompts only. You can also upload a reference video and pull frames at points matched to the narration for use as first frames. Characters are shared at the account level, so one character works across projects.',
    bulletsZh: ['选题 → 脚本 → 分镜 → 成片，一条链路都在本机', '保真脚本按旁白原句切镜，AI 只补画面不改稿', '参考视频按旁白比例抽帧，直接用作分镜首帧', '角色库账号级共享，16:9 / 9:16 / 1:1 / 4:5 可选', '接入火山方舟、阿里百炼与 MiniMax，密钥只存本机'],
    bulletsEn: ['Topic to script to scenes to final cut, all on your machine', 'Faithful scripts keep your narration and let AI fill visuals only', 'Reference footage supplies first frames matched to the voiceover', 'Shared character library, with 16:9, 9:16, 1:1, and 4:5 output', 'Works with Volcengine Ark, Alibaba Bailian, and MiniMax; keys stay local'],
  },
  {
    id: 'analytics',
    icon: 'insights',
    titleZh: '数据复盘：不用再手抄',
    titleEn: 'Analytics review: stop copying numbers',
    bodyZh:
      '抖音、视频号、小红书、快手、微博、B站、知乎与公众号的作品数据自动回流，互动率、涨粉率、更新频率实时算好。四张业务表都支持 CSV 导出，Excel 直接打开，复盘结论能落地。',
    bodyEn:
      'Data from Douyin, WeChat Channels, Xiaohongshu, Kuaishou, Weibo, Bilibili, Zhihu, and Official Accounts flows back automatically, with engagement, follower growth, and posting frequency calculated. All four business tables export to CSV that Excel opens correctly.',
    bulletsZh: ['八个平台自动回流，发布后的数据自动归档', '互动率、涨粉率、更新频率自动计算', 'CSV 带 BOM，中文在 Excel 中不乱码'],
    bulletsEn: ['All eight platforms sync automatically after publishing', 'Engagement, growth, and cadence calculated for you', 'CSV exports open cleanly in Excel'],
  },
  {
    id: 'library',
    icon: 'library_books',
    titleZh: '素材库：好内容可以复用',
    titleEn: 'Asset library: reuse what works',
    bodyZh:
      '成稿、配图说明、关键词、语音复盘统一归档，和选题、排期互相打通。下次做同主题内容时，不用从零开始找素材。',
    bodyEn:
      'Manuscripts, image notes, keywords, and voice memos are archived and linked to ideas and schedules. When a topic comes back, you do not start from zero.',
    bulletsZh: ['成稿与配图说明保存在同一处', '关键词把选题、素材和复盘串起来', '语音复盘直接归档，不必再整理录音'],
    bulletsEn: ['Keep final copy and image notes together', 'Keywords connect ideas, assets, and reviews', 'Voice memos archive directly without extra transcription work'],
  },
  {
    id: 'accounts',
    icon: 'manage_accounts',
    titleZh: '多账号与多渠道：一份授权，管好整台机器',
    titleEn: 'Multiple accounts and channels on one license',
    bodyZh:
      '同一台机器可以创建多个运营账号，每个账号最多连接 8 个国内渠道，另可连接 YouTube 与 TikTok。顶栏随时切换，重启后自动回到上次使用的账号。账号之间完全隔离——数据库、素材、选题、录音和渠道登录态各自独立，不会串号。一份授权覆盖本机所有账号，定时发布、公众号监控与对标账号更新按账号独立调度；删除账号时整个工作区移入备份目录，可手动恢复。',
    bodyEn:
      'Create several operating accounts on one machine, each connecting up to eight domestic channels plus YouTube and TikTok. Switch from the top bar at any time, and the app reopens the last account you used. Accounts are fully isolated — databases, assets, topics, recordings, and channel sessions stay separate, so nothing bleeds across accounts. One license covers every account on the machine, and scheduled publishing, Official Account monitoring, and competitor tracking run per account. Deleting an account moves its whole workspace into a backup folder you can restore manually.',
    bulletsZh: ['同一台机器管理多个运营账号，顶栏一键切换', '每个账号最多连接 8 个国内渠道，另可连接 YouTube 与 TikTok', '数据库、素材、选题与录音按账号隔离，不会串号', '一份授权覆盖本机所有账号，后台任务分账号独立调度'],
    bulletsEn: ['Several operating accounts on one machine with one-click switching', 'Up to eight domestic channels per account, plus YouTube and TikTok', 'Databases, assets, topics, and recordings isolated per account', 'One license for every account, with background tasks scheduled per account'],
  },
  {
    id: 'connect',
    icon: 'vpn_key',
    titleZh: '一键登录：不用申请 API',
    titleEn: 'One-click sign-in: no API keys',
    bodyZh:
      '独立浏览器窗口扫码登录，Cookie 只留在本机；过期了重新登录即可，无需开发者认证。账号密码不会上传，也没有共享账号或中转服务器。',
    bodyEn:
      'Sign in with a QR code in an isolated browser window. Cookies stay on your machine; sign in again when they expire. No developer account, no uploaded passwords, no shared accounts or relay server.',
    bulletsZh: ['每个账号、每个平台各有独立登录态', 'Cookie 保存在本机数据目录', '登录过期会提示重新扫码，不会静默失败'],
    bulletsEn: ['Every account and platform gets its own isolated session', 'Cookies live in the local data directory', 'Expired sessions prompt a new scan instead of failing silently'],
  },
];
