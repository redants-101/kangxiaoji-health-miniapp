/**
 * sendDueReminders 云函数
 *
 * 定时扫描到期提醒，发送微信订阅消息，并写入 reminder_push_logs 防重复。
 *
 * 订阅消息是一次性授权：用户每次允许模板消息，通常只增加 1 次可推送机会。
 * 云端成功发送后微信侧会消耗授权次数，但本地缓存无法精确同步微信真实剩余额度。
 *
 * 触发方式：CloudBase 定时触发器，建议每分钟执行一次。
 * 触发配置：cloudfunctions/sendDueReminders/config.json
 */

const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000
const TIME_TOLERANCE_MINUTES = 2
const MAX_USERS_PER_RUN = 100

const PUSH_LOG_COLLECTION = 'reminder_push_logs'
const REMINDER_SETTINGS_COLLECTION = 'reminder_settings'

const SUBSCRIBE_TEMPLATE_IDS = {
  medicine: 'qoFwVTDFbfd3VewxWP9q77s1cRV8BoAv2HNZ6enxUJg',
  measure: 'gKW7PCNOvOuRABIErKmkvkUU5CAiK7sQl1bsbUzLxSs',
  weeklyReport: 'KG7G70GC2i91aCDibDDVl6NT1zQRJlVQcM1GGmqSYIE'
}

/**
 * 获取当前北京时间。
 * @returns {{dateValue: string, timeValue: string, weekday: number}} weekday: 0 周日，1 周一。
 */
function getChinaNow() {
  const now = new Date()
  const chinaTime = new Date(now.getTime() + CHINA_TIME_OFFSET_MS)
  const y = chinaTime.getUTCFullYear()
  const m = String(chinaTime.getUTCMonth() + 1).padStart(2, '0')
  const d = String(chinaTime.getUTCDate()).padStart(2, '0')
  const h = String(chinaTime.getUTCHours()).padStart(2, '0')
  const min = String(chinaTime.getUTCMinutes()).padStart(2, '0')
  return {
    dateValue: `${y}-${m}-${d}`,
    timeValue: `${h}:${min}`,
    weekday: chinaTime.getUTCDay()
  }
}

function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return -1
  const parts = time.split(':')
  if (parts.length !== 2) return -1
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return -1
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1
  return h * 60 + m
}

function isTimeMatch(planTime, currentTime) {
  const planMin = timeToMinutes(planTime)
  const currentMin = timeToMinutes(currentTime)
  if (planMin < 0 || currentMin < 0) return false
  return Math.abs(planMin - currentMin) <= TIME_TOLERANCE_MINUTES
}

function isValidTime(time) {
  return timeToMinutes(time) >= 0
}

async function isAlreadyPushed(openId, logId, dateValue) {
  try {
    const { total } = await db.collection(PUSH_LOG_COLLECTION)
      .where({
        _openid: openId,
        logId,
        pushDate: dateValue
      })
      .count()
    return total > 0
  } catch (e) {
    // 集合未创建时不要中断扫描，后续写日志会再次暴露配置问题。
    return false
  }
}

/**
 * 记录推送尝试，成功和不可重试失败都会落库，用于防止重复消耗授权。
 * @param {Object} log 推送日志。
 * @returns {Promise<void>}
 */
async function recordPushLog(log) {
  try {
    await db.collection(PUSH_LOG_COLLECTION).add({
      data: {
        _openid: log.openId,
        type: log.type,
        logId: log.logId,
        planId: log.planId || '',
        sourceId: log.sourceId || log.planId || '',
        time: log.time,
        pushDate: log.dateValue,
        success: log.success,
        failReason: log.failReason || '',
        templateId: log.templateId || '',
        page: log.page || '',
        pushedAt: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('[sendDueReminders] recordPushLog failed:', e)
  }
}

function isRetryableError(err) {
  if (!err) return false
  const errMsg = (err.errMsg || '').toLowerCase()
  const retryablePatterns = ['timeout', 'network', 'econnreset', 'econnaborted', 'socket hang up']
  return retryablePatterns.some(p => errMsg.includes(p))
}

function truncateValue(value, maxLen) {
  if (!value) return ''
  const str = String(value)
  return str.length > maxLen ? str.substring(0, maxLen) : str
}

function extractDosageNumber(dosage) {
  if (!dosage) return '0'
  const match = String(dosage).match(/[\d.]+/)
  return match ? match[0] : '0'
}

async function sendSubscribeMessage(openId, reminder) {
  try {
    const result = await cloud.openapi.subscribeMessage.send({
      touser: openId,
      templateId: reminder.templateId,
      page: reminder.page,
      data: reminder.data,
      miniprogramState: 'formal',
      lang: 'zh_CN'
    })
    console.log('[sendDueReminders] push success:', openId, reminder.type, reminder.logId, result)
    return { ok: true }
  } catch (err) {
    console.warn('[sendDueReminders] push failed:', openId, reminder.type, reminder.logId, err.errCode, err.errMsg)
    return {
      ok: false,
      errCode: err.errCode,
      errMsg: err.errMsg || 'unknown error'
    }
  }
}

async function attemptPush(openId, reminder, dateValue) {
  if (await isAlreadyPushed(openId, reminder.logId, dateValue)) {
    return { pushCount: 0, skipCount: 1, failCount: 0 }
  }

  const pushResult = await sendSubscribeMessage(openId, reminder)
  if (pushResult.ok) {
    await recordPushLog({
      openId,
      ...reminder,
      dateValue,
      success: true
    })
    return { pushCount: 1, skipCount: 0, failCount: 0 }
  }

  const retryable = isRetryableError({ errCode: pushResult.errCode, errMsg: pushResult.errMsg })
  if (retryable) {
    console.log('[sendDueReminders] retryable push error, skip log:', openId, reminder.logId, pushResult.errMsg)
    return { pushCount: 0, skipCount: 0, failCount: 0 }
  }

  const failReason = `errCode=${pushResult.errCode}: ${pushResult.errMsg}`
  await recordPushLog({
    openId,
    ...reminder,
    dateValue,
    success: false,
    failReason
  })
  console.log('[sendDueReminders] non-retryable push error logged:', openId, reminder.logId, failReason)
  return { pushCount: 0, skipCount: 0, failCount: 1 }
}

function mergeResult(total, item) {
  total.pushCount += item.pushCount || 0
  total.skipCount += item.skipCount || 0
  total.failCount += item.failCount || 0
  return total
}

function buildMedicineReminder(plan, time) {
  const logId = `log-${plan._id}-${String(time).replace(':', '')}`
  return {
    type: 'medicine',
    logId,
    planId: plan._id,
    sourceId: plan._id,
    time,
    templateId: SUBSCRIBE_TEMPLATE_IDS.medicine,
    page: `pages/medication/med-confirm/index?planId=${plan._id}&logId=${logId}`,
    data: {
      thing1: { value: '我' },
      thing3: { value: truncateValue(plan.name || '用药提醒', 20) },
      time2: { value: time },
      character_string4: { value: extractDosageNumber(plan.dosage) },
      thing5: { value: '请确认服药' }
    }
  }
}

function buildMeasureReminder(dateValue, time) {
  const compactTime = String(time).replace(':', '')
  return {
    type: 'measure',
    logId: `measure-${dateValue}-${compactTime}`,
    sourceId: 'reminder_settings',
    time,
    templateId: SUBSCRIBE_TEMPLATE_IDS.measure,
    page: 'pages/record/record-bp/index',
    data: {
      thing12: { value: '血压血糖' },
      time2: { value: time },
      thing1: { value: '请记录测量结果' }
    }
  }
}

function buildWeeklyReportReminder(dateValue, time) {
  const compactTime = String(time).replace(':', '')
  return {
    type: 'weeklyReport',
    logId: `weeklyReport-${dateValue}-${compactTime}`,
    sourceId: 'weekly_report',
    time,
    templateId: SUBSCRIBE_TEMPLATE_IDS.weeklyReport,
    page: 'pages/trend/index',
    data: {
      thing5: { value: '我' },
      thing1: { value: '健康周报' },
      time2: { value: time },
      thing3: { value: '本周记录回顾已生成' },
      thing4: { value: '点击查看详情' }
    }
  }
}

function isReminderEnabled(settings, key, defaultEnabled) {
  if (!settings || !Array.isArray(settings.reminders)) return defaultEnabled
  const item = settings.reminders.find(r => r && r.key === key)
  if (!item) return defaultEnabled
  return item.enabled !== false
}

function getTimePlanTime(settings, id, fallback) {
  if (!settings || !Array.isArray(settings.timePlans)) return fallback
  const item = settings.timePlans.find(plan => plan && plan.id === id)
  return item && isValidTime(item.time) ? item.time : fallback
}

async function getReminderSettings(openId) {
  try {
    const { data = [] } = await db.collection(REMINDER_SETTINGS_COLLECTION)
      .where({ _openid: openId })
      .field({ reminders: true, timePlans: true })
      .limit(1)
      .get()
    return data[0] || null
  } catch (e) {
    console.warn('[sendDueReminders] getReminderSettings failed:', openId, e)
    return null
  }
}

async function processMedicineReminders(openId, now, settings) {
  const result = { pushCount: 0, skipCount: 0, failCount: 0 }
  if (!isReminderEnabled(settings, 'medicine', true)) return result

  const { data: plans = [] } = await db.collection('medication_plans')
    .where({ _openid: openId, status: '启用' })
    .field({ _id: true, name: true, dosage: true, times: true, startDate: true, endDate: true })
    .limit(50)
    .get()

  if (!plans.length) return result

  const { data: confirmations = [] } = await db.collection('medication_confirmations')
    .where({ _openid: openId, confirmDate: now.dateValue })
    .field({ logId: true, status: true })
    .limit(100)
    .get()

  const confirmedLogIds = new Set(
    confirmations
      .filter(c => c.status === 'taken' || c.status === 'skipped')
      .map(c => c.logId)
  )

  for (const plan of plans) {
    const times = Array.isArray(plan.times) ? plan.times : []
    if (!times.length) continue

    if (plan.startDate && plan.startDate !== '今天' && plan.startDate > now.dateValue) continue
    if (plan.endDate && plan.endDate < now.dateValue) continue

    for (const time of times) {
      if (!isTimeMatch(time, now.timeValue)) continue

      const reminder = buildMedicineReminder(plan, time)
      if (confirmedLogIds.has(reminder.logId)) continue

      mergeResult(result, await attemptPush(openId, reminder, now.dateValue))
    }
  }

  return result
}

async function processMeasureReminder(openId, now, settings) {
  const result = { pushCount: 0, skipCount: 0, failCount: 0 }
  if (!isReminderEnabled(settings, 'measure', false)) return result

  const time = getTimePlanTime(settings, 'time-measure', '09:00')
  if (!isTimeMatch(time, now.timeValue)) return result

  return attemptPush(openId, buildMeasureReminder(now.dateValue, time), now.dateValue)
}

async function processWeeklyReportReminder(openId, now, settings) {
  const result = { pushCount: 0, skipCount: 0, failCount: 0 }
  if (!isReminderEnabled(settings, 'weeklyReport', false)) return result
  if (now.weekday !== 1) return result

  const time = getTimePlanTime(settings, 'time-report', '20:00')
  if (!isTimeMatch(time, now.timeValue)) return result

  return attemptPush(openId, buildWeeklyReportReminder(now.dateValue, time), now.dateValue)
}

async function processUserReminders(openId, now) {
  const settings = await getReminderSettings(openId)
  const result = { pushCount: 0, skipCount: 0, failCount: 0 }

  mergeResult(result, await processMedicineReminders(openId, now, settings))
  mergeResult(result, await processMeasureReminder(openId, now, settings))
  mergeResult(result, await processWeeklyReportReminder(openId, now, settings))

  return result
}

async function getOwnersFromMedicationPlans() {
  try {
    const { data: planOwners = [] } = await db.collection('medication_plans')
      .where({ status: '启用' })
      .field({ _openid: true })
      .limit(MAX_USERS_PER_RUN * 5)
      .get()
    return planOwners.map(p => p._openid).filter(Boolean)
  } catch (e) {
    console.warn('[sendDueReminders] query medication owners failed:', e)
    return []
  }
}

async function getOwnersFromReminderSettings() {
  try {
    const { data: settingOwners = [] } = await db.collection(REMINDER_SETTINGS_COLLECTION)
      .field({ _openid: true })
      .limit(MAX_USERS_PER_RUN * 5)
      .get()
    return settingOwners.map(s => s._openid).filter(Boolean)
  } catch (e) {
    console.warn('[sendDueReminders] query settings owners failed:', e)
    return []
  }
}

async function getOwnersToScan() {
  const [planOwners, settingOwners] = await Promise.all([
    getOwnersFromMedicationPlans(),
    getOwnersFromReminderSettings()
  ])
  const ownerSet = new Set([...planOwners, ...settingOwners])
  return Array.from(ownerSet).slice(0, MAX_USERS_PER_RUN)
}

exports.main = async (_event, _context) => {
  const now = getChinaNow()
  console.log('[sendDueReminders] start:', now)

  const owners = await getOwnersToScan()
  console.log('[sendDueReminders] users to scan:', owners.length)

  let totalPushed = 0
  let totalSkipped = 0
  let totalFailed = 0
  let usersPushed = 0
  let errorCount = 0

  for (const openId of owners) {
    try {
      const result = await processUserReminders(openId, now)
      if (result.pushCount > 0) {
        usersPushed++
        totalPushed += result.pushCount
      }
      totalSkipped += result.skipCount
      totalFailed += result.failCount
    } catch (err) {
      console.warn('[sendDueReminders] processUser failed:', openId, err)
      errorCount++
    }
  }

  const summary = {
    date: now.dateValue,
    time: now.timeValue,
    weekday: now.weekday,
    usersScanned: owners.length,
    usersPushed,
    totalPushed,
    totalSkipped,
    totalFailed,
    errors: errorCount
  }
  console.log('[sendDueReminders] done:', summary)
  return summary
}
