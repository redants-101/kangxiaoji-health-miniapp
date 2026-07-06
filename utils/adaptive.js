/**
 * 小程序适配辅助能力。
 * 负责根据微信字体档位和窗口宽度生成页面可直接使用的适配状态。
 */

function readAppBaseInfo() {
  if (typeof wx === 'undefined') return {}
  if (wx.getAppBaseInfo) {
    try {
      return wx.getAppBaseInfo()
    } catch (error) {
      return {}
    }
  }
  if (wx.getSystemInfoSync) {
    try {
      return wx.getSystemInfoSync()
    } catch (error) {
      return {}
    }
  }
  return {}
}

function readWindowWidth() {
  if (typeof wx === 'undefined') return 375
  if (wx.getWindowInfo) {
    try {
      const info = wx.getWindowInfo()
      if (info && info.windowWidth) return info.windowWidth
    } catch (error) {
      // ignore
    }
  }
  if (wx.getSystemInfoSync) {
    try {
      const info = wx.getSystemInfoSync()
      if (info && info.windowWidth) return info.windowWidth
    } catch (error) {
      // ignore
    }
  }
  return 375
}

function toNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveScaleClass(fontScaleFactor, fontSizeSetting) {
  if (fontScaleFactor >= 1.3 || fontSizeSetting >= 22) {
    return 'ui-scale-elder'
  }
  if (fontScaleFactor >= 1.12 || fontSizeSetting >= 18) {
    return 'ui-scale-large'
  }
  return 'ui-scale-normal'
}

function resolveLayoutClass(windowWidth) {
  if (windowWidth >= 960) return 'layout-wide'
  if (windowWidth >= 680) return 'layout-medium'
  return 'layout-compact'
}

/**
 * 构建自适应状态对象，根据窗口宽度和字体设置生成适配信息
 * @param {number} [windowWidth] - 可选的窗口宽度值，未提供时从缓存读取
 * @returns {Object} 包含 adaptive 字段的状态对象
 * @returns {number} returns.adaptive.fontSizeSetting - 字体大小设置值（默认17）
 * @returns {number} returns.adaptive.fontSizeScaleFactor - 字体缩放因子
 * @returns {number} returns.adaptive.windowWidth - 安全的窗口宽度值
 * @returns {string} returns.adaptive.scaleClass - 字体缩放样式类名
 * @returns {string} returns.adaptive.layoutClass - 布局样式类名
 * @returns {boolean} returns.adaptive.isLargeText - 是否为大字体模式
 * @returns {boolean} returns.adaptive.isElderText - 是否为老年人大字体模式
 * @returns {boolean} returns.adaptive.isMediumScreen - 是否为中等屏幕尺寸
 * @returns {boolean} returns.adaptive.isWideScreen - 是否为宽屏尺寸
 */
function buildAdaptiveState(windowWidth) {
  const appBaseInfo = readAppBaseInfo()
  const safeWindowWidth = toNumber(windowWidth, readWindowWidth())
  const fontSizeSetting = toNumber(appBaseInfo.fontSizeSetting, 17)
  const fontSizeScaleFactor = toNumber(appBaseInfo.fontSizeScaleFactor, fontSizeSetting / 17)
  const scaleClass = resolveScaleClass(fontSizeScaleFactor, fontSizeSetting)
  const layoutClass = resolveLayoutClass(safeWindowWidth)

  return {
    adaptive: {
      fontSizeSetting,
      fontSizeScaleFactor,
      windowWidth: safeWindowWidth,
      scaleClass,
      layoutClass,
      isLargeText: scaleClass !== 'ui-scale-normal',
      isElderText: scaleClass === 'ui-scale-elder',
      isMediumScreen: layoutClass === 'layout-medium',
      isWideScreen: layoutClass === 'layout-wide'
    }
  }
}

function applyAdaptiveState(page, windowWidth) {
  const state = buildAdaptiveState(windowWidth)
  if (page && typeof page.setData === 'function') {
    page.setData(state)
  }
  return state
}

function bindAdaptiveResize(page) {
  applyAdaptiveState(page)
  if (!page || typeof wx === 'undefined' || !wx.onWindowResize || page.__adaptiveResizeHandler) {
    return
  }

  const handler = (result = {}) => {
    const nextWidth = result && result.size ? result.size.windowWidth : undefined
    const state = buildAdaptiveState(nextWidth)
    page.setData(state)
    if (typeof page.onAdaptiveChange === 'function') {
      page.onAdaptiveChange(state)
    }
  }

  page.__adaptiveResizeHandler = handler
  wx.onWindowResize(handler)
}

function unbindAdaptiveResize(page) {
  if (!page || !page.__adaptiveResizeHandler || typeof wx === 'undefined' || !wx.offWindowResize) {
    return
  }
  wx.offWindowResize(page.__adaptiveResizeHandler)
  page.__adaptiveResizeHandler = null
}

module.exports = {
  applyAdaptiveState,
  bindAdaptiveResize,
  buildAdaptiveState,
  unbindAdaptiveResize
}
