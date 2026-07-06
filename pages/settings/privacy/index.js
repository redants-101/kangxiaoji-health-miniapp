const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  redirectRoute,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getPrivacyData } = require('../../../utils/api')
const { updatePrivacySettings, updatePrivacySettingsLocal } = require('../../../services/privacy')

/**
 * 首次隐私确认页。
 * 职责：展示产品范围、隐私政策和用户协议入口，用户确认后进入角色选择。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载隐私确认页数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getPrivacyData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载授权说明。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '康小记'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新加载页面数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 切换协议同意状态。
   * @returns {void} 更新 agreed。
   */
  toggleAgree() {
    this.setData({
      agreed: !this.data.agreed
    })
  },

  /** @returns {void} 进入隐私政策页。 */
  goPrivacyPolicy() {
    goRoute('privacyPolicy')
  },

  /** @returns {void} 进入用户服务协议页。 */
  goUserAgreement() {
    goRoute('userAgreement')
  },

  /**
   * 开始使用。
   * @returns {void} 未同意协议时拦截；同意后保存状态并进入角色选择。
   */
  async startUse() {
    if (!this.data.agreed) {
      wx.showToast({
        title: '请先同意隐私政策和用户服务协议',
        icon: 'none'
      })
      return
    }

    const privacyPayload = {
      agreed: true,
      agreedAt: new Date().toISOString()
    }

    // 保存隐私协议同意状态
    try {
      await updatePrivacySettings(privacyPayload)
    } catch (err) {
      // 云端保存失败时，确保本地存储有数据，避免后续预检查误判
      console.warn('[Privacy] 云端保存失败，写入本地存储', err)
      try { updatePrivacySettingsLocal(privacyPayload) } catch (_) { /* ignore */ }
    }

    redirectRoute('role')
  }
})
