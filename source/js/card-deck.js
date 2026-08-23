/**
 * 主页选牌(Coverflow)模式交互
 *
 * 交互:
 *   - 点击 .card-mode-toggle 切换网格 ↔ 选牌模式
 *   - 进入选牌模式后,牌默认叠成一摞(扑克牌未展开样式)
 *   - 鼠标悬停牌堆 → 扇形展开
 *   - 鼠标移开 → 自动收起
 *   - 鼠标拖拽 / 触摸滑动 / 左右箭头 切换中心牌
 *   - 点击中心牌 → 跳转;点击侧牌 → 移到中心
 */
(function () {
  var grid = document.querySelector('.home-menu__grid')
  if (!grid) return

  var cards = Array.prototype.slice.call(grid.querySelectorAll('.home-card'))
  if (cards.length === 0) return

  var toggleBtn = document.querySelector('.card-mode-toggle')
  var deckMode = false
  var expanded = false  // 牌堆是否展开
  var selectedIndex = 0

  // ============ 展开:扇形 coverflow ============
  function render() {
    cards.forEach(function (card, i) {
      var offset = i - selectedIndex
      var abs = Math.abs(offset)
      var sign = offset === 0 ? 0 : (offset > 0 ? 1 : -1)

      if (offset === 0) {
        // 中心牌:只居中,不走 3D,字最清晰
        card.style.opacity = '1'
        card.style.pointerEvents = 'auto'
        card.style.transform = 'translate(-50%, -50%)'
        card.style.zIndex = '10'
        card.classList.add('is-active')
        return
      }

      if (abs > 3) {
        card.style.opacity = '0'
        card.style.pointerEvents = 'none'
        card.style.transform =
          'translate(-50%, -50%) translateX(' + (sign * 700) + 'px) scale(0.4)'
        card.style.zIndex = '0'
        card.classList.remove('is-active')
        return
      }

      var x = sign * (150 + (abs - 1) * 105)
      var z = -abs * 140
      var rotY = -sign * 32
      var scale = 1 - abs * 0.08
      // 非中心牌大幅降低透明度,避免背景透过来干扰中心牌
      var opacity = abs === 1 ? 0.55 : (abs === 2 ? 0.28 : 0.12)

      card.style.opacity = opacity
      card.style.pointerEvents = 'auto'
      card.style.zIndex = String(10 - abs)
      card.style.transform =
        'translate(-50%, -50%) ' +
        'translateX(' + x + 'px) ' +
        'translateZ(' + z + 'px) ' +
        'rotateY(' + rotY + 'deg) ' +
        'scale(' + scale + ')'

      card.classList.remove('is-active')
    })

    if (typeof updateArrows === 'function') updateArrows()
  }

  // ============ 收起:叠成一摞扑克牌 ============
  function collapse() {
    expanded = false
    grid.classList.remove('deck-expanded')

    cards.forEach(function (card, i) {
      var offset = i - selectedIndex
      var abs = Math.abs(offset)

      if (offset === 0) {
        // 中心牌:完全不虚化
        card.style.opacity = '1'
        card.style.pointerEvents = 'auto'
        card.style.transform = 'translate(-50%, -50%)'
        card.style.zIndex = '10'
        card.classList.add('is-active')
        return
      }

      if (abs > 4) {
        card.style.opacity = '0'
        card.style.pointerEvents = 'none'
        card.style.transform =
          'translate(-50%, -50%) translateZ(' + (-abs * 5) + 'px) scale(0.9)'
        card.style.zIndex = '0'
        card.classList.remove('is-active')
        return
      }

      var x = offset * 3
      var y = -abs * 1.5
      var z = -abs * 6
      var scale = 1 - abs * 0.03
      var opacity = abs === 1 ? 0.55 : (abs === 2 ? 0.28 : 0.12)

      card.style.opacity = opacity
      card.style.pointerEvents = 'auto'
      card.style.zIndex = String(10 - abs)
      card.style.transform =
        'translate(-50%, -50%) ' +
        'translateX(' + x + 'px) ' +
        'translateY(' + y + 'px) ' +
        'translateZ(' + z + 'px) ' +
        'scale(' + scale + ')'

      card.classList.remove('is-active')
    })

    if (typeof updateArrows === 'function') updateArrows()
  }

  // ============ 给每张牌分配背景图(从 banner 池) ============
  function assignCardBackgrounds() {
    if (!window.BANNER_LIST || window.BANNER_LIST.length === 0) return

    var altMode = document.documentElement.classList.contains('alt-mode')
    var pool = window.BANNER_LIST.filter(function (i) {
      return altMode ? true : i.safe
    })
    if (pool.length === 0) pool = window.BANNER_LIST.slice()

    // alt-mode 下,如果 unsafe 池非空,100% 用 unsafe 池
    if (altMode) {
      var unsafePool = window.BANNER_LIST.filter(function (i) { return !i.safe })
      if (unsafePool.length > 0) {
        pool = unsafePool
      }
    }

    var verticalPool = pool.filter(function (i) { return !i.wide })

    cards.forEach(function (card) {
      // 75% 概率优先纵向图,25% 任意(纵向池为空时回退到全部)
      var preferVertical = Math.random() < 0.75
      var subPool = (preferVertical && verticalPool.length > 0) ? verticalPool : pool
      var pick = subPool[Math.floor(Math.random() * subPool.length)]
      if (pick.enc && window.NsfwCrypt) {
        // 加密条目:解密成 blob URL 再上背景(失败则保持无图)
        window.NsfwCrypt.decrypt(pick).then(function (blobUrl) {
          if (blobUrl && deckMode) card.style.backgroundImage = 'url("' + blobUrl + '")'
        })
      } else {
        card.style.backgroundImage = 'url("' + pick.url + '")'
      }
    })
  }

  function clearCardBackgrounds() {
    cards.forEach(function (card) {
      card.style.backgroundImage = ''
    })
  }

  // ============ 切换网格 / 选牌模式 ============
  function setDeckMode(on) {
    deckMode = on
    if (on) {
      grid.classList.add('deck-mode')
      assignCardBackgrounds()
      collapse()  // 默认叠起
      if (toggleBtn) toggleBtn.textContent = '回到网格'
    } else {
      grid.classList.remove('deck-mode', 'deck-expanded')
      cards.forEach(function (c) {
        c.style.transform = ''
        c.style.opacity = ''
        c.style.pointerEvents = ''
        c.style.zIndex = ''
        c.classList.remove('is-active')
      })
      clearCardBackgrounds()
      if (toggleBtn) toggleBtn.textContent = '进入选牌模式'
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      setDeckMode(!deckMode)
    })
  }

  // ============ 左右切换箭头(动态创建,只在 deck-mode 显示) ============
  var leftArrow = document.createElement('button')
  leftArrow.className = 'deck-arrow deck-arrow--left'
  leftArrow.setAttribute('aria-label', '上一张')
  leftArrow.innerHTML = '<i class="fas fa-chevron-left"></i>'

  var rightArrow = document.createElement('button')
  rightArrow.className = 'deck-arrow deck-arrow--right'
  rightArrow.setAttribute('aria-label', '下一张')
  rightArrow.innerHTML = '<i class="fas fa-chevron-right"></i>'

  grid.appendChild(leftArrow)
  grid.appendChild(rightArrow)

  function updateArrows() {
    leftArrow.classList.toggle('is-disabled', selectedIndex === 0)
    rightArrow.classList.toggle('is-disabled', selectedIndex === cards.length - 1)
  }

  leftArrow.addEventListener('click', function (e) {
    e.preventDefault()
    e.stopPropagation()
    if (!deckMode || selectedIndex === 0) return
    selectedIndex--
    if (expanded) render(); else collapse()
    updateArrows()
  })

  rightArrow.addEventListener('click', function (e) {
    e.preventDefault()
    e.stopPropagation()
    if (!deckMode || selectedIndex === cards.length - 1) return
    selectedIndex++
    if (expanded) render(); else collapse()
    updateArrows()
  })

  // ============ 鼠标悬停展开 / 离开收起 ============
  grid.addEventListener('mouseenter', function () {
    if (!deckMode) return
    expanded = true
    grid.classList.add('deck-expanded')
    render()
    if (typeof updateArrows === 'function') updateArrows()
  })

  grid.addEventListener('mouseleave', function () {
    if (!deckMode) return
    collapse()
    if (typeof updateArrows === 'function') updateArrows()
  })

  // ============ 卡片点击 ============
  // suppressNextClick:拖动刚结束时浏览器仍会触发 click,用此标志抑制
  var suppressNextClick = false

  cards.forEach(function (card, i) {
    card.addEventListener('click', function (e) {
      if (!deckMode) return  // 网格模式正常跳转
      e.preventDefault()
      if (suppressNextClick) return  // 拖动刚结束,这次 click 是误触发,跳过
      if (i === selectedIndex) {
        window.location.href = card.href
      } else {
        selectedIndex = i
        if (expanded) render()
        else collapse()
      }
    })
  })

  // ============ 键盘左右箭头 ============
  document.addEventListener('keydown', function (e) {
    if (!deckMode) return
    if (e.key === 'ArrowLeft' && selectedIndex > 0) {
      selectedIndex--
      expanded ? render() : collapse()
    } else if (e.key === 'ArrowRight' && selectedIndex < cards.length - 1) {
      selectedIndex++
      expanded ? render() : collapse()
    }
  })

  // ============ 鼠标拖拽(展开状态下) ============
  var dragStart = null
  var DRAG_THRESHOLD = 60

  grid.addEventListener('mousedown', function (e) {
    if (!deckMode || !expanded) return
    dragStart = { x: e.clientX, moved: false }
    grid.classList.add('is-dragging')   // 拖动期间禁用 transition
    e.preventDefault()
  })

  document.addEventListener('mousemove', function (e) {
    if (!dragStart) return
    var dx = e.clientX - dragStart.x
    if (Math.abs(dx) > DRAG_THRESHOLD && !dragStart.moved) {
      dragStart.moved = true
      suppressNextClick = true   // 触发了拖动,抑制后续 click
      if (dx > 0 && selectedIndex > 0) {
        selectedIndex--
        render()
      } else if (dx < 0 && selectedIndex < cards.length - 1) {
        selectedIndex++
        render()
      }
      dragStart.x = e.clientX
      dragStart.moved = false
    }
  })

  document.addEventListener('mouseup', function () {
    if (dragStart) {
      grid.classList.remove('is-dragging')  // 松开后恢复 transition
    }
    if (suppressNextClick) {
      setTimeout(function () { suppressNextClick = false }, 150)
    }
    dragStart = null
  })

  // ============ 触摸滑动 ============
  var touchStart = null

  grid.addEventListener('touchstart', function (e) {
    if (!deckMode) return
    touchStart = { x: e.touches[0].clientX, moved: false }
    if (!expanded) {
      expanded = true
      grid.classList.add('deck-expanded')
      render()
    }
  }, { passive: true })

  grid.addEventListener('touchmove', function (e) {
    if (!touchStart) return
    var dx = e.touches[0].clientX - touchStart.x
    if (Math.abs(dx) > DRAG_THRESHOLD && !touchStart.moved) {
      touchStart.moved = true
      if (dx > 0 && selectedIndex > 0) {
        selectedIndex--
        render()
      } else if (dx < 0 && selectedIndex < cards.length - 1) {
        selectedIndex++
        render()
      }
      touchStart.x = e.touches[0].clientX
      touchStart.moved = false
    }
  }, { passive: true })

  grid.addEventListener('touchend', function () {
    touchStart = null
  })
})()
