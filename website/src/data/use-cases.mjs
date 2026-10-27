export const USE_CASES = {
  solo: {
    icon: 'person',
    labelZh: '一人创作者',
    labelEn: 'Solo creator',
    h1Zh: '一个人，也能稳定运营八个平台',
    h1En: 'One person can keep eight platforms running',
    introZh:
      '你的时间被拍摄、剪辑和客户沟通切得很碎。真正拖住节奏的不是创作本身，而是重复上传、改封面、抄数据。一个人做八个平台，靠的不是更努力，而是把机械动作交给排期。',
    introEn:
      'Your day is split between filming, editing, and client calls. The bottleneck is not the creative work — it is re-uploading, resizing covers, and copying numbers. One person running eight platforms needs a schedule, not more hustle.',
    storyZh: [
      ['09:30', '在选题池里把本周的三个想法标好平台和潜力评分，内容日历自动留出制作时间。'],
      ['14:00', '素材剪完直接放进发布中心，八个平台一次排好，封面比例提前裁切。'],
      ['18:00', '电脑合上也没关系，桌面端在托盘里按顺序发布，发完自动核验。'],
      ['次日 09:00', '打开复盘表，四个平台的播放、互动和涨粉已经回来，决定下一条做什么。'],
    ],
    storyEn: [
      ['09:30', 'Tag three ideas by platform and potential score; the calendar reserves production time.'],
      ['14:00', 'Drop the finished asset into the publish center and schedule all eight platforms with pre-cropped covers.'],
      ['18:00', 'Close the laptop. The desktop app keeps publishing from the tray and verifies each result.'],
      ['Next 09:00', 'Open the review table: views, engagement, and follower growth from four platforms are already there.'],
    ],
    scenariosZh: [
      ['副业博主', '下班后只有两三个小时，靠排期把周更变成稳定的节奏。'],
      ['多平台分发', '同一素材要发图文和视频，多比例封面一次准备好。'],
      ['一个人复盘', '没有运营同事，数据自动回来才看得下去。'],
    ],
    scenariosEn: [
      ['Side-project creator', 'Two or three hours after work; a schedule keeps weekly publishing steady.'],
      ['Multi-platform distribution', 'One asset becomes image and video posts with covers prepared once.'],
      ['Solo review', 'No operations teammate, so analytics must come back on their own.'],
    ],
    metricsZh: [['每天 2–3 小时', '少做重复上传与手抄'], ['8 个平台', '共用一张发布日历'], ['4 个平台', '数据自动回流复盘']],
    metricsEn: [['2–3 hours a day', 'less repetitive uploading and copying'], ['8 platforms', 'on one publishing calendar'], ['4 platforms', 'with automatic analytics']],
  },
  team: {
    icon: 'groups',
    labelZh: '小团队',
    labelEn: 'Small team',
    h1Zh: '小团队的排期、审稿与复盘，放在同一张表',
    h1En: 'Schedules, reviews, and analytics on one table',
    introZh:
      '当团队从一个人变成两三个人，最容易失控的不是产量，而是信息差：谁在做哪一步、哪条内容还没审、上周的数据到底谁抄。工作台把阶段、负责人和数据口径放进同一张表。',
    introEn:
      'When a one-person operation becomes two or three people, the risk is not output — it is information gaps: who is on which stage, what is waiting for review, and whose numbers are right. The workbench puts stages, owners, and metrics on the same table.',
    storyZh: [
      ['周一', '主理人在日历里排好本月主题，标明负责人和九个制作阶段。'],
      ['周中', '编辑推进文案与粗剪，运营在发布中心准备平台与封面，状态实时可见。'],
      ['发布日', '任务按顺序执行，失败会留在队列里，谁都能看到并重试。'],
      ['周末', '复盘表口径统一，四个人看到的是同一组数字，不用再对表。'],
    ],
    storyEn: [
      ['Monday', 'The lead plans the month and assigns owners across nine production stages.'],
      ['Midweek', 'Editors move copy and rough cuts; operations prepares platforms and covers. Status is visible to everyone.'],
      ['Publish day', 'Tasks run in order. Failures stay in the queue for anyone to retry.'],
      ['Weekend', 'One review table, one set of numbers. No more cross-checking screenshots.'],
    ],
    scenariosZh: [
      ['编辑 + 运营', '两个人分头推进，阶段与负责人写清楚，减少追问。'],
      ['审稿卡点', '草稿与发布流程分开，重要内容先审再发。'],
      ['数据口径', '复盘表统一计算方式，周会不再争论数字来源。'],
    ],
    scenariosEn: [
      ['Editor plus operations', 'Two people work in parallel with explicit stages and owners.'],
      ['Review gates', 'Draft and publish flows stay separate for sensitive content.'],
      ['Shared metrics', 'One calculation method, so meetings do not argue about sources.'],
    ],
    metricsZh: [['9 个阶段', '从文案到成片一表可见'], ['1 套口径', '复盘数字不再对不上'], ['3 台设备', '一份授权覆盖常用电脑']],
    metricsEn: [['9 stages', 'from copy to final cut in one table'], ['1 set of metrics', 'no more mismatched numbers'], ['3 devices', 'covered by one license']],
  },
  overseas: {
    icon: 'public',
    labelZh: '海外创作者',
    labelEn: 'Creator abroad',
    h1Zh: '人在海外，内容按时出现在国内平台',
    h1En: 'Your content lands on time back home',
    introZh:
      '跨时区运营国内平台，最难的是发布时间和工具稳定性。桌面端常驻运行，按国内时间排期；数据留在本机，不需要把账号交给云端。',
    introEn:
      'Running Chinese platforms across time zones is mostly about timing and tool stability. The desktop app stays resident and schedules in China time; your data stays local instead of being handed to a cloud service.',
    storyZh: [
      ['当地上午', '国内已是下午，选题和文案在本地准备好，排进对应的国内发布时间。'],
      ['当地中午', '发布任务在北京时间准点执行，不需要你熬夜守着。'],
      ['当地傍晚', '查看复盘表，四个平台的互动数据已经回流。'],
      ['周末', '把成稿和关键词归档，下一轮选题直接复用。'],
    ],
    storyEn: [
      ['Local morning', 'It is already afternoon in China. Prepare ideas and copy locally and schedule the right China-time slot.'],
      ['Local noon', 'Publishing runs on Beijing time without you staying up.'],
      ['Local evening', 'Check the review table: engagement from four platforms is already back.'],
      ['Weekend', 'Archive final copy and keywords to reuse next cycle.'],
    ],
    scenariosZh: [
      ['跨时区定时', '按北京时间排期，客户端自动到点执行。'],
      ['桌面常驻', '窗口关掉仍在托盘运行，不必一直开着电脑屏幕。'],
      ['支付与授权', '价格以人民币计价，购买前可先在反馈表单咨询支付方式。'],
    ],
    scenariosEn: [
      ['Cross-timezone scheduling', 'Schedule in Beijing time; the client executes on time.'],
      ['Resident desktop', 'Closing the window keeps it running in the tray.'],
      ['Payment and licensing', 'Prices are in USD; ask about payment options through the feedback form before buying.'],
    ],
    metricsZh: [['按北京时间', '排期自动执行'], ['托盘常驻', '关窗不中断任务'], ['本地数据', '不经过云端中转']],
    metricsEn: [['Beijing time', 'schedules run automatically'], ['Tray resident', 'closing the window does not stop tasks'], ['Local data', 'no cloud relay']],
  },
};
