const { 
  bindAdaptiveResize, 
  goRoute, 
  loadPageData, 
  clearPageLoadState,
  autoPreCheck,
  safeNavigateTo,
  unbindAdaptiveResize 
} = require('../../utils/page-factory')
const routes = require('../../utils/routes')
const { getReminderData } = require('../../utils/api')
const { markClean } = require('../../services/core')
const { checkAndShowSnoozePopup, clearSnoozePopupState } = require('../../utils/snooze-checker')
const { cleanupExpiredSnoozeReminders, getPendingSnoozeReminders } = require('../../services/snooze')
const { isAllSubscribed, isAllTemplatesConfigured, DEV_MODE } = require('../../utils/subscribe')

Page({
  data: {
    isLoading: true,
    loadError: '',
    activeTab: 'today',
    tabs: [],
    tasks: [],
    visibleTasks: [],
    showSubscribeHint: false
  },

  async loadData() {
    const data = await loadPageData(this, getReminderData)
    if (!data) return null
    this.updateSubscribeHint()
    this.updateTasks()
    return data
  },

  /**
   * 更新订阅消息未授权提示条的显示状态。
   * 仅在未全部授权时展示，引导用户去设置开启。
   * 开发模式下若模板 ID 未配置，不显示提示条（避免误导）。
   * @returns {void}
   */
  updateSubscribeHint() {
    try {
      // 开发模式下，模板 ID 未配置时不显示提示条
      if (DEV_MODE && !isAllTemplatesConfigured()) {
        this.setData({ showSubscribeHint: false })
        return
      }
      this.setData({
        showSubscribeHint: !isAllSubscribed()
      })
    } catch (e) { /* ignore */ }
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '提醒中心'
    })
    bindAdaptiveResize(this)
    this.loadData()
  },

  /**
   * 页面显示时刷新数据。
   * 用药确认后 navigateBack 返回时，任务列表需更新。
   * 同时检查是否有到期的稍后提醒，弹窗提示用户。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    this.updateSubscribeHint()
    if (this.data._loaded) {
      markClean('reminder')
      this.loadData()
    } else {
      // 首次加载由 onLoad 触发，此处仍清理过期 snooze
      cleanupExpiredSnoozeReminders()
    }
    // 检查到期 snooze 并弹窗（延迟 300ms 避免与 loadData 竞态）
    setTimeout(() => {
      try { checkAndShowSnoozePopup(this) } catch (e) { /* ignore */ }
    }, 300)
  },

  onUnload() {
    unbindAdaptiveResize(this)
    clearSnoozePopupState(this)
    if (this.route) clearPageLoadState(this.route)
  },

  async reloadPage() {
    await this.loadData()
  },

  /**
   * 下拉刷新：重新加载提醒数据。
   * @returns {Promise<void>}
   */
  async onPullDownRefresh() {
    try {
      await this.loadData()
    } catch (e) { /* ignore */ }
    wx.stopPullDownRefresh()
  },

  selectTab(event) {
    const key = event.currentTarget.dataset.key
    this.setData({
      activeTab: key
    })
    this.updateTasks()
  },

  /**
   * 合并云端任务与本地 snooze 任务，并按当前 Tab 过滤。
   * snooze 任务统一归入"今天"分组，状态标记为"稍后提醒"。
   * 任务按时间升序排列（今天/即将到来），已完成按时间倒序。
   * @returns {void}
   */
  updateTasks() {
    const cloudTasks = this.data.tasks || []
    const snoozeTasks = getPendingSnoozeReminders().map(item => {
      const dueTime = new Date(item.dueAt)
      const timeLabel = `${String(dueTime.getHours()).padStart(2, '0')}:${String(dueTime.getMinutes()).padStart(2, '0')}`
      return {
        id: `task-snooze-${item.id}`,
        tab: 'today',
        time: timeLabel,
        title: `${timeLabel} 稍后提醒`,
        meta: `${item.name} ${item.dosage || '按医嘱'}`,
        route: 'medConfirm',
        planId: item.planId,
        logId: item.logId,
        status: 'snooze',
        statusText: '去确认'
      }
    })

    // 合并：snooze 任务优先展示在用药任务之前
    const mergedTasks = [...snoozeTasks, ...cloudTasks]
    const visibleTasks = mergedTasks.filter((item) => item.tab === this.data.activeTab)

    // 按时间排序
    const sortedTasks = this.sortTasksByTime(visibleTasks)
    this.setData({ visibleTasks: sortedTasks })
  },

  /**
   * 按时间对任务排序。
   * - 今天/即将到来：按时间升序（最近的最前面）
   * - 已完成：按时间倒序（最新的最前面）
   * @param {Array} tasks 待排序任务。
   * @returns {Array} 排序后的任务。
   */
  sortTasksByTime(tasks) {
    if (!Array.isArray(tasks) || !tasks.length) return tasks

    const parseTimeToMinutes = (timeStr) => {
      if (!timeStr || typeof timeStr !== 'string') return 9999
      const match = timeStr.match(/(\d{1,2}):(\d{2})/)
      if (!match) return 9999
      return parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
    }

    const isCompleted = this.data.activeTab === 'completed'
    return [...tasks].sort((a, b) => {
      const aMin = parseTimeToMinutes(a.time)
      const bMin = parseTimeToMinutes(b.time)
      return isCompleted ? bMin - aMin : aMin - bMin
    })
  },

  handleTask(event) {
    const dataset = event.currentTarget.dataset
    const route = dataset.route
    if (dataset.toast) {
      wx.showToast({
        title: dataset.toast,
        icon: 'none'
      })
      return
    }
    if (!route) return

    // 用药确认需要携带 planId 和 logId 参数，确保多计划场景跳转正确
    if (route === 'medConfirm') {
      const params = []
      if (dataset.planId) params.push(`planId=${dataset.planId}`)
      if (dataset.logId) params.push(`logId=${dataset.logId}`)
      const url = routes[route]
      if (url) {
        safeNavigateTo(params.length ? `${url}?${params.join('&')}` : url)
      }
      return
    }

    goRoute(route)
  },

  goToReminderSettings() {
    goRoute('reminderSettings')
  },

  /**
   * 跳转到添加用药计划页面。
   * @returns {void}
   */
  goAddMedication() {
    goRoute('medEdit')
  }
})