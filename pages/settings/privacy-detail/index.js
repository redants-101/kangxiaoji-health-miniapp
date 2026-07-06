const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getPrivacyDetailData } = require('../../../utils/api')

/**
 * 隐私摘要页。
 * 职责：以摘要形式展示隐私处理范围，兼容早期 privacyDetail 路由。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载隐私摘要数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getPrivacyDetailData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载摘要。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '隐私摘要'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取隐私摘要。 */
  async reloadPage() {
    await this.loadData()
  },

  /** @returns {void} 返回隐私确认页。 */
  backToPrivacy() {
    goRoute('privacy')
  }
})
