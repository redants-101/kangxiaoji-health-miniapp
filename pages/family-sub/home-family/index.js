const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  autoPreCheck,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getHomeFamilyData, familyGetReminderPhone } = require('../../../utils/api')
const { markClean } = require('../../../services/core')

// A6：取号被拒原因 → 用户可读提示（不假设已拨出、不本地假成功）
const PHONE_DENIED_MESSAGES = {
  remindDenied: '提醒权限已关闭',
  notConfigured: '家人尚未配置提醒电话',
  revoked: '家属授权已解除',
  noBinding: '暂无家庭绑定',
  notMember: '仅家属可使用电话提醒'
}

/**
 * 家属视角首页。
 * 职责：展示被授权成员的最新记录、用药确认状态和周报入口。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    // A6：电话提醒入口（remindAllowed 才渲染；canCall 才可拨号；masked 为脱敏号）
    phoneReminder: { remindAllowed: false, configured: false, canCall: false, masked: '' },
    phoneError: ''
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
    // A3：本页即家属视图，置全局标记供 tabBar 页（trend）识别家属上下文
    const app = getApp()
    if (app && app.globalData) app.globalData.familyView = true
    await this.loadData()
  },

  /**
   * 页面显示时刷新数据。
   * 授权变更后返回时需更新展示。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    const app = getApp()
    if (app && app.globalData) app.globalData.familyView = true
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
    // A3：家属视图二级页携带 familyView；trend 为 tabBar 页，经全局标记传递
    const route = event.detail.route
    if (route === 'trend') {
      const app = getApp()
      if (app && app.globalData) app.globalData.familyView = true
      goRoute(route)
      return
    }
    goRoute(route, 'familyView=1')
  },

  /**
   * 点击指标卡。
   * @param {Object} event 组件事件；detail.route 为路由键。
   * @returns {void}
   */
  handleMetricTap(event) {
    const route = event.detail.route
    if (route === 'trend') {
      const app = getApp()
      if (app && app.globalData) app.globalData.familyView = true
      goRoute(route)
      return
    }
    goRoute(route, 'familyView=1')
  },

  /**
   * 点击用药日志。
   * @param {Object} event 点击事件；dataset.action 为 confirm/view。
   * @returns {void} 待确认进入确认页，其他进入用药列表。
   */
  handleMedicineTap(event) {
    // A3/A4：家属代确认入口在用药列表（med-list 家属态已服/跳过），本页不直开确认页
    if (event.currentTarget.dataset.action === 'confirm') {
      wx.showToast({ title: '请进入用药列表进行代确认', icon: 'none' })
      return
    }
    goRoute('medList', 'familyView=1')
  },

  /**
   * A6 电话提醒：点击时经 action 按需取号（不入读缓存、不落 data/storage），
   * 直接唤起 wx.makePhoneCall；被拒/失败均显式提示，不假设已拨出。
   * @returns {Promise<void>}
   */
  async handleCallReminder() {
    if (!this.data.phoneReminder || !this.data.phoneReminder.canCall) {
      wx.showToast({ title: '电话提醒当前不可用', icon: 'none' })
      return
    }
    try {
      const res = await familyGetReminderPhone()
      if (res && res.phoneDenied && res.phoneDenied.allowed === false) {
        const reason = res.phoneDenied.reason || ''
        this.setData({ phoneError: reason })
        wx.showToast({ title: PHONE_DENIED_MESSAGES[reason] || '电话提醒当前不可用', icon: 'none' })
        return
      }
      if (!res || !res.phone) {
        this.setData({ phoneError: 'notConfigured' })
        wx.showToast({ title: PHONE_DENIED_MESSAGES.notConfigured, icon: 'none' })
        return
      }
      // 完整号码仅用于本次拨号，不写入 this.data、不写入本地存储
      wx.makePhoneCall({
        phoneNumber: res.phone,
        fail: () => {
          wx.showToast({ title: '拨号未接通，请重试或手动拨打', icon: 'none' })
        }
      })
    } catch (err) {
      wx.showToast({ title: err && err.message ? err.message : '获取号码失败，请稍后重试', icon: 'none' })
    }
  },

  /**
   * A4 家属代录入口：携带 familyView 进入记录页（写路由由服务端闸口鉴权）。
   * @param {Object} event 组件事件；detail.route 为路由键。
   * @returns {void}
   */
  handleProxyRecord(event) {
    goRoute(event.detail.route, 'familyView=1')
  },

  /** @returns {void} 返回家庭页。 */
  goFamily() {
    goRoute('family')
  },

  /** @returns {void} 进入用药确认页（家属代确认入口在用药列表）。 */
  goMedConfirm() {
    wx.showToast({ title: '请进入用药列表进行代确认', icon: 'none' })
  },

  /** @returns {void} 进入历史记录页（家属视图）。 */
  goRecordList() {
    goRoute('recordList', 'familyView=1')
  },

  /** @returns {void} 进入趋势页（已合并周报功能）。 */
  goReport() {
    goRoute('trend')
  }
})
