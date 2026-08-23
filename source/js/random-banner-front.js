/**
 * 前端随机 banner
 *
 * 规则:
 *   - 默认模式 → 只从 safe 图里挑
 *   - body.alt-mode → 从全部图(safe + unsafe)里挑
 *   - 75% 概率选 wide(横向),25% 任意
 *
 * 依赖 window.BANNER_LIST,元素格式: { url, w, h, wide, safe, enc }
 * enc 条目(url 指向 .bin 密文)由 window.NsfwCrypt.decrypt 解密成 blob url
 */
(function () {
  if (!window.BANNER_LIST || window.BANNER_LIST.length === 0) return

  var altMode = document.documentElement.classList.contains('alt-mode')

  var pool = window.BANNER_LIST.filter(function (i) {
    return altMode ? true : i.safe
  })
  if (pool.length === 0) pool = window.BANNER_LIST

  // alt-mode 下,如果 unsafe 池非空,100% 用 unsafe 池
  // (用户切到 alt-mode 就是想看 unsafe 图,不应该再看到 safe)
  if (altMode) {
    var unsafePool = window.BANNER_LIST.filter(function (i) { return !i.safe })
    if (unsafePool.length > 0) {
      pool = unsafePool
    }
  }

  var pickWide = Math.random() < 0.75
  var candidates = pickWide ? pool.filter(function (i) { return i.wide }) : pool
  if (candidates.length === 0) candidates = pool

  // 直接拿 item 对象(含 w/h),后面不用 new Image() 异步加载
  var pickedItem = candidates[Math.floor(Math.random() * candidates.length)]
  if (!pickedItem) return

  function applyStyle(pick, item) {
    var header = document.getElementById('page-header')
    if (!header || !pick) return

    if (item && item.w > 0 && item.h > 0) {
      var vw = window.innerWidth
      var vh = window.innerHeight
      var desired = vw * item.h / item.w
      var minH = vh * 1.5
      var maxH = vh * 3
      var finalH = Math.max(minH, Math.min(maxH, desired))

      // 把所有 banner CSS 都放在 style 标签里 + !important
      // 优先级最高,任何主题 CSS(包括 darkmode 的 background shorthand)都覆盖不了
      var styleId = 'banner-override'
      var existing = document.getElementById(styleId)
      if (existing) existing.remove()
      var styleEl = document.createElement('style')
      styleEl.id = styleId
      styleEl.textContent =
        '#page-header {' +
          'background-image: url("' + pick + '") !important;' +
          'background-size: cover !important;' +
          'background-position: top center !important;' +
          'background-repeat: no-repeat !important;' +
          'background-attachment: scroll !important;' +
          'height: ' + finalH + 'px !important;' +
          'min-height: ' + finalH + 'px !important;' +
          'max-height: none !important;' +
        '}'
      document.head.appendChild(styleEl)

      console.log('[random-banner] pick=' + pick + ' w/h=' + item.w + '/' + item.h + ' enc=' + !!item.enc + ' banner height=' + finalH + 'px')
      setTimeout(function () {
        var h = document.getElementById('page-header')
        if (h) {
          var cs = window.getComputedStyle(h)
          console.log('[random-banner] 1s后实际 computed: height=' + cs.height +
            ' attachment=' + cs.backgroundAttachment +
            ' image=' + cs.backgroundImage.substring(0, 80) +
            ' html.alt-mode=' + document.documentElement.classList.contains('alt-mode') +
            ' html[data-theme]=' + document.documentElement.getAttribute('data-theme'))
        }
      }, 1000)
    }
  }

  function run() {
    if (pickedItem.enc && window.NsfwCrypt) {
      window.NsfwCrypt.decrypt(pickedItem).then(function (blobUrl) {
        if (blobUrl) {
          applyStyle(blobUrl, pickedItem)
        } else {
          // 解密失败(密码错/取消):回落到 safe 明文池,保证页面始终有 banner
          var safePool = window.BANNER_LIST.filter(function (i) { return i.safe })
          if (safePool.length > 0) {
            var fb = safePool[Math.floor(Math.random() * safePool.length)]
            applyStyle(fb.url, fb)
          }
        }
      })
    } else {
      applyStyle(pickedItem.url, pickedItem)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
