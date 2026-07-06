const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  safeNavigateBack,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getUserAgreementData } = require('../../../utils/api')

/**
 * 用户服务协议页。
 * 职责：展示服务边界、使用规则和免责声明。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载用户服务协议内容。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getUserAgreementData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载协议文本。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '用户服务协议'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取用户服务协议。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 返回上一页。
   * @returns {void} 有页面栈时 navigateBack；单独打开时回到隐私确认页。
   */
  goBack() {
    if (getCurrentPages().length > 1) {
      safeNavigateBack()
      return
    }
    goRoute('privacy')
  },

  scrollToSection(e) {
    const index = e.currentTarget.dataset.index
    wx.pageScrollTo({
      selector: `#section-${index}`,
      duration: 300
    })
  }
})
