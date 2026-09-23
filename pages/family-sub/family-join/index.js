const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getFamilyJoinData, joinFamilyByInvite } = require('../../../utils/api')

// A2：邀请错误码 → 页面状态标题（码表契约定义于云端 family-policy.js，此处仅复制稳定字符串）
const INVITE_ERROR_TITLES = {
  FAMILY_INVITE_NOT_FOUND: '邀请不存在',
  FAMILY_INVITE_INVALID: '邀请码无效',
  FAMILY_INVITE_EXPIRED: '邀请已过期',
  FAMILY_INVITE_REVOKED: '邀请已撤销',
  FAMILY_INVITE_USED: '邀请已被使用',
  FAMILY_INVITE_RATE_LIMITED: '尝试过于频繁',
  FAMILY_INVITE_SELF: '不能加入自己的邀请',
  FAMILY_MEMBER_BOUND: '已绑定其他家人'
}

/**
 * 加入家庭页。
 * 职责：家属通过邀请链接进入后确认边界，并加入授权家庭。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    inviteCodeFromRoute: '',
    pendingAction: '',
    inviteErrorTitle: '',
    noInvite: false
  },

  /**
   * 加载邀请加入页数据。云端返回 inviteError 时渲染对应错误态。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData(inviteCode = '') {
    const data = await loadPageData(this, () => getFamilyJoinData({ inviteCode }))
    if (data && data.inviteError) {
      this.setData({
        inviteErrorTitle: INVITE_ERROR_TITLES[data.inviteError.code] || '邀请不可用'
      })
    }
    return data
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
    // A2：无邀请说明态禁止提交
    if (this.data.noInvite) {
      wx.showToast({
        title: '请通过家人分享的邀请进入',
        icon: 'none'
      })
      return
    }
    // A2：邀请处于错误态（无效/过期/撤销/已用/频控）时禁止提交
    if (this.data.inviteError) {
      wx.showToast({
        title: this.data.inviteError.message || '当前邀请不可用',
        icon: 'none'
      })
      return
    }
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
      // 加入失败可能因邀请状态刚变化（被使用/过期/撤销），刷新页面呈现最新错误态
      await this.loadData(this.data.inviteCodeFromRoute)
    }
  }
})
