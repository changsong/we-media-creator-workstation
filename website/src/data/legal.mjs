export const LEGAL = {
  privacy: {
    updated: '2026-10-26',
    titleZh: '隐私政策',
    titleEn: 'Privacy Policy',
    introZh:
      '这份政策说明媒管家（下称「本应用」）如何处理你的数据。核心原则只有一条：内容和账号数据保存在你自己的电脑上，我们不上传、不托管、不出售。',
    introEn:
      'This policy explains how WeMedia Creator (“the app”) handles your data. The core rule is simple: your content and account data stay on your computer. We do not upload, host, or sell it.',
    sectionsZh: [
      {
        h: '一、桌面应用里的数据',
        ps: [
          '本应用是本地优先的桌面软件。选题、排期、素材、发布记录、数据复盘和登录 Cookie 都保存在你电脑的用户数据目录中，数据库为 SQLite，不会同步到我们的服务器。',
          '登录平台账号时，扫码在独立浏览器窗口内完成。账号密码不会经过本应用，登录态仅作为本地 Cookie 保存在对应平台的独立配置目录中。',
          '删除应用或清除数据目录会移除这些数据。建议在重装或换机前，先备份整个数据目录。',
        ],
      },
      {
        h: '二、网站与反馈表单',
        ps: [
          '本站是静态网站，不使用登录账号，也不设置广告追踪像素。',
          '当你提交反馈或购买咨询时，我们会收集你填写的内容、可选的联系方式、使用系统与版本号，以及提交页面的地址。服务器还会记录提交时间、IP 地址与浏览器标识，仅用于防滥用和排查问题。',
          '反馈数据保存在我们自建服务器的 SQLite 数据库中，不会提供给第三方。购买咨询通常会在 1 个工作日内回复。',
        ],
      },
      {
        h: '三、下载与更新',
        ps: [
          '安装包与自动更新清单从对象存储（阿里云 OSS）分发。下载过程中，对象存储会按行业惯例记录访问 IP 与文件请求，用于计费与安全防护。',
          'Windows 与 Linux 版会定期检查更新；macOS 当前构建不启用自动更新。检查更新时只会请求版本清单，不上传你的内容或使用数据。',
        ],
      },
      {
        h: '四、我们不做什么',
        ps: [
          '不读取、不上传你的素材与发布内容。',
          '不收集平台账号密码，不代理你的登录。',
          '不出售、不出租、不向广告网络共享任何个人数据。',
        ],
      },
      {
        h: '五、你的权利',
        ps: [
          '你可以通过反馈表单要求查询或删除你提交过的反馈记录。删除桌面数据只需自行清理数据目录，无需经过我们。',
          '如果对本政策有疑问，请通过反馈表单联系我们。我们会在合理时间内答复。',
        ],
      },
    ],
    sectionsEn: [
      {
        h: '1. Data in the desktop app',
        ps: [
          'The app is local-first. Ideas, schedules, assets, publish logs, analytics, and sign-in cookies are stored in your user data directory in a local SQLite database. They are not synced to our servers.',
          'Platform sign-in happens in an isolated browser window. Passwords never pass through the app, and session cookies stay in each platform’s local profile directory.',
          'Removing the app or the data directory deletes this data. Back up the whole data directory before reinstalling or switching computers.',
        ],
      },
      {
        h: '2. This website and the feedback form',
        ps: [
          'This site is static. It has no user accounts and sets no advertising tracking pixels.',
          'When you submit feedback or a licensing question, we collect what you write, your optional contact details, your operating system and app version, and the page you submitted from. The server also records the time, IP address, and browser identifier to prevent abuse and debug issues.',
          'Feedback is stored in a SQLite database on our own server and is not shared with third parties. Licensing questions are usually answered within one business day.',
        ],
      },
      {
        h: '3. Downloads and updates',
        ps: [
          'Installers and update manifests are distributed through object storage (Aliyun OSS), which records IP addresses and file requests for billing and security, as is standard for CDNs.',
          'Windows and Linux builds check for updates periodically; the current macOS build does not auto-update. Update checks request only the version manifest and never upload your content or usage data.',
        ],
      },
      {
        h: '4. What we do not do',
        ps: [
          'We do not read or upload your assets or published content.',
          'We do not collect platform passwords or proxy your sign-in.',
          'We do not sell, rent, or share personal data with ad networks.',
        ],
      },
      {
        h: '5. Your rights',
        ps: [
          'You can ask us to look up or delete feedback you submitted through the form. Desktop data can be deleted by clearing the data directory yourself — no request needed.',
          'For questions about this policy, contact us through the feedback form. We will respond within a reasonable time.',
        ],
      },
    ],
  },
  terms: {
    updated: '2026-11-03',
    titleZh: '服务条款',
    titleEn: 'Terms of Service',
    introZh:
      '下载、安装或购买本应用即表示你同意以下条款。条款尽量写得直白，重点放在授权范围、平台风险与退款规则。',
    introEn:
      'By downloading, installing, or purchasing the app you agree to these terms. They are written plainly and focus on licensing scope, platform risk, and refunds.',
    sectionsZh: [
      {
        h: '一、授权范围',
        ps: [
          '一份授权最多同时激活 3 台设备，仅限你本人或你所在小团队使用。不得转售、出租、共享账号或以任何方式规避授权校验。',
          '月付与年付授权在订阅期内有效；终身授权为一次性买断，包含常规功能更新与平台适配。',
        ],
      },
      {
        h: '二、第三方平台与自动化风险',
        ps: [
          '本应用通过你本机的浏览器环境与平台交互，使用你自己的登录态。各平台的用户协议、访问限制与页面结构可能随时变化。',
          '自动化操作仍可能触发平台访问限制或发布失败。我们会提供重试与核验机制，并持续适配改版，但无法承诺自动化 100% 成功，也不对平台侧的账号处置承担责任。请遵守各平台规则，不要用于违规内容或大规模批量操作。',
        ],
      },
      {
        h: '三、文案提取与知识产权',
        ps: [
          '文案提取功能只读取你已合法访问的视频页面中平台公开提供的字幕；你也可以上传自己有权处理的音视频文件，由本机内置的 ffmpeg 与 whisper.cpp 完成转写。上传文件、提取结果与语音模型均保存在本机，不会上传至我们的服务器，仅用于个人学习、研究与选题参考。',
          '首次使用本地转写时，应用会从公开镜像下载开源的 whisper.cpp 语音模型；下载失败或速度受网络环境限制，你可稍后重试。',
          '视频画面、声音与文案的著作权归原作者或权利人所有。你不得将提取结果直接复制发布、冒充原创或用于侵犯他人权益的用途；引用时应遵守平台规则与合理使用边界，并自行承担相应责任。',
          '平台字幕与本地语音识别结果未必完整或准确，提取失败、内容缺失或识别偏差不构成对本应用的退款或赔偿理由。',
        ],
      },
      {
        h: '四、网络代理与访问出口',
        ps: [
          '本应用允许你为本机浏览器配置自己提供的网络代理，仅作为访问第三方平台的网络出口。我们不内置、不代售、不托管任何代理、IP 或线路资源，代理配置只保存在你的电脑上。',
          '你应确保代理来源与用途合法，并遵守所在地法律法规与第三方平台规则。不得将本功能用于规避国家网络管理、跨境违规访问、批量注册、刷量、虚假流量或其他违法用途。',
          '因你自行配置的代理、代理服务商或网络环境导致的合规问题、访问失败或账号处置，由你自行承担；我们不对代理服务商的行为或可用性负责。',
        ],
      },
      {
        h: '五、付款、退款与发票',
        ps: [
          '价格为人民币（CNY）含税价。三种方案功能一致，仅有效期与付款方式不同。',
          '建议的退款政策为购买后 14 天内无理由退款，最终以购买页展示的条款为准。授权无法激活时，请先联系我们排查。',
          '电子发票可通过反馈表单申请，请提供订单信息与抬头。',
        ],
      },
      {
        h: '六、软件许可与责任限制',
        ps: [
          '本应用按「现状」提供。在适用法律允许的范围内，我们不对因使用或无法使用本应用导致的间接损失、数据丢失或平台处罚承担责任。',
          '请定期备份数据目录，并为重要内容保留平台侧的手动备份。',
        ],
      },
      {
        h: '七、条款变更',
        ps: [
          '我们可能随产品变化更新本条款，更新后会修改页面顶部的日期。继续使用即视为接受更新后的条款。',
        ],
      },
    ],
    sectionsEn: [
      {
        h: '1. License scope',
        ps: [
          'One license activates up to three devices at a time and is for you or your small team. You may not resell, rent, share accounts, or bypass license checks.',
          'Monthly and yearly licenses are valid while subscribed. Lifetime is a one-time purchase that includes regular feature updates and platform compatibility fixes.',
        ],
      },
      {
        h: '2. Third-party platforms and automation risk',
        ps: [
          'The app interacts with platforms through your local browser session. Platform terms, access restrictions, and page structures can change at any time.',
          'Automation may still trigger platform access restrictions or fail. We provide retries and verification and keep adapting to changes, but cannot promise 100% success and are not responsible for platform-side account actions. Follow platform rules and do not use the app for prohibited content or mass bulk operations.',
        ],
      },
      {
        h: '3. Transcripts and intellectual property',
        ps: [
          'The transcript feature only reads captions that the platform publicly provides on video pages you may lawfully access. You may also upload audio or video files you have the right to process; transcription runs locally with the bundled ffmpeg and whisper.cpp. Uploaded files, results, and speech models stay on your machine and are not sent to our servers; they are intended for personal study, research, and topic reference.',
          'On first local transcription, the app downloads an open-source whisper.cpp speech model from a public mirror. Downloads may fail or be slow depending on your network; you can retry later.',
          'Copyright in the video, audio, and script belongs to the original creator or rights holder. You may not republish extracted text as your own or use it to infringe others’ rights; when quoting, follow platform rules and the bounds of fair use, and you are responsible for your use.',
          'Platform captions and local speech recognition may be incomplete or inaccurate. Extraction failures, missing content, or recognition errors do not entitle you to a refund or compensation.',
        ],
      },
      {
        h: '4. Network proxies and egress',
        ps: [
          'The app lets you configure a proxy of your own for the local browser as the network egress used to access third-party platforms. We do not bundle, resell, or host any proxy, IP, or line resources; proxy settings stay on your computer.',
          'You must ensure your proxy is lawfully obtained and used, and comply with applicable laws and platform rules. Do not use this feature to circumvent national network regulations, for unauthorized cross-border access, bulk registration, artificial traffic, or any other unlawful purpose.',
          'You are responsible for compliance issues, access failures, or account actions caused by proxies, proxy providers, or network environments you configure. We are not responsible for the acts or availability of proxy providers.',
        ],
      },
      {
        h: '5. Payment, refunds, and invoices',
        ps: [
          'Prices are in USD and include applicable tax. All three plans have the same features; only duration and billing differ.',
          'The recommended refund policy is a 14-day no-questions-asked refund after purchase; the final terms are shown at checkout. If activation fails, contact us first.',
          'Electronic invoices are available through the feedback form with your order details and invoice title.',
        ],
      },
      {
        h: '6. Software license and limitation of liability',
        ps: [
          'The app is provided “as is.” To the extent permitted by law, we are not liable for indirect losses, data loss, or platform penalties arising from use or inability to use the app.',
          'Back up your data directory regularly and keep manual copies of important content on the platform side.',
        ],
      },
      {
        h: '7. Changes to these terms',
        ps: [
          'We may update these terms as the product changes and will change the date at the top of the page. Continued use means you accept the updated terms.',
        ],
      },
    ],
  },
};
