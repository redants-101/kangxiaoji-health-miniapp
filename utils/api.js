const { resolveMockData } = require('../services/core')
const records = require('../services/records')
const profile = require('../services/profile')
const medication = require('../services/medication')
const family = require('../services/family')
const settings = require('../services/settings')
const privacy = require('../services/privacy')
const feedback = require('../services/feedback')
const dataRights = require('../services/data-rights')
const onboarding = require('../services/onboarding')
const report = require('../services/report')
const { deepMerge, withMockPageData } = require('../services/page-data')
const { parseDisplayDateTime, getTodayDateValue, getWeekStartDate } = require('../utils/date-helper')

/**
 * API 门面层。
 * 页面仍统一 require('../../utils/api')，但具体业务逻辑已经拆到 services/*。
 * 这里只保留少量跨领域组合和纯静态页面接口，避免页面直接依赖服务层。
 */

/** @returns {Promise<Object>} 首次隐私确认页数据。 */
function getPrivacyData() {
  return privacy.getPrivacyData()
}

/** @returns {Promise<Object>} 隐私摘要页数据，兼容旧页面。 */
function getPrivacyDetailData() {
  return privacy.getPrivacyDetailData()
}

/** @returns {Promise<Object>} 完整隐私政策页数据。 */
function getPrivacyPolicyData() {
  return privacy.getPrivacyPolicyData()
}

/** @returns {Promise<Object>} 用户服务协议页数据。 */
function getUserAgreementData() {
  return privacy.getUserAgreementData()
}

/**
 * 标准化首页数据，合并基础数据和远程数据
 * @param {Object} remoteData - 从云函数获取的远程数据，包含最新记录和统计信息
 * @returns {Object} 合并后的首页数据，包含最新指标和周概览
 */
function sortRecordsByTime(recordList) {
  return [...recordList].sort((a, b) => {
    const aParsed = parseDisplayDateTime(a.time || a.measuredAt || '')
    const bParsed = parseDisplayDateTime(b.time || b.measuredAt || '')
    const aDateStr = `${aParsed.dateValue} ${aParsed.timeValue}`
    const bDateStr = `${bParsed.dateValue} ${bParsed.timeValue}`
    if (aDateStr > bDateStr) return -1
    if (aDateStr < bDateStr) return 1
    const aCreated = a.createdAt || ''
    const bCreated = b.createdAt || ''
    return bCreated.localeCompare(aCreated)
  })
}

function formatRecordMeta(record) {
  const rawTime = record.time || record.measuredAt || ''
  const parsed = parseDisplayDateTime(rawTime)

  // 当 time 只含时间（如 "08:30"）时，parseDisplayDateTime 会回退到今天日期，
  // 此时从 createdAt 提取真实日期（复用 records.extractCreatedAtDate 统一处理 ISO 时区）
  let dateValue = parsed.dateValue
  const timeOnly = /^\d{1,2}:\d{2}$/.test(rawTime.trim())
  if (timeOnly && record.createdAt) {
    const extractedDate = records.extractCreatedAtDate(record)
    if (extractedDate) {
      dateValue = extractedDate
    }
  }

  const parts = dateValue.split('-')
  let dateLabel = ''
  if (parts.length === 3) {
    dateLabel = `${Number(parts[1])}月${Number(parts[2])}日`
  }
  const timeLabel = parsed.timeValue
  const tagLabel = record.tag || ''
  const segments = [`${dateLabel} ${timeLabel}`]
  if (tagLabel) segments.push(tagLabel)
  return segments.join(' · ')
}

function buildMetricItem(record, label) {
  return {
    id: record.id,
    type: record.type,
    label,
    value: record.value,
    unit: record.unit,
    meta: formatRecordMeta(record),
    status: '看详情',
    statusType: record.statusType || '',
    route: 'recordDetail',
    hasData: true
  }
}

function buildMetricsFromRecords(allRecords) {
  // 从所有记录中取最新的血压/血糖，不限今日——首页"最新记录"应展示最新一条
  const sorted = sortRecordsByTime(allRecords)
  const latestBp = sorted.find((item) => item.type === 'bp')
  const latestBg = sorted.find((item) => item.type === 'bg')
  const metrics = []
  if (latestBp) {
    metrics.push(buildMetricItem(latestBp, '血压'))
  } else {
    metrics.push({ type: 'bp', label: '血压', hasData: false })
  }
  if (latestBg) {
    metrics.push(buildMetricItem(latestBg, '血糖'))
  } else {
    metrics.push({ type: 'bg', label: '血糖', hasData: false })
  }
  return metrics
}

function buildWeeklyOverviewFromRecords(allRecords) {
  const now = new Date()
  const weekStart = getWeekStartDate(now)
  const todayStr = getTodayDateValue(now)

  const weekRecords = allRecords.filter((item) => {
    // 复用 records.extractCreatedAtDate，统一 ISO→本地日期转换逻辑
    const createdDate = records.extractCreatedAtDate(item)
    if (createdDate) {
      return createdDate >= weekStart && createdDate <= todayStr
    }
    // 回退：从 time/measuredAt 显示值解析日期
    const parsed = parseDisplayDateTime(item.time || item.measuredAt || '')
    return parsed.dateValue >= weekStart && parsed.dateValue <= todayStr
  })

  const bpCount = weekRecords.filter((item) => item.type === 'bp').length
  const bgCount = weekRecords.filter((item) => item.type === 'bg').length

  return {
    group: '血压血糖',
    pills: [
      `血压血糖 ${weekRecords.length} 次`,
      `血压 ${bpCount} 次 · 血糖 ${bgCount} 次`
    ],
    emptyHint: ''
  }
}

function normalizeHomeData(remoteData, listRemoteData) {
  return withMockPageData('home', remoteData, (baseData, remote) => {
    const merged = deepMerge(baseData, remote)

    const storedRecords = records.getStoredRecords()
    const localIdSet = new Set(storedRecords.map((item) => item.id))

    let allRecords = storedRecords

    if (Array.isArray(remote.records) && remote.records.length) {
      const remoteOnlyFromHome = remote.records.filter((item) => item && item.id && !localIdSet.has(item.id))
      allRecords = [...storedRecords, ...remoteOnlyFromHome]
    }

    // 从 recordList 云端数据中补充记录
    if (listRemoteData) {
      const listRecords = Array.isArray(listRemoteData.records) ? listRemoteData.records : []
      const existingIdSet = new Set(allRecords.map((item) => item.id).filter(Boolean))
      const listOnlyRecords = listRecords.filter((item) => item && (item.id || item._id) && !existingIdSet.has(item.id || item._id))
      allRecords = [...allRecords, ...listOnlyRecords]
    }

    // 云端 latestRecord 单条记录兜底（当 listRemoteData 为空或失败时）
    if (allRecords.length === 0 && remote.latestRecord) {
      const r = remote.latestRecord
      allRecords = [{
        id: r.id || r._id,
        type: r.type === '血压' ? 'bp' : (r.type === '血糖' ? 'bg' : r.type),
        value: r.value,
        unit: r.unit,
        time: r.time,
        measuredAt: r.time || r.measuredAt,
        tag: r.tag,
        status: r.status,
        statusType: r.statusType || '',
        createdAt: r.createdAt || ''
      }]
    }

    console.log('[Home] allRecords count:', allRecords.length,
      '| stored:', storedRecords.length,
      '| latestMetrics from records:', allRecords.some(r => r.type === 'bp') ? 'hasBP' : 'noBP',
      allRecords.some(r => r.type === 'bg') ? 'hasBG' : 'noBG')

    merged.latestMetrics = buildMetricsFromRecords(allRecords)

    // 确保 latestMetrics 至少有两个指标槽位（血压 + 血糖），避免区域空白
    if (!Array.isArray(merged.latestMetrics) || merged.latestMetrics.length === 0) {
      merged.latestMetrics = [
        { type: 'bp', label: '血压', hasData: false },
        { type: 'bg', label: '血糖', hasData: false }
      ]
    }

    // 与 latestMetrics 原子性计算 isFirstTime，避免单独 setData 导致状态不一致
    merged.isFirstTime = !merged.latestMetrics.some((m) => m.hasData)

    // 本周日期范围（供概览统计使用）
    const now = new Date()
    const weekStart = getWeekStartDate(now)
    const todayStr = getTodayDateValue(now)

    // 构建分组结构的本周概览
    const weeklyGroups = []

    if (allRecords.length > 0) {
      const overview = buildWeeklyOverviewFromRecords(allRecords)
      weeklyGroups.push({ group: overview.group || '血压血糖', items: overview.pills })
    } else {
      weeklyGroups.push({ group: '血压血糖', items: ['血压血糖 0 次', '血压 0 次 · 血糖 0 次'] })
    }

    // 追加本周用药统计（基于用药计划推算应服次数，结合确认记录计算服药率）
    const weekConfirmations = Array.isArray(merged.weekConfirmations) ? merged.weekConfirmations : []
    const weekMedPlans = Array.isArray(merged.weekMedPlans) ? merged.weekMedPlans : []
    const medOverview = medication.buildWeeklyMedicationOverview(weekStart, todayStr, weekConfirmations, weekMedPlans)
    if (medOverview.pills.length > 0) {
      weeklyGroups.push({ group: medOverview.group || '用药', items: medOverview.pills })
    }

    merged.weeklyGroups = weeklyGroups
    // 兼容旧字段：扁平化 pill 列表，供简单场景使用
    merged.weeklyOverview = weeklyGroups.reduce((acc, g) => acc.concat(g.items), [])

    return merged
  })
}

/** @returns {Promise<Object>} 本人首页数据，已合并称呼和用药状态。 */
function getHomeData() {
  return Promise.all([
    resolveMockData('home').catch(err => {
      console.warn('[Home] resolveMockData("home") 失败:', err.message || err)
      return null
    }),
    resolveMockData('recordList').catch(err => {
      console.warn('[Home] resolveMockData("recordList") 失败:', err.message || err)
      return null
    })
  ]).then(([homeRemote, listRemote]) =>
    normalizeHomeData(homeRemote, listRemote)
  )
    .then(profile.mergeProfileIntoHome)
    .then(medication.mergeHomeMedicationStatus)
}

/** @returns {Promise<Object>} 家属首页数据，已合并最近用药确认状态。 */
function getHomeFamilyData() {
  return resolveMockData('homeFamily')
    .then((remoteData) => withMockPageData('homeFamily', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
    .then(family.enforceHomeFamilyAccess)
    .then(medication.mergeHomeFamilyMedicationStatus)
}

/** @returns {Promise<Object>} 提醒中心数据，已应用用药状态和提醒开关。 */
function getReminderData() {
  return settings.getReminderData()
}

/** @returns {Promise<Object>} 提醒设置页数据，已合并本地设置。 */
function getReminderSettingsData() {
  return settings.getReminderSettingsData()
}

/** @returns {Promise<Object>} 隐私与授权页数据，已合并本地设置。 */
function getPrivacySettingsData() {
  return privacy.getPrivacySettingsData()
}

/** @returns {Promise<Object>} 帮助中心数据。 */
function getHelpData() {
  return feedback.getHelpData()
}

/** @returns {Promise<Object>} 意见反馈页数据。 */
function getFeedbackData() {
  return feedback.getFeedbackData()
}

/**
 * 保存提醒设置。
 * @param {Object} payload 提醒设置页完整数据。
 * @returns {Promise<Object>} 保存结果。
 */
function saveReminderSettings(payload) {
  return settings.saveReminderSettings(payload)
}

/**
 * 更新隐私授权设置。
 * @param {Object} payload 隐私授权页完整数据。
 * @returns {Promise<Object>} 保存结果。
 */
function updatePrivacySettings(payload) {
  return privacy.updatePrivacySettings(payload)
}

/**
 * 提交意见反馈。
 * @param {Object} payload 反馈表单。
 * @returns {Promise<Object>} 保存结果。
 */
function submitFeedback(payload) {
  return feedback.submitFeedback(payload)
}

module.exports = {
  getPrivacyData,
  getPrivacyDetailData,
  getPrivacyPolicyData,
  getUserAgreementData,
  getRoleData: onboarding.getRoleData,
  getFamilyJoinHintData: family.getFamilyJoinHintData,
  getProfileData: profile.getProfileData,
  getHomeData,
  getHomeFamilyData,
  getRecordBpData: records.getRecordBpData,
  getRecordBgData: records.getRecordBgData,
  getRecordDetailData: records.getRecordDetailData,
  getRecordListData: records.getRecordListData,
  getMedListData: medication.getMedListData,
  getMedHistoryData: medication.getMedHistoryData,
  getMedEditData: medication.getMedEditData,
  getMedConfirmData: medication.getMedConfirmData,
  getTrendData: report.getTrendData,
  getFamilyData: family.getFamilyData,
  getFamilyInviteData: family.getFamilyInviteData,
  getFamilyJoinData: family.getFamilyJoinData,
  getFamilyAuthData: family.getFamilyAuthData,
  getReminderData,
  getReminderSettingsData,
  getMeData: profile.getMeData,
  getPrivacySettingsData,
  getDataManagementData: records.getDataManagementData,
  getHelpData,
  getFeedbackData,
  saveBloodPressureRecord: records.saveBloodPressureRecord,
  saveBloodGlucoseRecord: records.saveBloodGlucoseRecord,
  deleteRecord: records.deleteRecord,
  rebuildRecordStats: records.rebuildRecordStats,
  saveProfile: profile.saveProfile,
  saveMedicationPlan: medication.saveMedicationPlan,
  deleteMedicationPlan: medication.deleteMedicationPlan,
  toggleMedicationPlanStatus: medication.toggleMedicationPlanStatus,
  revokeMedicationConfirmation: medication.revokeMedicationConfirmation,
  confirmMedication: medication.confirmMedication,
  updateFamilyAuth: family.updateFamilyAuth,
  createFamilyInvite: family.createFamilyInvite,
  joinFamilyByInvite: family.joinFamilyByInvite,
  revokeFamilyMember: family.revokeFamilyMember,
  exportUserData: dataRights.exportUserData,
  deleteUserData: dataRights.deleteUserData,
  clearUserAccount: dataRights.clearUserAccount,
  saveReminderSettings,
  updatePrivacySettings,
  submitFeedback
}
