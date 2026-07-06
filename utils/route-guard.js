/**
 * 路由守卫工具
 * 防止快速连击、WebView 竞态、页面卸载后跳转等问题
 */

// 路由锁，防止快速连击（基于 URL 的节流）
const lastNavigateTimeByUrl = new Map()
const NAVIGATE_THROTTLE = 300 // 300ms 防抖

// 正在跳转的页面集合
const navigatingPages = new Set()

/**
 * 安全导航跳转 (navigateTo)
 * @param {string} url 目标页面路径
 * @param {string} pageKey 页面标识，用于去重
 * @returns {boolean} 是否成功发起跳转
 */
function safeNavigateTo(url, pageKey = url) {
  const now = Date.now()
  const lastTime = lastNavigateTimeByUrl.get(url) || 0

  // 基于 URL 的节流保护：同一个 URL 300ms 内不重复跳转
  if (now - lastTime < NAVIGATE_THROTTLE) {
    console.warn(`[RouteGuard] 跳转过于频繁，已忽略: ${url}`)
    return false
  }
  lastNavigateTimeByUrl.set(url, now)

  // 防止重复跳转
  if (navigatingPages.has(pageKey)) {
    console.warn(`[RouteGuard] 页面 ${pageKey} 正在跳转中，忽略重复请求`)
    return false
  }

  navigatingPages.add(pageKey)

  wx.navigateTo({
    url,
    fail: (err) => {
      navigatingPages.delete(pageKey)

      // 忽略 WebView 已销毁的错误（routeDone not found）
      if (err.errMsg && (
        err.errMsg.includes('webview') ||
        err.errMsg.includes('routeDone') ||
        err.errMsg.includes('not found')
      )) {
        console.warn(`[RouteGuard] WebView 已销毁，跳过: ${url}`)
        return
      }

      console.error(`[RouteGuard] navigateTo 失败:`, err)
      wx.showToast({
        title: '页面跳转失败',
        icon: 'none'
      })
    }
  })

  // 设置超时自动清理标记，防止意外情况
  setTimeout(() => {
    navigatingPages.delete(pageKey)
  }, 2000)

  return true
}

/**
 * 安全重定向跳转 (redirectTo)
 * @param {string} url 目标页面路径
 * @returns {boolean} 是否成功发起跳转
 */
function safeRedirectTo(url) {
  const now = Date.now()
  const lastTime = lastNavigateTimeByUrl.get(url) || 0

  if (now - lastTime < NAVIGATE_THROTTLE) {
    console.warn(`[RouteGuard] 跳转过于频繁，已忽略: ${url}`)
    return false
  }
  lastNavigateTimeByUrl.set(url, now)

  wx.redirectTo({
    url,
    fail: (err) => {
      if (err.errMsg && (
        err.errMsg.includes('webview') ||
        err.errMsg.includes('routeDone') ||
        err.errMsg.includes('not found')
      )) {
        console.warn(`[RouteGuard] WebView 已销毁，跳过: ${url}`)
        return
      }
      console.error(`[RouteGuard] redirectTo 失败:`, err)
    }
  })

  return true
}

/**
 * 安全切换 Tab (switchTab)
 * @param {string} url tabBar 页面路径
 * @returns {boolean} 是否成功发起跳转
 */
function safeSwitchTab(url) {
  const now = Date.now()
  const lastTime = lastNavigateTimeByUrl.get(url) || 0

  if (now - lastTime < NAVIGATE_THROTTLE) {
    console.warn(`[RouteGuard] 跳转过于频繁，已忽略: ${url}`)
    return false
  }
  lastNavigateTimeByUrl.set(url, now)

  wx.switchTab({
    url,
    fail: (err) => {
      // switchTab 通常不会遇到 webview 问题，但保留容错
      if (!err.errMsg.includes('tabbar')) {
        console.error(`[RouteGuard] switchTab 失败:`, err)
      }
    }
  })

  return true
}

/**
 * 安全重新启动页面 (reLaunch)
 * @param {string} url 目标页面路径
 * @returns {boolean} 是否成功发起跳转
 */
function safeReLaunch(url) {
  const now = Date.now()
  const lastTime = lastNavigateTimeByUrl.get(url) || 0

  if (now - lastTime < NAVIGATE_THROTTLE) {
    console.warn(`[RouteGuard] 跳转过于频繁，已忽略: ${url}`)
    return false
  }
  lastNavigateTimeByUrl.set(url, now)

  wx.reLaunch({
    url,
    fail: (err) => {
      if (err.errMsg && (
        err.errMsg.includes('webview') ||
        err.errMsg.includes('routeDone')
      )) {
        console.warn(`[RouteGuard] WebView 已销毁，跳过: ${url}`)
        return
      }
      console.error(`[RouteGuard] reLaunch 失败:`, err)
    }
  })

  return true
}

/**
 * 带页面实例检查的安全跳转
 * @param {Object} page 页面实例 (this)
 * @param {string} url 目标页面路径
 * @returns {boolean} 是否成功发起跳转
 */
function safeNavigateWithPageCheck(page, url) {
  // 检查页面实例是否有效
  if (!page || page.hasOwnProperty === undefined) {
    console.warn('[RouteGuard] 页面实例已失效，跳过跳转')
    return false
  }

  // 检查页面路由是否仍然存在
  if (!page.route) {
    console.warn('[RouteGuard] 页面 route 已丢失，跳过跳转')
    return false
  }

  return safeNavigateTo(url, page.route)
}

/**
 * 带页面实例检查的安全重定向
 * @param {Object} page 页面实例 (this)
 * @param {string} url 目标页面路径
 * @returns {boolean} 是否成功发起跳转
 */
function safeRedirectWithPageCheck(page, url) {
  if (!page || page.hasOwnProperty === undefined) {
    console.warn('[RouteGuard] 页面实例已失效，跳过重定向')
    return false
  }

  if (!page.route) {
    console.warn('[RouteGuard] 页面 route 已丢失，跳过重定向')
    return false
  }

  return safeRedirectTo(url)
}

/**
 * 清理指定页面的跳转标记
 * @param {string} pageKey 页面标识
 */
function clearNavigateFlag(pageKey) {
  navigatingPages.delete(pageKey)
}

/**
 * 获取当前是否有页面正在跳转
 * @returns {boolean}
 */
function isNavigating() {
  return navigatingPages.size > 0
}

/**
 * 安全返回上一页 (navigateBack)
 * 使用独立节流键避免与其他导航操作冲突；检查路由栈避免空栈调用；
 * 失败时回退 switchTab / reLaunch 确保总能返回。
 * @param {string} [fallbackTabUrl] 当 navigateBack 失败时，回退到该 tabBar 页。
 * @returns {boolean} 是否成功发起返回
 */
function safeNavigateBack(fallbackTabUrl) {
  const now = Date.now()
  const backUrl = '__back_navigate__'
  const lastTime = lastNavigateTimeByUrl.get(backUrl) || 0

  if (now - lastTime < NAVIGATE_THROTTLE) {
    console.warn('[RouteGuard] 返回操作过于频繁，已忽略')
    return false
  }
  lastNavigateTimeByUrl.set(backUrl, now)

  const pages = getCurrentPages()
  if (pages.length <= 1) {
    // 路由栈只剩一个页面，navigateBack 无处可回
    if (fallbackTabUrl) {
      return safeSwitchTab(fallbackTabUrl)
    }
    // 没有 fallback 时尝试 reLaunch 到首页
    const routes = require('./routes')
    safeReLaunch(routes.home)
    return true
  }

  wx.navigateBack({
    fail: (err) => {
      if (err.errMsg && (
        err.errMsg.includes('webview') ||
        err.errMsg.includes('routeDone') ||
        err.errMsg.includes('not found')
      )) {
        console.warn('[RouteGuard] WebView 已销毁，跳过返回')
        return
      }
      console.error('[RouteGuard] navigateBack 失败:', err)
      // navigateBack 失败，尝试 switchTab 回退
      if (fallbackTabUrl) {
        safeSwitchTab(fallbackTabUrl)
      } else {
        const routes = require('./routes')
        safeSwitchTab(routes.home)
      }
    }
  })

  return true
}

module.exports = {
  safeNavigateTo,
  safeRedirectTo,
  safeSwitchTab,
  safeReLaunch,
  safeNavigateWithPageCheck,
  safeRedirectWithPageCheck,
  safeNavigateBack,
  clearNavigateFlag,
  isNavigating
}
