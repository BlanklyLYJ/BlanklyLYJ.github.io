/**
 * private 文章机制(构建侧)
 *
 * frontmatter 加 `private: true` 的文章:
 *   1. after_post_render: 在正文头部内嵌 <i class="private-flag">,供文章页识别
 *   2. generator: 按当前文章数据动态生成 js/private-list.js 路由(window.PRIVATE_POSTS),
 *      供列表页/归档页隐藏入口。
 *      不再用 before_generate 写 source/js/private-list.js——那个时机 locals 未加载完,
 *      且文件路由早已按旧内容注册,产物拿到的是旧值(线上部署曾因此失效)。
 *
 * 前端隐藏逻辑在 source/js/private-post-front.js:localhost 自动放行,线上隐藏。
 * 注意:RSS/搜索索引/sitemap 仍可能包含 private 文章内容,这是纯客户端方案的固有边界。
 */
'use strict'

hexo.extend.filter.register('after_post_render', (data) => {
  if (data.private === true && data.content.indexOf('private-flag') === -1) {
    data.content = '<i class="private-flag" style="display:none"></i>' + data.content
  }
  return data
})

hexo.extend.generator.register('private-list', function (locals) {
  const urls = locals.posts.filter(p => p.private === true).map(p => '/' + String(p.path).replace(/^\/+/, ''))
  hexo.log.info(`[private-post] 隐私文章清单: ${urls.length} 篇`)
  return {
    path: 'js/private-list.js',
    data: `window.PRIVATE_POSTS = ${JSON.stringify(urls)};`
  }
})
