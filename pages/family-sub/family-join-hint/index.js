const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getFamilyJoinHintData } = require('../../../utils/api')

/**
 * 等待邀请页。
 * 职责：当用户选择"帮家人管理"但尚未收到邀请时，说明加入流程。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载等待邀请说明数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getFamilyJoinHintData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载步骤。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '等待邀请'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取等待邀请说明。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 进入加入家庭页。
   * @returns {void}
   */
  openInviteLink() {
    goRoute('familyJoin')
  },

  /**
   * 预览家属首页。
   * @returns {void}
   */
  previewFamilyHome() {
    goRoute('homeFamily')
  }
})
