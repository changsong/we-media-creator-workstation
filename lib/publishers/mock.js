'use strict';

/**
 * 模拟发布渠道：仅在 WB_PUBLISH_MOCK=1 时启用，供本地冒烟测试走通队列状态流转。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(ctx) {
  const delay = Number(process.env.WB_PUBLISH_MOCK_DELAY) || 120;
  const isImage = ctx.kind === 'image';
  const items = Array.isArray(ctx.media) ? ctx.media : [];
  ctx.log(isImage ? `准备 ${items.length} 张图片` : '准备视频：' + (ctx.video ? ctx.video.name : ''));
  await sleep(delay);
  ctx.log(isImage ? '模拟上传图片' : '模拟上传视频');
  await sleep(delay);
  ctx.log('模拟填写标题与简介：' + ctx.task.title);
  await sleep(delay);
  if (ctx.task.mode === 'confirm') {
    return { status: 'needs_confirm', message: '模拟渠道：表单已填好，等待人工确认' };
  }
  ctx.log('模拟点击发布');
  await sleep(delay);
  const id = 'mock' + Date.now();
  return {
    status: 'published',
    workId: id,
    publishUrl: (isImage ? 'https://www.douyin.com/note/' : 'https://www.douyin.com/video/') + id,
    message: '模拟发布成功'
  };
}

module.exports = { key: 'mock', supported: true, run };
