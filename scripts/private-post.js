/**
 * private 文章机制(构建侧)
 *
 * frontmatter 加 `private: true` 的文章:
 *   1. after_post_render: 在正文头部内嵌 <i class="private-flag">,供文章页识别
 *   2. before_generate: 把所有 private 文章的 URL 写入 source/js/private-list.js
 *      (window.PRIVATE_POSTS),供列表页/归档页隐藏入口
 *
 * 前端隐藏逻辑在 source/js/private-post-front.js,仅 localhost 非 alt-mode 生效……
 * 实际上前端脚本全站加载,GitHub Pages 上也会跑——所以隐藏是全站的,
 * alt-mode(仅本地)才显示。注意:RSS/搜索索引/sitemap 仍可能包含 private 文章内容,
 * 这是纯客户端方案的固有边界。
 */
'use strict'

hexo.extend.filter.register('after_post_render', (data) => {
  if (data.private === true && data.content.indexOf('private-flag') === -1) {
    data.content = '<i class="private-flag" style="display:none"></i>' + data.content
  }
  return data
})

hexo.extend.filter.register('before_generate', () => {
  let posts = []
  try { posts = hexo.locals.get('posts') } catch (e) { return }

  const urls = posts.filter(p => p.private === true).map(p => '/' + p.path)
  const newList = `window.PRIVATE_POSTS = ${JSON.stringify(urls)};`
  const targetPath = require('path').join(hexo.source_dir, 'js/private-list.js')
  const fs = require('fs')
  let oldList = ''
  try { oldList = fs.readFileSync(targetPath, 'utf8') } catch (e) { /* no */ }
  if (oldList !== newList) {
    fs.mkdirSync(require('path').dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, newList)
    hexo.log.info(`[private-post] 隐私文章清单: ${urls.length} 篇`)
  }
})
