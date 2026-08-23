/**
 * 随机 banner filter
 *
 * 两个图池:
 *   - source/img/bg/safe/        — 明文 SFW 图,对外公开,light 模式可见
 *   - source/img/bg/unsafe_enc/  — 加密 NSFW 图(文件名为内容 hash),仅本地 alt-mode 解密
 *     明文库在仓库根 nsfw_plain/unsafe/,由 scripts/nsfw_crypto.py 管理,不进站点。
 *
 * safe 用 image-size 读宽高;unsafe_enc 宽高来自加密时写入的 _meta.json。
 * 输出 window.BANNER_LIST,条目 { url, w, h, wide, safe, enc }。
 * 加密条目由前端 source/js/nsfw-decrypt.js 用 WebCrypto 解密,密码在浏览器端输入。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { imageSize } = require('image-size')

const IMG_RE = /\.(png|jpe?g|gif|svg|webp)$/i

function scanSafe(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => IMG_RE.test(f))
    .map(f => {
      const abs = path.join(dir, f)
      let w = 0, h = 0
      try {
        const dim = imageSize(fs.readFileSync(abs))
        w = dim.width  || 0
        h = dim.height || 0
      } catch (e) { /* 忽略 */ }
      return {
        url: `/img/bg/safe/${encodeURI(f)}`,
        w, h,
        wide: w > 0 && h > 0 && (w / h) >= 1.5,
        safe: true,
        enc: false
      }
    })
}

function scanUnsafeEnc(dir) {
  if (!fs.existsSync(dir)) return []
  let meta = {}
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8')) } catch (e) { /* no */ }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.bin'))
    .map(f => {
      const hash = f.slice(0, -4)
      const m = meta[hash] || {}
      const w = m.w || 0, h = m.h || 0
      return {
        url: `/img/bg/unsafe_enc/${hash}.bin`,
        w, h,
        wide: w > 0 && h > 0 && (w / h) >= 1.5,
        safe: false,
        enc: true
      }
    })
}

hexo.extend.filter.register('before_generate', () => {
  const baseDir = path.join(hexo.source_dir, 'img/bg')
  const items = [
    ...scanSafe(path.join(baseDir, 'safe')),
    ...scanUnsafeEnc(path.join(baseDir, 'unsafe_enc'))
  ]

  if (items.length === 0) {
    hexo.log.warn(`[random-banner] ${baseDir}/{safe,unsafe_enc} 里没有图片`)
    return
  }

  const newList = `window.BANNER_LIST = ${JSON.stringify(items)};`
  const targetPath = path.join(hexo.source_dir, 'js/banner-list.js')
  let oldList = ''
  try { oldList = fs.readFileSync(targetPath, 'utf8') } catch (e) { /* no */ }

  if (oldList !== newList) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, newList)
    const safeN  = items.filter(i => i.safe).length
    const unsafeN = items.length - safeN
    const wideN  = items.filter(i => i.wide).length
    hexo.log.info(`[random-banner] 图列表已更新: safe ${safeN} + unsafe(加密) ${unsafeN} = ${items.length}(横向 ${wideN})`)
  }
})
