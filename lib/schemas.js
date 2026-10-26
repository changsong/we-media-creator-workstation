'use strict';

/**
 * 四张表的结构定义。前端按 name + type + config 渲染表单，后端按同一份结构校验与类型转换。
 * type 支持：text | long_text | select | radio | multi_select | tags | number | date | url | checkbox
 */

const PLATFORMS = ['抖音', '视频号', '快手', '微博', '公众号', '小红书', 'B站', '知乎'];
const STAGES = ['选题确认', '脚本撰写', '待补素材', '制作中', '待审核', '待发布', '已发布', '二次分发', '已复盘'];
const STATUSES = ['待写', '写作中', '已发布', '废弃'];
const FORMATS = ['图文', '长图', '短视频', '直播', '音频'];
const TAGS = ['干货', '观点', '故事', '合集', '热点', '测评'];
const VISIBILITIES = ['公开', '私密/草稿'];

const select = (options) => ({ options: options.map((text) => ({ text })) });

const tables = {
  topic: {
    key: 'topic',
    name: '选题池',
    idField: '选题ID',
    idPrefix: 'TP',
    properties: [
      { name: '选题ID', type: 'text', note: '留空自动生成', readonly: true },
      { name: '选题', type: 'text', required: true, maxLength: 60 },
      { name: '平台', type: 'select', config: select(PLATFORMS), required: true },
      { name: '切入角度', type: 'long_text' },
      { name: '状态', type: 'select', config: select(STATUSES) },
      { name: '爆款潜力评分', type: 'number', config: { min: 0, max: 10, step: 0.1, precision: 1 } },
      { name: '标签', type: 'multi_select', config: select(TAGS) },
      { name: '参考链接', type: 'url' },
      { name: '创建日期', type: 'date', config: { format: 'yyyy-mm-dd' } }
    ]
  },
  calendar: {
    key: 'calendar',
    name: '内容日历',
    idField: '排期ID',
    idPrefix: 'SC',
    properties: [
      { name: '排期ID', type: 'text', note: '留空自动生成', readonly: true },
      { name: '选题ID', type: 'text', note: '关联选题池' },
      { name: '标题', type: 'text', required: true, maxLength: 80 },
      { name: '平台', type: 'multi_select', config: select(PLATFORMS), required: true },
      { name: '计划发布时间', type: 'date', config: { format: 'yyyy-mm-dd hh:mm' }, required: true },
      { name: '当前阶段', type: 'select', config: select(STAGES) },
      { name: '负责人', type: 'text' },
      { name: '内容形式', type: 'select', config: select(FORMATS) },
      { name: '发布链接', type: 'url' },
      { name: '备注', type: 'long_text' },
      { name: '标签', type: 'tags', note: '回车或空格添加' },
      { name: '是否开启原创声明', type: 'checkbox', note: '支持视频号、小红书、哔哩哔哩等 14 个平台' },
      { name: '是否包含AI生成内容', type: 'checkbox', note: '支持抖音、快手、小红书等 18 个平台' },
      { name: '谁可以看', type: 'radio', config: select(VISIBILITIES) }
    ]
  },
  review: {
    key: 'review',
    name: '数据复盘',
    idField: '复盘ID',
    idPrefix: 'RV',
    properties: [
      { name: '复盘ID', type: 'text', note: '留空自动生成', readonly: true },
      { name: '排期ID', type: 'text', note: '关联内容日历', required: true },
      { name: '平台', type: 'select', config: select(PLATFORMS), required: true },
      { name: '统计日期', type: 'date', config: { format: 'yyyy-mm-dd' }, required: true },
      { name: '阅读播放', type: 'number', config: { min: 0, precision: 0 } },
      { name: '点赞', type: 'number', config: { min: 0, precision: 0 } },
      { name: '涨粉', type: 'number', config: { min: 0, precision: 0 } },
      { name: '转化', type: 'number', config: { min: 0, precision: 0 } },
      { name: '复盘备注', type: 'long_text' }
    ]
  },
  asset: {
    key: 'asset',
    name: '素材库',
    idField: '素材ID',
    idPrefix: 'AS',
    properties: [
      { name: '素材ID', type: 'text', note: '留空自动生成', readonly: true },
      { name: '关联选题ID', type: 'text' },
      { name: '关联排期ID', type: 'text' },
      { name: '标题', type: 'text', required: true, maxLength: 80 },
      { name: '平台', type: 'select', config: select(PLATFORMS) },
      { name: '成稿Markdown', type: 'long_text' },
      { name: '配图说明', type: 'long_text' },
      { name: '语音复盘', type: 'long_text', note: '可从复盘录音一键写入' },
      { name: '关键词', type: 'multi_select', config: select(TAGS.concat(['封面', '标题', '排版', '转化'])) },
      { name: '归档日期', type: 'date', config: { format: 'yyyy-mm-dd' } },
      { name: '字数', type: 'number', config: { min: 0, precision: 0 } },
      { name: '发布链接', type: 'url' },
      { name: '成稿文档链接', type: 'url' },
      { name: '配图文档链接', type: 'url' }
    ]
  }
};

const tableOrder = ['topic', 'calendar', 'review', 'asset'];

/** 去掉内部备注字段，返回给前端的精简结构 */
function publicSchema(table) {
  return {
    key: table.key,
    name: table.name,
    idField: table.idField,
    properties: table.properties.map((p) => ({
      name: p.name,
      type: p.type,
      required: !!p.required,
      readonly: !!p.readonly,
      note: p.note || '',
      config: p.config || null,
      maxLength: p.maxLength || null
    }))
  };
}

module.exports = { tables, tableOrder, publicSchema, PLATFORMS, STAGES, STATUSES };
