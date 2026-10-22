'use strict';

/** 首次启动时写入的示例数据，覆盖多平台、多状态，便于直接看到首页趋势 */

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthTag() {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}`;
}

function populate(state, makeId, nowIso) {
  const tag = monthTag();
  const tp = (n) => `TP${tag}-${pad(n)}`;
  const sc = (n) => `SC${tag}-${pad(n)}`;
  const rv = (n) => `RV${tag}-${pad(n)}`;
  const as = (n) => `AS${tag}-${pad(n)}`;

  const base = (id, extra) => ({
    _id: id,
    _createdAt: nowIso(),
    _updatedAt: nowIso(),
    ...extra
  });

  state.tables.topic.records.push(
    base(makeId('topic'), {
      选题ID: tp(1),
      选题: '公众号起号 30 天：我踩过的 5 个坑',
      平台: '公众号',
      切入角度: '不讲方法论，只讲踩坑，用时间线还原真实的冷启动过程',
      状态: '已发布',
      爆款潜力评分: 8.6,
      标签: ['故事', '干货'],
      参考链接: 'https://mp.weixin.qq.com/',
      创建日期: dayOffset(-21)
    }),
    base(makeId('topic'), {
      选题ID: tp(2),
      选题: '小红书封面 5 秒法则：3 个模板直接抄',
      平台: '小红书',
      切入角度: '把设计原则翻译成手机端可执行的 3 步动作，配可复用模板',
      状态: '写作中',
      爆款潜力评分: 9.2,
      标签: ['干货', '合集'],
      参考链接: 'https://www.xiaohongshu.com/',
      创建日期: dayOffset(-9)
    }),
    base(makeId('topic'), {
      选题ID: tp(3),
      选题: '视频号冷启动：一条视频带来 800 粉的复盘',
      平台: '视频号',
      切入角度: '拆解单条视频的选题、开头 3 秒、评论区运营三件事',
      状态: '待写',
      爆款潜力评分: 7.4,
      标签: ['观点'],
      参考链接: '',
      创建日期: dayOffset(-4)
    }),
    base(makeId('topic'), {
      选题ID: tp(4),
      选题: '「爆款标题公式」合集（已废弃，角度太泛）',
      平台: '公众号',
      切入角度: '原计划做 20 条标题模板，评估后与已有内容重复',
      状态: '废弃',
      爆款潜力评分: 4.5,
      标签: ['合集'],
      参考链接: '',
      创建日期: dayOffset(-30)
    })
  );

  state.tables.calendar.records.push(
    base(makeId('calendar'), {
      排期ID: sc(1),
      选题ID: tp(1),
      标题: '公众号起号 30 天：我踩过的 5 个坑',
      平台: '公众号',
      计划发布时间: `${dayOffset(-14)}T20:00`,
      当前阶段: '已复盘',
      负责人: '我',
      内容形式: '图文',
      发布链接: 'https://mp.weixin.qq.com/',
      备注: '首发，评论区互动集中在第 3 个坑'
    }),
    base(makeId('calendar'), {
      排期ID: sc(2),
      选题ID: tp(2),
      标题: '小红书封面 5 秒法则：3 个模板直接抄',
      平台: '小红书',
      计划发布时间: `${dayOffset(2)}T19:30`,
      当前阶段: '待发布',
      负责人: '我',
      内容形式: '长图',
      发布链接: '',
      备注: '封面已出 3 版，选第二版'
    }),
    base(makeId('calendar'), {
      排期ID: sc(3),
      选题ID: tp(3),
      标题: '视频号冷启动：一条视频带来 800 粉的复盘',
      平台: '视频号',
      计划发布时间: `${dayOffset(4)}T21:00`,
      当前阶段: '脚本撰写',
      负责人: '我',
      内容形式: '短视频',
      发布链接: '',
      备注: '需要补 2 段录屏素材'
    }),
    base(makeId('calendar'), {
      排期ID: sc(4),
      选题ID: tp(2),
      标题: '封面模板二次分发到视频号',
      平台: '视频号',
      计划发布时间: `${dayOffset(-2)}T18:00`,
      当前阶段: '二次分发',
      负责人: '我',
      内容形式: '短视频',
      发布链接: '',
      备注: '同一内容换平台重剪'
    })
  );

  const snapshots = [
    { day: -6, read: 1860, like: 92, fans: 18, conv: 4 },
    { day: -5, read: 2410, like: 118, fans: 22, conv: 5 },
    { day: -4, read: 3120, like: 164, fans: 31, conv: 7 },
    { day: -3, read: 2680, like: 141, fans: 25, conv: 6 },
    { day: -2, read: 3980, like: 212, fans: 44, conv: 9 },
    { day: -1, read: 4320, like: 238, fans: 52, conv: 11 }
  ];
  snapshots.forEach((s, i) => {
    state.tables.review.records.push(
      base(makeId('review'), {
        复盘ID: rv(i + 1),
        排期ID: sc(1),
        平台: '公众号',
        统计日期: dayOffset(s.day),
        阅读播放: s.read,
        点赞: s.like,
        涨粉: s.fans,
        转化: s.conv,
        复盘备注: i === 5 ? '第 3 个坑这段停留最久，可单独拆一篇' : ''
      })
    );
  });
  state.tables.review.records.push(
    base(makeId('review'), {
      复盘ID: rv(7),
      排期ID: sc(4),
      平台: '视频号',
      统计日期: dayOffset(-1),
      阅读播放: 12400,
      点赞: 486,
      涨粉: 96,
      转化: 14,
      复盘备注: '开头 3 秒直接抛结论，完播率明显高于上条'
    })
  );

  state.tables.asset.records.push(
    base(makeId('asset'), {
      素材ID: as(1),
      关联选题ID: tp(2),
      关联排期ID: sc(2),
      标题: '小红书封面 5 秒法则：3 个模板直接抄',
      平台: '小红书',
      成稿Markdown: [
        '# 小红书封面 5 秒法则',
        '',
        '刷到的前 5 秒，用户只做一件事：判断这张图跟自己有没有关系。',
        '',
        '## 一、主标题占画面 1/3',
        '',
        '标题字号小于画面高度的三分之一，手指划过去根本读不完。',
        '',
        '## 二、只留一个视觉焦点',
        '',
        '- 人像看镜头，产品居中，背景纯色',
        '- 不要同时放三张图，手机端会糊成一团',
        '',
        '## 三、对比度优先于好看',
        '',
        '> 深色底 + 亮色字，永远比浅色底 + 浅色字更容易被读到。',
        '',
        '需要模板的评论区留「封面」，我发你。'
      ].join('\n'),
      配图说明: [
        '图 1 · 封面：竖版 1242×1660，深绿底 + 白色主标题，标题占高 1/3',
        '图 2 · 对比页：左右分屏，左侧错误示例（浅灰底浅灰字），右侧正确示例',
        '图 3 · 模板页：三套模板缩略图，标注可替换区域'
      ].join('\n'),
      关键词: ['封面', '排版', '干货'],
      归档日期: dayOffset(-3),
      字数: 620,
      发布链接: '',
      成稿文档链接: '',
      配图文档链接: ''
    })
  );
}

module.exports = { populate };
