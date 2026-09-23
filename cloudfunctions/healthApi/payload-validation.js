/**
 * 记录与用药入参校验/归一化：从 index.js 迁入，逻辑逐字不变。
 * 云函数与回归脚本共同引用，保证本地回归覆盖真实校验规则。
 */

const {
  CHINA_TIME_OFFSET_MS,
  assertPayloadObject,
  getLimitedString,
  getRequiredNumber,
  getOptionalNumber,
  isValidTime,
  getEnumValue
} = require('./payload-helpers')

/**
 * 校验血压记录入参并归一化。
 * @param {Object} payload 血压记录入参。
 * @returns {Object} 可落库的血压记录字段。
 */
function validateBloodPressurePayload(payload) {
  const data = assertPayloadObject(payload, '血压记录')
  const systolic = getRequiredNumber(data, 'systolic', '收缩压（高压）', 50, 260)
  const diastolic = getRequiredNumber(data, 'diastolic', '舒张压（低压）', 30, 160)
  if (systolic <= diastolic) {
    throw new Error('收缩压（高压）需要大于舒张压（低压）')
  }
  return {
    systolic,
    diastolic,
    pulse: getOptionalNumber(data, 'pulse', '心率', 30, 220),
    tag: getLimitedString(data.tag, '测量场景', 20),
    level: data.level === 'warn' ? 'warn' : '',
    tip: getLimitedString(data.tip, '提示文案', 120),
    note: getLimitedString(data.note, '备注', 200),
    measuredAt: getLimitedString(data.measuredAt, '测量时间', 40) || (() => {
      const c = new Date(Date.now() + CHINA_TIME_OFFSET_MS)
      return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}-${String(c.getUTCDate()).padStart(2, '0')} ${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`
    })()
  }
}

/**
 * 校验血糖记录入参并归一化。
 * @param {Object} payload 血糖记录入参。
 * @returns {Object} 可落库的血糖记录字段。
 */
function validateBloodGlucosePayload(payload) {
  const data = assertPayloadObject(payload, '血糖记录')
  return {
    glucose: getRequiredNumber(data, 'glucose', '血糖值', 1.0, 33.3),
    tag: getLimitedString(data.tag, '测量场景', 20),
    level: data.level === 'warn' ? 'warn' : '',
    tip: getLimitedString(data.tip, '提示文案', 120),
    note: getLimitedString(data.note, '备注', 200),
    measuredAt: getLimitedString(data.measuredAt, '测量时间', 40) || (() => {
      const c = new Date(Date.now() + CHINA_TIME_OFFSET_MS)
      return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}-${String(c.getUTCDate()).padStart(2, '0')} ${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`
    })()
  }
}

/**
 * 校验用药计划入参并归一化。
 * @param {Object} payload 用药计划入参。
 * @returns {Object} 可落库的用药计划字段。
 */
function validateMedicationPlanPayload(payload) {
  const data = assertPayloadObject(payload, '用药计划')
  const times = Array.isArray(data.times) ? data.times : []
  if (!times.length) {
    throw new Error('请至少选择一个提醒时间')
  }
  if (times.length > 8) {
    throw new Error('提醒时间不能超过 8 个')
  }
  const cleanTimes = times.map(time => `${time}`.trim())
  const invalidTime = cleanTimes.find(time => !isValidTime(time))
  if (invalidTime) {
    throw new Error(`提醒时间格式不正确：${invalidTime}`)
  }
  const endDate = getLimitedString(data.endDate, '结束日期', 30)
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('结束日期格式不正确，应为 YYYY-MM-DD')
  }

  return {
    id: data.id || '',
    name: getLimitedString(data.name, '药品名称', 50, true),
    dosage: getLimitedString(data.dosage, '剂量说明', 80),
    times: Array.from(new Set(cleanTimes)),
    subscribe: !!data.subscribe,
    startDate: getLimitedString(data.startDate, '开始日期', 30) || '今天',
    endDate: endDate || ''
  }
}

/**
 * 校验用药确认入参并归一化。
 * @param {Object} payload 用药确认入参。
 * @returns {Object} 可落库的用药确认字段。
 */
function validateMedicationConfirmationPayload(payload) {
  const data = assertPayloadObject(payload, '用药确认')
  const status = getEnumValue(data.status, ['taken', 'skipped', 'snoozed'], '用药确认状态')
  const defaultStatusText = {
    taken: '已服',
    skipped: '已跳过',
    snoozed: '稍后提醒'
  }
  return {
    logId: getLimitedString(data.logId, '用药日志ID', 80, true),
    time: getLimitedString(data.time, '用药时间', 20, true),
    name: getLimitedString(data.name, '药品名称', 50, true),
    dosage: getLimitedString(data.dosage, '剂量说明', 80),
    status,
    statusText: getLimitedString(data.statusText, '状态文案', 20) || defaultStatusText[status]
  }
}

module.exports = {
  validateBloodPressurePayload,
  validateBloodGlucosePayload,
  validateMedicationPlanPayload,
  validateMedicationConfirmationPayload
}
