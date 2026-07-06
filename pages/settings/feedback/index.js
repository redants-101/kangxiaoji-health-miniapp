const {
  bindAdaptiveResize,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getFeedbackData, submitFeedback: submitFeedbackApi } = require('../../../utils/api')

const MIN_CONTENT_LENGTH = 5
const MAX_CONTENT_LENGTH = 300
const CONTACT_MAX_LENGTH = 50

/**
 * 意见反馈页。
 * 职责：收集问题类型、反馈内容和联系方式，含表单验证与提交状态提示。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    pendingAction: '',
    errors: {},
    MIN_CONTENT_LENGTH,
    MAX_CONTENT_LENGTH
  },

  async loadData() {
    return loadPageData(this, getFeedbackData).then(() => {
      if (!this.data.form) {
        this.setData({ form: { content: '', contact: '' } })
      }
      if (!this.data.activeType && this.data.types && this.data.types.length) {
        this.setData({ activeType: this.data.types[0].value || this.data.types[0].key })
      }
    })
  },

  async onLoad() {
    wx.setNavigationBarTitle({ title: '意见反馈' })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  async reloadPage() {
    await this.loadData()
  },

  selectType(event) {
    this.setData({
      activeType: event.currentTarget.dataset.key,
      'errors.type': ''
    })
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    const nextData = {
      [`form.${field}`]: value,
      [`errors.${field}`]: ''
    }
    if (field === 'content') {
      nextData.contentLength = value.length
    }
    this.setData(nextData)
  },

  validateForm() {
    const { form = {}, activeType } = this.data
    const errors = {}

    if (!activeType) {
      errors.type = '请选择问题类型'
    }

    const content = (form.content || '').trim()
    if (!content) {
      errors.content = '请填写问题描述'
    } else if (content.length < MIN_CONTENT_LENGTH) {
      errors.content = `问题描述至少 ${MIN_CONTENT_LENGTH} 个字`
    }

    const contact = (form.contact || '').trim()
    if (contact && contact.length > CONTACT_MAX_LENGTH) {
      errors.contact = `联系方式不超过 ${CONTACT_MAX_LENGTH} 个字`
    }

    this.setData({ errors })
    return Object.keys(errors).length === 0
  },

  async submitFeedback() {
    if (!this.validateForm()) return

    try {
      await runButtonAction(this, 'submit', async () => {
        await submitFeedbackApi({
          type: this.data.activeType,
          content: this.data.form.content.trim(),
          contact: this.data.form.contact.trim()
        })

        wx.showToast({ title: '反馈已提交，感谢你的建议', icon: 'none', duration: 2500 })
        this.setData({
          contentLength: 0,
          form: { content: '', contact: '' },
          errors: {}
        })
      })
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '提交失败，请稍后重试',
        icon: 'none'
      })
    }
  }
})
