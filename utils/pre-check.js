/**
 * 页面预检查工具
 * 解决小程序预检查和抢占式缓存问题
 * 确保用户在进入特定页面之前满足必要的前置条件
 */

const { readStorage, STORAGE_KEYS } = require('../services/core')
const { getOnboardingState } = require('./onboarding-state')
const routes = require('./routes')
const {
  safeNavigateTo,
  safeRedirectTo,
  safeSwitchTab
} = require('./route-guard')

/**
 * 获取当前页面路径
 * @returns {string} 当前页面路径
 */
function getCurrentPagePath() {
  const pages = getCurrentPages()
  if (!pages || pages.length === 0) return ''
  const currentPage = pages[pages.length - 1]
  return currentPage ? currentPage.route : ''
}

/**
 * 跳转到指定页面（自动判断 tabBar）
 * @param {string} url 页面路径
 * @param {boolean} redirect 是否使用 redirectTo
 */
function goToPage(url, redirect = false) {
  if (redirect) {
    safeRedirectTo(url)
  } else {
    const tabRoutes = [routes.home, routes.trend, routes.family, routes.me]
    if (tabRoutes.includes(url)) {
      safeSwitchTab(url)
    } else {
      safeNavigateTo(url)
    }
  }
}

/**
 * 检查隐私协议是否已确认
 * @returns {boolean} true 表示已确认
 */
function checkPrivacyAgreed() {
  const privacy = readStorage(STORAGE_KEYS.privacySettings, null)
  
  // 防御性检查：支持多种可能的存储结构
  if (!privacy) {
    console.warn('[PreCheck] 隐私设置数据为空')
    return false
  }
  
  // 检查 agreedAt（时间戳格式）
  if (privacy.agreedAt) {
    return true
  }
  
  // 兼容旧数据：只检查 agreed 布尔值
  if (privacy.agreed === true) {
    return true
  }
  
  console.warn('[PreCheck] 隐私协议未确认或数据格式异常', { privacyKeys: Object.keys(privacy) })
  return false
}

/**
 * 检查基础资料是否已设置
 * @returns {boolean} true 表示已设置
 */
function checkProfileSetup() {
  const profile = readStorage(STORAGE_KEYS.profile, null)
  
  // 防御性检查：支持多种可能的数据结构
  // 1. 标准结构: profile.profile.name
  // 2. 扁平结构: profile.name
  // 3. 兼容旧数据: name
  let name = ''
  if (profile) {
    name = profile.profile?.name || profile.name || profile.profileName || ''
  }
  
  if (!name || !name.trim()) {
    console.warn('[PreCheck] 基础资料未设置或姓名为空', { name, profileKeys: profile ? Object.keys(profile) : [] })
    return false
  }
  return true
}

/**
 * 检查隐私协议（未确认则跳转）
 * @param {Object} options 配置选项
 * @param {boolean} options.redirect 是否使用 redirect（防止回退）
 * @param {string} options.fromPage 来源页面路径
 * @returns {boolean} true 表示检查通过
 */
function ensurePrivacyAgreed(options = {}) {
  const { redirect = false, fromPage = '' } = options

  if (!checkPrivacyAgreed()) {
    console.warn('[PreCheck] 隐私协议未确认，跳转到隐私页', { fromPage })
    goToPage(routes.privacy, redirect)
    return false
  }
  return true
}

/**
 * 检查基础资料（未设置则跳转）
 * @param {Object} options 配置选项
 * @param {boolean} options.redirect 是否使用 redirect（防止回退）
 * @param {string} options.fromPage 来源页面路径
 * @returns {boolean} true 表示检查通过
 */
function ensureProfileSetup(options = {}) {
  const { redirect = false, fromPage = '' } = options

  if (!checkProfileSetup()) {
    console.warn('[PreCheck] 基础资料未设置，跳转到资料页', { fromPage })
    goToPage(routes.profile, redirect)
    return false
  }
  return true
}

/**
 * 组合预检查：先检查隐私，再检查资料
 * @param {Object} options 配置选项
 * @param {boolean} options.redirect 是否使用 redirect
 * @param {string} options.fromPage 来源页面
 * @returns {boolean} true 表示所有检查通过
 */
function ensureOnboarding(options = {}) {
  const { redirect = false, fromPage = '' } = options

  if (!checkPrivacyAgreed()) {
    console.warn('[PreCheck] 隐私协议未确认，跳转到隐私页', { fromPage })
    goToPage(routes.privacy, redirect)
    return false
  }

  if (!checkProfileSetup()) {
    console.warn('[PreCheck] 基础资料未设置，跳转到资料页', { fromPage })
    goToPage(routes.profile, redirect)
    return false
  }

  return true
}

async function ensureCloudOnboarding(options = {}) {
  const { redirect = false, fromPage = '', requireProfile = true, shouldSkip } = options
  const state = await getOnboardingState()

  // 异步回调中：如果用户已离开发起检查的页面，放弃跳转
  if (shouldSkip && shouldSkip()) {
    console.info('[PreCheck] 用户已离开原页面，取消预检查跳转')
    return true
  }

  if (!state.privacyAgreed) {
    // 云端因写后读延迟可能返回旧数据，回退检查本地存储
    if (checkPrivacyAgreed()) {
      console.info('[PreCheck] 云端隐私未同意但本地已同意，视为已同意（写后读延迟）')
    } else {
      // 跳转前再检查：用户可能已离开
      if (shouldSkip && shouldSkip()) {
        console.info('[PreCheck] 用户已离开原页面，取消预检查跳转')
        return true
      }
      console.warn('[PreCheck] 云端隐私协议未确认，跳转到隐私页', { fromPage })
      goToPage(routes.privacy, redirect)
      return false
    }
  }

  if (requireProfile && !state.profileReady) {
    // 云端因写后读延迟可能返回旧数据，回退检查本地存储
    if (checkProfileSetup()) {
      console.info('[PreCheck] 云端资料未就绪但本地已有资料，视为已设置（写后读延迟）')
      return true
    }

    // 再次检查：在两次判断之间用户可能已离开
    if (shouldSkip && shouldSkip()) {
      console.info('[PreCheck] 用户已离开原页面，取消预检查跳转')
      return true
    }

    console.warn('[PreCheck] 云端基础资料未设置，跳转到资料页', { fromPage })
    goToPage(routes.profile, redirect)
    return false
  }

  return true
}

/**
 * 获取需要预检查的页面列表
 * 需要用户完成 onboarding 才能访问
 */
const PROTECTED_PAGES = [
  'pages/home/index',
  'pages/family-sub/home-family/index',
  'pages/trend/index',
  'pages/record/record-bp/index',
  'pages/record/record-bg/index',
  'pages/record/record-list/index',
  'pages/record/record-detail/index',
  'pages/medication/med-list/index',
  'pages/medication/med-edit/index',
  'pages/medication/med-confirm/index',
  'pages/family/index',
  'pages/family-sub/family-invite/index',
  'pages/family-sub/family-join/index',
  'pages/family-sub/family-auth/index',
  'pages/reminder/reminder/index',
  'pages/me/index',
  'pages/reminder/reminder-settings/index',
  'pages/settings/privacy-settings/index',
  'pages/data/data/index',
  'pages/settings/help/index',
  'pages/settings/feedback/index'
]

const PRIVACY_FREE_PAGES = [
  'pages/settings/privacy/index',
  'pages/settings/privacy-detail/index',
  'pages/settings/privacy-policy/index',
  'pages/settings/user-agreement/index'
]

const PROFILE_FREE_PAGES = [
  ...PRIVACY_FREE_PAGES,
  'pages/settings/role/index',
  'pages/settings/profile/index',
  'pages/family-sub/family-join-hint/index',
  'pages/family-sub/family-join/index'
]

/**
 * 检查页面是否需要预检查
 * @param {string} pagePath 页面路径
 * @returns {boolean} true 表示需要预检查
 */
function isProtectedPage(pagePath) {
  return PROTECTED_PAGES.some(page => pagePath.includes(page))
}

function isPrivacyFreePage(pagePath) {
  return PRIVACY_FREE_PAGES.some(page => pagePath.includes(page))
}

function isProfileFreePage(pagePath) {
  return PROFILE_FREE_PAGES.some(page => pagePath.includes(page))
}

/**
 * 在 onShow 中自动执行预检查
 * @param {Object} page 页面实例
 * @param {Object} options 预检查选项
 * @returns {boolean} true 表示检查通过，false 表示已跳转
 */
function autoPreCheck(page, options = {}) {
  const pagePath = getCurrentPagePath()

  if (isPrivacyFreePage(pagePath)) {
    return true
  }

  // 只对受保护页面执行预检查
  if (!isProtectedPage(pagePath) && !isProfileFreePage(pagePath)) {
    return true
  }

  // 获取来源页面（用于日志）
  const pages = getCurrentPages()
  const fromPage = pages.length > 1 ? pages[pages.length - 2] : null
  const fromPath = fromPage ? fromPage.route : ''

  // 记录发起检查时的页面路径，异步回调中验证用户是否仍在原页面
  const checkOriginPath = pagePath

  ensureCloudOnboarding({
    redirect: false,
    requireProfile: !isProfileFreePage(pagePath),
    fromPage: fromPath,
    // 异步回调中检查：如果用户已离开发起检查的页面，则放弃跳转
    shouldSkip: () => getCurrentPagePath() !== checkOriginPath,
    ...options
  }).catch((error) => {
    console.error('[PreCheck] 云端预检查失败', error)
    wx.showToast({
      title: '云端状态检查失败',
      icon: 'none'
    })
  })

  return true
}

module.exports = {
  checkPrivacyAgreed,
  checkProfileSetup,
  ensurePrivacyAgreed,
  ensureProfileSetup,
  ensureOnboarding,
  ensureCloudOnboarding,
  autoPreCheck,
  isProtectedPage,
  isPrivacyFreePage,
  isProfileFreePage,
  PROTECTED_PAGES,
  getCurrentPagePath,
  goToPage
}
