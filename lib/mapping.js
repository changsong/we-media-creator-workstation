'use strict';

/**
 * 字段映射：中文业务字段名 ↔ SQLite 列名。
 * 页面与 API 仍然使用中文名，库里统一 snake_case，便于直接用 SQL 查询。
 */

const mapping = {
  topic: {
    table: 'topics',
    idField: '选题ID',
    idPrefix: 'TP',
    columns: {
      选题ID: 'code',
      选题: 'title',
      平台: 'platform',
      切入角度: 'angle',
      状态: 'status',
      爆款潜力评分: 'score',
      标签: 'tags',
      参考链接: 'reference_url',
      创建日期: 'created_on'
    },
    json: ['标签'],
    searchable: ['code', 'title', 'platform', 'angle', 'status', 'reference_url']
  },
  calendar: {
    table: 'schedules',
    idField: '排期ID',
    idPrefix: 'SC',
    columns: {
      标签: 'tags',
      是否开启原创声明: 'original_claim',
      是否包含AI生成内容: 'ai_generated',
      谁可以看: 'visibility',
      排期ID: 'code',
      选题ID: 'topic_code',
      标题: 'title',
      平台: 'platform',
      计划发布时间: 'publish_at',
      当前阶段: 'stage',
      负责人: 'owner',
      内容形式: 'format',
      发布链接: 'publish_url',
      备注: 'note'
    },
    json: ['标签', '平台'],
    searchable: ['code', 'topic_code', 'title', 'platform', 'stage', 'owner', 'note', 'tags']
  },
  review: {
    table: 'reviews',
    idField: '复盘ID',
    idPrefix: 'RV',
    columns: {
      复盘ID: 'code',
      排期ID: 'schedule_code',
      平台: 'platform',
      统计日期: 'stat_date',
      阅读播放: 'reads',
      点赞: 'likes',
      涨粉: 'followers',
      转化: 'conversions',
      复盘备注: 'note'
    },
    json: [],
    searchable: ['code', 'schedule_code', 'platform', 'stat_date', 'note']
  },
  asset: {
    table: 'assets',
    idField: '素材ID',
    idPrefix: 'AS',
    columns: {
      素材ID: 'code',
      关联选题ID: 'topic_code',
      关联排期ID: 'schedule_code',
      标题: 'title',
      平台: 'platform',
      成稿Markdown: 'manuscript_md',
      配图说明: 'image_spec',
      语音复盘: 'voice_review',
      关键词: 'keywords',
      归档日期: 'archived_on',
      字数: 'word_count',
      发布链接: 'publish_url',
      成稿文档链接: 'manuscript_doc_url',
      配图文档链接: 'image_doc_url'
    },
    json: ['关键词'],
    searchable: ['code', 'topic_code', 'schedule_code', 'title', 'platform', 'manuscript_md', 'image_spec', 'voice_review', 'keywords']
  }
};

const tableKeys = Object.keys(mapping);

function columnOf(tableKey, field) {
  const map = mapping[tableKey];
  return map && map.columns[field];
}

/** 排序后的列名列表，用于 SELECT 与 INSERT 保持稳定顺序 */
function columnsOf(tableKey) {
  return Object.values(mapping[tableKey].columns);
}

module.exports = { mapping, tableKeys, columnOf, columnsOf };
