/**
 * sendDueReminders 云函数
 *
 * 功能：定时扫描到期未确认的用药计划，向用户推送微信订阅消息。
 *
 * ⚠️ 订阅消息机制说明：
 * 微信小程序订阅消息为"一次性订阅"，用户每次授权 = 1 次推送权限。
 * 云函数推送 1 条消耗 1 次授权次数；次数不足时推送会失败（errCode=43101）。
 * 因此本云函数的推送成功率取决于用户是否在业务事件后完成授权。
 *
 * 触发方式：定时触发器（建议每分钟执行一次）
 * 配置方式：在云函数目录的 config.json 中添加定时触发器：
 * {
 *   "triggers": [
 *     {
 *       "name": "dueReminderTimer",
 *       "type": "timer",
 *       "config": "0 * * * * * *"
 *     }
 *   ]
 * }
 *
 * 工作流程：
 * 1. 查询所有启用状态的用药计划
 * 2. 对每个计划，检查当前时间是否匹配某个提醒时间点（±2 分钟容差）
 * 3. 检查该时间点是否已被确认（taken/skipped）
 * 4. 检查是否已尝试推送过（含成功和失败），避免重复尝试
 * 5. 未确认且未推送过则调用 cloud.openapi.subscribeMessage.send 推送
 * 6. 推送失败（如用户未授权、次数不足）时记录失败原因，不再重试
 *
 * 失败处理策略：
 * - errCode=43101（用户未订阅/次数不足）：记录后不再重试，等待用户重新授权
 * - errCode=40037（模板 ID 不正确）：记录配置错误，不重试
 * - errCode=47003（模板参数不匹配）：记录参数错误，不重试
 * - 网络错误：不记录，下次触发时重试
 *
 * 兜底机制：
 * - 即使云函数推送失败，前端提醒中心仍会展示待办任务
 * - snooze 机制提供延时本地提醒
 * - 用户打开小程序时可通过首页弹窗看到到期提醒
 *
 * 注意：
 * - 订阅消息模板 ID 需在小程序后台申请后填入 SUBSCRIBE_TEMPLATE_ID
 * - 推送频率受微信订阅消息配额限制
 * - 本函数仅推送用药提醒，测量和周报提醒可按需扩展
 */

const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

// 订阅消息模板 ID（用药提醒 - 每日用药提醒，模板编号 73500）
const SUBSCRIBE_TEMPLATE_ID = 'qoFwVTDFbfd3VewxWP9q77s1cRV8BoAv2HNZ6enxUJg'

// 时间匹配容差（分钟）：当前时间在 [计划时间 - 容差, 计划时间 + 容差] 内视为到期
const TIME_TOLERANCE_MINUTES = 2

// 单次执行最多扫描的用户数，避免超时
const MAX_USERS_PER_RUN = 100

// 已推送记录的缓存集合名（避免重复推送）
const PUSH_LOG_COLLECTION = 'reminder_push_logs'

/**
 * 获取当前北京时间字符串。
 * @returns {{dateValue: string, timeValue: string}} 日期和时间。
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
    timeValue: `${h}:${min}`
  }
}

/**
 * 将 HH:mm 时间字符串转换为分钟数，便于比较。
 * @param {string} time HH:mm 格式时间。
 * @returns {number} 分钟数。
 */
function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return -1
  const parts = time.split(':')
  if (parts.length !== 2) return -1
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return -1
  return h * 60 + m
}

/**
 * 判断当前时间是否匹配计划时间点（在容差范围内）。
 * @param {string} planTime 计划时间 HH:mm。
 * @param {string} currentTime 当前时间 HH:mm。
 * @returns {boolean} true 表示匹配。
 */
function isTimeMatch(planTime, currentTime) {
  const planMin = timeToMinutes(planTime)
  const currentMin = timeToMinutes(currentTime)
  if (planMin < 0 || currentMin < 0) return false
  return Math.abs(planMin - currentMin) <= TIME_TOLERANCE_MINUTES
}

/**
 * 检查指定 logId 是否已尝试推送过（含成功和失败），避免重复尝试。
 * 一次性订阅消息：推送失败（43101）意味着用户无授权次数，重试无意义。
 * @param {string} openId 用户 openId。
 * @param {string} logId 用药确认 logId。
 * @param {string} dateValue 今日日期。
 * @returns {Promise<boolean>} true 表示已尝试过。
 */
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
    // 集合不存在时视为未推送
    return false
  }
}

/**
 * 记录推送日志（含成功和失败），防止重复推送。
 * @param {string} openId 用户 openId。
 * @param {string} logId 用药确认 logId。
 * @param {string} dateValue 今日日期。
 * @param {string} planId 计划 ID。
 * @param {string} time 提醒时间。
 * @param {boolean} success 是否推送成功。
 * @param {string} [failReason] 失败原因（errCode 或错误描述）。
 * @returns {Promise<void>}
 */
async function recordPushLog(openId, logId, dateValue, planId, time, success, failReason) {
  try {
    await db.collection(PUSH_LOG_COLLECTION).add({
      data: {
        _openid: openId,
        logId,
        planId,
        time,
        pushDate: dateValue,
        success,
        failReason: failReason || '',
        pushedAt: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('[sendDueReminders] recordPushLog failed:', e)
  }
}

/**
 * 判断错误是否为可重试错误（网络类）。
 * 一次性订阅消息的 43101（次数不足）不可重试，记录后跳过。
 * @param {Object} err 错误对象。
 * @returns {boolean} true 表示可重试（不记录日志）。
 */
function isRetryableError(err) {
  if (!err) return false
  const errMsg = (err.errMsg || '').toLowerCase()
  const retryablePatterns = ['timeout', 'network', 'econnreset', 'econnaborted', 'socket hang up']
  return retryablePatterns.some(p => errMsg.includes(p))
}

/**
 * 截断字符串到指定长度，避免超过微信模板字段限制。
 * @param {string} value 原始值。
 * @param {number} maxLen 最大长度。
 * @returns {string} 截断后的值。
 */
function truncateValue(value, maxLen) {
  if (!value) return ''
  const str = String(value)
  return str.length > maxLen ? str.substring(0, maxLen) : str
}

/**
 * 从剂量文本中提取数字字符串，用于 character_string 类型字段。
 * 微信 character_string 类型要求纯数字字符串。
 * @param {string} dosage 原始剂量文本（如"1片"、"0.5mg"）。
 * @returns {string} 数字字符串（如"1"、"0.5"），无数字时返回"0"。
 */
function extractDosageNumber(dosage) {
  if (!dosage) return '0'
  const match = String(dosage).match(/[\d.]+/)
  return match ? match[0] : '0'
}

/**
 * 向用户推送订阅消息。
 *
 * 模板字段映射（每日用药提醒，模板编号 73500）：
 * - thing1            服药人（云函数无昵称信息，使用"我"）
 * - thing3            药品名称（plan.name，最多 20 字符）
 * - time2             用药时间（HH:mm）
 * - character_string4 剂量（从 plan.dosage 提取数字，如"1片"→"1"）
 * - thing5            备注（固定"请确认服药"，最多 20 字符）
 *
 * @param {string} openId 用户 openId。
 * @param {Object} plan 用药计划。
 * @param {string} time 提醒时间。
 * @returns {Promise<{ok: boolean, errCode?: number, errMsg?: string}>} 推送结果。
 */
async function sendSubscribeMessage(openId, plan, time) {
  try {
    const result = await cloud.openapi.subscribeMessage.send({
      touser: openId,
      templateId: SUBSCRIBE_TEMPLATE_ID,
      page: `pages/medication/med-confirm/index?planId=${plan._id}&logId=log-${plan._id}-${String(time).replace(':', '')}`,
      data: {
        thing1: { value: '我' },
        thing3: { value: truncateValue(plan.name || '用药提醒', 20) },
        time2: { value: time },
        character_string4: { value: extractDosageNumber(plan.dosage) },
        thing5: { value: '请确认服药' }
      },
      miniprogramState: 'formal',
      lang: 'zh_CN'
    })
    console.log('[sendDueReminders] push success:', openId, plan.name, result)
    return { ok: true }
  } catch (err) {
    // 常见错误：
    // errCode=43101：用户未订阅或次数不足（一次性订阅消息常见）
    // errCode=40037：模板 ID 不正确
    // errCode=47003：模板参数不匹配
    console.warn('[sendDueReminders] push failed:', openId, plan.name, err.errCode, err.errMsg)
    return {
      ok: false,
      errCode: err.errCode,
      errMsg: err.errMsg || 'unknown error'
    }
  }
}

/**
 * 处理单个用户的用药计划，推送到期提醒。
 * @param {string} openId 用户 openId。
 * @param {string} dateValue 今日日期。
 * @param {string} timeValue 当前时间。
 * @returns {Promise<number>} 本次推送的数量。
 */
async function processUserReminders(openId, dateValue, timeValue) {
  // 查询该用户启用中的用药计划
  const { data: plans = [] } = await db.collection('medication_plans')
    .where({ _openid: openId, status: '启用' })
    .field({ _id: true, name: true, dosage: true, times: true, startDate: true, endDate: true })
    .limit(50)
    .get()

  if (!plans.length) return 0

  // 查询今日已确认记录
  const { data: confirmations = [] } = await db.collection('medication_confirmations')
    .where({ _openid: openId, confirmDate: dateValue })
    .field({ logId: true, status: true })
    .limit(100)
    .get()

  const confirmedLogIds = new Set(
    confirmations
      .filter(c => c.status === 'taken' || c.status === 'skipped')
      .map(c => c.logId)
  )

  let pushCount = 0
  let skipCount = 0
  for (const plan of plans) {
    const times = Array.isArray(plan.times) ? plan.times : []
    if (!times.length) continue

    // 检查计划是否在有效期内
    if (plan.startDate && plan.startDate !== '今天' && plan.startDate > dateValue) continue
    if (plan.endDate && plan.endDate < dateValue) continue

    for (const time of times) {
      if (!isTimeMatch(time, timeValue)) continue

      const logId = `log-${plan._id}-${String(time).replace(':', '')}`
      if (confirmedLogIds.has(logId)) continue

      // 检查是否已尝试推送过（含成功和失败，避免重复尝试）
      if (await isAlreadyPushed(openId, logId, dateValue)) {
        skipCount++
        continue
      }

      // 推送订阅消息
      const pushResult = await sendSubscribeMessage(openId, plan, time)

      if (pushResult.ok) {
        // 推送成功，记录日志
        await recordPushLog(openId, logId, dateValue, plan._id, time, true)
        pushCount++
      } else {
        // 推送失败：判断是否可重试
        const retryable = isRetryableError({ errCode: pushResult.errCode, errMsg: pushResult.errMsg })
        if (!retryable) {
          // 不可重试的错误（如 43101 次数不足），记录日志避免重复尝试
          const failReason = `errCode=${pushResult.errCode}: ${pushResult.errMsg}`
          await recordPushLog(openId, logId, dateValue, plan._id, time, false, failReason)
          console.log('[sendDueReminders] 不可重试错误，记录后跳过:', openId, logId, failReason)
        } else {
          // 可重试的错误（网络类），不记录日志，下次触发时重试
          console.log('[sendDueReminders] 可重试错误，不记录日志:', openId, logId, pushResult.errMsg)
        }
      }
    }
  }

  return { pushCount, skipCount }
}

/**
 * 云函数主入口。
 * @param {Object} _event 触发事件，定时触发器时为空对象。
 * @param {Object} _context 云函数上下文。
 * @returns {Promise<Object>} 执行结果统计。
 */
exports.main = async (_event, _context) => {
  const { dateValue, timeValue } = getChinaNow()
  console.log('[sendDueReminders] start:', dateValue, timeValue)

  // 查询所有有待推送用药计划的用户（去重）
  // 通过 medication_plans 集合反查，避免全量扫描用户表
  const { data: planOwners = [] } = await db.collection('medication_plans')
    .where({ status: '启用' })
    .field({ _openid: true })
    .limit(MAX_USERS_PER_RUN * 5)
    .get()

  const ownerSet = new Set(planOwners.map(p => p._openid).filter(Boolean))
  const owners = Array.from(ownerSet).slice(0, MAX_USERS_PER_RUN)

  console.log('[sendDueReminders] users to scan:', owners.length)

  let totalPushed = 0
  let totalSkipped = 0
  let userCount = 0
  let errorCount = 0

  for (const openId of owners) {
    try {
      const result = await processUserReminders(openId, dateValue, timeValue)
      if (result.pushCount > 0) {
        userCount++
        totalPushed += result.pushCount
      }
      totalSkipped += result.skipCount
    } catch (err) {
      console.warn('[sendDueReminders] processUser failed:', openId, err)
      errorCount++
    }
  }

  const summary = {
    date: dateValue,
    time: timeValue,
    usersScanned: owners.length,
    usersPushed: userCount,
    totalPushed,
    totalSkipped,
    errors: errorCount
  }
  console.log('[sendDueReminders] done:', summary)
  return summary
}
