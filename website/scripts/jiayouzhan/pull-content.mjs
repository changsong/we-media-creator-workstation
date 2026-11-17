#!/usr/bin/env node
import { syncContentFromServer } from './sync-content.mjs';

try {
  const result = syncContentFromServer();
  if (result.pulled) console.log(`已同步 ${result.count} 篇文章到 ${result.file}`);
  else console.log('服务器上还没有 content/jiayouzhan.json，本次不拉取');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
