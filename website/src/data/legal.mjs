export const LEGAL = {
  privacy: {
    updated: '2026-11-23',
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
        h: '四、Google 与 TikTok 授权及数据处理',
        ps: [
          '当你连接 YouTube 或 TikTok 时，应用会打开官方 OAuth 授权页，让你用自己的账号登录并同意授权。我们只申请发布视频所必需的最小权限：YouTube 为 youtube.upload（上传视频到你的频道），TikTok 为 user.info.basic（读取昵称用于显示账号）与 video.upload（上传视频到收件箱）。应用不会读取你的观看记录、订阅列表、私信或其它无关数据。',
          '授权后得到的访问令牌与刷新令牌仅保存在你本机对应账号的数据目录中（明文落盘、界面掩码显示），不会上传到我们的服务器，也不会提供给任何第三方。应用只用该权限把你主动选择发布的视频上传到你本人的频道或收件箱。',
          '你可以随时在本应用「连接设置 → 海外渠道」点击「断开授权」，或在 Google 账号「第三方应用与网站」（https://myaccount.google.com/permissions ）与 TikTok 的第三方应用设置页撤销授权。撤销后应用立即失去访问能力，本机对应的令牌文件也会被清除。',
          '我们不会出售、转让你的 Google 用户数据，不会将其用于广告，也不允许人工读取（除经你明确同意为排查问题、或法律要求的必要情形外）。我们对通过 Google API 获取的信息的使用与转移，遵守 Google API 服务用户数据政策（https://developers.google.com/terms/api-services-user-data-policy ），包括其中的 Limited Use（有限使用）要求，仅将其用于提供或改进用户可见、以本应用功能为核心的上传服务。',
          '应用不会使用 Google 或 TikTok 的用户数据训练 AI 模型，也不会用于生成未经同意的深度伪造（deepfake）或不涉及同意的亲密影像（NCII）。你上传的视频内容由你自行负责，不得用于上述用途。',
          'TikTok 收件箱模式：上传完成后视频会进入你的 TikTok 收件箱，需你在 TikTok App 内手动确认发布。应用不会绕过平台审核或替你自动公开发布。',
        ],
      },
      {
        h: '五、数据共享、保留与删除',
        ps: [
          '我们不出售、出租、转让你的任何个人数据，不向广告或数据分析网络共享，也不会将其用于定向广告。',
          '除为提供你主动发起的发布功能、经你授权直接与 YouTube / TikTok 官方接口通信外，我们不会把你的数据提供给第三方。本应用不经过任何中转服务器转发你的内容或授权令牌。',
          '桌面应用数据（选题、排期、素材、发布记录、登录态与授权令牌）由你自行保留，直至你清理数据目录或卸载应用；反馈记录由我们保留至你请求删除为止。',
          '删除方式：桌面数据——清理应用数据目录；反馈记录——通过反馈表单申请删除；授权数据——在应用内「断开授权」或在 Google / TikTok 的账户设置中撤销授权，本机令牌随即清除。',
        ],
      },
      {
        h: '六、我们不做什么',
        ps: [
          '不读取、不上传你的素材与发布内容。',
          '不收集平台账号密码，不代理你的登录。',
          '不出售、不出租、不向广告网络共享任何个人数据。',
        ],
      },
      {
        h: '七、你的权利与联系方式',
        ps: [
          '你可以通过反馈表单要求查询或删除你提交过的反馈记录。删除桌面数据只需自行清理数据目录，无需经过我们。',
          '如果对本政策有疑问，请通过反馈表单（https://www.wemediacreator.com/feedback/ ）联系我们，我们会在合理时间内答复。',
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
        h: '4. Google and TikTok authorization and data',
        ps: [
          'When you connect YouTube or TikTok, the app opens the official OAuth screen so you can sign in with your own account and grant access. We request only the minimum scope needed to publish video: youtube.upload for YouTube (upload video to your channel), and user.info.basic (read your nickname to label the account) plus video.upload for TikTok (upload video to your inbox). The app does not read your watch history, subscriptions, messages, or other unrelated data.',
          'Access and refresh tokens obtained after authorization are stored only in your local per-account data directory on your machine (plaintext on disk, masked in the UI). They are never uploaded to our servers or shared with any third party. The app uses the scope only to upload videos you explicitly choose to your own channel or inbox.',
          'You can revoke access at any time via "Disconnect" under Connections → Overseas channels in the app, or from your Google Account third-party apps page (https://myaccount.google.com/permissions ) and TikTok’s third-party app settings. Revoking immediately removes the app’s access, and the local token file for that account is cleared.',
          'We do not sell or transfer your Google user data, do not use it for advertising, and do not allow humans to read it (except with your explicit consent to troubleshoot an issue, or where required by law). Our use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy ), including the Limited Use requirements, and is used only to provide or improve user-facing features that are central to the app’s upload functionality.',
          'The app does not use Google or TikTok user data to train AI models, and does not use it to create non-consensual deepfakes or non-consensual intimate imagery (NCII). You are responsible for the videos you upload and may not use them for those purposes.',
          'TikTok inbox mode: after upload, the video goes to your TikTok inbox and you confirm publishing manually in the TikTok app. The app does not bypass platform review or publish publicly on your behalf.',
        ],
      },
      {
        h: '5. Data sharing, retention, and deletion',
        ps: [
          'We do not sell, rent, or transfer any of your personal data, do not share it with advertising or analytics networks, and do not use it for targeted advertising.',
          'Apart from providing the publishing features you initiate — communicating directly with the official YouTube / TikTok APIs after you grant authorization — we do not provide your data to third parties. The app does not relay your content or tokens through any intermediary server.',
          'Desktop app data (ideas, schedules, assets, publish logs, sign-in state, and authorization tokens) is retained by you until you clear the data directory or uninstall the app. Feedback records are retained until you ask us to delete them.',
          'Deletion: desktop data — clear the app data directory; feedback records — request deletion through the feedback form; authorization data — use "Disconnect" in the app or revoke access in your Google / TikTok account settings, after which the local token is cleared.',
        ],
      },
      {
        h: '6. What we do not do',
        ps: [
          'We do not read or upload your assets or published content.',
          'We do not collect platform passwords or proxy your sign-in.',
          'We do not sell, rent, or share personal data with ad networks.',
        ],
      },
      {
        h: '7. Your rights and contact',
        ps: [
          'You can ask us to look up or delete feedback you submitted through the form. Desktop data can be deleted by clearing the data directory yourself — no request needed.',
          'For questions about this policy, contact us through the feedback form (https://www.wemediacreator.com/en/feedback/ ). We will respond within a reasonable time.',
        ],
      },
    ],
  },
  terms: {
    updated: '2026-11-23',
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
          '通过 YouTube / TikTok 发布时，你还需遵守 Google 与 YouTube 服务条款、Google API 服务条款，以及 TikTok 的开发者条款与社区准则。你不得使用本应用或相关渠道上传涉及他人的、未经同意的私密影像（NCII）、深度伪造、侵权、骚扰或其它违法内容；本应用不生成内容，也不提供用于生成此类影像的功能。',
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
          'When publishing to YouTube or TikTok you also agree to the Google and YouTube Terms of Service, the Google APIs Terms of Service, and TikTok’s developer terms and community guidelines. You may not use the app or these channels to upload non-consensual intimate imagery (NCII), deepfakes, infringing, harassing, or otherwise unlawful content regarding others; the app does not generate content and provides no feature to create such imagery.',
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
