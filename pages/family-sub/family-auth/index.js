const {
  bindAdaptiveResize,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getFamilyAuthData, updateFamilyAuth, setFamilyContactPhone } = require('../../../utils/api')
const { noticeRulesToList } = require('../../../services/family')

// A6：提醒电话客户端预检（与云端 family-policy CONTACT_PHONE_PATTERN 同规则；
// 云端仍会独立校验，客户端拦截只为省一次网络往返）
const CONTACT_PHONE_PATTERN = /^1[3-9]\d{9}$/

/**
 * 家属权限页。
 * 职责：管理某个家属可查看的数据范围、提醒规则，并持久化授权设置。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    memberId: '',
    pendingAction: '',
    noticeRuleItems: [],
    // A1：无绑定成员（邀请预览）时禁止提交改权
    canEdit: false,
    // A6：提醒电话（owner 家庭授权配置；本人页可回读完整号用于编辑）
    contactPhone: '',
    contactPhoneMasked: '',
    contactPhoneInput: '',
    contactPhoneError: '',
    savingPhone: false
  },

  /**
   * 加载授权设置。noticeRules 存储为对象，渲染前显式转为列表。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    const data = await loadPageData(this, () => getFamilyAuthData(this.data.memberId))
    if (data) {
      this.setData({
        noticeRuleItems: noticeRulesToList(data.noticeRules),
        canEdit: !!this.data.memberId,
        contactPhone: data.contactPhone || '',
        contactPhoneMasked: data.contactPhoneMasked || '',
        contactPhoneInput: data.contactPhone || '',
        contactPhoneError: ''
      })
    }
    return data
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
  },

  /** @returns {Promise<void>} 重新拉取授权数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 切换权限开关（read/write/remind 独立，互不联动）。
   * @param {Object} event switch 事件；dataset.key/field 标识权限项与字段。
   * @returns {void} 更新 scopes。
   */
  toggleScope(event) {
    const { key, field } = event.currentTarget.dataset
    const value = event.detail.value
    const scopes = this.data.scopes.map((item) => {
      if (item.key !== key) return item
      return {
        ...item,
        [field]: value
      }
    })
    this.setData({ scopes })
  },

  /**
   * 切换家属提醒规则：更新 noticeRules 对象并刷新展示列表。
   * @param {Object} event switch 事件；dataset.key 为提醒规则 key。
   * @returns {void}
   */
  toggleNoticeRule(event) {
    const key = event.currentTarget.dataset.key
    const enabled = event.detail.value
    const noticeRules = {
      ...(this.data.noticeRules || {}),
      [key]: enabled
    }
    this.setData({
      noticeRules,
      noticeRuleItems: noticeRulesToList(noticeRules)
    })
  },

  /**
   * A6：提醒电话输入（清除错误提示；保存动作需显式点击）。
   * @param {Object} event input 事件。
   * @returns {void}
   */
  handlePhoneInput(event) {
    this.setData({ contactPhoneInput: event.detail.value, contactPhoneError: '' })
  },

  /**
   * A6：保存提醒电话。客户端先做格式预检，云端仍独立校验；
   * 以云端响应为准，失败显式提示、不本地假成功。
   * @returns {Promise<void>}
   */
  async saveContactPhone() {
    const value = String(this.data.contactPhoneInput || '').trim()
    if (!value) {
      this.setData({ contactPhoneError: '请先填写手机号' })
      wx.showToast({ title: '请先填写手机号', icon: 'none' })
      return
    }
    if (!CONTACT_PHONE_PATTERN.test(value)) {
      this.setData({ contactPhoneError: '电话格式不正确，请填写 11 位手机号' })
      wx.showToast({ title: '电话格式不正确', icon: 'none' })
      return
    }
    this.setData({ savingPhone: true })
    try {
      const res = await setFamilyContactPhone({ contactPhone: value })
      this.setData({
        savingPhone: false,
        contactPhone: value,
        contactPhoneMasked: (res && res.contactPhoneMasked) || '',
        contactPhoneError: ''
      })
      wx.showToast({ title: '提醒电话已保存', icon: 'none' })
    } catch (error) {
      this.setData({ savingPhone: false })
      wx.showToast({
        title: error && error.message ? error.message : '保存失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  /**
   * A6：清空提醒电话（清空后家属端立即变为未配置状态，接口不再回传号码）。
   * @returns {Promise<void>}
   */
  async clearContactPhone() {
    this.setData({ savingPhone: true })
    try {
      await setFamilyContactPhone({ contactPhone: '' })
      this.setData({
        savingPhone: false,
        contactPhone: '',
        contactPhoneInput: '',
        contactPhoneMasked: '',
        contactPhoneError: ''
      })
      wx.showToast({ title: '提醒电话已清空', icon: 'none' })
    } catch (error) {
      this.setData({ savingPhone: false })
      wx.showToast({
        title: error && error.message ? error.message : '清空失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  /**
   * 保存家属授权。
   * @returns {Promise<void>} 调用 updateFamilyAuth 写入当前授权范围和提醒规则。
   */
  async saveAuth() {
    if (!this.data.memberId) {
      wx.showToast({ title: '请先从家庭页选择要管理的家属', icon: 'none' })
      return
    }
    try {
      await runButtonAction(this, 'save', async () => {
        await updateFamilyAuth({
          memberId: this.data.memberId,
          member: this.data.member,
          scopes: this.data.scopes,
          noticeRules: this.data.noticeRules
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
  }
})
