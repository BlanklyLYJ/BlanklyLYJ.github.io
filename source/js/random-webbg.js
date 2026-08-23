/**
 * 整页背景图(light + alt-mode 都生效)
 *
 * 图池跟随模式(跟 random-banner-front.js 一致):
 *   - light   → safe 池
 *   - alt-mode → unsafe 池
 *
 * 遮罩色调跟随模式:
 *   - light   → 浅白半透明(让背景图淡雅,不抢正文)
 *   - alt-mode → 暗紫半透明(保留主色调)
 *
 * 优先级:setProperty('background', ..., 'important') 设 inline,
 * 任何 CSS(含 _config 的 background 与 alt-mode.css 的 gradient)都盖不住。
 */
(function () {
  if (!window.BANNER_LIST || window.BANNER_LIST.length === 0) return

  var altMode = document.documentElement.classList.contains('alt-mode')

  // 图池跟随模式
  var pool
  if (altMode) {
    pool = window.BANNER_LIST.filter(function (i) { return !i.safe })
  } else {
    pool = window.BANNER_LIST.filter(function (i) { return i.safe })
  }
  if (pool.length === 0) pool = window.BANNER_LIST

  var pick = pool[Math.floor(Math.random() * pool.length)]
  if (!pick || !pick.url) return

  // 遮罩色调跟随模式
  var mask
  if (altMode) {
    mask = 'linear-gradient(rgba(26, 16, 36, 0.18), rgba(45, 27, 61, 0.22))'
  } else {
    mask = 'linear-gradient(rgba(255, 255, 255, 0.35), rgba(245, 240, 250, 0.45))'
  }

  function applyTo(url) {
    var bg = document.getElementById('web_bg')
    if (!bg) {
      console.log('[random-webbg] 无 #web_bg 元素,跳过')
      return
    }

    var value = mask + ', url("' + url + '") center/cover no-repeat fixed'
    bg.style.setProperty('background', value, 'important')

    console.log('[random-webbg] mode=' + (altMode ? 'alt' : 'light') + ' pick=' + pick.url + ' 已应用到 #web_bg')
  }

  function apply() {
    if (pick.enc && window.NsfwCrypt) {
      // 加密条目:解密成 blob URL;失败(密码错/取消)回落 safe 明文池
      window.NsfwCrypt.decrypt(pick).then(function (blobUrl) {
        if (blobUrl) {
          applyTo(blobUrl)
        } else {
          var safePool = window.BANNER_LIST.filter(function (i) { return !i.enc })
          if (safePool.length > 0) {
            pick = safePool[Math.floor(Math.random() * safePool.length)]
            applyTo(pick.url)
          }
        }
      })
    } else {
      applyTo(pick.url)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply)
  } else {
    apply()
  }
})()
