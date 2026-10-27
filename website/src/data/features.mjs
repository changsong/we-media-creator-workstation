export const FEATURE_BLOCKS = [
  {
    id: 'ideas',
    icon: 'psychology',
    titleZh: '选题池：灵感有处安放',
    titleEn: 'Idea pool: a home for every idea',
    bodyZh:
      '记录平台、角度、标签和爆款潜力评分，搜索、筛选、导出，下一条内容不再靠翻备忘录。选题池和日历、素材库互相关联，一个想法可以从灵感阶段一直走到复盘。',
    bodyEn:
      'Capture platform, angle, tags, and potential score. Search, filter, and export so the next idea is not buried in a notes app. Ideas stay linked to the calendar and asset library from first thought to review.',
    bulletsZh: ['按平台和标签筛选，快速找到能复用的旧选题', '潜力评分帮你决定先做哪一条', '一键导出 CSV，选题会也能离线讨论'],
    bulletsEn: ['Filter by platform and tag to reuse older ideas', 'A potential score helps you choose what to make next', 'Export CSV for offline planning sessions'],
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
      '八个平台一次排期，视频、图文、多比例封面；失败可重试，发布后自动核验。任务按时间顺序执行，本机浏览器窗口固定尺寸，减少误点与漏发。',
    bodyEn:
      'Schedule all eight platforms at once — video, image posts, multi-ratio covers. Retry failures and verify results automatically. Tasks run in time order with a fixed browser window to reduce mis-clicks and missed posts.',
    bulletsZh: ['八个平台统一队列，按平台筛选与分页', '发布后核验作品状态，失败保留可重试', '固定窗口尺寸与命中校验，减少误操作'],
    bulletsEn: ['One queue for eight platforms with filters and paging', 'Verify each post and retry failures safely', 'Fixed window size and hit-checking reduce mis-clicks'],
  },
  {
    id: 'analytics',
    icon: 'insights',
    titleZh: '数据复盘：不用再手抄',
    titleEn: 'Analytics review: stop copying numbers',
    bodyZh:
      '抖音、小红书、视频号、公众号数据自动回流，互动率、涨粉率、更新频率实时算好。四张业务表都支持 CSV 导出，Excel 直接打开，复盘结论能落地。',
    bodyEn:
      'Data from Douyin, Xiaohongshu, WeChat Channels, and Official Accounts flows back automatically, with engagement, follower growth, and posting frequency calculated. All four business tables export to CSV that Excel opens correctly.',
    bulletsZh: ['四个平台自动回流，其余平台可手动补充', '互动率、涨粉率、更新频率自动计算', 'CSV 带 BOM，中文在 Excel 中不乱码'],
    bulletsEn: ['Four platforms sync automatically; others can be filled in manually', 'Engagement, growth, and cadence calculated for you', 'CSV exports open cleanly in Excel'],
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
    id: 'connect',
    icon: 'vpn_key',
    titleZh: '一键登录：不用申请 API',
    titleEn: 'One-click sign-in: no API keys',
    bodyZh:
      '独立浏览器窗口扫码登录，Cookie 只留在本机；过期了重新登录即可，无需开发者认证。账号密码不会上传，也没有共享账号或中转服务器。',
    bodyEn:
      'Sign in with a QR code in an isolated browser window. Cookies stay on your machine; sign in again when they expire. No developer account, no uploaded passwords, no shared accounts or relay server.',
    bulletsZh: ['每个平台使用独立登录态', 'Cookie 保存在本机数据目录', '登录过期会提示重新扫码，不会静默失败'],
    bulletsEn: ['Each platform has its own isolated session', 'Cookies live in the local data directory', 'Expired sessions prompt a new scan instead of failing silently'],
  },
];
