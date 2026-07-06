const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { createFamilyInvite, getFamilyInviteData } = require('../../../utils/api')

/**
 * 邀请家属页。
 * 职责：选择家属身份、授权范围，生成分享文案和一次性邀请入口。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  async loadData() {
    return loadPageData(this, getFamilyInviteData)
  },

  async onLoad() {
    wx.setNavigationBarTitle({
      title: '邀请家属'
    })
    bindAdaptiveResize(this)
    const data = await this.loadData()
    if (!data) return
    this.updateInvitePreview()
    await this.createInvite()
  },

  async reloadPage() {
    const data = await this.loadData()
    if (!data) return
    this.updateInvitePreview()
    await this.createInvite()
  },

  onShareAppMessage() {
    return {
      title: this.data.invitePreview.title,
      path: this.data.sharePath || `/pages/family-sub/family-join/index?inviteCode=${this.data.inviteCode || ''}`,
      imageUrl: ''
    }
  },

  selectRelation(event) {
    this.setData({
      selectedRelation: event.currentTarget.dataset.key
    })
    this.updateInvitePreview()
    this.createInvite()
  },

  toggleScope(event) {
    const key = event.currentTarget.dataset.key
    const enabled = event.detail.value
    const scopes = this.data.scopes.map((item) => {
      if (item.key !== key) return item
      return { ...item, enabled }
    })
    this.setData({ scopes })
    this.updateInvitePreview()
    this.createInvite()
  },

  selectAllScopes() {
    const scopes = this.data.scopes.map((item) => ({ ...item, enabled: true }))
    this.setData({ scopes })
    this.updateInvitePreview()
    this.createInvite()
  },

  updateInvitePreview() {
    const relation = this.data.relations.find((item) => item.key === this.data.selectedRelation)
    const enabledScopes = this.data.scopes.filter((item) => item.enabled).map((item) => item.title)
    this.setData({
      invitePreview: {
        title: `妈妈邀请${relation ? relation.label : '家属'}查看健康记录`,
        meta: enabledScopes.length ? `可查看：${enabledScopes.join('、')}` : '暂未选择可查看内容',
        expire: '24 小时'
      }
    })
  },

  async createInvite() {
    try {
      const result = await createFamilyInvite({
        selectedRelation: this.data.selectedRelation,
        scopes: this.data.scopes
      })
      this.setData({
        inviteCode: result.inviteCode,
        inviteId: result.inviteId,
        sharePath: result.sharePath,
        invitePreview: { ...this.data.invitePreview, ...(result.invitePreview || {}) }
      })
    } catch (err) {
      wx.showToast({ title: err.message || '邀请生成失败', icon: 'none' })
    }
  },

  copyInvite() {
    wx.setClipboardData({
      data: `${this.data.invitePreview.title}，${this.data.invitePreview.meta}。邀请码：${this.data.inviteCode || ''}`,
      success() {
        wx.showToast({ title: '邀请说明已复制', icon: 'none' })
      }
    })
  },

  goFamily() {
    goRoute('family')
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },
})