/**
 * 事件驱动授权工具模块。
 *
 * 设计依据：微信小程序订阅消息为"一次性订阅"，一次授权 = 一次推送权限。
 * 不能在页面加载时主动弹授权（违规），必须在用户主动触发的业务事件后引导。
 *
 * 核心策略：
 * - 用户完成用药确认/跳过后，引导授权下次用药提醒（累积 1 次推送权限）
 * - 用户记录测量后，引导授权下次测量提醒
 * - 用户查看周报后，引导授权下周周报
 * - 每次授权累积 1 次，云函数推送消耗 1 次
 * - 本地提醒中心 + snooze 机制作为兜底，确保用户不漏提醒
 *
 * 防打扰策略：
 * - 同一业务场景 24 小时内最多引导 1 次
 * - 用户拒绝后 7 天内不再主动引导
 * - 开发模式（DEV_MODE=true）下模板未配置时跳过授权
 */

const { requestSubscription, isTemplateConfigured, DEV_MODE, getRemainingQuota } = require('./subscribe')

// 防打扰记录的存储 key 前缀
const PROMPT_RECORD_KEY = 'subscribe_prompt_record_v1'

// 同一场景引导间隔（毫秒）：24 小时
const PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000

// 用户拒绝后冷却时间（毫秒）：7 天
const REJECT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 读取引导记录。
 * @returns {Object} 形如 { medicine: { lastPromptAt, lastRejectAt } }
 */
function getPromptRecord() {
  try {
    return wx.getStorageSync(PROMPT_RECORD_KEY) || {}
  } catch (e) {
    return {}
  }
}

/**
 * 写入引导记录。
 * @param {Object} record 完整记录对象。
 * @returns {void}
 */
function savePromptRecord(record) {
  try {
    wx.setStorageSync(PROMPT_RECORD_KEY, record)
  } catch (e) { /* ignore */ }
}

/**
 * 判断指定场景是否可以引导授权（防打扰检查）。
 * @param {string} templateKey 模板 key。
 * @returns {{canPrompt: boolean, reason?: string}} 是否可引导及原因。
 */
function canPrompt(templateKey) {
  const record = getPromptRecord()
  const sceneRecord = record[templateKey] || {}

  // 用户拒绝后 7 天内不再引导
  if (sceneRecord.lastRejectAt) {
    const rejectTime = new Date(sceneRecord.lastRejectAt).getTime()
    if (Date.now() - rejectTime < REJECT_COOLDOWN_MS) {
      return { canPrompt: false, reason: 'in-reject-cooldown' }
    }
  }

  // 同一场景 24 小时内最多引导 1 次
  if (sceneRecord.lastPromptAt) {
    const promptTime = new Date(sceneRecord.lastPromptAt).getTime()
    if (Date.now() - promptTime < PROMPT_INTERVAL_MS) {
      return { canPrompt: false, reason: 'in-prompt-interval' }
    }
  }

  return { canPrompt: true }
}

/**
 * 记录引导时间。
 * @param {string} templateKey 模板 key。
 * @returns {void}
 */
function recordPrompt(templateKey) {
  const record = getPromptRecord()
  record[templateKey] = {
    ...(record[templateKey] || {}),
    lastPromptAt: new Date().toISOString()
  }
  savePromptRecord(record)
}

/**
 * 记录用户拒绝授权。
 * @param {string} templateKey 模板 key。
 * @returns {void}
 */
function recordReject(templateKey) {
  const record = getPromptRecord()
  record[templateKey] = {
    ...(record[templateKey] || {}),
    lastRejectAt: new Date().toISOString()
  }
  savePromptRecord(record)
}

/**
 * 在用户完成业务操作后，引导授权下次提醒。
 *
 * 事件驱动授权流程：
 * 1. 检查模板是否已配置（开发模式跳过）
 * 2. 检查防打扰策略（24小时间隔、7天拒绝冷却）
 * 3. 调起微信授权弹窗
 * 4. 根据结果记录（成功累积次数，拒绝记录冷却）
 *
 * @param {string|string[]} templateKeys 模板 key 或数组。
 * @param {Object} [options] 可选参数。
 * @param {string} [options.scene] 业务场景标识，用于日志。
 * @param {boolean} [options.force] true 时跳过防打扰检查。
 * @returns {Promise<Object>} 授权结果。
 */
async function promptSubscribeAfterAction(templateKeys, options = {}) {
  const keys = Array.isArray(templateKeys) ? templateKeys : [templateKeys]

  // 开发模式下，模板未配置时直接返回
  if (DEV_MODE) {
    const allConfigured = keys.every(k => isTemplateConfigured(k))
    if (!allConfigured) {
      console.warn('[subscribe-prompt] 开发模式：模板未配置，跳过授权引导。场景:', options.scene)
      return { ok: false, reason: 'template-not-configured', skipped: true }
    }
  }

  // 防打扰检查（非 force 模式）
  if (!options.force) {
    for (const key of keys) {
      const check = canPrompt(key)
      if (!check.canPrompt) {
        return { ok: false, reason: check.reason, skipped: true }
      }
    }
  }

  // 记录引导时间
  keys.forEach(key => recordPrompt(key))

  // 调起授权
  const result = await requestSubscription(keys, { silent: true })

  // 记录拒绝
  if (!result.ok) {
    keys.forEach(key => {
      if (result.results && result.results[key] === 'reject') {
        recordReject(key)
      }
    })
  }

  return result
}

/**
 * 生成订阅次数展示文案。
 * @returns {{quotaText: string, hasQuota: boolean}} 次数信息。
 */
function buildQuotaDisplay() {
  const medicine = getRemainingQuota('medicine')
  const measure = getRemainingQuota('measure')
  const weeklyReport = getRemainingQuota('weeklyReport')
  const total = medicine + measure + weeklyReport

  if (total === 0) {
    return {
      quotaText: '暂无微信提醒次数',
      hasQuota: false
    }
  }

  const parts = []
  if (medicine > 0) parts.push(`用药${medicine}次`)
  if (measure > 0) parts.push(`测量${measure}次`)
  if (weeklyReport > 0) parts.push(`周报${weeklyReport}次`)

  return {
    quotaText: `已累积：${parts.join('、')}`,
    hasQuota: true
  }
}

module.exports = {
  PROMPT_INTERVAL_MS,
  REJECT_COOLDOWN_MS,
  buildQuotaDisplay,
  canPrompt,
  getPromptRecord,
  promptSubscribeAfterAction,
  recordPrompt,
  recordReject
}
