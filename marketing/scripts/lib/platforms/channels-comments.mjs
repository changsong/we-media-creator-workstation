export const meta = {
  key: 'channels',
  label: '视频号',
  needsBrowserForSearch: false,
  needsBrowserForComments: false,
  supportsManual: true,
};

const MANUAL_HINT =
  '视频号没有公开的网页搜索/评论入口，无法自动采集。' +
  '请把视频链接、标题和评论原文用 comments.mjs add --platform channels 手动导入，' +
  'AI 出稿后复制到微信视频号里回复。';

export async function searchVideos() {
  throw new Error(MANUAL_HINT);
}

export async function collectComments() {
  throw new Error(MANUAL_HINT);
}

export async function focusComment({ comment, draft }) {
  return {
    manual: true,
    opened: false,
    prefilled: false,
    copied: false,
    url: comment.video_url || '',
    draft: draft || comment.draft || '',
    reason: '视频号请在微信里手动回复。文案已准备好，点「复制文案」后粘贴。',
  };
}

export { MANUAL_HINT };
