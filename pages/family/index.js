const {
  autoPreCheck,
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  safeNavigateTo,
  unbindAdaptiveResize
} = require('../../utils/page-factory')
const { runButtonAction } = require('../../utils/button-state')
const { markClean } = require('../../services/core')
const { getFamilyData, revokeFamilyMember } = require('../../utils/api')

/**
 * 家庭页。
 * 职责：展示家属成员、授权范围和邀请入口，是家庭协同链路的主入口。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    pendingMemberId: ''
  },

  /**
   * 加载家庭成员和授权概览。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getFamilyData)
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载家庭数据。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '家庭'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  /**
   * 页面显示时执行预检查并刷新数据。
   * tabBar 页面切回时重新拉取数据，确保授权变更后成员列表更新。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    if (this.data._loaded) {
      markClean('family')
      this.loadData()
    }
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取家庭数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 进入邀请家属页。
   * @returns {void}
   */
  inviteFamily() {
    goRoute('familyInvite')
  },

  /**
   * 预览家属视角首页。
   * @returns {void}
   */
  previewFamily() {
    goRoute('homeFamily')
  },

  /**
   * 进入家属权限管理页。
   * @returns {void}
   */
  manageMember(event) {
    const id = event.currentTarget.dataset.id
    safeNavigateTo(id ? `/pages/family-sub/family-auth/index?id=${id}` : '/pages/family-sub/family-auth/index')
  },

  /**
   * 解除家属授权入口。
   * @returns {void} 弹出统一确认框。
   */
  revokeMember(event) {
    const memberId = event.currentTarget.dataset.id
    wx.showModal({
      title: '确认解除授权？',
      content: '解除后，该家属将不能继续查看你的新记录。',
      confirmText: '解除',
      confirmColor: '#C8463A',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await runButtonAction(this, memberId, async () => {
            await revokeFamilyMember({ memberId })
            await this.loadData()
            wx.showToast({
              title: '家属授权已解除',
              icon: 'none'
            })
          }, 'pendingMemberId')
        } catch (error) {
          wx.showToast({
            title: error && error.message ? error.message : '解除失败，请稍后重试',
            icon: 'none'
          })
        }
      }
    })
  },

  /** 分享给朋友，带上用户称呼。 */
  onShareAppMessage() {
    const name = this.data.profile && this.data.profile.name
    const title = name ? `${name}邀请你关注家人的健康记录` : '康小记 — 邀请家人一起关注健康'
    return {
      title,
      path: '/pages/family/index',
      imageUrl: ''
    }
  },

  /** 分享到朋友圈，带上用户称呼。 */
  onShareTimeline() {
    const name = this.data.profile && this.data.profile.name
    const title = name ? `${name}的家庭健康圈 · 康小记` : '康小记 — 家庭共享健康记录'
    return {
      title,
      query: '',
      imageUrl: ''
    }
  }
})
