const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  safeNavigateTo,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { getMedListData, deleteMedicationPlan, toggleMedicationPlanStatus, revokeMedicationConfirmation, confirmMedication, familyConfirmMedication, familyRevokeProxyConfirmation } = require('../../../utils/api')
const { removeSnoozeReminderByLogId } = require('../../../services/snooze')
const { promptSubscribeAfterAction } = require('../../../utils/subscribe-prompt')

Page({
  data: {
    isLoading: true,
    loadError: '',
    isFamilyView: false,
    familyDenied: false
  },

  async loadData() {
    return loadPageData(this, () => getMedListData(this.data.isFamilyView || undefined)).then((data) => {
      try {
        this.setData({
          _loaded: true,
          familyDenied: !!(data && data.familyView && data.familyView.allowed === false),
          familyCanConfirm: !!(data && data.familyView && data.familyView.writePermissions && data.familyView.writePermissions.medicine)
        })
      } catch (e) { /* 页面可能已销毁 */ }
    })
  },

  async onLoad(options = {}) {
    wx.setNavigationBarTitle({
      title: '用药提醒'
    })
    bindAdaptiveResize(this)
    // A3 家属只读视图：写入口全部禁用
    if (options.familyView === '1' || options.familyView === true) {
      this.setData({ isFamilyView: true })
    }
    await this.loadData()
  },

  /** A3：家属视图只读守卫；命中则提示并返回 true。 */
  _familyReadOnly() {
    if (this.data.isFamilyView) {
      wx.showToast({ title: '家属视图为只读', icon: 'none' })
      return true
    }
    return false
  },

  onShow() {
    if (this.data._loaded) {
      this.loadData()
    }
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  async reloadPage() {
    await this.loadData()
  },

  handleCardTap(event) {
    if (this._familyReadOnly()) return
    const id = event.currentTarget.dataset.id
    const pendingIndex = event.currentTarget.dataset.pendingIndex
    if (pendingIndex >= 0) {
      const card = this.data.todayCards.find(c => c.id === id)
      const logId = card && card.logs && card.logs[pendingIndex] ? card.logs[pendingIndex].id : ''
      safeNavigateTo(`/pages/medication/med-confirm/index?planId=${id}&logId=${logId}`)
      return
    }
    if (id) {
      safeNavigateTo(`/pages/medication/med-edit/index?id=${id}`)
    }
  },

  handleConfirmTap(event) {
    // A4 家属态：代确认（已服）走家属写路由；无写权限时只读提示
    if (this.data.isFamilyView) {
      if (!this.data.familyCanConfirm) {
        this._familyReadOnly()
        return
      }
      this.handleFamilyConfirm(event, 'taken')
      return
    }
    const planId = event.currentTarget.dataset.planId
    const logId = event.currentTarget.dataset.logId
    if (!planId) return
    safeNavigateTo(`/pages/medication/med-confirm/index?planId=${planId}&logId=${logId || ''}`)
  },

  /** A4 家属代确认（已服/跳过）；以云端响应为准，拒绝不本地假成功。 */
  async handleFamilyConfirm(event, status) {
    const dataset = event.currentTarget.dataset
    const logId = dataset.logId
    if (!logId) return
    try {
      const res = await familyConfirmMedication({
        logId,
        time: dataset.time || '',
        name: dataset.name || '',
        dosage: dataset.dosage || '',
        status
      })
      if (res && res.familyWrite && res.familyWrite.allowed === false) {
        wx.showToast({ title: '代确认被拒绝：' + (res.familyWrite.reason || '无权限'), icon: 'none' })
        return
      }
      wx.showToast({ title: status === 'taken' ? '已确认已服' : '已记录跳过', icon: 'success' })
      await this.loadData()
    } catch (error) {
      wx.showToast({ title: error && error.message ? error.message : '代确认失败', icon: 'none' })
    }
  },

  handleLogTap(event) {
    if (this.data.isFamilyView && event.currentTarget.dataset.action !== 'view' && event.currentTarget.dataset.action !== 'none') {
      this._familyReadOnly()
      return
    }
    const action = event.currentTarget.dataset.action
    const logId = event.currentTarget.dataset.logId
    const planId = event.currentTarget.dataset.planId

    if (action === 'confirm') {
      safeNavigateTo(`/pages/medication/med-confirm/index?planId=${planId}&logId=${logId}`)
      return
    }
    if (action === 'revoke') {
      this._revokeByLogId(logId)
      return
    }
    if (action === 'view') {
      wx.showToast({ title: '已确认', icon: 'none' })
      return
    }
    if (action === 'none') return
  },

  _doRevoke(logId) {
    wx.showModal({
      title: '撤销本次确认？',
      content: '撤销后，该时间点将恢复为待确认状态。',
      confirmText: '撤销',
      confirmColor: '#b36b00',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await revokeMedicationConfirmation(logId)
          wx.showToast({ title: '已撤销', icon: 'success' })
          await this.loadData()
        } catch (error) {
          wx.showToast({
            title: error && error.message ? error.message : '撤销失败',
            icon: 'none'
          })
        }
      }
    })
  },

  handleRevokeConfirmation(event) {
    // A4 家属态：仅撤销本人本次代确认（wxml 仅对 canRevokeProxy 项显示按钮）
    if (this.data.isFamilyView) {
      const logId = event.currentTarget.dataset.logId
      if (!logId) return
      this._familyRevokeProxy(logId)
      return
    }
    const logId = event.currentTarget.dataset.logId
    if (!logId) return
    this._doRevoke(logId)
  },

  /** A4 家属撤销本人代确认；以云端响应为准。 */
  async _familyRevokeProxy(logId) {
    try {
      const res = await familyRevokeProxyConfirmation({ logId })
      if (res && res.familyWrite && res.familyWrite.allowed === false) {
        wx.showToast({ title: res.familyWrite.reason === 'notFound' ? '该确认不可撤销' : '撤销被拒绝', icon: 'none' })
        return
      }
      wx.showToast({ title: '已撤销', icon: 'success' })
      await this.loadData()
    } catch (error) {
      wx.showToast({ title: error && error.message ? error.message : '撤销失败', icon: 'none' })
    }
  },

  _revokeByLogId(logId) {
    if (!logId) return
    this._doRevoke(logId)
  },

  async handleBatchConfirm() {
    if (this._familyReadOnly()) return
    const cards = this.data.todayCards
    if (!cards || !cards.length) return

    const pendingItems = []
    cards.forEach(card => {
      if (!card.logs) return
      card.logs.forEach(log => {
        if (log.status === 'pending' || log.status === 'snoozed') {
          pendingItems.push({
            planId: card.id,
            logId: log.id,
            time: log.time,
            name: card.name,
            dosage: card.dosage
          })
        }
      })
    })

    if (!pendingItems.length) {
      wx.showToast({ title: '没有待确认的用药', icon: 'none' })
      return
    }

    wx.showModal({
      title: '批量确认全部已服？',
      content: `将标记 ${pendingItems.length} 个待确认项为"已服"，请确保已按医嘱服药。`,
      confirmText: '全部已服',
      confirmColor: '#168957',
      success: async (result) => {
        if (!result.confirm) return
        try {
          for (const item of pendingItems) {
            await confirmMedication({
              logId: item.logId,
              time: item.time,
              name: item.name,
              dosage: item.dosage,
              status: 'taken',
              statusText: '已服'
            })
            // 批量确认后清理对应的 snooze 任务
            removeSnoozeReminderByLogId(item.logId)
          }
          wx.showToast({ title: '已全部确认', icon: 'success' })
          // 批量确认后引导授权下次用药提醒（事件驱动）
          promptSubscribeAfterAction(['medicine'], { scene: 'med-list-batch' })
            .then(subscribeResult => {
              if (subscribeResult.ok) {
                wx.showToast({
                  title: '已开启下次微信提醒',
                  icon: 'success',
                  duration: 1500
                })
              }
            })
            .catch(() => { /* 静默处理 */ })
          await this.loadData()
        } catch (error) {
          wx.showToast({
            title: error && error.message ? error.message : '批量确认失败',
            icon: 'none'
          })
          await this.loadData()
        }
      }
    })
  },

  editPlan(event) {
    if (this._familyReadOnly()) return
    const id = event.currentTarget.dataset.id
    safeNavigateTo(id ? `/pages/medication/med-edit/index?id=${id}` : '/pages/medication/med-edit/index')
  },

  handlePlanLongPress(event) {
    if (this._familyReadOnly()) return
    const id = event.currentTarget.dataset.id
    const status = event.currentTarget.dataset.status
    if (!id) return

    const toggleLabel = status === '启用' ? '停用计划' : '重新启用'
    wx.showActionSheet({
      itemList: [toggleLabel, '删除计划'],
      itemColor: '#14201a',
      success: async (res) => {
        if (res.tapIndex === 0) {
          await this.handleTogglePlan(id, status)
        } else if (res.tapIndex === 1) {
          await this.handleDeletePlan(id)
        }
      }
    })
  },

  async handleTogglePlan(planId, currentStatus) {
    if (this._familyReadOnly()) return
    try {
      await toggleMedicationPlanStatus(planId, currentStatus)
      wx.showToast({ title: '状态已更新', icon: 'success' })
      await this.loadData()
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '操作失败',
        icon: 'none'
      })
    }
  },

  async handleDeletePlan(planId) {
    if (this._familyReadOnly()) return
    wx.showModal({
      title: '确认删除该用药计划？',
      content: '删除后，该计划的所有提醒将不再显示。',
      confirmText: '删除',
      confirmColor: '#C8463A',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await deleteMedicationPlan(planId)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadData()
        } catch (error) {
          wx.showToast({
            title: error && error.message ? error.message : '删除失败',
            icon: 'none'
          })
        }
      }
    })
  },

  goMedEdit() {
    if (this._familyReadOnly()) return
    goRoute('medEdit')
  },

  goMedHistory() {
    safeNavigateTo('/pages/medication/med-history/index' + (this.data.isFamilyView ? '?familyView=1' : ''))
  }
})
