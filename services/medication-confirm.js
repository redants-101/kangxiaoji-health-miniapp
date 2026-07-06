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
const { getStoredMedicationPlans } = require('./medication-plan')

function getStoredMedicationConfirmations() {
  return readStorage(STORAGE_KEYS.medicationConfirmations, [])
}

function getLatestMedicationConfirmation() {
  const records = getStoredMedicationConfirmations()
  if (!records.length) return null
  return records.reduce((latest, current) => {
    if (!latest) return current
    return (current.actionAt || '') > (latest.actionAt || '') ? current : latest
  }, null)
}

function appendMedicationConfirmation(confirmation) {
  const records = getStoredMedicationConfirmations()
  const existingIndex = records.findIndex(
    r => r.logId === confirmation.logId && r.confirmDate === confirmation.confirmDate
  )
  if (existingIndex >= 0) {
    const updated = [...records]
    updated[existingIndex] = confirmation
    writeStorageAndInvalidate(STORAGE_KEYS.medicationConfirmations, updated, getRelatedCacheKeys(STORAGE_KEYS.medicationConfirmations))
    return confirmation
  }
  writeStorageAndInvalidate(STORAGE_KEYS.medicationConfirmations, [confirmation, ...records], getRelatedCacheKeys(STORAGE_KEYS.medicationConfirmations))
  return confirmation
}

function confirmMedicationLocal(payload, remoteResult) {
  const confirmation = {
    id: (remoteResult && (remoteResult.confirmationId || remoteResult._id)) || createRecordId('med-log'),
    logId: payload.logId,
    time: payload.time,
    name: payload.name,
    dosage: payload.dosage,
    status: payload.status,
    statusText: payload.statusText,
    confirmDate: getTodayDateValue(),
    actionAt: new Date().toISOString()
  }
  return appendMedicationConfirmation(confirmation)
}

function revokeMedicationConfirmationLocal(logId) {
  const records = getStoredMedicationConfirmations()
  const todayStr = getTodayDateValue()
  const index = records.findIndex(
    r => r.logId === logId && r.confirmDate === todayStr
  )
  if (index < 0) return null
  const removed = records.splice(index, 1)[0]
  writeStorageAndInvalidate(STORAGE_KEYS.medicationConfirmations, records, getRelatedCacheKeys(STORAGE_KEYS.medicationConfirmations))
  return removed
}

function mergeConfirmationsByLogId(localItems, remoteItems) {
  const itemMap = new Map()
  remoteItems.forEach((item) => {
    if (!item || !item.logId) return
    itemMap.set(item.logId, item)
  })
  localItems.forEach((item) => {
    if (!item || !item.logId) return
    const existing = itemMap.get(item.logId)
    if (!existing) {
      itemMap.set(item.logId, item)
      return
    }
    const localTs = item.actionAt || ''
    const remoteTs = existing.actionAt || ''
    if (localTs >= remoteTs) {
      itemMap.set(item.logId, item)
    }
  })
  return Array.from(itemMap.values())
}

function mapConfirmationToListItem(c) {
  return {
    id: c.id,
    logId: c.logId,
    name: c.name,
    dosage: c.dosage,
    time: c.time,
    status: c.status,
    statusText: c.statusText,
    confirmDate: c.confirmDate || '',
    actionAt: c.actionAt
  }
}

function confirmMedication(payload) {
  return resolveRemote('confirmMedication', payload, confirmMedicationLocal, {
    mirrorLocal: true
  })
}

function revokeMedicationConfirmation(logId) {
  return resolveRemote('revokeMedicationConfirmation', { logId }, () => revokeMedicationConfirmationLocal(logId), {
    mirrorLocal: true
  })
}

function normalizeMedConfirmData(remoteData) {
  return withMockPageData('medConfirm', remoteData, (baseData, remote) => deepMerge(baseData, remote))
}

function normalizeMedHistoryData(remoteData) {
  return withMockPageData('medHistory', remoteData, (baseData, remote) => deepMerge(baseData, remote))
}

function getMedHistoryData(startDate, endDate) {
  const payload = {}
  if (startDate) payload.startDate = startDate
  if (endDate) payload.endDate = endDate
  return resolveMockData('medHistory', payload)
    .then(normalizeMedHistoryData)
    .then(mergeMedHistoryConfirmations)
}

function mergeMedHistoryConfirmations(baseData) {
  const remoteGroups = Array.isArray(baseData.dateGroups) ? baseData.dateGroups : []
  if (remoteGroups.length) return baseData

  const storedConfirmations = getStoredMedicationConfirmations()
  if (!storedConfirmations.length) return baseData

  const startDate = baseData.startDate || ''
  const endDate = baseData.endDate || getTodayDateValue()

  const filtered = storedConfirmations.filter(c => {
    if (c.status !== 'taken' && c.status !== 'skipped') return false
    const d = c.confirmDate || ''
    if (startDate && d < startDate) return false
    if (endDate && d > endDate) return false
    return true
  })

  if (!filtered.length) return baseData

  const dateGroupMap = new Map()
  let takenCount = 0
  let skippedCount = 0

  filtered.forEach(c => {
    const date = c.confirmDate || ''
    if (!dateGroupMap.has(date)) dateGroupMap.set(date, [])
    dateGroupMap.get(date).push(mapConfirmationToListItem(c))
    if (c.status === 'taken') takenCount++
    if (c.status === 'skipped') skippedCount++
  })

  const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const dateGroups = []
  for (const [date, records] of dateGroupMap) {
    const parts = date.split('-')
    const d = parts.length === 3 ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) : new Date()
    const dateLabel = `${Number(parts[1])}月${Number(parts[2])}日 ${WEEK_DAYS[d.getDay()]}`
    dateGroups.push({ date, dateLabel, records })
  }

  return {
    ...baseData,
    dateGroups,
    summary: {
      totalRecords: filtered.length,
      takenCount,
      skippedCount
    }
  }
}

module.exports = {
  appendMedicationConfirmation,
  confirmMedication,
  confirmMedicationLocal,
  getLatestMedicationConfirmation,
  getMedHistoryData,
  getStoredMedicationConfirmations,
  mapConfirmationToListItem,
  mergeConfirmationsByLogId,
  revokeMedicationConfirmation,
  revokeMedicationConfirmationLocal
}
