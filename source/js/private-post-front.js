/**
 * private 文章隐藏(前端)
 *
 * 非 alt-mode 下:
 *   - private 文章页:隐藏正文与标题,显示"仅限本地查看"提示
 *   - 所有页面:隐藏指向 private 文章的入口(首页卡片/归档条目/上下篇)
 * alt-mode(仅本地)完全放行。
 *
 * 依赖 window.PRIVATE_POSTS(URL 数组,scripts/private-post.js 生成)
 */
;(function () {
  if (document.documentElement.classList.contains('alt-mode')) return
  var urls = window.PRIVATE_POSTS || []

  // 1) 列表入口隐藏(首页卡片/归档/分类/上下篇翻页)
  urls.forEach(function (u) {
    var anchors = document.querySelectorAll('a[href*="' + u + '"]')
    Array.prototype.forEach.call(anchors, function (a) {
      var el = a
      while (el && el !== document.body) {
        if (el.matches('.recent-post-item, .article-sort-item, .prev-post, .next-post')) {
          el.style.display = 'none'
          return
        }
        el = el.parentElement
      }
      a.style.display = 'none'
    })
  })

  // 2) 文章页正文隐藏
  if (document.querySelector('.private-flag')) {
    var style = document.createElement('style')
    style.textContent =
      '#article-container, .post-title, .article-title { display: none !important; }' +
      '.private-notice { text-align: center; padding: 80px 20px; font-size: 18px; color: #999; }'
    document.head.appendChild(style)

    var notice = document.createElement('div')
    notice.className = 'private-notice'
    notice.textContent = '🔒 此内容仅限本地模式查看(Ctrl+Shift+L)'
    var container = document.getElementById('article-container')
    if (container && container.parentNode) {
      container.parentNode.insertBefore(notice, container.nextSibling)
    }
  }
})()
