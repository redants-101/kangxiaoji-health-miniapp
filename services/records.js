const {
  STORAGE_KEYS,
  createRecordId,
  getRelatedCacheKeys,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorage,
  writeStorageAndInvalidate
} = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')
const { parseDisplayDateTime } = require('../utils/date-helper')

function extractCreatedAtDate(record) {
  if (!record) return ''
  const raw = record.createdAt || record.created_at || record.createTime || ''
  if (typeof raw === 'string' && raw.length >= 10) {
    // ISO 8601 含时间部分（T 后有数字）：先解析为 Date 再取本地日期，避免 UTC 跨天偏差
    // 正则宽松匹配 T+数字，覆盖 T23:30Z / T23:30:00Z / T23:30:00.123Z 等变体
    if (/T\d{2}/.test(raw)) {
      const d = new Date(raw)
      if (Number.isFinite(d.getTime())) {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
      }
    }
    return raw.slice(0, 10)
  }
  if (record._id && typeof record._id === 'string' && record._id.length >= 8) {
    try {
      const timestamp = parseInt(record._id.substring(0, 8), 16)
      if (timestamp > 0) {
        const date = new Date(timestamp * 1000)
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
      }
    } catch (e) {
      // ignore
    }
  }
  const timeStr = record.time || record.measuredAt || ''
  if (typeof timeStr === 'string') {
    const match = timeStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    }
    if (/^\d{1,2}月\d{1,2}日/.test(timeStr) || /^今天/.test(timeStr)) {
      const now = new Date()
      const y = now.getFullYear()
      const m = String(now.getMonth() + 1).padStart(2, '0')
      const d = String(now.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
  }
  return ''
}

/**
 * 健康记录服务模块。
 * 负责血压/血糖记录的读写、云端结果适配，以及详情/列表/数据管理页的数据统一。
 */

function getStoredRecords() {
  return readStorage(STORAGE_KEYS.records, [])
}

function getRecordStatus(statusType) {
  if (statusType === 'warn') return '建议复测'
  return '正常'
}

function buildBloodPressureRecord(payload, recordId, source = 'local') {
  const pulseText = payload.pulse || '-'
  const now = new Date()
  // 确保 time 包含完整日期+时间，兼容仅传时间（如 "08:30"）的旧调用
  const datePrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const measuredAtFull = /^\d{4}-\d{2}-\d{2}/.test(payload.measuredAt)
    ? payload.measuredAt
    : `${datePrefix} ${payload.measuredAt}`
  return {
    id: recordId || createRecordId('bp'),
    type: 'bp',
    source,
    title: `血压 ${payload.systolic}/${payload.diastolic} mmHg`,
    value: `${payload.systolic} / ${payload.diastolic}`,
    unit: `mmHg · 心率 ${pulseText} 次/分`,
    time: measuredAtFull,
    tag: payload.tag,
    status: getRecordStatus(payload.level),
    statusType: payload.level || '',
    tip: payload.tip,
    tipLevel: payload.level || '',
    details: [
      { label: '收缩压（高压）', value: `${payload.systolic} mmHg` },
      { label: '舒张压（低压）', value: `${payload.diastolic} mmHg` },
      { label: '心率', value: `${pulseText} 次/分` },
      { label: '测量场景', value: payload.tag },
      { label: '测量时间', value: measuredAtFull },
      { label: '备注', value: payload.note || '未填写' }
    ],
    createdAt: now.toISOString()
  }
}

function buildBloodGlucoseRecord(payload, recordId, source = 'local') {
  const now = new Date()
  // 确保 time 包含完整日期+时间，兼容仅传时间（如 "08:30"）的旧调用
  const datePrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const measuredAtFull = /^\d{4}-\d{2}-\d{2}/.test(payload.measuredAt)
    ? payload.measuredAt
    : `${datePrefix} ${payload.measuredAt}`
  return {
    id: recordId || createRecordId('bg'),
    type: 'bg',
    source,
    title: `血糖 ${payload.glucose} mmol/L`,
    value: `${payload.glucose}`,
    unit: 'mmol/L',
    time: measuredAtFull,
    tag: payload.tag,
    status: payload.level === 'warn' ? '建议复测' : '已记录',
    statusType: payload.level || '',
    tip: payload.tip,
    tipLevel: payload.level || '',
    details: [
      { label: '血糖值', value: `${payload.glucose} mmol/L` },
      { label: '测量场景', value: payload.tag },
      { label: '测量时间', value: measuredAtFull },
      { label: '备注', value: payload.note || '未填写' }
    ],
    createdAt: now.toISOString()
  }
}

function upsertStoredRecord(record) {
  const records = getStoredRecords()
  const nextRecords = records.some((item) => item.id === record.id)
    ? records.map((item) => (item.id === record.id ? record : item))
    : [record, ...records]
  writeStorageAndInvalidate(STORAGE_KEYS.records, nextRecords, getRelatedCacheKeys(STORAGE_KEYS.records))
  return record
}

function getStoredRecordById(recordId) {
  if (!recordId) return getStoredRecords()[0] || null
  return getStoredRecords().find((item) => item.id === recordId) || null
}

function removeStoredRecord(recordId) {
  const records = getStoredRecords()
  const nextRecords = recordId
    ? records.filter((item) => item.id !== recordId)
    : records.slice(1)
  writeStorageAndInvalidate(STORAGE_KEYS.records, nextRecords, getRelatedCacheKeys(STORAGE_KEYS.records))
  return records.length !== nextRecords.length
}

function mapStoredRecordToListItem(record) {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    value: record.value,
    unit: record.unit,
    time: record.time,
    tag: record.tag,
    status: record.status,
    statusType: record.statusType,
    createdAt: extractCreatedAtDate(record)
  }
}

function mapStoredRecordToDetail(record) {
  const createdAtDate = extractCreatedAtDate(record)
  const details = [...record.details]
  details.push({ label: '创建时间', value: createdAtDate || '未知' })
  return {
    recordId: record.id,
    record: {
      id: record.id,
      type: record.type === 'bp' ? '血压' : '血糖',
      value: record.value,
      unit: record.unit,
      time: record.time,
      tag: record.tag,
      status: record.status,
      statusType: record.statusType,
      tip: record.tip,
      tipLevel: record.tipLevel
    },
    details
  }
}

function dedupeRecords(records) {
  const map = new Map()
  records.forEach((item) => {
    if (!item || !item.id || map.has(item.id)) return
    map.set(item.id, item)
  })
  return Array.from(map.values())
}

function buildRecordSummary(records) {
  const daySet = new Set()
  let warnCount = 0

  records.forEach((item) => {
    const parsed = parseDisplayDateTime(item.time)
    daySet.add(parsed.dateValue)
    if (item.statusType === 'warn' || item.status === '建议复测') {
      warnCount += 1
    }
  })

  return [
    { label: '本周记录', value: `${records.length}次` },
    { label: '连续天数', value: `${daySet.size}天` },
    { label: '建议复测', value: `${warnCount}次` }
  ]
}

function normalizeRecordBpData(remoteData) {
  return withMockPageData('recordBp', remoteData, (baseData, remote) => {
    const merged = deepMerge(baseData, remote)
    const tags = Array.isArray(merged.tags) && merged.tags.length
      ? merged.tags
      : (Array.isArray(remote.quickTags) && remote.quickTags.length ? remote.quickTags : baseData.tags)
    return {
      ...merged,
      form: merged.form || baseData.form,
      errors: merged.errors || {},
      tags,
      selectedTag: merged.selectedTag || tags[0] || baseData.selectedTag,
      measuredAt: merged.measuredAt || baseData.measuredAt,
      summaryTip: merged.summaryTip || '',
      summaryLevel: merged.summaryLevel || ''
    }
  })
}

function normalizeRecordBgData(remoteData) {
  return withMockPageData('recordBg', remoteData, (baseData, remote) => {
    const merged = deepMerge(baseData, remote)
    const mealTags = Array.isArray(merged.mealTags) && merged.mealTags.length
      ? merged.mealTags
      : (Array.isArray(remote.quickTags) && remote.quickTags.length ? remote.quickTags : baseData.mealTags)
    return {
      ...merged,
      form: merged.form || baseData.form,
      errors: merged.errors || {},
      mealTags,
      selectedMealTag: merged.selectedMealTag || mealTags[0] || baseData.selectedMealTag,
      measuredAt: merged.measuredAt || baseData.measuredAt,
      summaryTip: merged.summaryTip || '',
      summaryLevel: merged.summaryLevel || ''
    }
  })
}

function normalizeRecordDetailData(remoteData, recordId) {
  const storedRecord = getStoredRecordById(recordId)
  if (storedRecord) {
    return {
      ...withMockPageData('recordDetail', remoteData),
      ...mapStoredRecordToDetail(storedRecord)
    }
  }

  const merged = withMockPageData('recordDetail', remoteData)
  if (merged.record) {
    const record = {
      ...merged.record,
      id: merged.record.id || merged.recordId || recordId || ''
    }
    const createdAtDate = extractCreatedAtDate(record) || extractCreatedAtDate(merged)
    const details = Array.isArray(merged.details) ? [...merged.details] : []
    if (!details.some((item) => item.label === '创建时间')) {
      details.push({ label: '创建时间', value: createdAtDate || '未知' })
    }
    return {
      ...merged,
      recordId: record.id,
      record,
      details
    }
  }

  if (merged.recordId || recordId) {
    const createdAtDate = extractCreatedAtDate(merged)
    const details = Array.isArray(merged.details) ? [...merged.details] : []
    if (!details.some((item) => item.label === '创建时间')) {
      details.push({ label: '创建时间', value: createdAtDate || '未知' })
    }
    return {
      ...merged,
      recordId: merged.recordId || recordId,
      record: {
        id: merged.recordId || recordId,
        type: merged.type || '',
        value: merged.value || '',
        unit: merged.unit || '',
        time: merged.time || '',
        status: merged.status || '',
        statusType: merged.statusType || '',
        tip: merged.tip || '',
        tipLevel: merged.tipLevel || ''
      },
      details
    }
  }

  return withMockPageData('recordDetail', null)
}

function normalizeRecordListData(remoteData) {
  return withMockPageData('recordList', remoteData, (baseData, remote) => {
    const merged = deepMerge(baseData, remote)
    const localRecords = getStoredRecords().map(mapStoredRecordToListItem)
    const localIdSet = new Set(localRecords.map((item) => item.id))

    const rawRemoteRecords = Array.isArray(remote.records) ? remote.records : baseData.records
    const remoteOnlyRecords = rawRemoteRecords.filter((item) => item && (item.id || item._id) && !localIdSet.has(item.id || item._id)).map((item) => {
      const mapped = {
        ...item,
        id: item.id || item._id,
        createdAt: extractCreatedAtDate(item) || item.createdAt || ''
      }
      return mapped
    })
    const combinedRecords = dedupeRecords([...localRecords, ...remoteOnlyRecords])

    return {
      ...merged,
      filters: Array.isArray(merged.filters) && merged.filters.length ? merged.filters : baseData.filters,
      activeFilter: merged.activeFilter || baseData.activeFilter,
      summary: buildRecordSummary(combinedRecords),
      records: combinedRecords
    }
  })
}

function normalizeDataManagementData(remoteData) {
  return withMockPageData('dataManagement', remoteData, (baseData, remote) => {
    const merged = deepMerge(baseData, remote)
    const baseSummary = Array.isArray(baseData.summary) ? baseData.summary : []
    const summaryMap = new Map((Array.isArray(merged.summary) ? merged.summary : baseSummary).map((item) => [item.label, item]))
    const recordCount = getStoredRecords().length

    summaryMap.set('健康记录', {
      label: '健康记录',
      value: `${recordCount}条`
    })

    if (!summaryMap.has('用药计划')) {
      summaryMap.set('用药计划', baseSummary.find((item) => item.label === '用药计划'))
    }
    if (!summaryMap.has('家属关系')) {
      summaryMap.set('家属关系', baseSummary.find((item) => item.label === '家属关系'))
    }

    return {
      ...merged,
      summary: Array.from(summaryMap.values()).filter(Boolean),
      dataScopes: Array.isArray(merged.dataScopes) && merged.dataScopes.length ? merged.dataScopes : (baseData.dataScopes || []),
      exportOptions: Array.isArray(merged.exportOptions) && merged.exportOptions.length ? merged.exportOptions : (baseData.exportOptions || [])
    }
  })
}

function saveBloodPressureRecordLocal(payload, remoteResult) {
  const recordId = payload.id || (remoteResult && (remoteResult.recordId || remoteResult._id))
  const source = remoteResult && (remoteResult.recordId || remoteResult._id) ? 'cloud' : 'local'
  return upsertStoredRecord(buildBloodPressureRecord(payload, recordId, source))
}

function saveBloodGlucoseRecordLocal(payload, remoteResult) {
  const recordId = payload.id || (remoteResult && (remoteResult.recordId || remoteResult._id))
  const source = remoteResult && (remoteResult.recordId || remoteResult._id) ? 'cloud' : 'local'
  return upsertStoredRecord(buildBloodGlucoseRecord(payload, recordId, source))
}

function deleteRecordLocal(payload) {
  const recordId = payload && payload.recordId
  const deleted = removeStoredRecord(recordId)
  return {
    recordId,
    deleted
  }
}

function getRecordBpData() {
  return resolveMockData('recordBp').then(normalizeRecordBpData)
}

function getRecordBgData() {
  return resolveMockData('recordBg').then(normalizeRecordBgData)
}

function getRecordDetailData(recordId) {
  const payload = recordId ? { recordId } : {}
  return resolveMockData('recordDetail', payload).then((remoteData) => normalizeRecordDetailData(remoteData, recordId))
}

function getRecordListData() {
  return resolveMockData('recordList').then(normalizeRecordListData)
}

function getDataManagementData() {
  return resolveMockData('dataManagement').then(normalizeDataManagementData)
}

function saveBloodPressureRecord(payload) {
  const enrichedPayload = { ...payload, createdAt: payload.createdAt || new Date().toISOString() }
  return resolveRemote('saveBloodPressureRecord', enrichedPayload, saveBloodPressureRecordLocal, {
    mirrorLocal: true
  })
}

function saveBloodGlucoseRecord(payload) {
  const enrichedPayload = { ...payload, createdAt: payload.createdAt || new Date().toISOString() }
  return resolveRemote('saveBloodGlucoseRecord', enrichedPayload, saveBloodGlucoseRecordLocal, {
    mirrorLocal: true
  })
}

function deleteRecord(recordId) {
  return resolveRemote('deleteRecord', { recordId }, deleteRecordLocal, {
    mirrorLocal: true
  })
}

function rebuildRecordStats() {
  return resolveRemote('rebuildRecordStats', {})
}

module.exports = {
  buildBloodGlucoseRecord,
  buildBloodPressureRecord,
  buildRecordSummary,
  dedupeRecords,
  deleteRecord,
  extractCreatedAtDate,
  getDataManagementData,
  getRecordBgData,
  getRecordBpData,
  getRecordDetailData,
  getRecordListData,
  getRecordStatus,
  getStoredRecordById,
  getStoredRecords,
  mapStoredRecordToDetail,
  mapStoredRecordToListItem,
  rebuildRecordStats,
  saveBloodGlucoseRecord,
  saveBloodPressureRecord
}
