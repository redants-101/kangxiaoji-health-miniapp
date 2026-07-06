/**
 * Snooze 到期检查与弹窗工具。
 *
 * 使用场景：
 * - 首页 onShow 时调用，检查是否有到期 snooze，弹窗提示用户。
 * - 提醒中心 onShow 时调用，同上。
 * - 弹窗后用户操作：
 *   - "去确认" → 跳转 medConfirm，并移除该 snooze 任务。
 *   - "再稍后" → 调用 rescheduleSnoozeReminder 再延 15 分钟。
 *   - "忽略" → 仅关闭弹窗，snooze 任务保留（下次进入页面再提示）。
 *
 * 防打扰策略：
 * - 同一条 snooze 任务在一次小程序会话内只弹一次（通过 _shownSnoozeIds 记录）。
 * - 距离上次弹窗不足 30 秒时不重复弹（避免页面切换反复弹）。
 */

const { getDueSnoozeReminders, removeSnoozeReminder, rescheduleSnoozeReminder } = require('../services/snooze')
const { safeNavigateTo } = require('./route-guard')

const SHOWN_SET_KEY = '_shownSnoozeIds'
const LAST_POPUP_KEY = '_lastSnoozePopupAt'
const MIN_POPUP_INTERVAL_MS = 30 * 1000

/**
 * 检查并弹出到期的 snooze 提醒。
 * @param {Object} page 页面实例（用于记录已弹过的 snooze ID）。
 * @param {Object} [options] 可选参数。
 * @param {boolean} [options.force] true 时跳过防打扰间隔检查。
 * @returns {void}
 */
function checkAndShowSnoozePopup(page, options = {}) {
  if (typeof wx === 'undefined' || !wx.showModal) return

  const dueReminders = getDueSnoozeReminders()
  if (!dueReminders.length) return

  // 防打扰：30 秒内不重复弹窗
  const now = Date.now()
  if (!options.force && page && page[LAST_POPUP_KEY] && now - page[LAST_POPUP_KEY] < MIN_POPUP_INTERVAL_MS) {
    return
  }

  // 防重复：同一条 snooze 在一次会话内只弹一次
  if (!page) return
  if (!page[SHOWN_SET_KEY]) page[SHOWN_SET_KEY] = new Set()

  const target = dueReminders.find(item => !page[SHOWN_SET_KEY].has(item.id))
  if (!target) return

  page[SHOWN_SET_KEY].add(target.id)
  page[LAST_POPUP_KEY] = now

  const dueTime = new Date(target.dueAt)
  const timeLabel = `${String(dueTime.getHours()).padStart(2, '0')}:${String(dueTime.getMinutes()).padStart(2, '0')}`

  wx.showModal({
    title: '稍后提醒已到时',
    content: `${timeLabel} 该服药了：${target.name} ${target.dosage || '按医嘱'}`,
    confirmText: '去确认',
    cancelText: '再稍后',
    confirmColor: '#168957',
    success(result) {
      if (result.confirm) {
        // 跳转用药确认页，并清理该 snooze 任务
        removeSnoozeReminder(target.id)
        const params = [`planId=${target.planId}`, `logId=${target.logId}`]
        safeNavigateTo(`/pages/medication/med-confirm/index?${params.join('&')}`)
      } else if (result.cancel) {
        // 再延 15 分钟
        rescheduleSnoozeReminder(target.id)
        // 从已弹集合移除，下次到期可再弹
        if (page[SHOWN_SET_KEY]) page[SHOWN_SET_KEY].delete(target.id)
        wx.showToast({
          title: '已延后 15 分钟',
          icon: 'none',
          duration: 1500
        })
      }
    }
  })
}

/**
 * 清理页面实例上的 snooze 弹窗状态（页面卸载时调用）。
 * @param {Object} page 页面实例。
 * @returns {void}
 */
function clearSnoozePopupState(page) {
  if (!page) return
  if (page[SHOWN_SET_KEY]) page[SHOWN_SET_KEY].clear()
  page[LAST_POPUP_KEY] = 0
}

module.exports = {
  checkAndShowSnoozePopup,
  clearSnoozePopupState
}
