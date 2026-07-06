const {
  bindAdaptiveResize,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize,
  safeNavigateBack
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getMedConfirmData, confirmMedication } = require('../../../utils/api')
const { createSnoozeReminder, removeSnoozeReminderByLogId } = require('../../../services/snooze')
const { promptSubscribeAfterAction } = require('../../../utils/subscribe-prompt')
const routes = require('../../../utils/routes')

Page({
  data: {
    isLoading: true,
    loadError: '',
    pendingAction: '',
    sourcePlanId: '',
    targetLogId: ''
  },

  async loadData() {
    const planId = this.data.sourcePlanId
    const logId = this.data.targetLogId
    return loadPageData(this, () => getMedConfirmData(planId, logId))
  },

  async onLoad(options = {}) {
    this.setData({
      sourcePlanId: options.planId || '',
      targetLogId: options.logId || ''
    })
    wx.setNavigationBarTitle({
      title: '服药确认'
    })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
    if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null }
  },

  async reloadPage() {
    await this.loadData()
  },

  async markTaken() {
    if (!this.data.medication) {
      wx.showToast({ title: '暂无待确认用药', icon: 'none' })
      return
    }
    try {
      await runButtonAction(this, 'taken', async () => {
        await confirmMedication({
          logId: this.data.medication.logId,
          time: this.data.medication.time,
          name: this.data.medication.name,
          dosage: this.data.medication.dosage,
          status: 'taken',
          statusText: '已服'
        })
        // 确认已服后清理对应的 snooze 任务，避免到期后再次弹窗
        removeSnoozeReminderByLogId(this.data.medication.logId)
        this.setData({
          lastAction: '已记录为已服。',
          lastActionLevel: ''
        })
        wx.showToast({
          title: '已记录',
          icon: 'success'
        })
      })
      // 确认成功后，引导授权下次用药提醒（事件驱动，累积订阅次数）
      // 不阻塞返回流程，授权弹窗在返回前展示
      this._promptNextReminder()
      this._navTimer = setTimeout(() => safeNavigateBack(routes.home), 800)
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '记录失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  /**
   * 引导授权下次用药提醒。
   * 事件驱动授权：用户完成确认后，累积 1 次微信推送权限。
   * 防打扰：24 小时内同一场景只引导 1 次，拒绝后 7 天冷却。
   * @returns {void}
   */
  _promptNextReminder() {
    promptSubscribeAfterAction(['medicine'], { scene: 'med-confirm-taken' })
      .then(result => {
        if (result.ok) {
          wx.showToast({
            title: '已开启下次微信提醒',
            icon: 'success',
            duration: 1500
          })
        }
      })
      .catch(() => { /* 静默处理，不阻塞业务 */ })
  },

  async snooze() {
    if (!this.data.medication) {
      wx.showToast({ title: '暂无待确认用药', icon: 'none' })
      return
    }
    try {
      await runButtonAction(this, 'snooze', async () => {
        await confirmMedication({
          logId: this.data.medication.logId,
          time: this.data.medication.time,
          name: this.data.medication.name,
          dosage: this.data.medication.dosage,
          status: 'snoozed',
          statusText: '稍后提醒'
        })
        // 创建本地延时提醒任务，15 分钟后在提醒中心/首页弹窗重新提示
        createSnoozeReminder({
          logId: this.data.medication.logId,
          planId: this.data.medication.planId,
          name: this.data.medication.name,
          dosage: this.data.medication.dosage,
          time: this.data.medication.time
        })
        this.setData({
          lastAction: '已设置稍后提醒。15 分钟后将在提醒中心重新提示；未开启微信提醒时也可在这里查看。',
          lastActionLevel: ''
        })
        wx.showToast({
          title: '稍后提醒',
          icon: 'none'
        })
      })
      this._navTimer = setTimeout(() => safeNavigateBack(routes.home), 800)
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '记录失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  skip() {
    if (!this.data.medication) {
      wx.showToast({ title: '暂无待确认用药', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认跳过本次记录？',
      content: '康小记不会判断是否需要补服，请按医生或药师指导用药。',
      confirmText: '确认跳过',
      confirmColor: '#C8463A',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await runButtonAction(this, 'skip', async () => {
            await confirmMedication({
              logId: this.data.medication.logId,
              time: this.data.medication.time,
              name: this.data.medication.name,
              dosage: this.data.medication.dosage,
              status: 'skipped',
              statusText: '已跳过'
            })
            // 跳过后也清理对应的 snooze 任务
            removeSnoozeReminderByLogId(this.data.medication.logId)
            this.setData({
              lastAction: '已记录为跳过。请按医生或药师指导用药。',
              lastActionLevel: 'warn'
            })
            wx.showToast({
              title: '已记录',
              icon: 'none'
            })
          })
          // 跳过后也引导授权下次用药提醒
          this._promptNextReminder()
          this._navTimer = setTimeout(() => safeNavigateBack(routes.home), 800)
        } catch (error) {
          wx.showToast({
            title: error && error.message ? error.message : '记录失败，请稍后重试',
            icon: 'none'
          })
        }
      }
    })
  }
})
