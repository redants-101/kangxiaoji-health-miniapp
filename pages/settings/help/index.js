const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getHelpData } = require('../../../utils/api')

/**
 * 帮助中心页。
 * 职责：展示快捷入口和常见问题折叠面板。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载帮助中心数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getHelpData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载帮助数据。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '帮助中心'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取帮助中心数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 展开/收起 FAQ。
   * @param {Object} event 点击事件；dataset.id 为 FAQ ID。
   * @returns {void} 更新 activeFaq。
   */
  toggleFaq(event) {
    const id = event.currentTarget.dataset.id
    this.setData({
      activeFaq: this.data.activeFaq === id ? '' : id
    })
  },

  /**
   * 点击快捷链接。
   * @param {Object} event 点击事件；dataset.route 为路由键。
   * @returns {void} 跳转到对应页面。
   */
  goQuickLink(event) {
    goRoute(event.currentTarget.dataset.route)
  },

  /** @returns {void} 进入意见反馈页。 */
  goFeedback() {
    goRoute('feedback')
  }
})
