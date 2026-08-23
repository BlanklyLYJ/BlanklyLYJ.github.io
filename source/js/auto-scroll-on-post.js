/**
 * 自动滚动到主要内容(在 banner 大图页面生效)
 *
 * 检测 #page-header,如果它高度 ≥ 0.6 倍 viewport,说明是全屏 banner,
 * 1 秒后平滑滚动到 banner 底部(让用户先看一眼 banner)。
 *
 * 主页菜单 / 文章详情页 / 列表页 / 归档页 都生效。
 * 顶部小 banner(not-top-img 60px)不触发滚动。
 */
(function () {
  console.log('[auto-scroll] 脚本加载,readyState=' + document.readyState)

  function run() {
    var header = document.getElementById('page-header')
    if (!header) {
      console.log('[auto-scroll] 无 #page-header,跳过')
      return
    }

    var vh = window.innerHeight
    var headerH = header.offsetHeight
    console.log('[auto-scroll] header 高度=' + headerH + ', vh=' + vh)

    // 只在 banner 较大时触发(≥ 0.6 屏)
    if (headerH < vh * 0.6) {
      console.log('[auto-scroll] banner 太矮,跳过')
      return
    }

    // 滚动目标:banner 底部 - nav bar 高度(60)
    var targetTop = header.offsetTop + headerH - 60

    setTimeout(function () {
      console.log('[auto-scroll] 准备滚动,targetTop=' + targetTop + ',当前 scrollY=' + window.scrollY)
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
      })

      // fallback:smooth 不动就 instant
      setTimeout(function () {
        if (Math.abs(window.scrollY - targetTop) > 50) {
          console.log('[auto-scroll] smooth 没动,改 instant')
          window.scrollTo(0, Math.max(0, targetTop))
        }
      }, 600)
    }, 1000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
