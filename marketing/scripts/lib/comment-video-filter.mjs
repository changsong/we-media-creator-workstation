// 视频标题相关性过滤：搜索页滚到底会混入推荐流，用 include/exclude 词把明显无关的视频挡掉。
// include 里会自动加入当前搜索关键词，所以「自媒体工具」搜出来的视频只要标题含关键词也会保留。
export function isRelevantVideo(video, keyword, config = {}) {
  const filter = config.videoFilter || {};
  const include = [keyword, ...(filter.include || [])]
    .filter(Boolean)
    .map((word) => String(word).toLowerCase());
  const exclude = (filter.exclude || [])
    .map((word) => String(word).toLowerCase());
  const haystack = `${video && video.title ? video.title : ''} ${video && video.description ? video.description : ''}`
    .toLowerCase();
  if (!haystack.trim()) return true;
  if (exclude.some((word) => haystack.includes(word))) return false;
  if (include.length && !include.some((word) => haystack.includes(word))) return false;
  return true;
}
