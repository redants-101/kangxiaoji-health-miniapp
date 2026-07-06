const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getFamilyAuthData, revokeFamilyMember, updateFamilyAuth } = require('../../../utils/api')

/**
 * 家属权限页。
 * 职责：管理某个家属可查看的数据范围、提醒规则，并持久化授权设置。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    memberId: '',
    pendingAction: ''
  },

  /**
   * 加载授权设置。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, () => getFamilyAuthData(this.data.memberId))
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载授权数据。
   */
  async onLoad(options = {}) {
    wx.setNavigationBarTitle({
      title: '授权管理'
    })
    this.setData({
      memberId: options.id || ''
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
    if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null }
  },

  /** @returns {Promise<void>} 重新拉取授权数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 切换可查看的数据范围。
   * @param {Object} event switch 事件；dataset.key 为权限项 key。
   * @returns {void} 更新 scopes。
   */
  toggleScope(event) {
    const key = event.currentTarget.dataset.key
    const enabled = event.detail.value
    const scopes = this.data.scopes.map((item) => {
      if (item.key !== key) return item
      return {
        ...item,
        enabled
      }
    })
    this.setData({ scopes })
  },

  /**
   * 切换家属提醒规则。
   * @param {Object} event switch 事件；dataset.key 为提醒规则 key。
   * @returns {void} 更新 noticeRules。
   */
  toggleNoticeRule(event) {
    const key = event.currentTarget.dataset.key
    const enabled = event.detail.value
    const noticeRules = this.data.noticeRules.map((item) => {
      if (item.key !== key) return item
      return {
        ...item,
        enabled
      }
    })
    this.setData({ noticeRules })
  },

  /**
   * 返回家庭页。
   * @returns {void}
   */
  goFamily() {
    goRoute('family')
  },

  /**
   * 保存家属授权。
   * @returns {Promise<void>} 调用 updateFamilyAuth 写入当前授权范围和提醒规则。
   */
  async saveAuth() {
    try {
      await runButtonAction(this, 'save', async () => {
        await updateFamilyAuth({
          memberId: this.data.memberId,
          member: this.data.member,
          scopes: this.data.scopes,
          noticeRules: this.data.noticeRules,
          activities: this.data.activities
        })
        wx.showToast({
          title: '授权范围已保存',
          icon: 'none'
        })
      })
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '保存失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  /**
   * 解除家属授权入口。
   * @returns {void} 弹出统一解除授权确认框。
   */
  revokeAuth() {
    wx.showModal({
      title: '确认解除授权？',
      content: '解除后，该家属将不能继续查看你的新记录。',
      confirmText: '解除',
      confirmColor: '#C8463A',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await runButtonAction(this, 'revoke', async () => {
            await revokeFamilyMember({ memberId: this.data.memberId })
            wx.showToast({
              title: '家属授权已解除',
              icon: 'none'
            })
            this._navTimer = setTimeout(() => {
              goRoute('family')
            }, 300)
          })
        } catch (error) {
          wx.showToast({
            title: error && error.message ? error.message : '解除失败，请稍后重试',
            icon: 'none'
          })
        }
      }
    })
  }
})
