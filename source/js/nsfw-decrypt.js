/**
 * 加密 banner 解密工具(浏览器端)
 *
 * 配套 scripts/nsfw_crypto.py 的 .bin 格式:
 *   [5B "NSFW1"][16B salt][12B nonce][AES-GCM ct]
 *   明文 payload = JSON {"n": 文件名, "d": base64 图片字节}
 * 密钥: PBKDF2-SHA256(密码, salt, 200000) -> AES-GCM 256
 *
 * 密码第一次访问时输入一次,存 localStorage(只存在本机浏览器)。
 * 解密后的 blob URL 按图缓存,同页重复使用不再解密。
 */
(function () {
  var KEY_FIELD = 'banner-crypt-key'
  var urlCache = {}          // item.url -> blob url
  var pendingPwd = null      // 防止多个调用方同时弹 prompt
  var refused = false        // 用户取消过输入,本页不再打扰

  function askPwd() {
    if (pendingPwd) return pendingPwd
    pendingPwd = new Promise(function (resolve) {
      var input = window.prompt('banner 图已加密,请输入访问密码:')
      resolve(input || '')
    }).then(function (v) {
      pendingPwd = null
      if (!v) refused = true  // 取消:本页后续 decrypt 直接放弃
      return v
    })
    return pendingPwd
  }

  function getPwd() {
    var p = localStorage.getItem(KEY_FIELD)
    if (p) return Promise.resolve(p)
    if (refused) return Promise.resolve('')
    return askPwd()
  }

  function deriveKey(pwd, salt) {
    if (!window.crypto || !crypto.subtle) return Promise.reject('no-webcrypto')
    return crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']
    ).then(function (km) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
      )
    })
  }

  function b64ToBuf(b64) {
    var bin = atob(b64)
    var buf = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return buf
  }

  function decryptBuf(pwd, raw) {
    if (raw[0] !== 0x4E || raw[1] !== 0x53 || raw[2] !== 0x46 || raw[3] !== 0x57 || raw[4] !== 0x31) {
      return Promise.reject('bad-format')
    }
    var salt = raw.slice(5, 21)
    var nonce = raw.slice(21, 33)
    var ct = raw.slice(33)
    return deriveKey(pwd, salt).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct)
    }).then(function (plain) {
      var obj = JSON.parse(new TextDecoder().decode(plain))
      var bytes = b64ToBuf(obj.d)
      // 文件名后缀判断 mime,解不出就用通用二进制(浏览器对 background-image 一般也能容错)
      var ext = (obj.n || '').split('.').pop().toLowerCase()
      var mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext] || 'image/png'
      var blob = new Blob([bytes], { type: mime })
      return URL.createObjectURL(blob)
    })
  }

  /** 用给定密码解密;成功时才把密码存入 localStorage */
  function tryDecrypt(pwd, raw) {
    return decryptBuf(pwd, raw).then(function (blobUrl) {
      try { localStorage.setItem(KEY_FIELD, pwd) } catch (e) { /* ignore */ }
      return blobUrl
    })
  }

  /**
   * item: BANNER_LIST 条目 { url, enc }
   * 返回 Promise<string|null> — blob url;取消或失败返回 null
   * 密码错会清掉存的密码并再问一次,仍错则放弃(本次不banner)
   */
  function decrypt(item) {
    if (!item || !item.url) return Promise.resolve(null)
    if (!item.enc) return Promise.resolve(item.url)
    if (urlCache[item.url]) return Promise.resolve(urlCache[item.url])

    return fetch(item.url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status)
      return r.arrayBuffer()
    }).then(function (ab) {
      var raw = new Uint8Array(ab)
      return getPwd().then(function (pwd) {
        if (!pwd) return null
        return tryDecrypt(pwd, raw).catch(function (err) {
          if (err === 'bad-format' || err === 'no-webcrypto') return null
          // 密码大概率错了:清掉重问一次(错密码不落盘)
          console.warn('[nsfw-decrypt] 解密失败,密码可能错误,重新询问')
          localStorage.removeItem(KEY_FIELD)
          return getPwd().then(function (pwd2) {
            if (!pwd2) return null
            return tryDecrypt(pwd2, raw).catch(function () {
              localStorage.removeItem(KEY_FIELD)
              return null
            })
          })
        })
      })
    }).then(function (blobUrl) {
      if (blobUrl) urlCache[item.url] = blobUrl
      return blobUrl
    }).catch(function (e) {
      console.warn('[nsfw-decrypt] ' + e)
      return null
    })
  }

  window.NsfwCrypt = { decrypt: decrypt }
})()
