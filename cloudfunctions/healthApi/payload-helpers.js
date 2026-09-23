/**
 * 通用无副作用纯函数：北京时间口径、入参断言、字符串/数字/枚举校验。
 * index.js、各 *-service.js 与 scripts/health-api-regression.js 共同引用本模块，
 * 避免回归脚本复制一份业务校验逻辑后与真实实现漂移。
 * 本文件不依赖 wx-server-sdk，require 不产生任何初始化或网络副作用。
 */

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 获取北京时间当天日期串。
 * 云函数运行在 UTC 时区，需手动加偏移并用 UTC 方法取值。
 * @returns {string} YYYY-MM-DD（北京日期）。
 */
function getTodayDateValue() {
  const now = new Date()
  const chinaTime = new Date(now.getTime() + CHINA_TIME_OFFSET_MS)
  const y = chinaTime.getUTCFullYear()
  const m = String(chinaTime.getUTCMonth() + 1).padStart(2, '0')
  const d = String(chinaTime.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 由计划 ID 和时间点生成用药日志 ID。
 * @param {string} planId 用药计划 ID。
 * @param {string} time HH:mm 时间点。
 * @returns {string} 日志 ID。
 */
function buildLogId(planId, time) {
  return `log-${planId}-${String(time).replace(':', '')}`
}

/**
 * 格式化记录状态。
 * @param {string} level 记录等级，warn 表示建议复测。
 * @returns {string} 页面展示状态。
 */
function getRecordStatus(level) {
  if (level === 'warn') return '建议复测'
  return '正常'
}

/**
 * 断言 payload 是对象。
 * @param {*} payload 云函数入参。
 * @param {string} label 业务名称。
 * @returns {Object} payload 对象。
 */
function assertPayloadObject(payload, label) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${label}参数不能为空`)
  }
  return payload
}

/**
 * 限制文本长度。
 * @param {*} value 原始值。
 * @param {string} label 展示名称。
 * @param {number} maxLength 最大长度。
 * @param {boolean} required 是否必填。
 * @returns {string} 清理后的文本。
 */
function getLimitedString(value, label, maxLength, required = false) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) {
    throw new Error(`${label}不能为空`)
  }
  if (text.length > maxLength) {
    throw new Error(`${label}不能超过 ${maxLength} 个字`)
  }
  return text
}

/**
 * 读取必填数字并校验范围。
 * @param {Object} payload 入参对象。
 * @param {string} field 字段名。
 * @param {string} label 展示名称。
 * @param {number} min 最小值。
 * @param {number} max 最大值。
 * @returns {number} 校验后的数字。
 */
function getRequiredNumber(payload, field, label, min, max) {
  const value = Number(payload[field])
  if (!Number.isFinite(value)) {
    throw new Error(`${label}必须是数字`)
  }
  if (value < min || value > max) {
    throw new Error(`${label}范围应为 ${min}-${max}`)
  }
  return value
}

/**
 * 读取可选数字并校验范围。
 * @param {Object} payload 入参对象。
 * @param {string} field 字段名。
 * @param {string} label 展示名称。
 * @param {number} min 最小值。
 * @param {number} max 最大值。
 * @returns {number|null} 校验后的数字或 null。
 */
function getOptionalNumber(payload, field, label, min, max) {
  if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
    return null
  }
  return getRequiredNumber(payload, field, label, min, max)
}

/**
 * 校验提醒时间格式。
 * @param {string} time 时间字符串。
 * @returns {boolean} true 表示 HH:mm 格式有效。
 */
function isValidTime(time) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
}

/**
 * 校验状态枚举。
 * @param {string} value 状态值。
 * @param {Array<string>} allowed 允许值。
 * @param {string} label 展示名称。
 * @returns {string} 状态值。
 */
function getEnumValue(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label}不合法`)
  }
  return value
}

/**
 * 创建归属校验函数（绑定到注入的 db，云端 db 与 Mock db 均适用）。
 * @param {Object} db 数据库实例。
 * @returns {(collection: string, openId: string, documentId: string, label: string) => Promise<Object>}
 */
function createAssertOwnedDocument(db) {
  return async function assertOwnedDocument(collection, openId, documentId, label) {
    if (!documentId) {
      throw new Error(`${label}ID不能为空`)
    }
    const { data } = await db.collection(collection)
      .where({ _id: documentId, _openid: openId })
      .limit(1)
      .get()
    if (!data.length) {
      throw new Error(`${label}不存在或无权操作`)
    }
    return data[0]
  }
}

module.exports = {
  CHINA_TIME_OFFSET_MS,
  getTodayDateValue,
  buildLogId,
  getRecordStatus,
  assertPayloadObject,
  getLimitedString,
  getRequiredNumber,
  getOptionalNumber,
  isValidTime,
  getEnumValue,
  createAssertOwnedDocument
}
