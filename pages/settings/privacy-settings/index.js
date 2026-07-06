const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getPrivacySettingsData, updatePrivacySettings } = require('../../../utils/api')

/**
 * 隐私与授权页。
 * 职责：展示敏感信息授权项、管理入口和最近授权日志。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    showAllAuthLogs: false,
    visibleLogs: []
  },

  /**
   * 加载隐私授权设置。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    const data = await loadPageData(this, getPrivacySettingsData)
    if (!data) return null
    this.updateVisibleLogs(false, data.logs)
    return data
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载授权状态。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '隐私与授权'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取隐私设置数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 控制授权日志展开状态。
   * @param {boolean} showAll 是否显示全部日志。
   * @param {Array<Object>} [logs=this.data.logs] 日志列表。
   * @returns {void}
   */
  updateVisibleLogs(showAll, logs = this.data.logs || []) {
    this.setData({
      showAllAuthLogs: showAll,
      visibleLogs: showAll ? logs : logs.slice(0, 2)
    })
  },

  /**
   * 切换单项隐私授权。
   * @param {Object} event switch 事件；dataset.key 为授权项 key，detail.value 为开关值。
   * @returns {Promise<void>} 更新本地状态并调用 updatePrivacySettings 持久化。
   */
  async togglePermission(event) {
    const key = event.currentTarget.dataset.key
    const enabled = event.detail.value
    const permissions = this.data.permissions.map((item) => {
      if (item.key !== key) return item
      return {
        ...item,
        enabled
      }
    })
    this.setData({ permissions })
    await updatePrivacySettings({
      permissions,
      links: this.data.links,
      logs: this.data.logs
    })
    wx.showToast({
      title: '授权设置已保存',
      icon: 'none'
    })
  },

  /** @returns {void} 进入隐私政策页。 */
  goPrivacyPolicy() {
    goRoute('privacyPolicy')
  },

  /**
   * 通过数据中的 route 字段跳转。
   * @param {Object} event 点击事件；dataset.route 为路由键。
   * @returns {void}
   */
  goRoute(event) {
    goRoute(event.currentTarget.dataset.route)
  },

  /**
   * 展开或收起授权日志。
   * @returns {void}
   */
  toggleAllLogs() {
    this.updateVisibleLogs(!this.data.showAllAuthLogs)
  }
})
