/**
 * 稍后提醒（Snooze）服务模块。
 *
 * 设计要点：
 * - snooze 后在本地记录一条"延时提醒"任务，15 分钟后通过小程序内弹窗重新提示。
 * - 由于小程序后台无法持续运行定时器，采用"前台轮询 + 进入页面时检查到期"策略：
 *   1) snooze 时记录 dueAt（到期时间戳）；
 *   2) 用户进入提醒中心/首页时检查是否有到期项，有则弹窗提示；
 *   3) 用户点击弹窗"去确认"跳转 medConfirm，"稍后"再延 15 分钟。
 * - 同时维护一个内存中的 setTimeout（页面存活时），实现页面内即时弹窗。
 * - 所有数据本地持久化，重启小程序后仍能恢复未到期的 snooze 任务。
 */

const {
  STORAGE_KEYS,
  createRecordId,
  getRelatedCacheKeys,
  readStorage,
  writeStorageAndInvalidate
} = require('./core')
const { getTodayDateValue } = require('../utils/date-helper')

const DEFAULT_SNOOZE_MINUTES = 15

/**
 * 读取本地 snooze 任务列表。
 * @returns {Array<Object>} snooze 任务数组。
 */
function getStoredSnoozeReminders() {
  return readStorage(STORAGE_KEYS.snoozeReminders, []) || []
}

/**
 * 写入 snooze 任务列表并触发相关页面缓存失效。
 * @param {Array<Object>} list snooze 任务数组。
 * @returns {Array<Object>} 写入后的数组。
 */
function saveSnoozeRemindersLocal(list) {
  return writeStorageAndInvalidate(
    STORAGE_KEYS.snoozeReminders,
    list,
    getRelatedCacheKeys(STORAGE_KEYS.snoozeReminders)
  )
}

/**
 * 创建一条 snooze 任务。
 * @param {Object} payload snooze 任务参数。
 * @param {string} payload.logId 关联的用药确认 logId。
 * @param {string} payload.planId 用药计划 ID。
 * @param {string} payload.name 药品名称。
 * @param {string} payload.dosage 剂量。
 * @param {string} payload.time 原始提醒时间。
 * @param {number} [payload.delayMinutes=15] 延时分钟数。
 * @returns {Object} 创建的 snooze 任务。
 */
function createSnoozeReminder(payload) {
  const delayMinutes = payload.delayMinutes && payload.delayMinutes > 0
    ? payload.delayMinutes
    : DEFAULT_SNOOZE_MINUTES
  const now = Date.now()
  const dueAt = now + delayMinutes * 60 * 1000

  const reminder = {
    id: payload.id || createRecordId('snooze'),
    logId: payload.logId,
    planId: payload.planId,
    name: payload.name,
    dosage: payload.dosage || '',
    time: payload.time,
    delayMinutes,
    dueAt: new Date(dueAt).toISOString(),
    createdAt: new Date(now).toISOString(),
    confirmDate: getTodayDateValue(),
    status: 'pending'
  }

  const list = getStoredSnoozeReminders()
  // 同 logId 只保留最新一条 snooze
  const filtered = list.filter(item => item.logId !== payload.logId)
  const next = [reminder, ...filtered]
  saveSnoozeRemindersLocal(next)
  return reminder
}

/**
 * 移除指定 snooze 任务（确认或撤销时调用）。
 * @param {string} snoozeId snooze 任务 ID。
 * @returns {Object|null} 被移除的任务，不存在时返回 null。
 */
function removeSnoozeReminder(snoozeId) {
  const list = getStoredSnoozeReminders()
  const idx = list.findIndex(item => item.id === snoozeId)
  if (idx < 0) return null
  const removed = list.splice(idx, 1)[0]
  saveSnoozeRemindersLocal(list)
  return removed
}

/**
 * 按 logId 移除 snooze 任务。
 * 用药确认（taken/skipped）后调用，清理对应的 snooze。
 * @param {string} logId 用药确认 logId。
 * @returns {Object|null} 被移除的任务。
 */
function removeSnoozeReminderByLogId(logId) {
  if (!logId) return null
  const list = getStoredSnoozeReminders()
  const idx = list.findIndex(item => item.logId === logId)
  if (idx < 0) return null
  const removed = list.splice(idx, 1)[0]
  saveSnoozeRemindersLocal(list)
  return removed
}

/**
 * 获取所有已到期但未处理的 snooze 任务。
 * @returns {Array<Object>} 已到期任务数组，按到期时间升序。
 */
function getDueSnoozeReminders() {
  const now = Date.now()
  const list = getStoredSnoozeReminders()
  return list
    .filter(item => item.status === 'pending' && new Date(item.dueAt).getTime() <= now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
}

/**
 * 获取所有未到期的 snooze 任务（用于提醒中心展示"稍后提醒"分组）。
 * @returns {Array<Object>} 未到期任务数组。
 */
function getPendingSnoozeReminders() {
  const now = Date.now()
  const list = getStoredSnoozeReminders()
  return list
    .filter(item => item.status === 'pending' && new Date(item.dueAt).getTime() > now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
}

/**
 * 将到期 snooze 任务再延指定分钟（用户点击"再稍后"时调用）。
 * @param {string} snoozeId snooze 任务 ID。
 * @param {number} [delayMinutes=15] 延时分钟数。
 * @returns {Object|null} 更新后的任务，不存在时返回 null。
 */
function rescheduleSnoozeReminder(snoozeId, delayMinutes = DEFAULT_SNOOZE_MINUTES) {
  const list = getStoredSnoozeReminders()
  const idx = list.findIndex(item => item.id === snoozeId)
  if (idx < 0) return null
  const now = Date.now()
  const dueAt = now + delayMinutes * 60 * 1000
  list[idx] = {
    ...list[idx],
    dueAt: new Date(dueAt).toISOString(),
    delayMinutes,
    status: 'pending'
  }
  saveSnoozeRemindersLocal(list)
  return list[idx]
}

/**
 * 清理过期的 snooze 任务（超过 24 小时未处理）。
 * 避免本地存储无限增长。
 * @returns {number} 清理的任务数量。
 */
function cleanupExpiredSnoozeReminders() {
  const list = getStoredSnoozeReminders()
  const threshold = Date.now() - 24 * 60 * 60 * 1000
  const filtered = list.filter(item => {
    return new Date(item.dueAt).getTime() > threshold || item.status !== 'pending'
  })
  if (filtered.length !== list.length) {
    saveSnoozeRemindersLocal(filtered)
    return list.length - filtered.length
  }
  return 0
}

module.exports = {
  DEFAULT_SNOOZE_MINUTES,
  cleanupExpiredSnoozeReminders,
  createSnoozeReminder,
  getDueSnoozeReminders,
  getPendingSnoozeReminders,
  getStoredSnoozeReminders,
  removeSnoozeReminder,
  removeSnoozeReminderByLogId,
  rescheduleSnoozeReminder,
  saveSnoozeRemindersLocal
}
