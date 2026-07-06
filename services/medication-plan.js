/**
 * 根据用药计划 ID 和时间生成日志 ID。
 * 本文件内联定义，避免 medication-merge ↔ medication-plan 循环依赖。
 */
function buildLogId(planId, time) {
  return `log-${planId}-${String(time).replace(':', '')}`
}

const {
  STORAGE_KEYS,
  createRecordId,
  getRelatedCacheKeys,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorageAndInvalidate
} = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')
const { getTodayDateValue } = require('../utils/date-helper')

const DEFAULT_TIMES = [
  { value: '07:00', label: '早餐', enabled: false },
  { value: '12:00', label: '午餐', enabled: false },
  { value: '18:00', label: '晚餐', enabled: false },
  { value: '21:00', label: '睡前', enabled: false }
]

function getStoredMedicationPlans() {
  return readStorage(STORAGE_KEYS.medicationPlans, [])
}

function getStoredMedicationConfirmations() {
  return readStorage(STORAGE_KEYS.medicationConfirmations, [])
}

function upsertMedicationPlan(plan) {
  const plans = getStoredMedicationPlans()
  const nextPlans = plans.some((item) => item.id === plan.id)
    ? plans.map((item) => (item.id === plan.id ? plan : item))
    : [plan, ...plans]
  writeStorageAndInvalidate(STORAGE_KEYS.medicationPlans, nextPlans, getRelatedCacheKeys(STORAGE_KEYS.medicationPlans))
  return plan
}

function saveMedicationPlanLocal(payload, remoteResult) {
  const existingPlan = payload.id
    ? getStoredMedicationPlans().find(p => p.id === payload.id)
    : null
  const plan = {
    id: payload.id || (remoteResult && (remoteResult.planId || remoteResult._id)) || createRecordId('plan'),
    name: payload.name,
    dosage: payload.dosage || '',
    times: payload.times || [],
    subscribe: !!payload.subscribe,
    startDate: payload.startDate || '今天',
    endDate: payload.endDate || '',
    status: existingPlan ? existingPlan.status : '启用',
    updatedAt: new Date().toISOString()
  }
  return upsertMedicationPlan(plan)
}

function deleteMedicationPlanLocal(planId) {
  const plans = getStoredMedicationPlans()
  const filtered = plans.filter(item => item.id !== planId)
  writeStorageAndInvalidate(STORAGE_KEYS.medicationPlans, filtered, getRelatedCacheKeys(STORAGE_KEYS.medicationPlans))
  return { deleted: true, planId }
}

function toggleMedicationPlanStatusLocal(planId) {
  const plans = getStoredMedicationPlans()
  const plan = plans.find(item => item.id === planId)
  if (!plan) return null
  plan.status = plan.status === '启用' ? '已停用' : '启用'
  plan.updatedAt = new Date().toISOString()
  writeStorageAndInvalidate(STORAGE_KEYS.medicationPlans, plans, getRelatedCacheKeys(STORAGE_KEYS.medicationPlans))
  return plan
}

function mapMedicationPlanToListItem(plan) {
  return {
    id: plan.id,
    name: plan.name,
    schedule: `每天 ${plan.times.join(', ')}`,
    status: plan.status || '启用'
  }
}

function getMedicationEditData(baseData, planId) {
  const baseTimes = Array.isArray(baseData.times) && baseData.times.length
    ? baseData.times
    : DEFAULT_TIMES.map(t => ({ ...t }))

  if (!planId) {
    return {
      ...baseData,
      times: baseTimes
    }
  }

  if (baseData.planId && baseData.form && baseData.form.name) {
    const planTimes = baseTimes
      .filter(t => t.enabled)
      .map(t => t.value)
    const storedConfirmations = getStoredMedicationConfirmations()
    const todayStr = getTodayDateValue()
    const confirmedTimes = planTimes.filter((time, index) => {
      const logId = buildLogId(baseData.planId, time)
      const oldLogId = `log-${baseData.planId}-${index}`
      const c = storedConfirmations.find(r => (r.logId === logId || r.logId === oldLogId) && r.confirmDate === todayStr)
      return c && (c.status === 'taken' || c.status === 'skipped')
    })
    return {
      ...baseData,
      times: baseTimes,
      confirmedTimes
    }
  }

  const plan = getStoredMedicationPlans().find((item) => item.id === planId)
  if (!plan) {
    return {
      ...baseData,
      times: baseTimes,
      loadWarning: '未找到该用药计划，请返回重试。'
    }
  }

  const knownTimes = baseTimes.map((item) => item.value)
  const extraTimes = plan.times
    .filter((time) => !knownTimes.includes(time))
    .map((time) => ({ value: time, enabled: true }))

  const storedConfirmations = getStoredMedicationConfirmations()
  const todayStr = getTodayDateValue()
  const confirmedTimes = plan.times.filter((time, index) => {
    const logId = buildLogId(plan.id, time)
    const oldLogId = `log-${plan.id}-${index}`
    const c = storedConfirmations.find(r => (r.logId === logId || r.logId === oldLogId) && r.confirmDate === todayStr)
    return c && (c.status === 'taken' || c.status === 'skipped')
  })

  return {
    ...baseData,
    planId: plan.id,
    form: {
      name: plan.name,
      dosage: plan.dosage,
      subscribe: plan.subscribe,
      startDate: plan.startDate,
      endDate: plan.endDate || ''
    },
    times: baseTimes
      .map((item) => ({
        ...item,
        enabled: plan.times.includes(item.value)
      }))
      .concat(extraTimes),
    confirmedTimes
  }
}

function normalizeMedEditData(remoteData) {
  return withMockPageData('medEdit', remoteData, (baseData, remote) => deepMerge(baseData, remote))
}

function getMedEditData(planId) {
  return resolveMockData('medEdit', planId ? { planId } : {})
    .then(normalizeMedEditData)
    .then((baseData) => getMedicationEditData(baseData, planId))
}

function saveMedicationPlan(payload) {
  return resolveRemote('saveMedicationPlan', payload, saveMedicationPlanLocal, {
    mirrorLocal: true
  })
}

function deleteMedicationPlan(planId) {
  return resolveRemote('deleteMedicationPlan', { planId }, () => deleteMedicationPlanLocal(planId), {
    mirrorLocal: true
  })
}

function toggleMedicationPlanStatus(planId, currentStatus) {
  const newStatus = currentStatus === '启用' ? '已停用' : '启用'
  return resolveRemote('toggleMedicationPlanStatus', { planId, status: newStatus }, () => {
    const localResult = toggleMedicationPlanStatusLocal(planId)
    if (!localResult) return { planId, status: newStatus }
    return localResult
  }, {
    mirrorLocal: true
  })
}

module.exports = {
  DEFAULT_TIMES,
  deleteMedicationPlan,
  deleteMedicationPlanLocal,
  getMedEditData,
  getMedicationEditData,
  getStoredMedicationConfirmations,
  getStoredMedicationPlans,
  mapMedicationPlanToListItem,
  saveMedicationPlan,
  saveMedicationPlanLocal,
  toggleMedicationPlanStatus,
  toggleMedicationPlanStatusLocal,
  upsertMedicationPlan
}
