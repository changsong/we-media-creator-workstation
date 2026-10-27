import releases from './data/releases.json' with { type: 'json' };

export const SITE_URL = (process.env.SITE_URL || 'https://we-media.example.com').replace(/\/+$/, '');
export const SITE_BASE = (process.env.SITE_BASE || '').replace(/\/+$/, '');
export const RELEASES = releases;
export const VERSION = releases.version;
export const RELEASE_DATE = releases.releaseDate;

export const FEEDBACK_ENDPOINT = process.env.FEEDBACK_ENDPOINT || '/api/feedback';
export const CHECKOUT_URL = process.env.CHECKOUT_URL || '';
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';

export const PLANS = [
  {
    id: 'monthly',
    nameZh: '月付体验方案',
    nameEn: 'Monthly',
    price: 49.9,
    priceUsd: 10,
    unitZh: '/ 月',
    unitEn: '/ month',
    taglineZh: '先试水，按月续费，随时可暂停。',
    taglineEn: 'Try it out, pay month to month, stop anytime.',
    badgeZh: '',
    badgeEn: '',
  },
  {
    id: 'yearly',
    nameZh: '年付最具性价比',
    nameEn: 'Yearly',
    price: 500,
    priceUsd: 100,
    unitZh: '/ 年',
    unitEn: '/ year',
    taglineZh: '相当于 ¥41.7/月，比月付省 ¥98.8，折合 8.4 折优惠。',
    taglineEn: 'Works out to $8.3/month — save $20 (about 17% off).',
    badgeZh: '最受欢迎 · 省 ¥98.8',
    badgeEn: 'Most popular · Save $20',
  },
  {
    id: 'lifetime',
    nameZh: '终身买断方案',
    nameEn: 'Lifetime',
    price: 980,
    priceUsd: 200,
    unitZh: '一次买断',
    unitEn: 'one-time',
    taglineZh: '最省心，约等于 20 个月月付，长期更划算。',
    taglineEn: 'Pay once, around 20 months of the monthly plan — cheaper over time.',
    badgeZh: '一次买断',
    badgeEn: 'Pay once',
  },
];

export const PLAN_FEATURES_ZH = [
  '8 大平台定时自动发布',
  '4 大平台数据自动回流复盘',
  '全部功能，无低配版',
  '授权同时激活 3 台设备',
  '订阅期内版本更新与平台适配',
  '邮件与社群工单支持',
];

export const PLAN_FEATURES_EN = [
  'Scheduled publishing to all 8 platforms',
  'Automatic analytics for 4 platforms',
  'Every feature included — no cut-down tiers',
  'Activate up to 3 devices',
  'Updates and platform fixes while subscribed',
  'Email and community support',
];

// Order mirrors the Stitch prototype.
export const PLATFORMS = [
  {
    id: 'douyin',
    nameZh: '抖音',
    nameEn: 'Douyin',
    markZh: '抖',
    markEn: 'DY',
    dot: 'bg-black',
    formatsZh: '视频 / 图文',
    formatsEn: 'Video / image posts',
    dataBack: true,
    noteZh: '支持视频与图文发布，发布后可自动核验作品状态，并回流播放、点赞、涨粉数据。',
    noteEn: 'Publish video and image posts, verify the result automatically, and pull views, likes, and follower growth back into your workspace.',
    introZh: '把抖音视频与图文排进同一条日历，到点用你自己的登录态发布，发布结果自动核验，关键数据自动回到复盘表。',
    introEn: 'Put Douyin videos and image posts on the same calendar. It publishes with your own signed-in session, verifies the result, and brings key metrics back to your review table.',
  },
  {
    id: 'channels',
    nameZh: '微信视频号',
    nameEn: 'WeChat Channels',
    markZh: '视',
    markEn: 'WC',
    dot: 'bg-emerald-600',
    formatsZh: '长视频 / 短视频',
    formatsEn: 'Short and long video',
    dataBack: true,
    noteZh: '支持视频号视频发布与草稿流程，发布后回流播放与互动数据。',
    noteEn: 'Publish videos and use the draft flow, with views and engagement flowing back after publishing.',
    introZh: '视频号发布不用再守着手机。排好时间，客户端在后台完成发布，播放与互动数据自动回到同一张复盘表。',
    introEn: 'No more waiting around to post to Channels. Schedule it, let the desktop app publish in the background, and review views and engagement in one place.',
  },
  {
    id: 'xiaohongshu',
    nameZh: '小红书',
    nameEn: 'Xiaohongshu',
    markZh: '红',
    markEn: 'XHS',
    dot: 'bg-red-500',
    formatsZh: '图文 / 视频',
    formatsEn: 'Image posts / video',
    dataBack: true,
    noteZh: '支持图文笔记与视频笔记，封面比例可预设，发布后回流阅读、点赞与涨粉数据。',
    noteEn: 'Publish image and video notes with preset cover ratios. Reads, likes, and follower growth flow back afterward.',
    introZh: '小红书笔记的标题、封面和正文一次准备好，按日历自动发布；阅读、点赞、涨粉等数据自动归档，复盘不必再手抄。',
    introEn: 'Prepare titles, covers, and copy once, schedule them on the calendar, and let the app publish. Reads, likes, and follower growth are archived automatically.',
  },
  {
    id: 'wechat',
    nameZh: '微信公众号',
    nameEn: 'WeChat Official Accounts',
    markZh: '公',
    markEn: 'OA',
    dot: 'bg-green-700',
    formatsZh: '文章 / 草稿',
    formatsEn: 'Articles / drafts',
    dataBack: true,
    noteZh: '支持公众号文章发布与草稿箱流程，发布后回流阅读、点赞与分享数据。',
    noteEn: 'Publish articles or save to drafts, then pull reads, likes, and shares back into your review table.',
    introZh: '公众号文章可以提前排期，自动进入发布或草稿流程；阅读、点赞与分享数据回流，长期内容资产有据可查。',
    introEn: 'Schedule Official Account articles ahead of time, publish or save them as drafts, and keep reads, likes, and shares in your local records.',
  },
  {
    id: 'bilibili',
    nameZh: '哔哩哔哩',
    nameEn: 'Bilibili',
    markZh: 'B',
    markEn: 'BILI',
    dot: 'bg-sky-500',
    formatsZh: '视频投稿',
    formatsEn: 'Video uploads',
    dataBack: false,
    noteZh: '支持视频投稿流程；数据回流暂未覆盖，可在发布后手动记录关键数据。',
    noteEn: 'Supports the video submission flow. Automatic analytics is not available yet; record key numbers manually if needed.',
    introZh: 'B 站视频投稿也能进统一队列。标题、分区、封面一次排好，到点自动提交，省下重复填写的时间。',
    introEn: 'Bilibili uploads join the same queue. Set the title, category, and cover once, then let the schedule submit it for you.',
  },
  {
    id: 'kuaishou',
    nameZh: '快手',
    nameEn: 'Kuaishou',
    markZh: '快',
    markEn: 'KS',
    dot: 'bg-orange-500',
    formatsZh: '视频 / 图文',
    formatsEn: 'Video / image posts',
    dataBack: false,
    noteZh: '支持视频与图文发布；数据回流暂未覆盖，发布结果会自动核验。',
    noteEn: 'Publish video and image posts with automatic result verification. Analytics is not covered yet.',
    introZh: '快手内容排进同一张表，发布任务按顺序执行，失败可重试，结果自动核验，不用逐个后台确认。',
    introEn: 'Kuaishou posts join the same table. Tasks run in order, can be retried on failure, and are verified automatically.',
  },
  {
    id: 'weibo',
    nameZh: '微博',
    nameEn: 'Weibo',
    markZh: '微',
    markEn: 'WB',
    dot: 'bg-amber-500',
    formatsZh: '图文 / 视频',
    formatsEn: 'Image posts / video',
    dataBack: false,
    noteZh: '支持图文与视频微博发布，发布后会核验博文是否存在；数据回流暂未覆盖。',
    noteEn: 'Publish text, image, and video posts, then verify the post exists. Analytics is not covered yet.',
    introZh: '微博发布后自动核验是否成功，避免"以为发了其实没发"。适合把热点内容和其他平台一起排期。',
    introEn: 'Every Weibo post is verified after publishing, so you know it actually went live. Schedule hot takes alongside your other platforms.',
  },
  {
    id: 'zhihu',
    nameZh: '知乎',
    nameEn: 'Zhihu',
    markZh: '知',
    markEn: 'ZH',
    dot: 'bg-blue-600',
    formatsZh: '文章 / 视频',
    formatsEn: 'Articles / video',
    dataBack: false,
    noteZh: '支持知乎文章与视频发布；数据回流暂未覆盖，可在复盘表手动补充。',
    noteEn: 'Publish Zhihu articles and videos. Analytics is not covered yet; add key numbers to the review table manually.',
    introZh: '知乎长文和视频也能排期。把深度内容和其他平台一起安排好，发布后统一记录，节省重复操作。',
    introEn: 'Long-form Zhihu articles and videos can be scheduled too. Plan deep content alongside other platforms and log it all in one place.',
  },
];

export const PLATFORM_SLUGS = PLATFORMS.map((p) => p.id);

export const faqTopics = {
  zh: [
    {
      group: '产品',
      items: [
        { q: '它到底是什么？', a: '自媒体内容运营工作台是一款本地优先的桌面应用。它把选题、排期、发布、数据复盘和素材归档放在同一张工作台里，支持抖音、视频号、快手、B 站、微博、小红书、知乎、公众号 8 个平台。' },
        { q: '和浏览器插件、定时工具有什么不同？', a: '插件通常只能操作单个平台，通用定时工具又依赖平台开放 API。我们通过本机浏览器完成发布，不需要开发者资质；同时把数据回流和复盘做进了同一个应用。' },
        { q: '支持哪些平台？', a: '自动发布覆盖抖音、视频号、快手、B 站、微博、小红书、知乎、公众号 8 个平台。自动数据回流目前覆盖抖音、小红书、视频号、公众号 4 个平台。' },
      ],
    },
    {
      group: '使用',
      items: [
        { q: '需要什么系统？', a: 'Windows 10 及以上、macOS 11 及以上，或 Ubuntu 22.04 及以上的 Linux 发行版。同时需要本机安装 Chrome 或 Edge。' },
        { q: '一定要装 Chrome 吗？', a: '需要。发布与部分数据采集依赖本机 Chrome/Edge 浏览器环境。没有浏览器时，桌面应用仍可管理选题和排期，但无法执行自动发布。' },
        { q: '需要申请 API 或开发者账号吗？', a: '不需要。你在独立浏览器窗口扫码登录自己的平台账号即可，登录态只保存在本机。' },
        { q: '账号安全吗？会不会被封？', a: '客户端使用你自己的 IP 和登录态，不经过中转服务器，也不会把账号密码上传云端。自动化仍受平台风控策略影响，我们内置了执行间隔与温和重试，但不能承诺 100% 不受影响。' },
      ],
    },
    {
      group: '数据',
      items: [
        { q: '数据存在哪里？', a: '全部存在你电脑上的 SQLite 数据库文件中，默认位于系统的用户数据目录。不会上传云端，断网也能查看历史排期和复盘。' },
        { q: '能导出吗？', a: '可以。四张业务表都支持导出 CSV（带 BOM，Excel 可直接打开）。' },
        { q: '换电脑怎么办？', a: '停止应用后，把数据目录复制到新电脑对应的位置即可。升级或重装不会删除数据。' },
        { q: '会自动同步哪些平台的数据？', a: '目前自动回流抖音、小红书、视频号、公众号 4 个平台的数据；其他平台可在复盘表中手动记录。' },
      ],
    },
    {
      group: '购买',
      items: [
        { q: '三种价格有什么区别？', a: '功能完全一致，只是有效期与付款方式不同。月付 ¥49.9，年付 ¥500（省 ¥98.8），终身 ¥980 一次买断。' },
        { q: '能开发票吗？', a: '可以申请电子发票。购买后通过反馈表单提交订单信息与抬头，我们会在 1 个工作日内回复。' },
        { q: '支持退款吗？', a: '建议的退款政策为 14 天无理由退款，最终以购买页条款为准。如遇授权无法激活，请先联系我们排查。' },
        { q: '终身版包含更新吗？', a: '包含常规功能更新与平台适配。重大版本是否另收费以购买页说明为准。' },
      ],
    },
    {
      group: '限制',
      items: [
        { q: '为什么不支持多人协作？', a: '当前定位是单机单用户的本地工作台，数据不经过云端，因此暂不提供多人实时协作。小团队可以共用同一台机器或分别导出 CSV 汇总。' },
        { q: 'macOS 为什么不能自动更新？', a: '当前 macOS 构建未签名，自动更新会被系统拦截。需要手动下载新版本；功能与 Windows 版本一致。' },
        { q: '英文界面有吗？', a: '桌面应用当前为简体中文界面。英文站用于产品介绍与购买，FAQ 已明确说明这一限制。' },
      ],
    },
  ],
  en: [
    {
      group: 'Product',
      items: [
        { q: 'What is it?', a: 'WeMedia Creator Workstation is a local-first desktop app that puts topic planning, scheduling, publishing, analytics, and asset archiving in one workspace. It supports Douyin, WeChat Channels, Kuaishou, Bilibili, Weibo, Xiaohongshu, Zhihu, and WeChat Official Accounts.' },
        { q: 'How is it different from a browser extension or a scheduler?', a: 'Extensions usually handle one platform, while generic schedulers depend on official APIs. We publish through the browser on your own machine, so no developer account is needed, and analytics plus review live in the same app.' },
        { q: 'Which platforms are supported?', a: 'Publishing covers eight platforms: Douyin, WeChat Channels, Kuaishou, Bilibili, Weibo, Xiaohongshu, Zhihu, and WeChat Official Accounts. Automatic analytics currently covers four: Douyin, Xiaohongshu, WeChat Channels, and WeChat Official Accounts.' },
      ],
    },
    {
      group: 'Usage',
      items: [
        { q: 'What do I need?', a: 'Windows 10+, macOS 11+, or Ubuntu 22.04+, plus Chrome or Edge installed on the same machine.' },
        { q: 'Do I have to install Chrome?', a: 'Yes. Publishing and some data collection rely on a local Chrome/Edge environment. Without it, you can still organize topics and schedules, but automatic publishing will not run.' },
        { q: 'Do I need API keys or a developer account?', a: 'No. Sign in to your own platform accounts in an isolated browser window; the session stays on your machine.' },
        { q: 'Is my account safe? Could it get banned?', a: 'The app uses your own IP and signed-in session, with no relay server and no passwords sent to the cloud. Automation is still subject to platform risk controls; we add pacing and gentle retries but cannot promise zero risk.' },
      ],
    },
    {
      group: 'Data',
      items: [
        { q: 'Where is my data stored?', a: 'In a local SQLite database in your user data directory. Nothing is uploaded, and your schedules and reviews remain available offline.' },
        { q: 'Can I export it?', a: 'Yes. All four business tables export to CSV, encoded so Excel opens Chinese text correctly.' },
        { q: 'What happens when I change computers?', a: 'Stop the app and copy the data directory to the matching location on the new machine. Upgrades and reinstalls do not delete your data.' },
        { q: 'Which platforms sync analytics automatically?', a: 'Douyin, Xiaohongshu, WeChat Channels, and WeChat Official Accounts sync automatically. For other platforms, record key numbers manually in the review table.' },
      ],
    },
    {
      group: 'Purchasing',
      items: [
        { q: 'What is the difference between the plans?', a: 'Features are identical; only billing and duration differ. Monthly is $10, yearly is $100 (save $20), and lifetime is $200 once.' },
        { q: 'Can I get an invoice?', a: 'Yes, electronic invoices are available. Send your order details and invoice title through the feedback form and we will reply within one business day.' },
        { q: 'Do you offer refunds?', a: 'The recommended policy is a 14-day no-questions-asked refund; the final terms are shown at checkout. If activation fails, contact us first so we can troubleshoot.' },
        { q: 'Does lifetime include updates?', a: 'It includes regular feature updates and platform compatibility fixes. Any charge for a major version is stated at checkout.' },
      ],
    },
    {
      group: 'Limitations',
      items: [
        { q: 'Why is there no team collaboration?', a: 'The product is a single-user, local-first workspace and does not route data through a cloud, so real-time multi-user collaboration is not available. Small teams can share a machine or combine CSV exports.' },
        { q: 'Why does macOS not auto-update?', a: 'The current macOS build is unsigned, so the system blocks automatic updates. Download new versions manually; features match the Windows build.' },
        { q: 'Is there an English interface?', a: 'The desktop app currently uses a Simplified Chinese interface. The English site covers the product and purchasing; this limitation is noted in the FAQ.' },
      ],
    },
  ],
};
