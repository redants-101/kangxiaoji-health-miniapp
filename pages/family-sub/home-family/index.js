const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  autoPreCheck,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getHomeFamilyData } = require('../../../utils/api')
const { markClean } = require('../../../services/core')

/**
 * 家属视角首页。
 * 职责：展示被授权成员的最新记录、用药确认状态和周报入口。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载家属首页数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getHomeFamilyData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载家属视角数据。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '家人健康'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /**
   * 页面显示时刷新数据。
   * 授权变更后返回时需更新展示。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    if (this.data._loaded) {
      markClean('homeFamily')
      this.loadData()
    }
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取家属视角数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 点击快捷入口。
   * @param {Object} event 组件事件；detail.route 为路由键。
   * @returns {void}
   */
  handleQuickAction(event) {
    goRoute(event.detail.route)
  },

  /**
   * 点击指标卡。
   * @param {Object} event 组件事件；detail.route 为路由键。
   * @returns {void}
   */
  handleMetricTap(event) {
    goRoute(event.detail.route)
  },

  /**
   * 点击用药日志。
   * @param {Object} event 点击事件；dataset.action 为 confirm/view。
   * @returns {void} 待确认进入确认页，其他进入用药列表。
   */
  handleMedicineTap(event) {
    if (event.currentTarget.dataset.action === 'confirm') {
      goRoute('medConfirm')
      return
    }
    goRoute('medList')
  },

  /** @returns {void} 返回家庭页。 */
  goFamily() {
    goRoute('family')
  },

  /** @returns {void} 进入用药确认页。 */
  goMedConfirm() {
    goRoute('medConfirm')
  },

  /** @returns {void} 进入历史记录页。 */
  goRecordList() {
    goRoute('recordList')
  },

  /** @returns {void} 进入趋势页（已合并周报功能）。 */
  goReport() {
    goRoute('trend')
  }
})
