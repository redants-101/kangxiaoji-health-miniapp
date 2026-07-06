/**
 * 订阅消息工具模块。
 * 统一封装 wx.requestSubscribeMessage 调用、授权状态持久化和模板 ID 管理。
 *
 * 设计要点：
 * - 模板 ID 集中管理（utils/subscribe-config.js），便于审核通过后替换。
 * - 授权状态按模板维度记录，区分"已授权"和"被拒绝"。
 * - 调用 wx.requestSubscribeMessage 失败时降级为本地提醒中心，不阻塞业务流程。
 * - 开发模式（DEV_MODE=true）下，模板 ID 未配置不阻塞流程，便于本地测试。
 * - 兼容无 wx 环境的单元测试。
 */

const { STORAGE_KEYS, readStorage, writeStorageAndInvalidate, getRelatedCacheKeys } = require('../services/core')
const { SUBSCRIBE_TEMPLATE_IDS, DEV_MODE } = require('./subscribe-config')

/**
 * 订阅消息模板映射。
 * key 与业务提醒类型对应：medicine（用药）、measure（测量）、weeklyReport（周报）。
 */
const SUBSCRIBE_TEMPLATES = SUBSCRIBE_TEMPLATE_IDS

/**
 * 判断模板 ID 是否为占位符（未配置真实 ID）。
 * @param {string} tmplId 模板 ID。
 * @returns {boolean} true 表示是占位符。
 */
function isPlaceholderTemplateId(tmplId) {
  return !tmplId || typeof tmplId !== 'string' || tmplId.includes('_placeholder')
}

/**
 * 判断指定类型的模板 ID 是否已配置（非占位符）。
 * @param {string} templateKey 模板 key。
 * @returns {boolean} true 表示已配置真实模板 ID。
 */
function isTemplateConfigured(templateKey) {
  return !isPlaceholderTemplateId(SUBSCRIBE_TEMPLATES[templateKey])
}

/**
 * 判断所有业务模板是否都已配置。
 * @returns {boolean} true 表示全部已配置。
 */
function isAllTemplatesConfigured() {
  return Object.keys(SUBSCRIBE_TEMPLATES).every(key => isTemplateConfigured(key))
}

/**
 * 读取本地订阅消息授权记录。
 * @returns {Object} 形如 { medicine: { status: 'accept', updatedAt: '...' } }
 */
function getStoredSubscriptionStatus() {
  return readStorage(STORAGE_KEYS.subscriptionStatus, {}) || {}
}

/**
 * 写入本地订阅消息授权记录，并触发提醒设置页缓存失效。
 * @param {Object} status 完整授权状态对象。
 * @returns {Object} 写入后的状态。
 */
function saveSubscriptionStatusLocal(status) {
  return writeStorageAndInvalidate(
    STORAGE_KEYS.subscriptionStatus,
    { ...status, updatedAt: new Date().toISOString() },
    getRelatedCacheKeys(STORAGE_KEYS.subscriptionStatus)
  )
}

/**
 * 更新单个模板的授权状态。
 * @param {string} templateKey 模板 key（medicine/measure/weeklyReport）。
 * @param {string} result wx.requestSubscribeMessage 返回的状态值（accept/reject/ban/filter）。
 * @returns {Object} 更新后的完整授权状态。
 */
function updateSubscriptionRecord(templateKey, result) {
  if (!SUBSCRIBE_TEMPLATES[templateKey]) return getStoredSubscriptionStatus()
  const current = getStoredSubscriptionStatus()
  const next = {
    ...current,
    [templateKey]: {
      status: result,
      updatedAt: new Date().toISOString()
    }
  }
  return saveSubscriptionStatusLocal(next)
}

/**
 * 判断指定模板是否已授权（accept）。
 * @param {string} templateKey 模板 key。
 * @returns {boolean} true 表示用户曾授权过该模板。
 */
function isSubscribed(templateKey) {
  const status = getStoredSubscriptionStatus()
  return !!(status[templateKey] && status[templateKey].status === 'accept')
}

/**
 * 读取本地订阅次数记录（事件驱动授权累积）。
 * 一次性订阅消息：用户每次授权 = 1 次推送权限，次数可累计。
 * 云函数推送 1 条消耗 1 次；本地记录用于展示和参考，微信侧计数为准。
 * @returns {Object} 形如 { medicine: 3, measure: 1, weeklyReport: 0 }
 */
function getSubscriptionQuota() {
  return readStorage(STORAGE_KEYS.subscriptionQuota, {}) || {}
}

/**
 * 增加指定模板的订阅次数（用户授权后调用）。
 * @param {string} templateKey 模板 key。
 * @param {number} [count=1] 增加的次数。
 * @returns {Object} 更新后的完整次数记录。
 */
function addSubscriptionQuota(templateKey, count = 1) {
  if (!SUBSCRIBE_TEMPLATES[templateKey]) return getSubscriptionQuota()
  const current = getSubscriptionQuota()
  const next = {
    ...current,
    [templateKey]: (current[templateKey] || 0) + count
  }
  return writeStorageAndInvalidate(
    STORAGE_KEYS.subscriptionQuota,
    next,
    getRelatedCacheKeys(STORAGE_KEYS.subscriptionQuota)
  )
}

/**
 * 批量增加订阅次数（一次授权多个模板时使用）。
 * @param {string[]} templateKeys 模板 key 数组。
 * @param {Object} results wx.requestSubscribeMessage 返回的结果。
 * @returns {Object} 更新后的完整次数记录。
 */
function addSubscriptionQuotaBatch(templateKeys, results) {
  let current = getSubscriptionQuota()
  templateKeys.forEach(key => {
    if (results[key] === 'accept') {
      current = {
        ...current,
        [key]: (current[key] || 0) + 1
      }
    }
  })
  return writeStorageAndInvalidate(
    STORAGE_KEYS.subscriptionQuota,
    current,
    getRelatedCacheKeys(STORAGE_KEYS.subscriptionQuota)
  )
}

/**
 * 消耗指定模板的订阅次数（云函数推送成功后调用，或本地预估）。
 * 次数不足时不执行消耗。
 * @param {string} templateKey 模板 key。
 * @returns {boolean} true 表示消耗成功。
 */
function consumeSubscriptionQuota(templateKey) {
  if (!SUBSCRIBE_TEMPLATES[templateKey]) return false
  const current = getSubscriptionQuota()
  const remaining = current[templateKey] || 0
  if (remaining <= 0) return false
  const next = {
    ...current,
    [templateKey]: remaining - 1
  }
  writeStorageAndInvalidate(
    STORAGE_KEYS.subscriptionQuota,
    next,
    getRelatedCacheKeys(STORAGE_KEYS.subscriptionQuota)
  )
  return true
}

/**
 * 获取指定模板的剩余订阅次数。
 * @param {string} templateKey 模板 key。
 * @returns {number} 剩余次数。
 */
function getRemainingQuota(templateKey) {
  const current = getSubscriptionQuota()
  return current[templateKey] || 0
}

/**
 * 判断是否所有业务模板都已授权。
 * @returns {boolean} true 表示三类提醒全部已授权。
 */
function isAllSubscribed() {
  return Object.keys(SUBSCRIBE_TEMPLATES).every(key => isSubscribed(key))
}

/**
 * 生成提醒设置页展示用的订阅状态摘要。
 * @returns {{status: string, meta: string}} 状态文案。
 */
function buildSubscriptionDisplay() {
  const status = getStoredSubscriptionStatus()
  const keys = Object.keys(SUBSCRIBE_TEMPLATES)
  const accepted = keys.filter(key => status[key] && status[key].status === 'accept')
  const rejected = keys.filter(key => status[key] && status[key].status === 'reject')

  if (accepted.length === keys.length) {
    return {
      status: '已全部开启',
      meta: '微信会在提醒时间向你推送通知。'
    }
  }
  if (accepted.length > 0) {
    return {
      status: '部分开启',
      meta: `已开启 ${accepted.length}/${keys.length} 项，未开启项仍可在提醒中心查看。`
    }
  }
  if (rejected.length > 0) {
    return {
      status: '未全部开启',
      meta: '部分提醒被拒绝，你仍可在提醒中心查看待办。'
    }
  }
  return {
    status: '未开启',
    meta: '开启后，微信会在提醒时间通知你；未开启时仍可在提醒中心查看待办。'
  }
}

/**
 * 调起微信订阅消息授权弹窗。
 * 兼容无 wx 环境（单元测试），失败时返回 rejected 状态而非抛错。
 *
 * 模板 ID 未配置时的行为：
 * - DEV_MODE=true（开发模式）：记录日志，返回 { ok: false, reason: 'template-not-configured' }，不阻塞流程
 * - DEV_MODE=false（生产模式）：给出明确提示，引导用户配置模板 ID
 *
 * @param {string|string[]} templateKeys 模板 key 或 key 数组。
 * @param {Object} [options] 可选参数。
 * @param {boolean} [options.silent] true 时失败不弹 toast。
 * @returns {Promise<Object>} 形如 { ok: boolean, results: { medicine: 'accept' }, keys: ['medicine'], reason?: string }
 */
function requestSubscription(templateKeys, options = {}) {
  const keys = Array.isArray(templateKeys) ? templateKeys : [templateKeys]
  const validKeys = keys.filter(k => SUBSCRIBE_TEMPLATES[k])

  if (!validKeys.length) {
    return Promise.resolve({ ok: false, results: {}, keys: [], reason: 'no-valid-template' })
  }

  // 检测模板 ID 是否为占位符
  const unconfiguredKeys = validKeys.filter(key => !isTemplateConfigured(key))
  if (unconfiguredKeys.length > 0) {
    console.warn('[subscribe] 模板 ID 未配置:', unconfiguredKeys, '请在 utils/subscribe-config.js 中配置真实模板 ID')

    if (DEV_MODE) {
      // 开发模式：不阻塞流程，返回明确原因
      return Promise.resolve({
        ok: false,
        results: {},
        keys: validKeys,
        reason: 'template-not-configured',
        unconfiguredKeys
      })
    }

    // 生产模式：给出明确提示
    if (!options.silent && typeof wx !== 'undefined' && wx.showModal) {
      wx.showModal({
        title: '订阅消息未配置',
        content: '订阅消息模板 ID 未配置，请在 utils/subscribe-config.js 中设置真实模板 ID 后再使用微信提醒功能。',
        showCancel: false,
        confirmText: '知道了'
      })
    }
    return Promise.resolve({
      ok: false,
      results: {},
      keys: validKeys,
      reason: 'template-not-configured',
      unconfiguredKeys
    })
  }

  if (typeof wx === 'undefined' || !wx.requestSubscribeMessage) {
    return Promise.resolve({ ok: false, results: {}, keys: validKeys, reason: 'no-wx-env' })
  }

  const tmplIds = validKeys.map(k => SUBSCRIBE_TEMPLATES[k])

  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds,
      success(res) {
        const results = {}
        validKeys.forEach(key => {
          const tmplId = SUBSCRIBE_TEMPLATES[key]
          const result = res[tmplId]
          if (result) {
            results[key] = result
            updateSubscriptionRecord(key, result)
          }
        })
        // 累积订阅次数（accept 的模板每次 +1，对应一次性订阅消息的推送权限）
        addSubscriptionQuotaBatch(validKeys, results)
        const hasAccepted = Object.values(results).some(r => r === 'accept')
        if (!options.silent && !hasAccepted) {
          wx.showToast({
            title: '未开启微信提醒，仍可在提醒中心查看',
            icon: 'none',
            duration: 2500
          })
        } else if (!options.silent && hasAccepted) {
          wx.showToast({
            title: '已开启微信提醒',
            icon: 'success',
            duration: 1500
          })
        }
        resolve({ ok: hasAccepted, results, keys: validKeys })
      },
      fail(err) {
        console.warn('[subscribe] requestSubscribeMessage failed:', err)
        if (!options.silent) {
          const msg = err && err.errMsg ? err.errMsg : '订阅消息授权失败'
          wx.showToast({
            title: msg,
            icon: 'none',
            duration: 2500
          })
        }
        resolve({ ok: false, results: {}, keys: validKeys, reason: 'request-failed', error: err })
      }
    })
  })
}

module.exports = {
  SUBSCRIBE_TEMPLATES,
  DEV_MODE,
  addSubscriptionQuota,
  addSubscriptionQuotaBatch,
  buildSubscriptionDisplay,
  consumeSubscriptionQuota,
  getStoredSubscriptionStatus,
  getSubscriptionQuota,
  getRemainingQuota,
  isAllSubscribed,
  isAllTemplatesConfigured,
  isPlaceholderTemplateId,
  isSubscribed,
  isTemplateConfigured,
  requestSubscription,
  saveSubscriptionStatusLocal,
  updateSubscriptionRecord
}
