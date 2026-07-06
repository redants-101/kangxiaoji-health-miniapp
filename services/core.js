/**
 * services 公共基础能力
 * 精简版：移除冗余注释和重复代码
 */
const apiConfig = require('../utils/api-config')

const STORAGE_KEYS = {
  profile: 'user_profile_v1',
  records: 'health_records_v1',
  medicationPlans: 'medication_plans_v1',
  medicationConfirmations: 'medication_confirmations_v1',
  familyAuth: 'family_auth_v1',
  reminderSettings: 'reminder_settings_v1',
  privacySettings: 'privacy_settings_v1',
  feedbacks: 'feedbacks_v1',
  subscriptionStatus: 'subscription_status_v1',
  subscriptionQuota: 'subscription_quota_v1',
  snoozeReminders: 'snooze_reminders_v1'
}

const memoryStorage = {}
const cloudReadCache = {}
const inFlightCloudReads = {}
const CLOUD_READ_CACHE_TTL_MS = 60000
const dirtyFlags = {}

const DIRTY_MAP = {
  [STORAGE_KEYS.records]: ['home', 'trend', 'recordList'],
  [STORAGE_KEYS.medicationPlans]: ['home', 'trend', 'medList', 'reminder'],
  [STORAGE_KEYS.medicationConfirmations]: ['home', 'medList', 'reminder'],
  [STORAGE_KEYS.profile]: ['home', 'me'],
  [STORAGE_KEYS.familyAuth]: ['family', 'home', 'homeFamily'],
  [STORAGE_KEYS.reminderSettings]: ['home', 'reminder'],
  [STORAGE_KEYS.privacySettings]: ['privacy'],
  [STORAGE_KEYS.subscriptionStatus]: ['reminder', 'reminderSettings'],
  [STORAGE_KEYS.subscriptionQuota]: ['reminder', 'reminderSettings'],
  [STORAGE_KEYS.snoozeReminders]: ['reminder', 'home']
}

function markDirty(pages) {
  if (!Array.isArray(pages)) return
  pages.forEach(page => { dirtyFlags[page] = true })
}

function markDirtyByStorageKey(storageKey) {
  const pages = DIRTY_MAP[storageKey]
  if (Array.isArray(pages)) markDirty(pages)
}

function isDirty(page) {
  return !!dirtyFlags[page]
}

function markClean(page) {
  delete dirtyFlags[page]
}

function clone(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)) }
/**
 * 检测当前运行环境是否支持微信小程序存储 API
 * @returns {boolean} 如果存在 wx 对象且包含 getStorageSync 和 setStorageSync 方法则返回 true，否则返回 false
 */
function hasWxStorage() { return typeof wx !== 'undefined' && wx && wx.getStorageSync && wx.setStorageSync }
function isFailureErrMsg(errMsg) { return errMsg && !String(errMsg).toLowerCase().includes(':ok') }

/**
 * 从存储中读取指定键的值，优先使用微信存储，回退到内存存储
 * @param {string} key - 存储键名
 * @param {*} fallback - 当键不存在时的默认返回值
 * @returns {*} 存储值的深拷贝副本，若不存在则返回 fallback
 */
function readStorage(key, fallback) {
  if (!hasWxStorage()) return clone(memoryStorage[key] || fallback)
  
  return clone(wx.getStorageSync(key) || fallback)
}

function writeStorage(key, value) {
  const next = clone(value)
  if (!hasWxStorage()) { memoryStorage[key] = next; return next }
  wx.setStorageSync(key, next)
  return next
}

function removeStorage(key) {
  if (!hasWxStorage()) { delete memoryStorage[key]; return }
  wx.removeStorageSync ? wx.removeStorageSync(key) : wx.setStorageSync(key, null)
}

function clearMemoryStorage() {
  Object.keys(memoryStorage).forEach(k => delete memoryStorage[k])
}

function clearCloudReadCache() {
  Object.keys(cloudReadCache).forEach(k => delete cloudReadCache[k])
}

function clearCacheByKeys(keys) {
  if (!Array.isArray(keys)) return
  keys.forEach(key => {
    // 云缓存 key 格式为 "pageName:{...payload}"，需前缀匹配而非精确匹配
    const prefix = key + ':'
    Object.keys(cloudReadCache).forEach(k => (k === key || k.startsWith(prefix)) && delete cloudReadCache[k])
    Object.keys(inFlightCloudReads).forEach(k => (k === key || k.startsWith(prefix)) && delete inFlightCloudReads[k])
  })
}

function writeStorageAndInvalidate(key, value, relatedKeys = []) {
  const next = writeStorage(key, value)
  clearCacheByKeys(relatedKeys)
  markDirtyByStorageKey(key)
  return next
}

function getRelatedCacheKeys(storageKey) {
  const map = {
    [STORAGE_KEYS.profile]: ['profile', 'home', 'me'],
    [STORAGE_KEYS.records]: ['home', 'recordList', 'trend'],
    [STORAGE_KEYS.medicationPlans]: ['medList', 'home', 'trend', 'reminder'],
    [STORAGE_KEYS.medicationConfirmations]: ['medList', 'home', 'reminder'],
    [STORAGE_KEYS.familyAuth]: ['family', 'home', 'homeFamily'],
    [STORAGE_KEYS.reminderSettings]: ['reminder', 'home'],
    [STORAGE_KEYS.privacySettings]: ['privacy', 'profile'],
    [STORAGE_KEYS.subscriptionStatus]: ['reminder', 'reminderSettings'],
    [STORAGE_KEYS.subscriptionQuota]: ['reminder', 'reminderSettings'],
    [STORAGE_KEYS.snoozeReminders]: ['reminder', 'home']
  }
  return map[storageKey] || []
}

const CLOUD_RETRY_BASE = 800, CLOUD_RETRY_MAX = 3500
const CLOUD_CALL_TIMEOUT_MS = 8000
const TRANSIENT_PATTERNS = ['timeout', 'timed out', 'etimedout', 'econnreset', 'econnaborted', 'socket hang up', 'network', 'request:fail', 'systemerror', 'appservicesdkscripterror']

function isTransientError(err) {
  const text = err ? String(err.errMsg || err.message || err).toLowerCase() : ''
  return TRANSIENT_PATTERNS.some(p => text.includes(p))
}

function getRetryDelay(attempts) {
  return Math.min(CLOUD_RETRY_BASE * Math.pow(2, attempts - 1) + Math.floor(Math.random() * 200), CLOUD_RETRY_MAX)
}

function callCloudWithRetry(callData, retries = 2) {
  if (typeof wx === 'undefined' || !wx.cloud) return Promise.reject(new Error('未初始化 wx.cloud'))
  return new Promise((resolve, reject) => {
    let attempts = 0
    function attempt() {
      attempts++
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        if (attempts <= retries) {
          console.warn(`[Cloud] 请求超时，第 ${attempts} 次重试...`)
          attempt()
          return
        }
        reject(new Error('云函数请求超时，请检查网络或确认 healthApi 已上传部署'))
      }, CLOUD_CALL_TIMEOUT_MS)
      wx.cloud.callFunction({
        ...callData,
        success(res) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const result = res.result
          if (result && isTransientError(result.errMsg) && attempts <= retries) {
            console.warn(`[Cloud] 瞬态错误，第 ${attempts} 次重试...`)
            setTimeout(attempt, getRetryDelay(attempts))
            return
          }
          resolve(result)
        },
        fail(err) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (isTransientError(err) && attempts <= retries) {
            console.warn(`[Cloud] 请求失败，第 ${attempts} 次重试...`)
            setTimeout(attempt, getRetryDelay(attempts))
          } else reject(err)
        }
      })
    }
    attempt()
  })
}

function requestCloud(action, payload) {
  return callCloudWithRetry({ name: apiConfig.cloudFunctionName, data: { action, payload } })
    .then(result => {
      if (result && isFailureErrMsg(result.errMsg)) throw new Error(result.errMsg)
      clearCloudReadCache()
      return result
    })
}

function normalizeCachePayload(value) {
  if (Array.isArray(value)) return value.map(normalizeCachePayload)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((normalized, key) => {
    normalized[key] = normalizeCachePayload(value[key])
    return normalized
  }, {})
}

function createCloudReadCacheKey(key, payload) {
  return `${key}:${JSON.stringify(normalizeCachePayload(payload || {}))}`
}

function getCloudReadCache(cacheKey, allowStale = false) {
  const entry = cloudReadCache[cacheKey]
  if (!entry || (!allowStale && entry.expireAt < Date.now())) return null
  return clone(entry.data)
}

/**
 * 通过指定的 key 调用云函数并获取数据，支持缓存和请求去重
 * @param {string} key - 云函数接口标识
 * @param {Object} [payload={}] - 传递给云函数的参数
 * @returns {Promise<Object>} 云函数返回的数据
 * @throws {Error} 当云函数调用失败且无可用缓存时抛出错误
 */
function requestCloudByKey(key, payload = {}) {
  const cacheKey = createCloudReadCacheKey(key, payload)
  const cached = getCloudReadCache(cacheKey)
  if (cached) return Promise.resolve(cached)
  if (inFlightCloudReads[cacheKey]) return inFlightCloudReads[cacheKey].then(clone)

  const request = callCloudWithRetry({ name: apiConfig.cloudFunctionName, data: { key, payload } })
    .then(result => {
      if (result && isFailureErrMsg(result.errMsg)) throw new Error(result.errMsg)
      cloudReadCache[cacheKey] = { data: clone(result), expireAt: Date.now() + CLOUD_READ_CACHE_TTL_MS }
      return result
    })
    .catch(err => {
      const stale = getCloudReadCache(cacheKey, true)
      if (stale) { console.warn(`[Cloud] ${key} 失败，使用缓存`, err); return stale }
      throw err
    })
    .finally(() => delete inFlightCloudReads[cacheKey])

  inFlightCloudReads[cacheKey] = request
  return request.then(clone)
}

function requestHttp(action, payload) {
  if (!apiConfig.httpBaseUrl) return Promise.reject(new Error('HTTP 后端未配置'))
  if (typeof wx === 'undefined' || !wx.request) return Promise.reject(new Error('不支持 wx.request'))
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiConfig.httpBaseUrl}/${action}`,
      method: 'POST',
      data: payload,
      success(result) {
        if (result.statusCode >= 200 && result.statusCode < 300) {
          if (result.data && isFailureErrMsg(result.data.errMsg)) reject(new Error(result.data.errMsg))
          else resolve(result.data)
        } else reject(new Error(`HTTP ${result.statusCode}`))
      },
      fail: reject
    })
  })
}

async function resolveRemote(action, payload, localHandler, options = {}) {
  const { mirrorLocal = false, preferLocalResult = mirrorLocal } = options

  if (apiConfig.dataSource === 'local') return Promise.resolve(localHandler(payload))
  const remoteReq = apiConfig.dataSource === 'cloud' ? requestCloud(action, payload) : requestHttp(action, payload)
  const remoteResult = await remoteReq
  if (!mirrorLocal || typeof localHandler !== 'function') return remoteResult

  const localResult = localHandler(payload, remoteResult)
  return preferLocalResult ? localResult : remoteResult
}

/**
 * 根据数据源配置解析模拟数据
 * @param {string} key - 数据键名，用于标识请求的数据类型
 * @param {Object} [payload={}] - 请求参数或载荷
 * @returns {Promise<Object>} 返回解析后的数据对象
 */
function resolveMockData(key, payload = {}) {
  if (apiConfig.dataSource === 'cloud') return requestCloudByKey(key, payload)
  if (apiConfig.dataSource === 'http') return requestHttp(`get/${key}`, payload)
  const { DEFAULT_PAGE_DATA } = require('./page-data')
  return Promise.resolve(clone(DEFAULT_PAGE_DATA[key] || {}))
}

let _recordIdSeq = 0
function createRecordId(prefix) { return `${prefix}-${Date.now()}-${++_recordIdSeq}` }
function appendStorageList(key, item) {
  const list = readStorage(key, [])
  const next = [item, ...list]
  writeStorage(key, next)
  return item
}

module.exports = {
  STORAGE_KEYS,
  appendStorageList,
  clearCacheByKeys,
  clearCloudReadCache,
  clearMemoryStorage,
  createRecordId,
  getRelatedCacheKeys,
  getRetryDelay,
  isDirty,
  isTransientError,
  markClean,
  markDirty,
  markDirtyByStorageKey,
  readStorage,
  removeStorage,
  resolveMockData,
  resolveRemote,
  writeStorage,
  writeStorageAndInvalidate
}
