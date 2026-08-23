/**
 * 底部翻页 banner 图(文章详情页 #pagination.pagination-post)
 *
 * 当前数据源:window.BANNER_LIST 的 safe 池
 * 后续切换:用户单独给 footer 图文件夹后,改 FOOTER_POOL 这一段即可
 *   方案 A:加 scripts/random-banner.js 扫 source/img/bg/footer/,挂到 window.FOOTER_BANNER_LIST
 *   方案 B:直接在下面 FOOTER_POOL 写死一个数组
 */
(function () {
  function getPool() {
    if (window.FOOTER_BANNER_LIST && window.FOOTER_BANNER_LIST.length > 0) {
      return window.FOOTER_BANNER_LIST
    }
    if (window.BANNER_LIST && window.BANNER_LIST.length > 0) {
      return window.BANNER_LIST.filter(function (i) { return i.safe })
    }
    return []
  }

  function pickOne(pool) {
    return pool[Math.floor(Math.random() * pool.length)]
  }

  function applyTo(el, item) {
    if (!el || !item) return
    el.style.backgroundImage = 'url("' + item.url + '")'
    el.style.backgroundSize = 'cover'
    el.style.backgroundPosition = 'center center'
    el.style.backgroundRepeat = 'no-repeat'
  }

  function run() {
    var pag = document.getElementById('pagination')
    if (!pag || !pag.classList.contains('pagination-post')) return

    var pool = getPool()
    if (pool.length === 0) return

    var prevA = pag.querySelector('.prev-post a')
    var nextA = pag.querySelector('.next-post a')

    if (prevA) applyTo(prevA, pickOne(pool))
    if (nextA) applyTo(nextA, pickOne(pool))
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
