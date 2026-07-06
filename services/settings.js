const {
  STORAGE_KEYS,
  getRelatedCacheKeys,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorageAndInvalidate
} = require('./core')
const { mergeReminderMedicationStatus } = require('./medication')
const { getStoredMedicationConfirmations } = require('./medication-confirm')
const { deepMerge, mergeArrayItemDefaults, withMockPageData } = require('./page-data')
const { getTodayDateValue } = require('../utils/date-helper')

/**
 * 提醒设置服务模块。
 * 负责提醒中心任务过滤、提醒设置读取和本地持久化。
 */

/** @returns {Object|null} 本地提醒设置。 */
function getStoredReminderSettings() {
  return readStorage(STORAGE_KEYS.reminderSettings, null)
}

/**
 * 本地保存提醒设置。
 * @param {Object} payload 提醒设置页完整数据。
 * @returns {Object} 保存后的提醒设置。
 */
function saveReminderSettingsLocal(payload) {
  return writeStorageAndInvalidate(STORAGE_KEYS.reminderSettings, {
    ...payload,
    updatedAt: new Date().toISOString()
  }, getRelatedCacheKeys(STORAGE_KEYS.reminderSettings))
}

/**
 * 根据本地提醒设置过滤提醒任务。
 * 已完成分组的任务不受开关影响，始终保留。
 * @param {Object} baseData mockData.reminder。
 * @returns {Object} 已过滤关闭项后的提醒数据。
 */
function applyReminderSettings(baseData) {
  const settings = getStoredReminderSettings()
  if (!settings || !settings.reminders) return baseData
  const isEnabled = (key) => {
    const item = settings.reminders.find((reminder) => reminder.key === key)
    return !item || item.enabled
  }
  const tasks = Array.isArray(baseData.tasks) ? baseData.tasks : []
  return {
    ...baseData,
    tasks: tasks.filter((task) => {
      // 已完成分组不过滤
      if (task.tab === 'completed') return true
      if (task.route === 'medConfirm') return isEnabled('medicine')
      if (task.route === 'recordBp' || task.route === 'recordBg') return isEnabled('measure')
      if (task.route === 'trend') return isEnabled('weeklyReport')
      return true
    })
  }
}

/**
 * 合并本地提醒设置到提醒设置页。
 * @param {Object} baseData mockData.reminderSettings。
 * @returns {Object} 提醒设置页数据。
 */
function mergeReminderSettings(baseData) {
  const storedSettings = getStoredReminderSettings()
  if (!storedSettings) return baseData
  const merged = {
    ...baseData,
    ...storedSettings
  }
  return {
    ...merged,
    reminders: mergeArrayItemDefaults(baseData.reminders, merged.reminders, 'key'),
    timePlans: mergeArrayItemDefaults(baseData.timePlans, merged.timePlans, 'id')
  }
}

/**
 * 确保提醒任务中包含周报任务。
 * 云端数据可能不包含周报任务，在此补齐默认项。
 * @param {Object} baseData 提醒中心数据。
 * @returns {Object} 包含周报任务的提醒数据。
 */
function ensureWeeklyReportTask(baseData) {
  const tasks = Array.isArray(baseData.tasks) ? baseData.tasks : []
  const hasReportTask = tasks.some((task) => task.route === 'trend')
  if (hasReportTask) return baseData

  const reportTask = {
    id: 'task-weekly-report',
    tab: 'today',
    time: '周一',
    title: '查看本周健康趋势',
    meta: '回顾本周血压、血糖和用药趋势',
    route: 'trend',
    status: 'pending',
    statusText: '查看'
  }

  return {
    ...baseData,
    tasks: [...tasks, reportTask]
  }
}

/**
 * 合并本地今日已确认记录到"已完成"分组。
 * 云端可能因缓存或延迟未返回最新确认记录，本地补齐确保已完成列表完整。
 * @param {Object} baseData 提醒中心数据。
 * @returns {Object} 包含本地已完成任务的提醒数据。
 */
function mergeLocalCompletedTasks(baseData) {
  const tasks = Array.isArray(baseData.tasks) ? baseData.tasks : []
  const todayStr = getTodayDateValue()
  const storedConfirmations = getStoredMedicationConfirmations()

  // 已存在的已完成任务 logId 集合（避免重复）
  const existingLogIds = new Set(
    tasks
      .filter(t => t.tab === 'completed' && t.logId)
      .map(t => t.logId)
  )

  const localCompletedTasks = storedConfirmations
    .filter(c => (c.status === 'taken' || c.status === 'skipped') && c.confirmDate === todayStr)
    .filter(c => !existingLogIds.has(c.logId))
    .map(c => ({
      id: `task-done-local-${c.logId}`,
      tab: 'completed',
      time: c.time || '',
      title: `${c.time || ''} ${c.name || '用药'}`,
      meta: `${c.name || ''} ${c.dosage || '按医嘱'}`,
      route: 'medList',
      planId: '',
      logId: c.logId,
      status: c.status,
      statusText: c.statusText || (c.status === 'taken' ? '已服' : '已跳过')
    }))

  if (!localCompletedTasks.length) return baseData

  return {
    ...baseData,
    tasks: [...tasks, ...localCompletedTasks]
  }
}

/**
 * 生成"即将到来"分组任务。
 * 基于今日用药计划，生成未来 3 天的提醒任务（不含今天）。
 * @param {Object} baseData 提醒中心数据。
 * @returns {Object} 包含即将到来任务的提醒数据。
 */
function ensureUpcomingTasks(baseData) {
  const tasks = Array.isArray(baseData.tasks) ? baseData.tasks : []

  // 从今日用药任务中提取计划信息
  const todayMedTasks = tasks.filter(t => t.tab === 'today' && t.route === 'medConfirm' && t.planId)

  if (!todayMedTasks.length) return baseData

  // 检查是否已有"即将到来"任务
  const hasUpcoming = tasks.some(t => t.tab === 'upcoming')
  if (hasUpcoming) return baseData

  const upcomingTasks = []
  const today = new Date()
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  // 生成未来 3 天的用药提醒任务
  for (let dayOffset = 1; dayOffset <= 3; dayOffset++) {
    const date = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000)
    const dayLabel = weekDays[date.getDay()]
    const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`

    todayMedTasks.forEach(task => {
      upcomingTasks.push({
        id: `task-upcoming-${task.planId}-${dayOffset}-${task.time || ''}`.replace(/\s/g, ''),
        tab: 'upcoming',
        time: task.time || '',
        title: `${dayLabel} ${dateStr}`,
        meta: `${task.time || ''} ${task.meta || ''}`,
        route: 'medConfirm',
        planId: task.planId,
        logId: task.logId,
        status: 'future',
        statusText: '待提醒'
      })
    })
  }

  return {
    ...baseData,
    tasks: [...tasks, ...upcomingTasks]
  }
}

/** @returns {Promise<Object>} 提醒中心数据，已应用用药状态和提醒开关。 */
function getReminderData() {
  return resolveMockData('reminder')
    .then((remoteData) => withMockPageData('reminder', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
    .then(mergeReminderMedicationStatus)
    .then(ensureWeeklyReportTask)
    .then(ensureUpcomingTasks)
    .then(mergeLocalCompletedTasks)
    .then(applyReminderSettings)
}

/** @returns {Promise<Object>} 提醒设置页数据，已合并本地设置。 */
function getReminderSettingsData() {
  return resolveMockData('reminderSettings')
    .then((remoteData) => withMockPageData('reminderSettings', remoteData, (baseData, remote) => {
      const merged = deepMerge(baseData, remote)
      return {
        ...merged,
        reminders: mergeArrayItemDefaults(baseData.reminders, merged.reminders, 'key'),
        timePlans: mergeArrayItemDefaults(baseData.timePlans, merged.timePlans, 'id')
      }
    }))
    .then(mergeReminderSettings)
}

/**
 * 保存提醒设置入口，按配置切换 local/cloud/http。
 * @param {Object} payload 提醒设置页完整数据。
 * @returns {Promise<Object>} 保存结果。
 */
function saveReminderSettings(payload) {
  return resolveRemote('saveReminderSettings', payload, saveReminderSettingsLocal, {
    mirrorLocal: true
  })
}

module.exports = {
  applyReminderSettings,
  ensureUpcomingTasks,
  ensureWeeklyReportTask,
  getReminderData,
  getReminderSettingsData,
  getStoredReminderSettings,
  mergeLocalCompletedTasks,
  mergeReminderSettings,
  saveReminderSettings,
  saveReminderSettingsLocal
}
