export const PLATFORM_DETAILS = {
  douyin: {
    zh: {
      h1: '抖音内容一键发布与数据复盘，用一张工作台完成',
      intro:
        '适合每周稳定更新的个人创作者与内容团队。把视频或图文排进日历，到点用你自己的登录态发布，发布后自动核验，并把播放、点赞与涨粉数据带回复盘表。',
      capabilities: [
        ['视频与图文发布', '支持短视频、图文作品，多比例封面可预先裁切，标题、话题与位置一次准备。'],
        ['发布结果核验', '任务完成后自动确认作品是否成功上线，失败会保留在队列中，可安全重试。'],
        ['数据自动回流', '播放、点赞、评论与涨粉数据自动写入本地复盘表，互动率自动计算。'],
        ['本地登录态', '扫码登录后 Cookie 只保存在本机浏览器目录，不经过中转服务器。'],
      ],
      manual: [
        ['重复复制标题与话题', '约 4 分钟'],
        ['裁切与上传封面', '约 3 分钟'],
        ['勾选发布选项并提交', '约 2 分钟'],
        ['后台抄录播放与互动数据', '约 4 分钟'],
      ],
      faq: [
        ['抖音发布会被判定为异常吗？', '客户端使用你本机的 IP 与登录态，按正常节奏操作，并内置执行间隔与温和重试。平台风控策略会变化，我们无法承诺零风险，但不会使用共享账号或中转节点。'],
        ['支持定时发布吗？', '可以。把作品放进发布中心并设定时间，到点后本地浏览器会被唤起执行。电脑需要开机，客户端可以最小化到托盘。'],
        ['数据多久回流一次？', '发布成功后会先核验结果，随后按客户端的同步周期抓取播放、点赞与涨粉数据，写入本地 SQLite。'],
      ],
    },
    en: {
      h1: 'Publish and review Douyin content from one workbench',
      intro:
        'For creators and small teams publishing every week. Schedule video or image posts, publish through your own signed-in session, verify the result, and bring views, likes, and follower growth back into one review table.',
      capabilities: [
        ['Video and image posts', 'Prepare short video or image posts with pre-cropped covers, titles, topics, and locations once.'],
        ['Result verification', 'Confirm whether the post went live. Failed tasks stay in the queue and can be retried safely.'],
        ['Automatic analytics', 'Views, likes, comments, and follower growth are written to your local review table, with engagement rates calculated.'],
        ['Local session', 'After a QR sign-in, cookies stay in the browser profile on your machine — never through a relay.'],
      ],
      manual: [
        ['Retype title and topics', '~4 min'],
        ['Crop and upload covers', '~3 min'],
        ['Tick options and submit', '~2 min'],
        ['Copy views and engagement', '~4 min'],
      ],
      faq: [
        ['Could publishing look suspicious to Douyin?', 'The app uses your own IP and session at a normal pace, with pacing and gentle retries. Platform risk controls change, so we cannot promise zero risk, but we never use shared accounts or relay nodes.'],
        ['Does it support scheduled publishing?', 'Yes. Queue the post and set a time; the local browser wakes up and publishes. Your computer needs to be on, and the app can stay in the tray.'],
        ['How often does analytics sync?', 'After publishing, the app verifies the result, then pulls views, likes, and follower growth on its sync cycle into local SQLite.'],
      ],
    },
  },
  channels: {
    zh: {
      h1: '视频号视频与草稿流程，排好期就不用守着手机',
      intro:
        '视频号更适合在桌面端完成发布。把短视频或长视频排进日历，客户端在后台执行并核验，播放与互动数据随后回到复盘表。',
      capabilities: [
        ['短视频与长视频', '按视频号的原生比例准备素材，封面与简介一次填好，不必在手机上反复操作。'],
        ['草稿与发布流程', '支持先保存草稿再发布，适合需要二次确认的账号。'],
        ['发布结果核验', '发布后确认作品状态，失败任务可重试，不会悄悄漏发。'],
        ['数据自动回流', '播放、点赞等互动数据自动归档到本地复盘表。'],
      ],
      manual: [
        ['手机与电脑之间传素材', '约 6 分钟'],
        ['在手机上填写标题与简介', '约 3 分钟'],
        ['等待上传与转码', '约 5 分钟'],
        ['手动记录播放数据', '约 3 分钟'],
      ],
      faq: [
        ['视频号发布需要手机吗？', '首次登录需要扫码确认，之后发布与核验在桌面端完成。登录态过期时重新扫码即可。'],
        ['草稿会留在哪里？', '草稿保存在视频号后台，客户端只负责创建与提交。是否发布仍由你在流程中确认。'],
        ['长视频支持吗？', '支持视频号允许的长视频规格，上传时间取决于文件大小与本机网络。'],
      ],
    },
    en: {
      h1: 'Publish WeChat Channels videos and drafts without babysitting your phone',
      intro:
        'Channels publishing works better on a desktop. Schedule short or long videos, let the client publish and verify in the background, and review views and engagement in your local table.',
      capabilities: [
        ['Short and long video', 'Prepare native-ratio assets, covers, and descriptions once instead of repeating the flow on a phone.'],
        ['Draft and publish flows', 'Save a draft first when an account needs a second confirmation before going live.'],
        ['Result verification', 'Confirm the post status; failed tasks can be retried instead of being silently dropped.'],
        ['Automatic analytics', 'Views, likes, and engagement are archived into the local review table.'],
      ],
      manual: [
        ['Move assets between phone and PC', '~6 min'],
        ['Fill title and description on phone', '~3 min'],
        ['Wait for upload and transcode', '~5 min'],
        ['Record views by hand', '~3 min'],
      ],
      faq: [
        ['Do I need a phone to publish?', 'The first sign-in needs a QR confirmation. Publishing and verification then run on the desktop. Scan again when the session expires.'],
        ['Where do drafts live?', 'Drafts are stored by Channels. The client creates and submits them; you still confirm publication in the flow.'],
        ['Are long videos supported?', 'Yes, within the platform limits. Upload time depends on file size and your connection.'],
      ],
    },
  },
  xiaohongshu: {
    zh: {
      h1: '小红书图文与视频笔记，一次准备、按日历发布',
      intro:
        '小红书笔记的标题、封面比例和正文一次准备好，按日历自动发布；阅读、点赞与涨粉数据自动归档，复盘不必再手抄。',
      capabilities: [
        ['图文笔记', '支持多图笔记，封面比例可预设，图片说明与话题一次填好。'],
        ['视频笔记', '竖版视频笔记同样可以排期，封面与标题在发布前准备完毕。'],
        ['数据自动回流', '阅读、点赞、收藏与涨粉数据写入本地复盘表。'],
        ['多账号隔离', '每个平台账号使用独立的浏览器登录态，互不影响。'],
      ],
      manual: [
        ['逐张上传图片并排序', '约 4 分钟'],
        ['裁切封面与填写正文', '约 5 分钟'],
        ['手动选择话题与发布时间', '约 2 分钟'],
        ['记录阅读与收藏数据', '约 3 分钟'],
      ],
      faq: [
        ['笔记图片数量有限制吗？', '以小红书当前的上传限制为准。客户端不会绕过平台限制，超过时会在发布前提示。'],
        ['支持定时发布吗？', '支持。到点后本地浏览器执行发布，电脑需保持开机，窗口可以最小化。'],
        ['数据回流包含哪些指标？', '阅读、点赞、收藏与涨粉等关键指标，互动率由本地自动计算。'],
      ],
    },
    en: {
      h1: 'Xiaohongshu image and video notes, prepared once and scheduled',
      intro:
        'Prepare titles, cover ratios, and copy once, schedule on the calendar, and let the app publish. Reads, likes, and follower growth are archived automatically.',
      capabilities: [
        ['Image notes', 'Multi-image notes with preset cover ratios, captions, and topics prepared in one pass.'],
        ['Video notes', 'Vertical video notes can be scheduled with covers and titles ready before publish time.'],
        ['Automatic analytics', 'Reads, likes, saves, and follower growth flow into the local review table.'],
        ['Isolated accounts', 'Each platform account uses its own browser session, so accounts do not interfere.'],
      ],
      manual: [
        ['Upload and reorder images', '~4 min'],
        ['Crop covers and write copy', '~5 min'],
        ['Pick topics and publish time', '~2 min'],
        ['Record reads and saves', '~3 min'],
      ],
      faq: [
        ['Is there a limit on images per note?', 'The app follows the current platform limit and warns before publishing if a note exceeds it.'],
        ['Does it support scheduled publishing?', 'Yes. The local browser publishes at the scheduled time; keep the computer on and the window can be minimized.'],
        ['Which analytics are synced?', 'Reads, likes, saves, and follower growth, with engagement rates calculated locally.'],
      ],
    },
  },
  wechat: {
    zh: {
      h1: '公众号文章与草稿，排期之后还能看到数据',
      intro:
        '公众号文章可以提前排期，自动进入发布或草稿流程；阅读、点赞与分享数据回流，长期内容资产有据可查。',
      capabilities: [
        ['文章与草稿', '支持先存草稿再发布，适合需要编辑复核的账号。'],
        ['封面与摘要', '头条封面、摘要与作者信息在发布前准备，减少重复填写。'],
        ['发布结果核验', '提交后确认文章是否上线，失败任务保留在队列。'],
        ['数据自动回流', '阅读、点赞与分享数据写入本地复盘表。'],
      ],
      manual: [
        ['在编辑器里重新排版', '约 8 分钟'],
        ['上传封面与填写摘要', '约 3 分钟'],
        ['等待审核并手动确认', '约 5 分钟'],
        ['逐篇抄录阅读与分享', '约 4 分钟'],
      ],
      faq: [
        ['支持草稿箱流程吗？', '支持。可以选择直接发布，或先保存到草稿箱，再由你确认。'],
        ['公众号登录需要什么？', '在独立浏览器窗口扫码登录公众号后台即可，登录态保存在本机。'],
        ['数据回流覆盖哪些指标？', '阅读、点赞与分享等关键指标会写入本地复盘表，历史文章同样可查。'],
      ],
    },
    en: {
      h1: 'WeChat Official Account articles and drafts, with analytics afterward',
      intro:
        'Schedule articles ahead of time, publish or save them as drafts, and keep reads, likes, and shares in your local records.',
      capabilities: [
        ['Articles and drafts', 'Publish directly or save a draft first when an editor needs to review.'],
        ['Covers and summaries', 'Prepare the lead cover, summary, and author details before publishing to avoid repeated form-filling.'],
        ['Result verification', 'Confirm whether the article went live; failed tasks stay in the queue.'],
        ['Automatic analytics', 'Reads, likes, and shares are written into the local review table.'],
      ],
      manual: [
        ['Reformat in the editor', '~8 min'],
        ['Upload cover and summary', '~3 min'],
        ['Wait for review and confirm', '~5 min'],
        ['Copy reads and shares', '~4 min'],
      ],
      faq: [
        ['Does it support drafts?', 'Yes. Publish directly or save to the draft box for later confirmation.'],
        ['What login is required?', 'Scan a QR code in an isolated browser window. The session stays on your machine.'],
        ['Which metrics are synced?', 'Reads, likes, and shares for published articles, including older posts.'],
      ],
    },
  },
  bilibili: {
    zh: {
      h1: 'B 站视频投稿进统一队列，省下重复填写',
      intro:
        'B 站视频投稿也能进统一队列。标题、分区、封面一次排好，到点自动提交，省下重复填写的时间。数据回流暂未覆盖。',
      capabilities: [
        ['视频投稿', '支持常规视频投稿流程，标题、分区、标签与封面提前准备。'],
        ['定时执行', '与其它平台共用发布队列，按时间顺序执行。'],
        ['结果核验', '提交后确认投稿是否成功，失败可重试。'],
        ['手动复盘', '数据回流暂未覆盖，可在复盘表中手动补充播放与互动数据。'],
      ],
      manual: [
        ['重复上传大体积视频', '约 6 分钟'],
        ['填写分区与标签', '约 3 分钟'],
        ['设置封面与简介', '约 3 分钟'],
        ['发布后手动记录数据', '约 3 分钟'],
      ],
      faq: [
        ['B 站数据会自动回流吗？', '目前不会。发布可以自动化，播放与互动数据需要在复盘表中手动记录。'],
        ['支持定时投稿吗？', '支持。电脑需保持开机，到点后本地浏览器执行提交流程。'],
        ['大文件上传稳定吗？', '上传依赖本机网络与浏览器。建议预留充足时间，避免在发布前一刻才开始上传。'],
      ],
    },
    en: {
      h1: 'Bilibili uploads join the same queue',
      intro:
        'Bilibili video submissions can be scheduled too. Set the title, category, cover, and tags once, then let the queue submit them at the right time. Automatic analytics is not covered yet.',
      capabilities: [
        ['Video submission', 'Prepare title, category, tags, and cover ahead of the regular submission flow.'],
        ['Scheduled execution', 'Runs in the same queue as other platforms, in time order.'],
        ['Result verification', 'Confirm whether the submission succeeded; retry on failure.'],
        ['Manual review', 'Automatic analytics is not covered; add views and engagement to the review table manually.'],
      ],
      manual: [
        ['Re-upload a large video', '~6 min'],
        ['Fill category and tags', '~3 min'],
        ['Set cover and description', '~3 min'],
        ['Record metrics after publishing', '~3 min'],
      ],
      faq: [
        ['Does Bilibili sync analytics?', 'Not yet. Publishing can be automated; views and engagement need manual entry in the review table.'],
        ['Can uploads be scheduled?', 'Yes. Keep the computer on; the local browser submits at the scheduled time.'],
        ['Are large uploads reliable?', 'Uploads depend on your connection and browser. Leave enough lead time before the scheduled publish.'],
      ],
    },
  },
  kuaishou: {
    zh: {
      h1: '快手视频与图文，排进同一张日历',
      intro:
        '快手内容排进同一张表，发布任务按顺序执行，失败可重试，结果自动核验，不用逐个后台确认。数据回流暂未覆盖。',
      capabilities: [
        ['视频与图文', '支持短视频与图文作品，封面比例可在发布前预设。'],
        ['顺序队列', '与其它平台一起排队执行，避免同时打开过多浏览器窗口。'],
        ['结果核验', '发布后核对作品状态，异常时提示重试。'],
        ['本地记录', '发布记录保存在本机，复盘数据可手动补充。'],
      ],
      manual: [
        ['分平台重传素材', '约 5 分钟'],
        ['填写标题与话题', '约 3 分钟'],
        ['选择封面与发布选项', '约 3 分钟'],
        ['逐个后台确认结果', '约 3 分钟'],
      ],
      faq: [
        ['快手数据会自动回流吗？', '目前不会。发布结果会自动核验，播放与互动数据需要手动记录。'],
        ['支持双封面吗？', '可以准备多张封面，具体以快手当前发布页面支持的比例为准。'],
        ['失败会怎样？', '任务保留在队列中并标记失败，可以重试，不会影响其它平台的排期。'],
      ],
    },
    en: {
      h1: 'Kuaishou video and image posts on the same calendar',
      intro:
        'Kuaishou posts join the same table. Tasks run in order, can be retried on failure, and are verified automatically. Automatic analytics is not covered yet.',
      capabilities: [
        ['Video and image posts', 'Short video and image posts with cover ratios prepared before publishing.'],
        ['Ordered queue', 'Runs alongside other platforms without opening too many browser windows at once.'],
        ['Result verification', 'Check the post status after publishing and retry when something goes wrong.'],
        ['Local records', 'Publishing history stays on your machine; add review metrics manually.'],
      ],
      manual: [
        ['Re-upload per platform', '~5 min'],
        ['Fill title and topics', '~3 min'],
        ['Choose covers and options', '~3 min'],
        ['Check each dashboard', '~3 min'],
      ],
      faq: [
        ['Does Kuaishou sync analytics?', 'Not yet. Publishing is verified automatically; views and engagement need manual entry.'],
        ['Are multiple covers supported?', 'You can prepare several covers; the available ratios follow the current Kuaishou publish page.'],
        ['What happens on failure?', 'The task is marked failed in the queue and can be retried without affecting other platforms.'],
      ],
    },
  },
  weibo: {
    zh: {
      h1: '微博图文与视频，发完自动核验是否真的上线',
      intro:
        '微博发布后自动核验是否成功，避免「以为发了其实没发」。适合把热点内容和其他平台一起排期。数据回流暂未覆盖。',
      capabilities: [
        ['图文与视频', '支持文字、图片与视频微博，多条内容可一起排期。'],
        ['发布后核验', '发布完成后检查博文是否存在，自动改判发布状态。'],
        ['热点排期', '把时效性内容放进日历，到点自动执行。'],
        ['失败重试', '核验失败时保留任务，可重新发布或手动处理。'],
      ],
      manual: [
        ['复制文案与图片', '约 3 分钟'],
        ['逐条发布并确认', '约 4 分钟'],
        ['核对是否发出', '约 2 分钟'],
        ['手动记录互动数据', '约 2 分钟'],
      ],
      faq: [
        ['怎么确认微博真的发出去了？', '客户端在发布后检查博文是否存在，并据此更新任务状态。核验失败会保留任务供你处理。'],
        ['支持图片数量限制吗？', '以微博当前上传限制为准，超过限制时会在发布前提示。'],
        ['数据会自动回流吗？', '目前不会。发布结果可自动核验，阅读与互动数据需要手动记录。'],
      ],
    },
    en: {
      h1: 'Weibo posts verified after publishing',
      intro:
        'Every Weibo post is verified after publishing, so you know it actually went live. Schedule timely posts alongside your other platforms. Automatic analytics is not covered yet.',
      capabilities: [
        ['Text, images, and video', 'Schedule Weibo posts with text, images, or video, including multiple posts at once.'],
        ['Post verification', 'After publishing, the app checks that the post exists and updates its status.'],
        ['Timely scheduling', 'Put time-sensitive posts on the calendar and let them run on schedule.'],
        ['Retry on failure', 'Keep failed tasks in the queue and retry or handle them manually.'],
      ],
      manual: [
        ['Copy copy and images', '~3 min'],
        ['Publish one by one', '~4 min'],
        ['Check that each went live', '~2 min'],
        ['Record engagement manually', '~2 min'],
      ],
      faq: [
        ['How do I know a Weibo post went live?', 'After publishing, the app checks that the post exists and updates the task status. Failures stay in the queue.'],
        ['Is there an image limit?', 'The app follows the current Weibo upload limit and warns before publishing when exceeded.'],
        ['Is analytics synced?', 'Not yet. Publishing is verified automatically; reads and engagement need manual entry.'],
      ],
    },
  },
  zhihu: {
    zh: {
      h1: '知乎长文与视频排期，深度内容也能按时上线',
      intro:
        '知乎长文和视频也能排期。把深度内容和其他平台一起安排好，发布后统一记录，节省重复操作。数据回流暂未覆盖。',
      capabilities: [
        ['文章与视频', '支持知乎文章与视频内容的发布流程。'],
        ['统一排期', '与其它平台共享同一张发布日历。'],
        ['结果核验', '提交后确认内容状态，失败可重试。'],
        ['手动复盘', '阅读、赞同与收藏等数据可在复盘表中手动补充。'],
      ],
      manual: [
        ['重新排版长文', '约 6 分钟'],
        ['上传视频与封面', '约 5 分钟'],
        ['选择话题与发布设置', '约 3 分钟'],
        ['记录阅读与赞同', '约 3 分钟'],
      ],
      faq: [
        ['知乎视频发布稳定吗？', '客户端已针对大体积视频做规避处理，但仍建议预留上传时间，并保证本机网络稳定。'],
        ['数据会自动回流吗？', '目前不会。发布可以自动化，阅读与赞同数据需要手动记录。'],
        ['支持定时发布吗？', '支持。电脑保持开机即可，窗口可以最小化到托盘。'],
      ],
    },
    en: {
      h1: 'Zhihu articles and videos, scheduled with everything else',
      intro:
        'Long-form Zhihu articles and videos can be scheduled too. Plan deep content alongside other platforms and log it in one place. Automatic analytics is not covered yet.',
      capabilities: [
        ['Articles and video', 'Supports Zhihu article and video publishing flows.'],
        ['Shared schedule', 'Uses the same publishing calendar as every other platform.'],
        ['Result verification', 'Confirm the content status after submission and retry on failure.'],
        ['Manual review', 'Add reads, upvotes, and saves to the review table yourself.'],
      ],
      manual: [
        ['Reformat long-form copy', '~6 min'],
        ['Upload video and cover', '~5 min'],
        ['Pick topics and publish settings', '~3 min'],
        ['Record reads and upvotes', '~3 min'],
      ],
      faq: [
        ['Are large Zhihu videos reliable?', 'The client mitigates large-upload disconnects, but leave lead time and keep your connection stable.'],
        ['Is analytics synced?', 'Not yet. Publishing can be automated; reads and upvotes need manual entry.'],
        ['Can it publish on a schedule?', 'Yes. Keep the computer on; the window can be minimized to the tray.'],
      ],
    },
  },
};
