const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { createFamilyInvite, getFamilyInviteData } = require('../../../utils/api')

// A6：提醒电话客户端预检（云端 family-policy 仍独立校验）
const CONTACT_PHONE_PATTERN = /^1[3-9]\d{9}$/

/**
 * 邀请家属页。
 * 职责：选择家属身份、授权范围（草稿），显式点击"生成邀请"后才提交云端。
 * A2 收尾：打开/刷新/编辑均不生成邀请码；脏草稿禁止复制/分享旧码组合。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    inviteCode: '',
    inviteId: '',
    sharePath: '',
    submitting: false,
    generatedConfig: null,
    draftDirty: false,
    generateError: '',
    // A6：提醒电话（可选项，随生成邀请提交；需勾选授权说明）
    contactPhoneInput: '',
    phoneAgreed: false
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
    // 打开页面只读取与渲染草稿，不生成邀请码
    this.updateInvitePreview()
  },

  async reloadPage() {
    const data = await this.loadData()
    if (!data) return
    this.updateInvitePreview()
  },

  onShareAppMessage() {
    // 未生成或草稿与已生成配置不一致时，不得携带旧码分享新文案
    if (!this.data.inviteCode || this.data.draftDirty) {
      return {
        title: '配置已修改或尚未生成邀请，请重新生成后分享',
        path: '/pages/family-sub/family-invite/index',
        imageUrl: ''
      }
    }
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
    // 仅更新草稿与预览文案，不写云端
    this.updateInvitePreview()
  },

  toggleScope(event) {
    const { key, field } = event.currentTarget.dataset
    const value = event.detail.value
    const scopes = this.data.scopes.map((item) => {
      if (item.key !== key) return item
      return { ...item, [field]: value }
    })
    this.setData({ scopes })
    this.updateInvitePreview()
  },

  selectAllScopes() {
    // 全选只开放查看与提醒；代录涉及写操作，须逐块显式打开
    const scopes = this.data.scopes.map(item => ({ ...item, read: true, remind: true }))
    this.setData({ scopes })
    this.updateInvitePreview()
  },

  updateInvitePreview() {
    const relation = this.data.relations.find((item) => item.key === this.data.selectedRelation)
    const readScopes = this.data.scopes.filter((item) => item.read).map((item) => item.title)
    this.setData({
      invitePreview: {
        title: `妈妈邀请${relation ? relation.label : '家属'}查看健康记录`,
        meta: readScopes.length ? `可查看：${readScopes.join('、')}` : '暂未选择可查看内容',
        expire: '24 小时'
      },
      draftDirty: this.isDraftDirty()
    })
  },

  isDraftDirty() {
    if (!this.data.generatedConfig) {
      // 从未生成：有旧码（理论上本页不再出现）也视为不一致，禁止当作新配置分享
      return !!this.data.inviteCode
    }
    const draft = JSON.stringify({
      selectedRelation: this.data.selectedRelation,
      scopes: this.data.scopes,
      contactPhone: String(this.data.contactPhoneInput || '').trim()
    })
    return draft !== JSON.stringify(this.data.generatedConfig)
  },

  /**
   * A6：提醒电话输入（草稿字段，参与脏检查）。
   * @param {Object} event input 事件。
   * @returns {void}
   */
  handlePhoneInput(event) {
    this.setData({ contactPhoneInput: event.detail.value })
    this.updateInvitePreview()
  },

  /**
   * A6：电话授权说明勾选。
   * @param {Object} event checkbox 事件。
   * @returns {void}
   */
  togglePhoneAgree(event) {
    this.setData({ phoneAgreed: !!event.detail.value })
  },

  /**
   * 显式生成邀请：用户点击才提交；已有码时先确认"旧码立即失效"。
   * 请求期间 submitting 防重复提交；失败保留旧码但维持脏标记，不冒充新配置生效。
   * @returns {Promise<void>}
   */
  async generateInvite() {
    if (this.data.submitting) return
    if (this.data.inviteCode) {
      const confirmed = await new Promise((resolve) => {
        wx.showModal({
          title: '重新生成邀请',
          content: '重新生成后，旧邀请码立即失效，已分享出去的旧码将无法使用。是否继续？',
          confirmText: '重新生成',
          confirmColor: '#C8463A',
          success: (result) => resolve(!!result.confirm),
          fail: () => resolve(false)
        })
      })
      if (!confirmed) return
    }
    this.setData({ submitting: true, generateError: '' })
    try {
      // A6：提醒电话可选；填写则先过格式预检与授权勾选，随邀请一并提交
      const contactPhone = String(this.data.contactPhoneInput || '').trim()
      if (contactPhone && !CONTACT_PHONE_PATTERN.test(contactPhone)) {
        this.setData({ submitting: false, draftDirty: true })
        wx.showToast({ title: '电话格式不正确，请填写 11 位手机号', icon: 'none' })
        return
      }
      if (contactPhone && !this.data.phoneAgreed) {
        this.setData({ submitting: false })
        wx.showToast({ title: '请先阅读并勾选电话授权说明', icon: 'none' })
        return
      }
      const result = await createFamilyInvite({
        selectedRelation: this.data.selectedRelation,
        scopes: this.data.scopes,
        ...(contactPhone ? { contactPhone } : {})
      })
      this.setData({
        inviteCode: result.inviteCode,
        inviteId: result.inviteId,
        sharePath: result.sharePath,
        invitePreview: { ...this.data.invitePreview, ...(result.invitePreview || {}) },
        generatedConfig: {
          selectedRelation: this.data.selectedRelation,
          scopes: this.data.scopes,
          contactPhone
        },
        draftDirty: false,
        submitting: false
      })
    } catch (err) {
      this.setData({
        submitting: false,
        generateError: err && err.message ? err.message : '邀请生成失败，请稍后重试',
        draftDirty: true
      })
      wx.showToast({ title: err && err.message ? err.message : '邀请生成失败', icon: 'none' })
    }
  },

  copyInvite() {
    // 脏草稿或未生成：禁止"新文案+旧码"组合
    if (!this.data.inviteCode || this.data.draftDirty) {
      wx.showToast({ title: '配置已修改或尚未生成，请重新生成邀请', icon: 'none' })
      return
    }
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
