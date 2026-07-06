const routes = require('./routes')
const {
  applyAdaptiveState,
  bindAdaptiveResize,
  buildAdaptiveState,
  unbindAdaptiveResize
} = require('./adaptive')
const { autoPreCheck } = require('./pre-check')
const {
  safeNavigateTo,
  safeRedirectTo,
  safeSwitchTab,
  safeNavigateWithPageCheck,
  safeRedirectWithPageCheck,
  safeNavigateBack
} = require('./route-guard')

// 请求去重：记录正在进行的页面加载
const pendingPageLoads = new Map()

/**
 * 统一页面跳转方法。
 * @param {string} routeKey routes.js 中定义的路由键名。
 * @returns {void} 无返回值；内部根据目标页面类型调用 wx.switchTab 或 wx.navigateTo。
 */
function goRoute(routeKey) {
  const url = routes[routeKey]
  if (!url) {
    wx.showToast({
      title: '页面暂未配置',
      icon: 'none'
    })
    return
  }

  // tabBar 页面必须使用 switchTab，普通页面使用 navigateTo。
  const tabRoutes = [routes.home, routes.trend, routes.family, routes.me]
  if (tabRoutes.includes(url)) {
    safeSwitchTab(url)
    return
  }

  safeNavigateTo(url)
}

/**
 * 统一页面替换跳转方法。
 * @param {string} routeKey routes.js 中定义的路由键名。
 * @returns {void} 非 tabBar 页面使用 redirectTo，tabBar 页面仍使用 switchTab。
 */
function redirectRoute(routeKey) {
  const url = routes[routeKey]
  if (!url) {
    wx.showToast({
      title: '页面暂未配置',
      icon: 'none'
    })
    return
  }

  const tabRoutes = [routes.home, routes.trend, routes.family, routes.me]
  if (tabRoutes.includes(url)) {
    safeSwitchTab(url)
    return
  }

  safeRedirectTo(url)
}

/**
 * 统一页面数据加载状态。
 * @param {Object} page 页面实例。
 * @param {Function} loader 返回页面数据对象的异步方法。
 * @param {string} pageKey 页面唯一标识，用于请求去重
 * @returns {Promise<Object|null>} 成功返回数据对象，失败返回 null。
 */
async function loadPageData(page, loader, pageKey = '') {
  const pagePath = page && page.route ? page.route : (pageKey || 'unknown')
  const loadKey = `${pagePath}_${Date.now()}`

  // 记录当前加载实例（允许并发加载，仅最新实例的数据会写入页面）
  pendingPageLoads.set(pagePath, loadKey)

  const adaptiveState = buildAdaptiveState()
  try {
    page.setData({
      ...adaptiveState,
      isLoading: true,
      loadError: ''
    })
  } catch (e) {
    // 页面可能在 setData 前已销毁（快速返回），直接清理
    if (pendingPageLoads.get(pagePath) === loadKey) {
      pendingPageLoads.delete(pagePath)
    }
    return null
  }

  try {
    // 等待云环境初始化完成后再调用 loader，避免 LifeCycle.load 竞态错误
    const app = getApp()
    if (app && app.globalData && app.globalData.cloudReady) {
      await app.globalData.cloudReady
    }
    const data = await loader()

    // 仅当本次加载仍是该页面最新实例时才写入数据，避免旧请求覆盖新数据
    if (pendingPageLoads.get(pagePath) === loadKey) {
      try {
        page.setData({
          ...adaptiveState,
          ...data,
          isLoading: false,
          loadError: '',
          _loaded: true
        })
      } catch (e) {
        // 页面可能已被销毁，忽略 setData 错误
      }
    }

    return data
  } catch (error) {
    const errorMessage = error && error.message ? error.message : '页面加载失败，请稍后重试'
    const errorDetail = error && error.stack ? error.stack : ''

    if (pendingPageLoads.get(pagePath) === loadKey) {
      try {
        page.setData({
          isLoading: false,
          loadError: errorMessage,
          loadErrorDetail: errorDetail
        })
      } catch (e) {
        // 页面可能已被销毁，忽略 setData 错误
      }
    }

    return null
  } finally {
    // 始终清理：无论成功/失败/页面销毁，确保不残留
    if (pendingPageLoads.get(pagePath) === loadKey) {
      pendingPageLoads.delete(pagePath)
    }
  }
}

/**
 * 清除页面的加载状态
 * @param {string} pagePath 页面路径
 */
function clearPageLoadState(pagePath) {
  pendingPageLoads.delete(pagePath)
}

/**
 * 检查页面是否有正在进行的加载
 * @param {string} pagePath 页面路径
 * @returns {boolean}
 */
function hasPendingLoad(pagePath) {
  return pendingPageLoads.has(pagePath)
}

/**
 * 统一弹窗方法。
 * @param {string} type 弹窗类型：subscribe / skip / delete / revoke / logout。
 * @returns {void} 无返回值；未命中类型时直接忽略。
 */
function showModal(type) {
  // 弹窗内容集中管理，避免各页面散落高风险或不一致文案。
  const modalMap = {
    subscribe: {
      title: '开启微信提醒？',
      content: '开启后，微信会在用药或周报时间提醒你。未开启时，你仍可在提醒中心查看待办。',
      confirmText: '去开启'
    },
    skip: {
      title: '确认跳过本次记录？',
      content: '康小记不会判断是否需要补服，请按医生或药师指导用药。',
      confirmText: '确认跳过'
    },
    delete: {
      title: '删除这条记录？',
      content: '删除后，这条记录将不再出现在趋势和周报中。',
      confirmText: '删除'
    },
    revoke: {
      title: '确认解除授权？',
      content: '解除后，该家属将不能继续查看你的新记录。',
      confirmText: '解除'
    },
    logout: {
      title: '确认注销账号？',
      content: '注销后，你的个人资料、健康记录、用药计划和家庭关系将被清理或匿名化。',
      confirmText: '确认注销'
    }
  }

  const item = modalMap[type]
  if (!item) return

  // 删除、解除授权、注销属于高影响操作，统一使用红色确认按钮。
  wx.showModal({
    title: item.title,
    content: item.content,
    confirmText: item.confirmText,
    confirmColor: type === 'delete' || type === 'revoke' || type === 'logout' ? '#C8463A' : '#168957',
    success(result) {
      if (result.confirm) {
        wx.showToast({
          title: '操作已记录',
          icon: 'none'
        })
      }
    }
  })
}

module.exports = {
  applyAdaptiveState,
  autoPreCheck,
  bindAdaptiveResize,
  clearPageLoadState,
  goRoute,
  hasPendingLoad,
  loadPageData,
  redirectRoute,
  showModal,
  unbindAdaptiveResize,
  // 路由守卫方法（从 route-guard 透传）
  safeNavigateTo,
  safeRedirectTo,
  safeSwitchTab,
  safeNavigateWithPageCheck,
  safeRedirectWithPageCheck,
  safeNavigateBack
}
