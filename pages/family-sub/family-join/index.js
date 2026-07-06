const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getFamilyJoinData, joinFamilyByInvite } = require('../../../utils/api')

/**
 * 加入家庭页。
 * 职责：家属通过邀请链接进入后确认边界，并加入授权家庭。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    inviteCodeFromRoute: '',
    pendingAction: ''
  },

  /**
   * 加载邀请加入页数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData(inviteCode = '') {
    return loadPageData(this, () => getFamilyJoinData({ inviteCode }))
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并初始化邀请数据。
   */
  async onLoad(options = {}) {
    wx.setNavigationBarTitle({
      title: '加入家庭'
    })
    const inviteCode = options.inviteCode || options.inviteId || ''
    this.setData({
      inviteCodeFromRoute: inviteCode
    })
    bindAdaptiveResize(this)
    await this.loadData(inviteCode)
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取邀请加入数据。 */
  async reloadPage() {
    await this.loadData(this.data.inviteCodeFromRoute)
  },

  /**
   * 切换边界确认勾选。
   * @returns {void} 更新 agreed。
   */
  toggleAgree() {
    this.setData({
      agreed: !this.data.agreed
    })
  },

  /**
   * 确认加入家庭。
   * @returns {void} 未勾选边界说明时阻止加入；通过后进入家属首页。
   */
  async joinFamily() {
    if (!this.data.agreed) {
      wx.showToast({
        title: '请先确认使用边界',
        icon: 'none'
      })
      return
    }
    try {
      await runButtonAction(this, 'join', async () => {
        await joinFamilyByInvite({
          inviteCode: this.data.inviteCode
        })
        wx.showToast({
          title: '已加入家庭',
          icon: 'none'
        })
        goRoute('homeFamily')
      })
    } catch (err) {
      wx.showToast({
        title: err.message || '加入失败',
        icon: 'none'
      })
    }
  }
})
