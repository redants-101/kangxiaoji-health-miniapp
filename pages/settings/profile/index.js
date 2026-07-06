const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getProfileData, saveProfile: saveProfileApi } = require('../../../utils/api')

/**
 * 基础资料页。
 * 职责：维护用户称呼、使用角色、关注项目，并决定后续进入本人首页还是家属邀请流程。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    errors: {},
    pendingAction: '',
    focusField: ''
  },

  /**
   * 加载个人资料初始数据。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    const data = await loadPageData(this, getProfileData)
    if (!data) return null
    this.setData({ errors: {} })
    return data
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载资料。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '基础资料'
    })
    bindAdaptiveResize(this)
    await this.loadData()
    setTimeout(() => {
      if (!this.data.isLoading && !this.data.loadError) {
        this.setData({ focusField: 'name' })
      }
    }, 500)
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {Promise<void>} 重新拉取资料页数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 处理资料表单输入。
   * @param {Object} event input 事件；dataset.field 为 profile 字段名。
   * @returns {void} 更新 profile[field]，并同步头像首字。
   */
  handleInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    this.setData({
      [`profile.${field}`]: value,
      avatarText: field === 'name' ? (value ? value.slice(0, 1) : '妈') : this.data.avatarText,
      [`errors.${field}`]: ''
    })
  },

  /**
   * 选择使用角色。
   * @param {Object} event 点击事件；dataset.key 为 self / family。
   * @returns {void} 更新 profile.role。
   */
  selectRole(event) {
    this.setData({
      'profile.role': event.currentTarget.dataset.key
    })
  },

  /**
   * 切换关注项目。
   * @param {Object} event 点击事件；dataset.key 为关注项 key。
   * @returns {void} 更新 focusItems.checked。
   */
  toggleFocus(event) {
    const key = event.currentTarget.dataset.key
    const focusItems = this.data.focusItems.map((item) => {
      if (item.key !== key) return item
      return {
        ...item,
        checked: !item.checked
      }
    })
    this.setData({ focusItems })
  },

  /**
   * 保存基础资料。
   * @returns {Promise<void>} 保存成功后根据角色进入不同流程。
   */
  async saveProfile() {
    const errors = {}
    const name = this.data.profile.name.trim()
    const birthYear = this.data.profile.birthYear.trim()
    const currentYear = new Date().getFullYear()

    if (!name) {
      errors.name = '请填写称呼，便于本人和家属识别。'
    }
    if (birthYear && !/^\d{4}$/.test(birthYear)) {
      errors.birthYear = '出生年份请输入 4 位数字。'
    } else if (birthYear && (Number(birthYear) < 1900 || Number(birthYear) > currentYear)) {
      errors.birthYear = `出生年份请输入 1900-${currentYear} 之间的年份。`
    }

    this.setData({ errors, focusField: '' })
    if (Object.keys(errors).length) {
      const firstErrorField = Object.keys(errors)[0]
      setTimeout(() => {
        this.setData({ focusField: firstErrorField })
      }, 100)
      return
    }

    try {
      await runButtonAction(this, 'save', async () => {
        await saveProfileApi({
          profile: this.data.profile,
          avatarText: this.data.avatarText,
          roles: this.data.roles,
          focusItems: this.data.focusItems
        })
        if (this.data.profile.role === 'family') {
          goRoute('familyJoinHint')
          return
        }
        goRoute('home')
      })
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '保存失败，请稍后重试',
        icon: 'none'
      })
    }
  }
})
