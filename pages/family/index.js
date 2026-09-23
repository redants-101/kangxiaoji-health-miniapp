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
const { getFamilyData, revokeFamilyMember, getAppConfig } = require('../../utils/api')
const { getFamilyTabEnabled } = require('../../utils/feature-flags')

/**
 * 家庭页。
 * 职责：展示家属成员、授权范围和邀请入口，是家庭协同链路的主入口。
 * A7：开放/回滚由运行时开关控制——远程配置 appConfig.familyTabEnabled 优先，
 * 无远程值按 envVersion 默认（正式版关、体验/开发版开）；开关只控展示，不构成数据授权。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    pendingMemberId: '',
    familyTabEnabled: getFamilyTabEnabled(null)
  },

  /**
   * 应用当前开关状态（同步：远程配置已缓存于 globalData 则参与判定）。
   * @returns {boolean} 开关是否打开。
   */
  applyFamilyTabFlag() {
    const app = getApp()
    const cfg = app && app.globalData ? app.globalData.appConfig : null
    const enabled = getFamilyTabEnabled(cfg)
    this.setData({ familyTabEnabled: enabled })
    return enabled
  },

  /**
   * 拉取一次远程开关配置并应用（回滚开关的运行时判断，非注释性承诺）。
   * 获取失败回退端侧默认；开关由关变开时补加载家庭数据。
   * @returns {Promise<boolean>} 最终开关状态。
   */
  async refreshFamilyTabFlag() {
    const app = getApp()
    try {
      const cfg = await getAppConfig()
      if (app && app.globalData) app.globalData.appConfig = cfg && typeof cfg === 'object' ? cfg : null
    } catch (e) {
      if (app && app.globalData && app.globalData.appConfig === undefined) app.globalData.appConfig = null
    }
    const enabled = this.applyFamilyTabFlag()
    if (enabled && !this.data._loaded && !this.data.isLoading) {
      await this.loadData()
    }
    return enabled
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
   * @returns {Promise<void>} 设置标题；开关打开才加载家庭数据，并异步应用远程开关。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '家庭'
    })
    bindAdaptiveResize(this)
    const enabled = this.applyFamilyTabFlag()
    if (enabled) {
      await this.loadData()
    } else {
      // 占位态：不请求家庭数据，复位加载标记
      this.setData({ isLoading: false })
    }
    // 远程配置到达后重估开关（回滚/放开均运行时生效）
    this.refreshFamilyTabFlag()
  },

  /**
   * 页面显示时执行预检查并刷新数据。
   * tabBar 页面切回时重新拉取数据，确保授权变更后成员列表更新。
   * A7：开关关闭时保持占位态，不加载数据。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    const enabled = this.applyFamilyTabFlag()
    if (!enabled) return
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
    // A1：邀请预览卡（bound=false，id 为空）不是关系行，不能提交撤销
    if (!memberId) {
      wx.showToast({ title: '该成员尚未加入，无需解除', icon: 'none' })
      return
    }
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
