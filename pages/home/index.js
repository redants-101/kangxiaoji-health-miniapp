const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  autoPreCheck,
  safeNavigateTo,
  unbindAdaptiveResize
} = require('../../utils/page-factory')
const { getHomeData } = require('../../utils/api')
const { readStorage, writeStorage, markClean } = require('../../services/core')
const { checkAndShowSnoozePopup, clearSnoozePopupState } = require('../../utils/snooze-checker')
const { cleanupExpiredSnoozeReminders } = require('../../services/snooze')

const ONBOARDING_KEY = 'home_onboarding_completed'

/**
 * 本人首页。
 * 职责：展示今日待办、快捷记录、最新指标和周概览。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    loadErrorDetail: '',
    showQuickRecord: false,
    isFirstTime: false,
    showOnboarding: false,
    onboardingStep: 1
  },

  /**
   * 加载首页数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    // 记住当前引导步骤，防止 loadPageData 的 setData 意外覆盖
    const preserveOnboardingStep = this.data.onboardingStep

    return loadPageData(this, getHomeData).then((data) => {
      // 云函数失败时 loadPageData 返回 null 并已设置 loadError
      // 此时用默认数据降级展示，避免停留在错误页面
      if (!data && this.data.loadError) {
        const { DEFAULT_PAGE_DATA } = require('../../services/page-data')
        const fallback = DEFAULT_PAGE_DATA.home || {}
        // 降级时检查本地是否有记录，决定是否显示空状态引导
        const { getStoredRecords } = require('../../services/records')
        const hasLocalRecords = getStoredRecords().length > 0
        console.warn('[Home] loadData 降级, loadError:', this.data.loadError, 'hasLocalRecords:', hasLocalRecords)
        try {
          this.setData({
            ...fallback,
            isLoading: false,
            loadError: '',
            _loaded: true,
            isFirstTime: !hasLocalRecords,
            showOnboarding: !hasLocalRecords && !this._onboardingCompleted,
            onboardingStep: !hasLocalRecords && !this._onboardingCompleted ? 1 : preserveOnboardingStep
          })
        } catch (e) { /* 页面可能已销毁 */ }
        return
      }
      // 从页面实际状态读取 latestMetrics，而非 data 参数（data 可能为 null）
      const metrics = this.data.latestMetrics || []
      const isFirstTime = !metrics.some((m) => m.hasData)
      console.log('[Home] loadData 成功, isFirstTime:', isFirstTime,
        'metrics hasData:', metrics.map(m => `${m.label}:${m.hasData}`).join(', '))
      try {
        this.setData({
          _loaded: true,
          isFirstTime,
          showOnboarding: isFirstTime && !this._onboardingCompleted,
          onboardingStep: isFirstTime && !this._onboardingCompleted ? 1 : preserveOnboardingStep
        })
      } catch (e) { /* 页面可能已销毁 */ }
    })
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载首页。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '首页'
    })
    bindAdaptiveResize(this)
    const onboardingCompleted = readStorage(ONBOARDING_KEY, false)
    // 不再在此处直接弹出 onboarding，等 loadData 判断 isFirstTime 后再决定
    this._onboardingCompleted = onboardingCompleted
    await this.loadData()
  },

  /**
   * 页面显示时执行预检查并刷新数据。
   * 确保用户已完成隐私协议和基础资料设置；
   * 非首次显示时重新拉取数据（用药计划等可能已变更）。
   * 同时检查是否有到期的稍后提醒，弹窗提示用户。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    if (this.data._loaded) {
      // 始终重新加载数据，避免因脏页标记丢失导致首页不刷新
      markClean('home')
      this.loadData()
    }
    // 清理过期 snooze 任务，避免本地存储无限增长
    cleanupExpiredSnoozeReminders()
    // 检查到期 snooze 并弹窗（延迟 300ms 避免与 loadData 竞态）
    setTimeout(() => {
      try { checkAndShowSnoozePopup(this) } catch (e) { /* ignore */ }
    }, 300)
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    clearSnoozePopupState(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取首页数据。 */
  async reloadPage() {
    try { this.setData({ loadErrorDetail: '' }) } catch (e) { /* ignore */ }
    await this.loadData()
  },

  /** 复制错误详情到剪贴板，方便排查问题。 */
  copyErrorDetail() {
    const detail = this.data.loadErrorDetail || this.data.loadError || ''
    if (!detail) return
    wx.setClipboardData({
      data: detail,
      success() {
        wx.showToast({ title: '已复制错误详情', icon: 'none' })
      }
    })
  },

  /**
   * 点击今日待办。
   * @param {Object} event 点击事件；dataset.route 为待办跳转路由。
   * @returns {void}
   */
  handleTaskTap(event) {
    const dataset = event.currentTarget.dataset
    const route = dataset.route
    if (!route) return

    // 用药确认需要携带 planId 和 logId 参数
    if (route === 'medConfirm') {
      const params = []
      if (dataset.planId) params.push(`planId=${dataset.planId}`)
      if (dataset.logId) params.push(`logId=${dataset.logId}`)
      const url = require('../../utils/routes')[route]
      if (url) {
        safeNavigateTo(params.length ? `${url}?${params.join('&')}` : url)
      }
      return
    }

    goRoute(route)
  },

  /**
   * 点击快捷入口组件。
   * @param {Object} event 组件事件；detail.route 为路由键。
   * @returns {void}
   */
  handleQuickAction(event) {
    goRoute(event.detail.route)
  },

  /**
   * 点击最新指标卡。
   * @param {Object} event 组件事件；detail.route 为路由键。
   * @returns {void}
   */
  handleMetricTap(event) {
    if (event.detail.recordId) {
      safeNavigateTo(`/pages/record/record-detail/index?id=${event.detail.recordId}`)
      return
    }
    goRoute(event.detail.route)
  },

  /**
   * 进入提醒中心。
   * @returns {void}
   */
  goReminder() {
    goRoute('reminder')
  },

  /**
   * 进入历史记录页。
   * @returns {void}
   */
  goRecordList() {
    goRoute('recordList')
  },

  goReport() {
    goRoute('trend')
  },

  goRecordBp() {
    try { this.setData({ showQuickRecord: false }) } catch (e) { /* ignore */ }
    goRoute('recordBp')
  },

  goRecordBg() {
    try { this.setData({ showQuickRecord: false }) } catch (e) { /* ignore */ }
    goRoute('recordBg')
  },

  toggleQuickRecord() {
    try {
      this.setData({ showQuickRecord: !this.data.showQuickRecord })
    } catch (e) { /* ignore */ }
  },

  closeQuickRecord() {
    try { this.setData({ showQuickRecord: false }) } catch (e) { /* ignore */ }
  },

  nextOnboardingStep() {
    const next = this.data.onboardingStep + 1
    if (next > 3) {
      this.skipOnboarding()
    } else {
      try { this.setData({ onboardingStep: next }) } catch (e) { /* ignore */ }
    }
  },

  skipOnboarding() {
    writeStorage(ONBOARDING_KEY, true)
    this._onboardingCompleted = true
    try { this.setData({ showOnboarding: false, onboardingStep: 1 }) } catch (e) { /* ignore */ }
  },

  /** 分享给朋友，带上用户称呼。 */
  onShareAppMessage() {
    const name = this.data.profile && this.data.profile.name
    const title = name ? `${name}邀请你关注家人的健康记录` : '康小记 — 家人健康，一眼便知'
    return {
      title,
      path: '/pages/home/index',
      imageUrl: ''
    }
  },

  /** 分享到朋友圈，带上用户称呼。 */
  onShareTimeline() {
    const name = this.data.profile && this.data.profile.name
    const title = name ? `${name}的健康记录 · 康小记` : '康小记 — 血压血糖记录×用药提醒×家庭共享'
    return {
      title,
      query: '',
      imageUrl: ''
    }
  }
})
