/**
 * 页面早期初始化(放在 </head> 前)。
 *
 * 1. 强制所有页面初始从顶部开始(history.scrollRestoration = 'manual')
 *    避免浏览器记住上次滚动位置,导致大图页面"进来到中间"
 * 2. 仅 localhost:读 localStorage 应用 alt-mode class,避免主题切换闪烁
 */
;(function () {
  // 禁用浏览器自动恢复滚动位置
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual'
  }

  // 仅本地:应用 alt-mode
  var isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].indexOf(location.hostname) >= 0
  if (isLocal) {
    try {
      if (localStorage.getItem('alt-mode') === '1') {
        document.documentElement.classList.add('alt-mode')
      }
    } catch (e) { /* localStorage 不可用时静默 */ }
  }
})()

