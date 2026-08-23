/**
 * 本地模式切换器(放在 </body> 前)。
 *
 * 只在 localhost 下生效。注册 Ctrl+Shift+L 快捷键,
 * 切换 localStorage 中的 alt-mode 标记并 reload,让 local-mode-init.js 重新生效。
 *
 * 外部访问(GitHub Pages)此脚本完全 no-op。
 */
(function () {
  var isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].indexOf(location.hostname) >= 0
  if (!isLocal) return

  var isAlt = document.documentElement.classList.contains('alt-mode')

  document.addEventListener('keydown', function (e) {
    // Ctrl + Shift + L
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l' || e.keyCode === 76)) {
      e.preventDefault()
      try {
        var next = isAlt ? '0' : '1'
        localStorage.setItem('alt-mode', next)
      } catch (err) { /* ignore */ }
      location.reload()
    }
  })

  console.log(
    '%c[local-mode] 当前:' + (isAlt ? 'alt-mode (暗黑+粉紫)' : 'light') + ' | 按 Ctrl+Shift+L 切换',
    'color:#ff6bcb;font-weight:bold;font-size:13px;'
  )
})()
