export const BLOG_POSTS = [
  {
    slug: 'one-video-eight-platforms',
    date: '2026-10-20',
    tagZh: '发布流程',
    tagEn: 'Publishing',
    readZh: 8,
    readEn: 6,
    titleZh: '一条视频发八个平台，怎样不崩溃',
    titleEn: 'Publishing one video to eight platforms without losing your mind',
    descZh: '把一条主素材拆成八次发布，真正耗时的不是上传，而是重复填写、改封面和确认结果。这是一套可复用的流程。',
    descEn: 'The cost of publishing one asset to eight platforms is not the upload. It is retyping, resizing, and checking whether it actually went live. Here is a repeatable process.',
    introZh:
      '一条视频发八个平台，听起来只是「多上传几次」。真正做过的人都知道，崩溃点在于每一步都要重新填、重新选、重新确认。把这套动作拆开，会发现大部分都可以提前准备。',
    introEn:
      'Publishing one video to eight platforms sounds like uploading it a few more times. Anyone who has done it knows the real cost: retyping, re-selecting, and re-checking at every stop. Break the work down and most of it can be prepared in advance.',
    sections: [
      {
        h2Zh: '先把「主素材」和「平台版本」分开',
        h2En: 'Separate the master asset from platform versions',
        psZh: [
          '主素材是内容本身：成片、标题、核心文案、关键词。平台版本则是每个平台需要的东西：封面比例、话题、简介长度、是否允许外链。前者只准备一次，后者才是差异所在。',
          '把封面按 9:16、3:4、16:9 三种常见比例各裁一版，放进同一个文件夹命名清楚。发布时不用再临时切图，这一步能省下最多时间。',
        ],
        psEn: [
          'The master asset is the content itself: final video, title, core copy, keywords. Platform versions are the differences: cover ratio, topics, description length, and link rules. Prepare the first once; the second is where variation lives.',
          'Crop covers at the common ratios — 9:16, 3:4, 16:9 — and name them clearly in one folder. This single step saves more time than any other.',
        ],
      },
      {
        h2Zh: '用一张表管理八个平台的「待发布」状态',
        h2En: 'Track “ready to publish” in one table',
        psZh: [
          '不要在浏览器标签里管理任务。标签会关掉，人也会忘。把所有待发布内容放进一个列表，标清平台、时间、封面比例和状态，打开就能知道还差什么。',
          '{{link:/features/#publish|发布中心}}就是按这个思路做的：八个平台共用一张日历，任务按时间排队，失败会留在队列里而不是悄悄消失。',
        ],
        psEn: [
          'Do not manage tasks in browser tabs. Tabs get closed and people forget. Keep every pending post in one list with platform, time, cover ratio, and status, so opening it shows exactly what is missing.',
          'The {{link:/features/#publish|publish center}} works this way: one calendar for eight platforms, tasks queued by time, and failures kept in the queue instead of disappearing.',
        ],
      },
      {
        h2Zh: '发布之后，一定要确认',
        h2En: 'After publishing, verify',
        psZh: [
          '“提交成功”不等于“已经发出去”。平台可能还在审核，也可能因为封面不合规被拦下。发布后的核验比发布本身更重要。',
          '把确认动作写进流程：发布后检查作品是否存在、状态是否正确，失败的任务当天处理。微博、抖音这些已支持自动核验的平台，可以让客户端替你检查；其余平台至少留一个手动确认的节点。',
        ],
        psEn: [
          '“Submitted” is not “live.” A platform may still be reviewing, or may reject an image. Verification after publishing matters more than the act itself.',
          'Make checking part of the workflow: after publishing, confirm the post exists and has the right status, and handle failures the same day. Platforms with automatic verification can be checked by the app; keep at least one manual checkpoint for the rest.',
        ],
      },
      {
        h2Zh: '把重复动作交给工具，把判断留给自己',
        h2En: 'Automate repetition, keep judgment',
        psZh: [
          '机器擅长按时执行、按顺序排队、失败重试；人擅长决定发什么、什么时候发、要不要改。把这两类工作分开，效率才会稳定。',
          '{{link:/pricing/|订阅或买断}}之前，先用自己的真实流程试一遍：准备一条内容，按上面的方式排八个平台，看看能省下多少时间。数字比功能清单更有说服力。',
        ],
        psEn: [
          'Machines are good at running on time, queuing in order, and retrying failures. People are good at deciding what to publish, when, and when to change course. Keeping those separate is what makes the rhythm stable.',
          'Before {{link:/pricing/|buying}}, try the process with a real post: prepare one asset, schedule eight platforms the way described here, and measure the time saved. Numbers persuade better than feature lists.',
        ],
      },
    ],
    takeawaysZh: ['主素材准备一次，平台版本按比例提前裁好', '用一张表管理待发布状态，不要在标签页里找任务', '发布后必须核验，失败当天处理', '把重复动作交给排期，把判断留给自己'],
    takeawaysEn: ['Prepare the master once and covers per ratio in advance', 'Track pending posts in one table, not browser tabs', 'Verify after publishing and handle failures the same day', 'Automate repetition and keep the judgment for yourself'],
  },
  {
    slug: 'content-calendar-that-works',
    date: '2026-10-12',
    tagZh: '内容日历',
    tagEn: 'Content calendar',
    readZh: 7,
    readEn: 5,
    titleZh: '自媒体内容日历怎么排才有用',
    titleEn: 'How to build a content calendar that actually helps',
    descZh: '日历不是把发布日期填进格子。真正有用的日历会把制作阶段、负责人和空档一起排进去。',
    descEn: 'A calendar is not a grid of publish dates. A useful one also shows production stages, owners, and gaps.',
    introZh:
      '很多人的内容日历最后都会变成一张「发布日期表」：填满、过期、放弃。问题不在自律，而在于日历只记录了结果，没有记录过程。',
    introEn:
      'Most content calendars end up as a list of publish dates: filled in, missed, abandoned. The problem is not discipline. The calendar records outcomes but not the process.',
    sections: [
      {
        h2Zh: '发布日期只是最后一格',
        h2En: 'The publish date is only the last box',
        psZh: [
          '一条视频从想法到上线，至少经过文案、粗剪、精剪、成片、审核几个阶段。如果日历里只有发布日，你永远是在截止前一天才发现缺素材。',
          '把每个阶段都放进时间轴，哪怕只是简单标注，也能提前看到哪一天会撞车。{{link:/features/#calendar|内容日历}}的九个阶段就是为此设计的。',
        ],
        psEn: [
          'A video passes through copy, rough cut, fine cut, final, and review before it goes live. If the calendar only shows the publish date, you discover missing assets the day before.',
          'Put every stage on the timeline, even as a simple note, and collisions become visible early. The nine stages in the {{link:/features/#calendar|content calendar}} exist for this reason.',
        ],
      },
      {
        h2Zh: '按「产能」排，不按「愿望」排',
        h2En: 'Plan by capacity, not aspiration',
        psZh: [
          '一周五更听起来很好，但如果每条视频需要六小时，你需要的不是更强的意志力，而是更现实的排期。先记录两周真实耗时，再决定更新频率。',
          '把固定事项（拍摄日、剪辑日、发布日）先占住，剩下的时间才是灵感可以自由流动的空间。',
        ],
        psEn: [
          'Five posts a week sounds great — until each video takes six hours. What you need is a realistic schedule, not more willpower. Track two weeks of real production time before choosing a cadence.',
          'Block fixed days for filming, editing, and publishing first. What remains is the space where ideas can move freely.',
        ],
      },
      {
        h2Zh: '留出「补位内容」的格子',
        h2En: 'Leave room for backup content',
        psZh: [
          '再稳定的排期也会有意外。提前准备两三条不需要拍摄的轻量内容，放在空档里，用来应对生病、出差或临时热点。',
          '补位内容不需要完美，它的作用是让节奏不断。把素材库里的旧内容重新整理，往往就能得到一条可用的备选。',
        ],
        psEn: [
          'Even a solid schedule meets surprises. Prepare two or three lightweight posts that need no filming, ready for illness, travel, or a sudden trend.',
          'Backup content does not need to be perfect; its job is to keep the rhythm. Reworking old material from the library often produces a usable option.',
        ],
      },
      {
        h2Zh: '每周复盘一次排期本身',
        h2En: 'Review the schedule itself every week',
        psZh: [
          '周末花十分钟问三个问题：哪条内容延期了，为什么？哪个平台的数据最值得继续投入？下周有没有可以提前做完的事？',
          '复盘的对象不只是内容，也包括排期方式。连续两周都排得太满，说明计划本身需要调整，而不是你不够努力。',
        ],
        psEn: [
          'Spend ten minutes each weekend on three questions: what slipped and why, which platform deserves more effort, and what can be finished early next week.',
          'Review the scheduling method, not just the posts. If two weeks in a row are overloaded, the plan needs adjusting — not more effort.',
        ],
      },
    ],
    takeawaysZh: ['把制作阶段放进日历，而不只是发布日', '按真实产能决定频率，先测两周耗时', '常备两三条不需要拍摄的补位内容', '每周复盘排期方式本身'],
    takeawaysEn: ['Put production stages on the calendar, not just publish dates', 'Measure two weeks of real output before choosing a cadence', 'Keep two or three backup posts that need no filming', 'Review the scheduling method itself each week'],
  },
  {
    slug: 'where-platform-analytics-live',
    date: '2026-10-02',
    tagZh: '数据复盘',
    tagEn: 'Analytics',
    readZh: 7,
    readEn: 5,
    titleZh: '抖音、小红书、视频号的数据在哪里看',
    titleEn: 'Where to find Douyin, Xiaohongshu, and Channels analytics',
    descZh: '各平台的后台入口不同，指标口径也不同。看清哪些数字能直接比较，哪些只能作为参考。',
    descEn: 'Every platform hides analytics in a different place, and the metrics mean different things. Know what can be compared and what cannot.',
    introZh:
      '复盘最难的一步往往不是分析，而是把数据找齐。抖音、小红书、视频号、公众号各有一套后台，入口和指标名称都不一样。',
    introEn:
      'The hardest part of a review is rarely the analysis — it is gathering the numbers. Douyin, Xiaohongshu, Channels, and Official Accounts each have their own dashboard, entry point, and metric names.',
    sections: [
      {
        h2Zh: '先统一「口径」，再比较数字',
        h2En: 'Align definitions before comparing numbers',
        psZh: [
          '同样是「播放」，有的平台按曝光算，有的按实际播放算；同样是「互动率」，分子可能包含点赞、收藏、评论、分享中的一部分。直接横向比较会得出错误结论。',
          '建议固定三四个能横向看的指标：播放或阅读、点赞、涨粉、发布频率。其余指标留在各平台内部看趋势，不放进同一张对比表。',
        ],
        psEn: [
          '“Views” may mean impressions on one platform and actual plays on another. “Engagement rate” may count likes, saves, comments, and shares differently. Comparing them directly leads to wrong conclusions.',
          'Pick three or four metrics that can be compared: views or reads, likes, follower growth, and posting frequency. Keep the rest inside each platform for trend reading.',
        ],
      },
      {
        h2Zh: '发布日期对齐，复盘才有意义',
        h2En: 'Align publish dates',
        psZh: [
          '平台数据通常按自然日统计。如果一条内容在晚上 11 点发布，第一天的数据只包含一小时，直接和中午发布的内容比较会失真。',
          '复盘时至少对齐「发布后 24 小时」或「发布后 72 小时」的口径，或者按完整自然日比较。{{link:/features/#analytics|自动回流}}的数据也会记录采集时间，方便你判断新鲜度。',
        ],
        psEn: [
          'Analytics usually aggregate by calendar day. A post at 11 p.m. only has one hour on day one, so comparing it with a noon post is misleading.',
          'Align on “24 hours after publishing” or “72 hours after publishing,” or compare full calendar days. Automatic sync records collection time so you can judge freshness.',
        ],
      },
      {
        h2Zh: '四个平台自动回流，其余手动补',
        h2En: 'Four platforms sync, the rest are manual',
        psZh: [
          '目前抖音、小红书、视频号、公众号的数据可以自动回流到本地复盘表；B 站、快手、微博、知乎暂未覆盖，需要手动补充。',
          '手动记录并不可耻，关键是固定字段和固定时间。哪怕是每周五下午花十分钟填一遍，也比完全不记要好。',
        ],
        psEn: [
          'Today, Douyin, Xiaohongshu, WeChat Channels, and Official Accounts sync automatically into the local review table. Bilibili, Kuaishou, Weibo, and Zhihu are not covered yet and need manual entry.',
          'Manual entry is fine if the fields and timing are consistent. Ten minutes every Friday is far better than not recording at all.',
        ],
      },
      {
        h2Zh: '让数据回答一个问题，而不是展示所有数字',
        h2En: 'Let data answer one question',
        psZh: [
          '好的复盘不是把所有曲线放在一起，而是带着问题看：这条内容为什么比上一条多涨粉？是标题、封面还是发布时间？',
          '每次只回答一个问题，下一轮只改一个变量。这样积累几个月，你拥有的就不只是报表，而是自己的方法论。',
        ],
        psEn: [
          'A good review is not a wall of charts. It starts with a question: why did this post gain more followers than the last one — the title, cover, or timing?',
          'Answer one question at a time and change one variable next round. After a few months you have more than reports — you have a method.',
        ],
      },
    ],
    takeawaysZh: ['先统一定义，再横向比较平台数字', '用发布后 24/72 小时对齐数据窗口', '四平台自动回流，其余固定字段手动补', '每次复盘只回答一个问题'],
    takeawaysEn: ['Align definitions before comparing platforms', 'Compare at 24 or 72 hours after publishing', 'Four platforms sync automatically; fill the rest with fixed fields', 'Answer one question per review'],
  },
  {
    slug: 'wechat-official-account-analytics',
    date: '2026-09-24',
    tagZh: '公众号',
    tagEn: 'Official Accounts',
    readZh: 6,
    readEn: 5,
    titleZh: '公众号数据监控：手动抄数之外的办法',
    titleEn: 'WeChat Official Account analytics beyond copying numbers',
    descZh: '公众号后台的数据并不难找，难的是持续记录。把阅读、点赞、分享固定下来，长期内容资产才有据可查。',
    descEn: 'The numbers are not hard to find; keeping them is. Record reads, likes, and shares consistently so long-term content has a paper trail.',
    introZh:
      '公众号的优势是内容寿命长，劣势是反馈慢。文章发出后一两周还在带来阅读，如果只在发布当天看一眼，很容易错过真正的表现。',
    introEn:
      'Official Accounts reward content that keeps working after publishing, but feedback is slow. If you only check on publish day, you miss the real performance that arrives over the following weeks.',
    sections: [
      {
        h2Zh: '不要只看发布当天',
        h2En: 'Do not judge on publish day',
        psZh: [
          '公众号文章的阅读会在几天内持续增长，尤其是被转发到社群或朋友圈之后。发布当天记录一次，一周后再记录一次，才能看出真实差距。',
          '把「发布后 7 天阅读」作为固定指标，比单看首日数据更稳定。',
        ],
        psEn: [
          'Reads keep growing for days, especially after a post is shared into groups or Moments. Record once on publish day and again a week later to see the real difference.',
          'Use “reads at day 7” as a stable metric instead of first-day numbers alone.',
        ],
      },
      {
        h2Zh: '三个指标就能看出内容类型',
        h2En: 'Three metrics reveal content type',
        psZh: [
          '阅读代表标题与分发的效果，点赞代表内容认可，分享代表传播意愿。三者组合能大致判断文章属于哪种类型：高阅读低分享，多半是标题强但内容一般；阅读一般但分享高，可能是垂直干货。',
          '把这组数据与选题池关联，下一次做同类选题时就有依据。{{link:/features/#analytics|复盘表}}支持公众号数据自动回流，避免每周手动抄。',
        ],
        psEn: [
          'Reads show title and distribution performance, likes show approval, and shares show willingness to spread. Together they reveal content type: high reads with low shares often means a strong title but ordinary content; modest reads with high shares often means specialized value.',
          'Link this data to your idea pool for the next similar topic. The {{link:/features/#analytics|review table}} syncs Official Account metrics automatically, avoiding weekly copying.',
        ],
      },
      {
        h2Zh: '长期资产需要长期记录',
        h2En: 'Long-lived assets need long-lived records',
        psZh: [
          '公众号文章会在搜索和转发中持续被打开。半年后想复用某个主题时，如果当初没有记录，就得重新翻后台。',
          '把成稿、关键词和阅读数据一起归档，下一次写同主题内容时，你能准确知道哪一篇值得更新，而不是凭印象。',
        ],
        psEn: [
          'Articles keep being opened through search and sharing. Six months later, reusing a topic without records means digging through the dashboard again.',
          'Archive final copy, keywords, and reads together. Next time you write on the topic, you will know which article is worth updating instead of guessing.',
        ],
      },
    ],
    takeawaysZh: ['固定记录发布后 7 天阅读', '阅读、点赞、分享组合判断内容类型', '把数据与选题关联，指导下一次创作', '成稿与关键词一起归档'],
    takeawaysEn: ['Record reads at day 7', 'Combine reads, likes, and shares to classify content', 'Link data to ideas for the next post', 'Archive final copy with keywords'],
  },
  {
    slug: 'choosing-a-creator-publishing-tool',
    date: '2026-09-15',
    tagZh: '工具选型',
    tagEn: 'Tooling',
    readZh: 7,
    readEn: 5,
    titleZh: '个人创作者需要怎样的发布工具',
    titleEn: 'What kind of publishing tool does an individual creator need',
    descZh: '插件、定时器、SaaS、桌面客户端各有取舍。先想清楚你缺的是发布、数据，还是稳定性。',
    descEn: 'Extensions, schedulers, SaaS, and desktop clients trade off differently. Decide whether you lack publishing, analytics, or stability.',
    introZh:
      '市面上的发布工具大致分四类：浏览器插件、通用定时工具、云端 SaaS、本地桌面客户端。它们解决的问题并不相同，混着比较很容易选错。',
    introEn:
      'Publishing tools fall into four rough groups: browser extensions, generic schedulers, cloud SaaS, and local desktop clients. They solve different problems, and comparing them loosely leads to the wrong choice.',
    sections: [
      {
        h2Zh: '先判断瓶颈在哪',
        h2En: 'Find the bottleneck first',
        psZh: [
          '如果只是偶尔发两个平台，插件足够；如果内容量大但不需要数据，定时工具也能用；如果既要发布又要复盘，才需要更完整的系统。',
          '不要为了「功能多」买单。先写下你每周重复次数最多的三个动作，再看工具能不能直接消掉它们。',
        ],
        psEn: [
          'If you occasionally publish to two platforms, an extension is enough. If volume is high but analytics do not matter, a scheduler may work. A fuller system makes sense only when publishing and review both hurt.',
          'Do not pay for a long feature list. Write down the three actions you repeat most each week, then check whether a tool removes them.',
        ],
      },
      {
        h2Zh: '云端 SaaS 与本地客户端的取舍',
        h2En: 'Cloud SaaS versus local desktop',
        psZh: [
          '云端工具省安装，但意味着账号登录态和数据可能经过第三方服务器。本地客户端需要安装，换来的是登录态、素材与数据都在自己电脑上。',
          '对个人创作者来说，真正的差别不是价格，而是「账号交不交给别人」。如果这一点重要，本地优先就是硬条件。',
        ],
        psEn: [
          'Cloud tools are easier to start with, but sessions and data may pass through a third-party server. A local client needs installation, but sessions, assets, and data stay on your machine.',
          'For an individual creator, the real difference is not price — it is whether someone else holds your accounts. If that matters, local-first is a hard requirement.',
        ],
      },
      {
        h2Zh: '更新能力比功能数量重要',
        h2En: 'Maintenance beats feature count',
        psZh: [
          '平台前端经常改版，今天能用的自动化明天可能失效。选工具时应该问：改版后多久能修好？是否需要重新购买？',
          '桌面客户端 + 自动更新的组合，通常比一次性脚本更能撑过平台变化。{{link:/changelog/|更新日志}}是判断维护节奏最直接的证据。',
        ],
        psEn: [
          'Platforms redesign often, and automation that works today may fail tomorrow. Ask how fast fixes ship and whether you must buy again.',
          'A desktop client with auto-updates usually survives platform changes better than a one-off script. The {{link:/changelog/|changelog}} is the clearest evidence of maintenance rhythm.',
        ],
      },
      {
        h2Zh: '用一周真实工作验证',
        h2En: 'Validate with one real week',
        psZh: [
          '功能演示都很好看。真正决定去留的，是你自己的素材、账号和网络环境。用一周时间按正常工作流跑一遍，记录失败次数和手工补救时间。',
          '如果失败次数低于手工方案，且补救成本可接受，这个工具就值得留下。否则功能再多也只是负担。',
        ],
        psEn: [
          'Demos look good. What decides fit is your own assets, accounts, and network. Run one normal week, and count failures plus manual recovery time.',
          'If failures are fewer than the manual workflow and recovery is acceptable, keep it. Otherwise more features are just more weight.',
        ],
      },
    ],
    takeawaysZh: ['先找瓶颈，再选工具类型', '本地与云端的核心差异是账号与数据归属', '更新速度比功能数量更重要', '用一周真实工作流验证'],
    takeawaysEn: ['Find the bottleneck before choosing a tool type', 'The core local-vs-cloud difference is who holds accounts and data', 'Update speed matters more than feature count', 'Validate with one real week of work'],
  },
  {
    slug: 'local-first-vs-cloud-saas',
    date: '2026-09-05',
    tagZh: '数据安全',
    tagEn: 'Data safety',
    readZh: 6,
    readEn: 5,
    titleZh: '本地部署 vs 云端 SaaS：内容数据到底放哪',
    titleEn: 'Local-first versus cloud SaaS: where content data should live',
    descZh: '不是所有 SaaS 都不安全，也不是所有本地工具都可靠。关键看你愿意把哪一部分交给别人。',
    descEn: 'Not all SaaS is unsafe, and not all local tools are reliable. The question is which part you hand over.',
    introZh:
      '“本地”经常被当成营销词。它真正意味着什么，取决于三件事：登录态存在哪、素材存在哪、复盘数据存在哪。只要有一样经过第三方服务器，就不能算完整本地。',
    introEn:
      '“Local” is often a marketing word. What it means depends on three things: where sessions live, where assets live, and where analytics live. If any one of them passes through a third-party server, it is not fully local.',
    sections: [
      {
        h2Zh: '登录态是最敏感的部分',
        h2En: 'Sessions are the sensitive part',
        psZh: [
          '平台 Cookie 等于账号控制权。把 Cookie 上传到云端，等于把账号交给服务商保管。即使服务商承诺加密，风险依然转移了。',
          '更稳妥的方式是让发布在用户本机的浏览器里完成，登录态不离开设备。{{link:/features/#connect|一键登录}}采用的就是独立浏览器窗口方案。',
        ],
        psEn: [
          'A platform cookie is account control. Uploading it to a cloud service transfers that control. Even with encryption promises, the risk moves.',
          'A safer model is publishing through a browser on the user’s machine so the session never leaves the device. One-click sign-in uses an isolated browser window for exactly this reason.',
        ],
      },
      {
        h2Zh: '素材与数据的所有权',
        h2En: 'Ownership of assets and data',
        psZh: [
          '本地 SQLite 的好处不是技术先进，而是文件在你自己的目录里。停用工具后，数据仍然可以打开、导出、迁移，不会被锁在服务里。',
          '如果工具商倒闭或改价，本地数据至少还能保留。这是长期使用时的保险，不是对服务商的不信任。',
        ],
        psEn: [
          'The benefit of local SQLite is not technical sophistication; it is that the file sits in your directory. If you stop using the tool, you can still open, export, and migrate the data.',
          'If a vendor shuts down or raises prices, local data survives. That is insurance for the long term, not distrust of any specific vendor.',
        ],
      },
      {
        h2Zh: '本地也有代价',
        h2En: 'Local-first has costs too',
        psZh: [
          '本地工具需要安装、需要自己备份、无法多人实时协作，也不能换台设备就登录。这些限制必须在购买前说清楚，而不是藏在条款里。',
          '当前产品就是单机单用户：数据不经过云端，因此没有多人协作；macOS 未签名，需要手动更新。{{link:/faq/|FAQ}}把这些边界写在了明面上。',
        ],
        psEn: [
          'Local tools require installation, self-managed backups, and have no real-time team collaboration. You cannot simply log in on another device. These limits should be stated before purchase, not buried in terms.',
          'This product is single-user by design: data never goes to a cloud, so there is no team collaboration; the macOS build is unsigned and updates manually. The {{link:/faq/|FAQ}} states these boundaries plainly.',
        ],
      },
    ],
    takeawaysZh: ['登录态、素材、数据三处都本地，才算本地优先', 'Cookie 等于账号控制权，不应上传云端', '本地 SQLite 保证数据可迁移', '本地工具也有备份与协作的代价'],
    takeawaysEn: ['Local-first means sessions, assets, and data all stay local', 'Cookies equal account control and should not be uploaded', 'Local SQLite keeps data portable', 'Local-first also costs you backups and collaboration'],
  },
  {
    slug: 'weekly-five-post-template',
    date: '2026-08-28',
    tagZh: '模板',
    tagEn: 'Template',
    readZh: 6,
    readEn: 4,
    titleZh: '一周五更的排期模板（可照着改）',
    titleEn: 'A weekly five-post schedule you can adapt',
    descZh: '把拍摄、剪辑、发布和复盘分成固定的几天，比每天临时决定要轻松得多。',
    descEn: 'Fixing filming, editing, publishing, and review to specific days is far easier than deciding every morning.',
    introZh:
      '这份模板适合每周更新五条、同时运营四到八个平台的个人创作者。核心不是「每天发一条」，而是把生产集中、发布分散。',
    introEn:
      'This template is for a creator publishing five posts a week across four to eight platforms. The idea is not one post every day; it is concentrated production with distributed publishing.',
    sections: [
      {
        h2Zh: '周一：定主题与批量选题',
        h2En: 'Monday: themes and bulk ideation',
        psZh: [
          '花 60–90 分钟，把本周五条内容的主题、平台和角度确定下来。每条至少写一句核心观点，避免拍到一半才发现没想清楚。',
          '给每条内容打一个潜力评分，评分最低的那条作为补位内容，不必占用黄金时段。',
        ],
        psEn: [
          'Spend 60–90 minutes choosing themes, platforms, and angles for five posts. Write at least one core sentence per post so you do not discover the point mid-shoot.',
          'Score each idea. The lowest score becomes backup content instead of taking a prime slot.',
        ],
      },
      {
        h2Zh: '周二：集中拍摄',
        h2En: 'Tuesday: batch filming',
        psZh: [
          '一次布置好灯光和机位，连拍三条。切换场景的成本远高于多拍一条的成本。',
          '拍摄时顺手录一段语音备忘，记下剪辑思路和标题灵感，后面会省很多时间。',
        ],
        psEn: [
          'Set lights and camera once and shoot three pieces back to back. Switching setups costs more than shooting one extra.',
          'Record a quick voice memo with editing notes and title ideas while shooting. It saves time later.',
        ],
      },
      {
        h2Zh: '周三到周四：剪辑与准备发布',
        h2En: 'Wednesday to Thursday: edit and prep',
        psZh: [
          '周三集中粗剪，周四精剪并准备平台版本：封面、标题、话题、简介。把八个平台的差异一次填完。',
          '在{{link:/features/#publish|发布中心}}排好时间，确认封面比例和平台限制，避免发布前才发现问题。',
        ],
        psEn: [
          'Rough cut on Wednesday; fine cut and platform versions on Thursday: covers, titles, topics, descriptions. Fill in all eight platforms in one pass.',
          'Schedule in the {{link:/features/#publish|publish center}}, checking cover ratios and platform limits before publish day.',
        ],
      },
      {
        h2Zh: '周五到周日：发布、复盘、留白',
        h2En: 'Friday to Sunday: publish, review, breathe',
        psZh: [
          '发布分散在周五到周日，按平台的最佳时段执行。周五下午花十分钟检查发布结果，处理失败任务。',
          '周日留半小时复盘：哪条数据最好、为什么、下周要不要重复。剩下的时间不要再排活，留白本身就是节奏的一部分。',
        ],
        psEn: [
          'Publish Friday through Sunday at each platform’s best time. On Friday afternoon, spend ten minutes checking results and clearing failures.',
          'Reserve half an hour on Sunday to review what performed and why, and what to repeat. Leave the rest empty — breathing room is part of the rhythm.',
        ],
      },
    ],
    takeawaysZh: ['周一选题，周二拍摄，周三到周四制作', '周五到周日分散发布，周五检查结果', '最低分选题留作补位', '周日复盘半小时，其余留白'],
    takeawaysEn: ['Ideas Monday, film Tuesday, produce Wednesday–Thursday', 'Publish Friday–Sunday and check results Friday', 'Keep the lowest-scored idea as backup', 'Review for half an hour Sunday and leave the rest empty'],
  },
  {
    slug: 'recovering-from-platform-changes',
    date: '2026-08-18',
    tagZh: '稳定性',
    tagEn: 'Reliability',
    readZh: 6,
    readEn: 5,
    titleZh: '平台改版后发布失败，怎么降低损失',
    titleEn: 'When a platform redesign breaks publishing, limit the damage',
    descZh: '自动化一定会遇到改版。关键不是避免失败，而是让失败可见、可重试、可恢复。',
    descEn: 'Automation will always meet redesigns. The goal is not to avoid failure but to make it visible, retryable, and recoverable.',
    introZh:
      '平台前端改版是自动化的常态，不是例外。按钮换位置、上传流程多一步、发布页结构调整，都可能让昨天的流程今天失效。',
    introEn:
      'Platform redesigns are the norm for automation, not the exception. A moved button, an extra upload step, or a restructured publish page can break yesterday’s flow.',
    sections: [
      {
        h2Zh: '让失败可见',
        h2En: 'Make failures visible',
        psZh: [
          '最糟糕的情况不是发布失败，而是失败了却没人知道。任务状态必须明确：待发布、执行中、已发布、失败。',
          '{{link:/features/#publish|发布中心}}会保留失败任务并核验结果，避免“以为发了其实没发”。微博等平台还会自动核验博文是否存在。',
        ],
        psEn: [
          'The worst outcome is not a failed publish; it is a failure nobody notices. Task states must be explicit: queued, running, published, failed.',
          'The {{link:/features/#publish|publish center}} keeps failed tasks and verifies results, so “I thought it posted” does not happen. On Weibo, the app also verifies that the post exists.',
        ],
      },
      {
        h2Zh: '重试要安全',
        h2En: 'Retries must be safe',
        psZh: [
          '重试前要先确认上一次到底有没有成功，否则可能重复发布。核验步骤就是为此存在：先查结果，再决定是否重试。',
          '对于不支持核验的平台，至少检查后台列表或主页，再手动处理。',
        ],
        psEn: [
          'Before retrying, confirm whether the previous attempt succeeded, or you may double-post. Verification exists for this reason: check the result, then decide.',
          'For platforms without verification, check the dashboard or profile before retrying manually.',
        ],
      },
      {
        h2Zh: '降低单点失败的影响',
        h2En: 'Reduce the blast radius',
        psZh: [
          '不要把八条内容排在同一分钟。给任务之间留出间隔，一个平台失败时，其它平台的排期不受影响。',
          '重要内容提前一天发布，或准备一个手动发布的备用方案。自动化是效率工具，不是唯一通道。',
        ],
        psEn: [
          'Do not schedule eight posts in the same minute. Space tasks out so one platform’s failure does not affect the others.',
          'Publish important content a day early or keep a manual fallback. Automation is an efficiency tool, not the only route.',
        ],
      },
      {
        h2Zh: '把修复速度当成选型标准',
        h2En: 'Judge tools by repair speed',
        psZh: [
          '改版后多久能修好，比改版前有多少功能更重要。查{{link:/changelog/|更新日志}}，看平台适配是否持续更新，是判断维护能力的直接办法。',
          '如果工具长期不更新，再便宜也会在关键节点掉链子。',
        ],
        psEn: [
          'How fast a tool recovers after a redesign matters more than how many features it had before. The {{link:/changelog/|changelog}} shows whether platform fixes keep shipping.',
          'A tool that never updates will fail at the worst moment, no matter how cheap it was.',
        ],
      },
    ],
    takeawaysZh: ['任务状态必须明确，失败不能静默', '重试前先核验是否已经成功', '任务之间留间隔，降低连带影响', '把修复速度作为选型标准'],
    takeawaysEn: ['Make task states explicit and never fail silently', 'Verify success before retrying', 'Space tasks out to limit collateral failures', 'Judge tools by how fast they recover'],
  },
];

export function findPost(slug) {
  return BLOG_POSTS.find((p) => p.slug === slug) || null;
}
