const {
  bindAdaptiveResize,
  loadPageData,
  clearPageLoadState,
  redirectRoute,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getRoleData } = require('../../../utils/api')

/**
 * 角色选择页。
 * 职责：让用户选择本人使用或帮家人管理，并进入对应流程。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载角色选项。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getRoleData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载角色数据。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '角色选择'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取角色选项。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 选择角色。
   * @param {Object} event 点击事件；dataset.key 为 self / family。
   * @returns {void} 更新 selectedRole。
   */
  selectRole(event) {
    this.setData({
      selectedRole: event.currentTarget.dataset.key
    })
  },

  /**
   * 继续下一步。
   * @returns {void} family 进入等待邀请，self 进入基础资料。
   */
  continueNext() {
    if (this.data.selectedRole === 'family') {
      redirectRoute('familyJoinHint')
      return
    }
    redirectRoute('profile')
  }
})
