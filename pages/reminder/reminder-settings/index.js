const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  safeNavigateBack,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getReminderSettingsData, saveReminderSettings } = require('../../../utils/api')
const { markDirty } = require('../../../services/core')
const {
  requestSubscription,
  buildSubscriptionDisplay,
  isAllSubscribed,
  isSubscribed,
  isAllTemplatesConfigured,
  DEV_MODE,
  getRemainingQuota
} = require('../../../utils/subscribe')

/**
 * 提醒设置页。
 * 职责：管理提醒开关、时间和静默模式，并持久化到本地或云端。
 * 同时提供订阅消息授权入口，引导用户开启微信提醒。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    pendingAction: ''
  },

  /**
   * 加载提醒设置数据。
   * 加载完成后合并本地订阅授权状态，确保展示最新。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData() {
    return loadPageData(this, getReminderSettingsData).then(() => {
      this.refreshSubscriptionDisplay()
    })
  },

  /**
   * 刷新订阅消息授权状态展示。
   * 从本地存储读取授权记录，覆盖云端返回的 subscription 字段。
   * 同时展示剩余订阅次数和各模板独立授权状态。
   * @returns {void}
   */
  refreshSubscriptionDisplay() {
    const display = buildSubscriptionDisplay()
    const medicineQuota = getRemainingQuota('medicine')
    const measureQuota = getRemainingQuota('measure')
    const weeklyReportQuota = getRemainingQuota('weeklyReport')
    const totalQuota = medicineQuota + measureQuota + weeklyReportQuota

    // 各模板独立授权状态
    const templateStatus = [
      { key: 'medicine', label: '用药提醒', authorized: isSubscribed('medicine'), quota: medicineQuota },
      { key: 'measure', label: '测量提醒', authorized: isSubscribed('measure'), quota: measureQuota },
      { key: 'weeklyReport', label: '健康周报', authorized: isSubscribed('weeklyReport'), quota: weeklyReportQuota }
    ]

    try {
      this.setData({
        subscription: {
          title: '微信提醒',
          meta: display.meta,
          status: display.status,
          allSubscribed: isAllSubscribed(),
          templateStatus,
          quota: {
            medicine: medicineQuota,
            measure: measureQuota,
            weeklyReport: weeklyReportQuota,
            total: totalQuota
          },
          quotaText: totalQuota > 0
            ? `剩余推送次数：用药${medicineQuota}次、测量${measureQuota}次、周报${weeklyReportQuota}次`
            : '暂无推送次数，完成用药确认等操作时可累积'
        }
      })
    } catch (e) { /* 页面可能已销毁 */ }
  },

  /**
   * 页面加载生命周期。
   * @returns {Promise<void>} 设置标题并加载提醒设置。
   */
  async onLoad() {
    wx.setNavigationBarTitle({
      title: '提醒设置'
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

  /** @returns {Promise<void>} 重新拉取提醒设置。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 切换提醒项开关。
   * 切换后展示即时反馈，提示用户记得保存。
   * @param {Object} event switch 事件；dataset.key 为提醒项 key。
   * @returns {void} 更新 reminders 数组中的 enabled 状态。
   */
  toggleReminder(event) {
    const key = event.currentTarget.dataset.key
    const enabled = event.detail.value
    const reminders = this.data.reminders.map((item) => {
      if (item.key !== key) return item
      return {
        ...item,
        enabled
      }
    })
    this.setData({ reminders })

    // 即时反馈
    const target = reminders.find(r => r.key === key)
    if (target) {
      wx.showToast({
        title: `${target.title}已${enabled ? '开启' : '关闭'}`,
        icon: 'none',
        duration: 1200
      })
    }
  },

  /**
   * 切换静默模式。
   * @param {Object} event switch 事件。
   * @returns {void} 更新 quietMode。
   */
  toggleQuietMode(event) {
    this.setData({
      quietMode: event.detail.value
    })
  },

  /**
   * 修改提醒时间。
   * @param {Object} event picker change 事件。
   * @returns {void} 更新对应 timePlan 的时间。
   */
  changeTimePlan(event) {
    const id = event.currentTarget.dataset.id
    const time = event.detail.value
    const timePlans = this.data.timePlans.map((item) => {
      if (item.id !== id) return item
      return { ...item, time }
    })
    this.setData({ timePlans })
    wx.showToast({
      title: '时间已更新，记得保存',
      icon: 'none',
      duration: 1500
    })
  },

  /**
   * 调起微信订阅消息授权弹窗。
   * 授权三类模板：用药、测量、周报。
   * 授权完成后刷新展示状态。
   * @returns {Promise<void>}
   */
  async handleSubscribe() {
    // 检查模板 ID 是否已配置
    if (!isAllTemplatesConfigured()) {
      if (DEV_MODE) {
        // 开发模式：提示模板未配置，不阻塞
        wx.showModal({
          title: '订阅消息模板未配置',
          content: '当前为开发模式，订阅消息模板 ID 未配置，无法调起微信授权弹窗。\n\n如需测试完整授权流程，请在 utils/subscribe-config.js 中配置真实模板 ID。\n\n点击"确定"继续，用药计划仍可保存，提醒中心功能正常使用。',
          showCancel: false,
          confirmText: '确定'
        })
        return
      }

      // 生产模式：提示配置模板 ID
      wx.showModal({
        title: '订阅消息未配置',
        content: '订阅消息模板 ID 未配置，无法开启微信提醒。请联系开发者在 utils/subscribe-config.js 中配置真实模板 ID。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    try {
      await runButtonAction(this, 'subscribe', async () => {
        const result = await requestSubscription(
          ['medicine', 'measure', 'weeklyReport'],
          { silent: false }
        )
        this.refreshSubscriptionDisplay()
        if (result.ok) {
          wx.showToast({
            title: '微信提醒已开启',
            icon: 'success',
            duration: 1500
          })
        }
      })
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '授权失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  /**
   * 返回上一页。
   * @returns {void}
   */
  goBack() {
    if (getCurrentPages().length > 1) {
      safeNavigateBack()
      return
    }
    goRoute('reminder')
  },

  /**
   * 恢复默认设置。
   * 重置提醒开关、提醒时间和免打扰模式为默认值。
   * @returns {void}
   */
  resetToDefault() {
    wx.showModal({
      title: '恢复默认设置？',
      content: '将重置提醒开关、提醒时间和免打扰模式为默认值，不影响订阅消息授权状态。',
      confirmText: '恢复默认',
      cancelText: '取消',
      confirmColor: '#168957',
      success: (result) => {
        if (!result.confirm) return
        // 重置为默认值
        this.setData({
          reminders: [
            { key: 'medicine', iconSrc: '/assets/icons/icon-data.png', title: '用药提醒', meta: '到点提醒确认是否已服药', enabled: true },
            { key: 'measure', iconSrc: '/assets/icons/icon-data.png', title: '测量提醒', meta: '按设定时间提醒记录血压或血糖', enabled: true },
            { key: 'weeklyReport', iconSrc: '/assets/icons/icon-data.png', title: '周报提醒', meta: '每周一生成健康周报', enabled: true }
          ],
          timePlans: [
            { id: 'morning', label: '晨起用药', time: '07:00' },
            { id: 'evening', label: '睡前用药', time: '21:00' }
          ],
          quietMode: false
        })
        wx.showToast({
          title: '已恢复默认，记得保存',
          icon: 'none',
          duration: 1500
        })
      }
    })
  },

  /**
   * 保存提醒设置。
   * 保存成功后标记提醒中心数据为脏，确保返回后刷新。
   * @returns {Promise<void>} 收集所有设置并调用 saveReminderSettings 持久化。
   */
  async saveSettings() {
    try {
      await runButtonAction(this, 'save', async () => {
        await saveReminderSettings({
          reminders: this.data.reminders,
          timePlans: this.data.timePlans,
          quietMode: this.data.quietMode,
          subscription: this.data.subscription
        })
        // 标记提醒中心数据为脏，返回后自动刷新
        markDirty(['reminder', 'home'])
        wx.showToast({
          title: '提醒设置已保存',
          icon: 'none'
        })
        this._navTimer = setTimeout(() => {
          this.goBack()
        }, 500)
      })
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '保存失败，请稍后重试',
        icon: 'none'
      })
    }
  }
})
