const {
  autoPreCheck,
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  showModal,
  unbindAdaptiveResize
} = require('../../utils/page-factory')
const { getMeData, rebuildRecordStats } = require('../../utils/api')
const { markClean } = require('../../services/core')

/**
 * 我的页。
 * 职责：展示个人摘要、统计数据和设置入口。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  async loadData() {
    return loadPageData(this, getMeData)
  },

  async onLoad() {
    wx.setNavigationBarTitle({ title: '我的' })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /**
   * 页面显示时执行预检查并刷新数据。
   * tabBar 页面切回时重新拉取数据，确保资料变更后摘要更新。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    if (this.data._loaded) {
      markClean('me')
      this.loadData()
    }
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  async reloadPage() {
    await this.loadData()
  },

  goProfile() {
    goRoute('profile')
  },

  async handleRebuildStats() {
    wx.showLoading({ title: '重建中…' })
    try {
      const result = await rebuildRecordStats()
      wx.hideLoading()
      wx.showModal({
        title: '重建完成',
        content: `已处理 ${result.recordCount ?? result.users ?? 0} 条记录`,
        showCancel: false
      })
      await this.loadData()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '重建失败', icon: 'none' })
    }
  },

  handleSettingTap(event) {
    const { route, modal, toast, action } = event.currentTarget.dataset
    if (action === 'rebuildStats') {
      this.handleRebuildStats()
      return
    }
    if (modal) {
      showModal(modal)
      return
    }
    if (route) {
      goRoute(route)
      return
    }
    if (toast) {
      wx.showToast({ title: toast, icon: 'none' })
    }
  }
})
