const { resolveMockData } = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')
const { getStoredRecords, extractCreatedAtDate, dedupeRecords } = require('./records')
const { getTodayDateValue, getWeekStartDate } = require('../utils/date-helper')
const {
  toChartBars, toAriaLabel, buildTrendChart, buildBpBgCharts,
  MED_NORMAL, TIME_BUCKET, formatBucketLabel, calcRefLineTop
} = require('../utils/chart-adapter')
const { getStoredMedicationConfirmations } = require('./medication-confirm')
const { getStoredMedicationPlans } = require('./medication-plan')

// ─── 日期筛选 ──────────────────────────────────────────────

function filterWeekRecords(records) {
  const now = new Date()
  const weekStart = getWeekStartDate(now)
  const todayStr = getTodayDateValue(now)
  return records.filter(item => {
    const dateStr = extractCreatedAtDate(item)
    return dateStr >= weekStart && dateStr <= todayStr
  })
}

function filterRecordsByDays(records, days) {
  if (days === 7) return filterWeekRecords(records)
  const now = new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  // 用本地日期而非 UTC，避免凌晨附近跨天偏差
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  const todayStr = getTodayDateValue(now)
  return records.filter(item => {
    const dateStr = extractCreatedAtDate(item)
    return dateStr >= cutoffStr && dateStr <= todayStr
  })
}

// ─── 数值解析 ──────────────────────────────────────────────

function parseBpValues(record) {
  const raw = record.value || ''
  const parts = String(raw).split('/')
  const systolic = parseInt(parts[0], 10) || 0
  const diastolic = parseInt(parts[1], 10) || 0
  return { systolic, diastolic }
}

function parseBgValue(record) {
  return parseFloat(record.value) || 0
}

// ─── 统计摘要（从周报迁入） ─────────────────────────────────

function buildReportSummary(bpRecords, bgRecords) {
  const summary = []
  if (bpRecords.length) {
    const systolics = bpRecords.map(parseBpValues).map(v => v.systolic).filter(v => v > 0)
    const diastolics = bpRecords.map(parseBpValues).map(v => v.diastolic).filter(v => v > 0)
    summary.push({
      label: '血压',
      items: [
        { label: '平均收缩压（高压）', value: systolics.length ? Math.round(systolics.reduce((a, b) => a + b, 0) / systolics.length) : '-', unit: 'mmHg' },
        { label: '平均舒张压（低压）', value: diastolics.length ? Math.round(diastolics.reduce((a, b) => a + b, 0) / diastolics.length) : '-', unit: 'mmHg' },
        { label: '最高收缩压（高压）', value: systolics.length ? Math.max(...systolics) : '-', unit: 'mmHg' },
        { label: '记录次数', value: `${bpRecords.length}次` }
      ]
    })
  }
  if (bgRecords.length) {
    const glucoses = bgRecords.map(parseBgValue).filter(v => v > 0)
    summary.push({
      label: '血糖',
      items: [
        { label: '平均血糖', value: glucoses.length ? (glucoses.reduce((a, b) => a + b, 0) / glucoses.length).toFixed(1) : '-', unit: 'mmol/L' },
        { label: '最高值', value: glucoses.length ? Math.max(...glucoses).toFixed(1) : '-', unit: 'mmol/L' },
        { label: '最低值', value: glucoses.length ? Math.min(...glucoses).toFixed(1) : '-', unit: 'mmol/L' },
        { label: '记录次数', value: `${bgRecords.length}次` }
      ]
    })
  }
  return summary
}

// ─── 异常检测（从周报迁入） ─────────────────────────────────

function isAbnormalRecord(record) {
  if (record.statusType === 'warn' || record.status === '建议复测') return true

  if (record.type === 'bp') {
    const { systolic, diastolic } = parseBpValues(record)
    if (systolic >= 140 || diastolic >= 90) return true
    if (systolic > 0 && (systolic < 90 || diastolic < 60)) return true
  }

  if (record.type === 'bg') {
    const glucose = parseBgValue(record)
    if (glucose >= 7.0) return true
    if (glucose > 0 && glucose <= 3.9) return true
  }

  return false
}

function buildAbnormalReason(record) {
  if (record.tip) return record.tip

  if (record.type === 'bp') {
    const { systolic, diastolic } = parseBpValues(record)
    if (systolic >= 180 || diastolic >= 110) return '血压值处于高危水平，建议尽快就医'
    if (systolic >= 140 || diastolic >= 90) return '血压偏高，建议复测并咨询医生'
    if (systolic < 90 || diastolic < 60) return '血压偏低，建议复测'
  }

  if (record.type === 'bg') {
    const glucose = parseBgValue(record)
    if (glucose >= 11.1) return '血糖显著偏高，建议及时就医'
    if (glucose >= 7.0) return '血糖偏高，建议控制饮食并复测'
    if (glucose <= 3.9) return '血糖偏低，注意补充糖分'
  }

  return '数值异常，建议复测'
}

function buildReportFocusItems(records) {
  return records
    .filter(isAbnormalRecord)
    .map(r => ({
      id: r.id,
      type: r.type === 'bp' ? '血压' : '血糖',
      value: r.value,
      unit: r.unit || (r.type === 'bp' ? 'mmHg' : 'mmol/L'),
      time: r.time || r.measuredAt || '',
      tag: r.tag || '',
      reason: buildAbnormalReason(r)
    }))
}

// ─── 图表构建（从周报迁入，已合并到 chart-adapter） ─────────

function buildReportChartFromRecords(bpRecords, bgRecords, periodLabel = '本周') {
  const allRecords = [...bpRecords, ...bgRecords]
  if (!allRecords.length) {
    return { chartBars: [], chartA11yLabel: `${periodLabel}暂无健康记录` }
  }

  const byDate = {}
  allRecords.forEach(r => {
    const dateStr = extractCreatedAtDate(r)
    if (!dateStr) return
    const key = `${dateStr}_${r.type}`
    if (!byDate[key] || r.createdAt > byDate[key].createdAt) {
      byDate[key] = r
    }
  })

  const sortedKeys = Object.keys(byDate).sort()
  const labels = sortedKeys.map(k => {
    const dateStr = k.split('_')[0]
    const type = byDate[k].type === 'bp' ? '血压' : '血糖'
    return `${dateStr.slice(5)} ${type}`
  })
  const values = sortedKeys.map(k => {
    const r = byDate[k]
    if (r.type === 'bp') return parseBpValues(r).systolic
    return parseBgValue(r)
  })

  const chartBars = toChartBars(values, labels)
  return {
    chartBars,
    chartA11yLabel: toAriaLabel(`${periodLabel} 趋势`, chartBars, '')
  }
}

// ─── 用药趋势辅助函数 ──────────────────────────────────────

/**
 * 从 logId 提取 planId。
 * 与 medication-merge.js 中的 extractPlanIdFromLogId 逻辑一致。
 */
function extractPlanIdFromLogId(logId) {
  if (!logId || typeof logId !== 'string') return ''
  const lastDash = logId.lastIndexOf('-')
  if (lastDash < 4) return ''
  const afterDash = logId.slice(lastDash + 1)
  if (/^\d{3,4}$/.test(afterDash)) {
    return logId.slice(4, lastDash)
  }
  return logId.slice(4)
}

/**
 * 计算指定日期范围内每天的服药率。
 * @param {string} startDate 起始日期 YYYY-MM-DD
 * @param {string} endDate   结束日期 YYYY-MM-DD
 * @param {Object[]} confirmations 合并去重后的确认记录
 * @param {Object[]} plans 启用中的用药计划
 * @returns {Map<string, number>} dateStr → 服药率(0-100)
 */
function buildDailyComplianceMap(startDate, endDate, confirmations, plans) {
  // 按日期分组确认记录
  const confirmByDate = new Map()
  confirmations.forEach(c => {
    if (c.status !== 'taken' && c.status !== 'skipped') return
    const d = c.confirmDate || ''
    if (!confirmByDate.has(d)) confirmByDate.set(d, [])
    confirmByDate.get(d).push(c)
  })

  // 计算每天的应服和已服
  const dailyMap = new Map()
  const startMs = new Date(startDate + 'T00:00:00').getTime()
  const endMs = new Date(endDate + 'T00:00:00').getTime()
  const DAY_MS = 24 * 60 * 60 * 1000

  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const d = new Date(ms)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let shouldTake = 0
    plans.forEach(plan => {
      const times = Array.isArray(plan.times) ? plan.times : []
      if (times.length === 0 || plan.status === '已停用') return
      const planStart = (plan.startDate && plan.startDate !== '今天') ? plan.startDate : ''
      const planEnd = plan.endDate || ''
      if (planStart && dateStr < planStart) return
      if (planEnd && dateStr > planEnd) return
      shouldTake += times.length
    })
    const dayConfirms = confirmByDate.get(dateStr) || []
    const taken = dayConfirms.filter(c => c.status === 'taken').length
    const rate = shouldTake > 0 ? Math.round((taken / shouldTake) * 100) : 0
    dailyMap.set(dateStr, { shouldTake, taken, skipped: dayConfirms.filter(c => c.status === 'skipped').length, rate })
  }
  return dailyMap
}

/**
 * 按时间桶聚合每日服药率数据，生成图表 labels + values。
 */
function aggregateMedicationByBucket(dailyMap, range) {
  if (dailyMap.size === 0) return { labels: [], values: [] }
  const bucket = TIME_BUCKET[range] || TIME_BUCKET['7d']
  const sortedDays = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  // 将日期映射到时间桶
  const earliestMs = new Date(sortedDays[0][0] + 'T00:00:00').getTime()
  const buckets = []

  sortedDays.forEach(([dateStr, data]) => {
    // 仅纳入有应服计划的日期，避免 shouldTake=0 的日期拉低桶平均值
    if (data.shouldTake === 0) return
    const ts = new Date(dateStr + 'T00:00:00').getTime()
    const bucketIdx = Math.floor((ts - earliestMs) / bucket.bucketMs)
    if (!buckets[bucketIdx]) {
      buckets[bucketIdx] = { rates: [], ts }
    }
    buckets[bucketIdx].rates.push(data.rate)
    buckets[bucketIdx].ts = Math.max(buckets[bucketIdx].ts, ts)
  })

  return {
    labels: buckets.filter(Boolean).map(b => formatBucketLabel(b.ts, bucket.labelFmt)),
    values: buckets.filter(Boolean).map(b => {
      const avg = b.rates.reduce((a, r) => a + r, 0) / b.rates.length
      return Math.round(avg)
    })
  }
}

/**
 * 构建用药趋势的统计摘要。
 * 按计划独立展示服药率和详细数据。
 */
function buildMedicationSummary(plans, confirmations, startDate, endDate) {
  // 按日期 + planId 分组确认
  const confirmByPlan = new Map()
  confirmations.forEach(c => {
    if (c.status !== 'taken' && c.status !== 'skipped') return
    const planId = extractPlanIdFromLogId(c.logId)
    if (!planId) return
    if (!confirmByPlan.has(planId)) confirmByPlan.set(planId, [])
    confirmByPlan.get(planId).push(c)
  })

  const summary = []
  let totalShouldTake = 0
  let totalTaken = 0
  let totalSkipped = 0

  plans.forEach(plan => {
    const times = Array.isArray(plan.times) ? plan.times : []
    if (times.length === 0 || plan.status === '已停用') return

    // 计算该计划在日期范围内的应服次数
    const planStart = (plan.startDate && plan.startDate !== '今天') ? plan.startDate : ''
    const planEnd = plan.endDate || ''
    let shouldTake = 0
    const startMs = new Date(startDate + 'T00:00:00').getTime()
    const endMs = new Date(endDate + 'T00:00:00').getTime()
    const DAY_MS = 24 * 60 * 60 * 1000

    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const d = new Date(ms)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (planStart && dateStr < planStart) continue
      if (planEnd && dateStr > planEnd) continue
      shouldTake += times.length
    }

    if (shouldTake === 0) return

    const planConfirms = (confirmByPlan.get(plan.planId) || [])
      .filter(c => {
        const d = c.confirmDate || ''
        return d >= startDate && d <= endDate
      })
    const taken = planConfirms.filter(c => c.status === 'taken').length
    const skipped = planConfirms.filter(c => c.status === 'skipped').length
    const rate = shouldTake > 0 ? Math.round((taken / shouldTake) * 100) : 0

    totalShouldTake += shouldTake
    totalTaken += taken
    totalSkipped += skipped

    const items = [
      { label: '服药率', value: `${rate}%` }
    ]
    if (skipped > 0) {
      items.push({ label: '应服/已服/跳过', value: `${shouldTake}/${taken}/${skipped}` })
    } else {
      items.push({ label: '应服/已服', value: `${shouldTake}/${taken}` })
    }

    summary.push({ label: plan.name, items })
  })

  // 添加汇总行（仅当有多个活跃计划实际贡献了数据时显示）
  if (summary.length > 1 && totalShouldTake > 0) {
    const totalRate = Math.round((totalTaken / totalShouldTake) * 100)
    summary.unshift({
      label: '整体',
      items: [
        { label: '服药率', value: `${totalRate}%` },
        { label: '应服/已服/跳过', value: `${totalShouldTake}/${totalTaken}/${totalSkipped}` }
      ]
    })
  }

  return summary
}

/**
 * 构建用药趋势的关注项。
 * 服药率低于 50% 的日期 → 关注。
 */
function buildMedicationFocusItems(dailyMap, days) {
  const items = []
  const isWeekly = days === 7

  dailyMap.forEach((data, dateStr) => {
    if (data.shouldTake > 0 && data.rate < 50) {
      const parts = dateStr.split('-')
      const dateLabel = `${Number(parts[1])}月${Number(parts[2])}日`
      items.push({
        id: `med-focus-${dateStr}`,
        type: '用药',
        value: `${data.rate}%`,
        unit: '服药率',
        time: dateLabel,
        tag: '',
        reason: `${dateLabel}服药率偏低，仅 ${data.rate}%（已服 ${data.taken}/${data.shouldTake}）`
      })
    }
  })

  return items.slice(0, 4)
}

/**
 * 合并本地 + 云端用药确认记录（composite key: logId::confirmDate）。
 */
function mergeMedConfirmations(cloudConfirmations) {
  const localConfirmations = getStoredMedicationConfirmations()
  const map = new Map()
  function confirmKey(c) { return `${c.logId}::${c.confirmDate || ''}` }
  cloudConfirmations.forEach(c => {
    if (c && c.logId && !map.has(confirmKey(c))) map.set(confirmKey(c), c)
  })
  localConfirmations.forEach(c => {
    if (c && c.logId) map.set(confirmKey(c), c)
  })
  return Array.from(map.values())
}

/**
 * 合并云端 + 本地用药计划。
 */
function mergeMedPlans(cloudPlans) {
  const localPlans = getStoredMedicationPlans()
    .filter(p => p.status !== '已停用')
    .map(p => ({
      planId: p.id,
      name: p.name,
      dosage: p.dosage,
      times: p.times,
      status: p.status,
      startDate: p.startDate || '',
      endDate: p.endDate || ''
    }))
  const planMap = new Map()
  ;(cloudPlans || []).forEach(p => { if (p && p.planId && p.status !== '已停用') planMap.set(p.planId, p) })
  localPlans.forEach(p => { if (p && p.planId) planMap.set(p.planId, p) })
  return Array.from(planMap.values())
}

// ─── 统一数据加载入口 ──────────────────────────────────────

/**
 * 合并后的趋势页统一数据加载。
 * @param {string} metric 指标键名：bloodPressure / bloodGlucose / medication
 * @param {string} range  时间范围：7d / 30d / 90d
 * @returns {Promise<Object>} 包含摘要、关注项、图表、记录列表等完整数据
 */
async function getTrendData(metric = 'bpBg', range = '7d') {
  const days = parseInt(range, 10) || 7
  const isWeekly = range === '7d'

  // ─── 用药指标：独立数据分支 ───
  if (metric === 'medication') {
    return getMedicationTrendData(range, days, isWeekly)
  }

  // ─── 血压血糖指标：原有逻辑 ───
  // bpBg 为血压+血糖复合指标，图表默认取血压趋势
  const chartMetric = metric === 'bpBg' ? 'bloodPressure' : metric

  // 并行获取：本地存储记录 + 云端趋势数据 + 云端记录列表（补充本地可能缺失的记录）
  const [localRecords, remoteData, listRemoteData] = await Promise.all([
    Promise.resolve(getStoredRecords()),
    resolveMockData('trend').catch(err => {
      console.warn('[Trend] resolveMockData("trend") 失败:', err.message || err)
      return null
    }),
    resolveMockData('recordList').catch(err => {
      console.warn('[Trend] resolveMockData("recordList") 失败:', err.message || err)
      return null
    })
  ])

  // 合并本地 + 云端记录列表
  const allRecords = [...localRecords]
  const localIdSet = new Set(localRecords.map(r => r.id).filter(Boolean))

  // 从 trend 远程数据补充记录
  const remoteRecords = Array.isArray(remoteData && remoteData.records) ? remoteData.records : []
  remoteRecords.forEach(r => {
    const id = r.id || r._id
    if (id && !localIdSet.has(id)) {
      allRecords.push({
        ...r,
        id,
        createdAt: extractCreatedAtDate(r) || r.createdAt || ''
      })
    }
  })

  // 从 recordList 远程数据补充记录（与首页逻辑一致）
  if (listRemoteData) {
    const listRecords = Array.isArray(listRemoteData.records) ? listRemoteData.records : []
    const existingIdSet = new Set(allRecords.map(r => r.id).filter(Boolean))
    listRecords.forEach(r => {
      const id = r.id || r._id
      if (id && !existingIdSet.has(id)) {
        allRecords.push({
          ...r,
          id,
          createdAt: extractCreatedAtDate(r) || r.createdAt || ''
        })
      }
    })
  }

  // 按时间范围筛选
  const rangeRecords = filterRecordsByDays(allRecords, days)
  const bpRecords = rangeRecords.filter(r => r.type === 'bp')
  const bgRecords = rangeRecords.filter(r => r.type === 'bg')

  // 统计摘要 & 关注项：所有档位均展示
  const summary = buildReportSummary(bpRecords, bgRecords)
  const focusItems = buildReportFocusItems(rangeRecords).slice(0, 4)

  // 摘要指标卡片
  const summaryMetrics = {
    recordCount: rangeRecords.length,
    bpCount: bpRecords.length,
    bgCount: bgRecords.length
  }

  // 空数据提示
  const emptyHint = rangeRecords.length === 0
    ? `${isWeekly ? '本周' : `近${days}天`}暂无记录，开始记录后趋势将自动生成`
    : ''

  // 图表构建
  let chartData
  const periodLabel = isWeekly ? '本周' : `近${days}天`

  if (metric === 'bpBg') {
    // 血压血糖复合指标：返回双图表数据
    const chartSeriesMap = remoteData && remoteData.chartSeries
    chartData = buildBpBgCharts(bpRecords, bgRecords, range, periodLabel, chartSeriesMap)
  } else {
    // 单指标：原有逻辑
    if (isWeekly && rangeRecords.length > 0) {
      chartData = buildReportChartFromRecords(bpRecords, bgRecords, periodLabel)
    } else {
      const chartSeriesMap = remoteData && remoteData.chartSeries
      const currentSummary = (remoteData && remoteData.summaries && remoteData.summaries[chartMetric]) || {}
      chartData = buildTrendChart(chartMetric, range, currentSummary, chartSeriesMap)
    }
  }

  // 指标切换选项
  const metricOptions = [
    { key: 'bpBg', label: '血压血糖' },
    { key: 'medication', label: '用药' }
  ]

  // 时间范围选项
  const rangeOptions = [
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: '90d', label: '90天' }
  ]

  // 当前指标摘要：bpBg 复合指标取血压摘要作为图表头部
  const summaries = (remoteData && remoteData.summaries) || {}
  const currentSummary = summaries[chartMetric] || {}

  // 记录列表（仅展示最新4条，点击"全部"查看更多）
  const sortedRangeRecords = [...rangeRecords].sort((a, b) => {
    const da = extractCreatedAtDate(a) || a.createdAt || ''
    const db = extractCreatedAtDate(b) || b.createdAt || ''
    return db.localeCompare(da)
  })
  const records = sortedRangeRecords.slice(0, 4)

  // 统一返回值：单指标模式下清空 bpChart/bgChart，避免旧数据残留
  const result = {
    activeMetric: metric,
    activeRange: range,
    period: isWeekly ? '本周' : `近${days}天`,
    subtitle: rangeRecords.length > 0 ? `${rangeRecords.length}次记录` : '暂无记录',
    summary,
    focusItems,
    summaryMetrics,
    emptyHint,
    metricOptions,
    rangeOptions,
    summaries,
    currentSummary,
    chartSeries: (remoteData && remoteData.chartSeries) || {},
    records,
    // bpBg 双图表数据（单指标时为空）
    bpChart: { hasData: false, systolicBars: [], diastolicBars: [], labels: [], chartA11yLabel: '' },
    bgChart: { hasData: false, chartBars: [], labels: [], chartA11yLabel: '' },
    // 单指标图表数据（bpBg 时为空）
    chartBars: [],
    chartA11yLabel: '',
    // 清理用药图表残留
    medChart: null,
    ...chartData
  }

  return result
}

/**
 * 用药趋势数据加载（独立分支）。
 * 复用 medHistory 云端接口 + 本地用药计划，计算每日服药率并聚合。
 */
async function getMedicationTrendData(range, days, isWeekly) {
  const now = new Date()
  const todayStr = getTodayDateValue(now)

  // 计算日期范围
  let startDate
  if (isWeekly) {
    startDate = getWeekStartDate(now)
  } else {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    startDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  }

  // 并行获取：云端用药历史 + 首页数据（取 weekMedPlans）
  const [medHistoryData, homeData] = await Promise.all([
    resolveMockData('medHistory', { startDate, endDate: todayStr }).catch(err => {
      console.warn('[Trend/Med] resolveMockData("medHistory") 失败:', err.message || err)
      return null
    }),
    resolveMockData('home').catch(err => {
      console.warn('[Trend/Med] resolveMockData("home") 失败:', err.message || err)
      return null
    })
  ])

  // 提取云端确认记录
  const cloudConfirmations = []
  const cloudDateGroups = Array.isArray(medHistoryData && medHistoryData.dateGroups) ? medHistoryData.dateGroups : []
  cloudDateGroups.forEach(group => {
    const groupRecords = Array.isArray(group.records) ? group.records : []
    groupRecords.forEach(r => cloudConfirmations.push(r))
  })

  // 合并确认记录
  const allConfirmations = mergeMedConfirmations(cloudConfirmations)
  // 筛选时间范围内的确认记录
  const rangeConfirmations = allConfirmations.filter(c => {
    const d = c.confirmDate || ''
    return d >= startDate && d <= todayStr
  })

  // 提取云端用药计划
  const cloudMedPlans = Array.isArray(homeData && homeData.weekMedPlans) ? homeData.weekMedPlans : []
  // 合并用药计划
  const plans = mergeMedPlans(cloudMedPlans)

  // 计算每日服药率
  const dailyMap = buildDailyComplianceMap(startDate, todayStr, rangeConfirmations, plans)

  // 统计摘要
  const summary = buildMedicationSummary(plans, rangeConfirmations, startDate, todayStr)

  // 关注项
  const focusItems = buildMedicationFocusItems(dailyMap, days)

  // 计算汇总指标
  let totalShouldTake = 0
  let totalTaken = 0
  let totalSkipped = 0
  dailyMap.forEach(d => {
    totalShouldTake += d.shouldTake
    totalTaken += d.taken
    totalSkipped += d.skipped
  })
  const totalRate = totalShouldTake > 0 ? Math.round((totalTaken / totalShouldTake) * 100) : 0

  // 摘要指标卡片（用药专属）
  const summaryMetrics = {
    recordCount: rangeConfirmations.length,
    complianceRate: totalRate,
    takenCount: totalTaken,
    skippedCount: totalSkipped,
    shouldTakeCount: totalShouldTake
  }

  // 空数据提示
  const emptyHint = plans.length === 0
    ? '暂无启用中的用药计划，添加计划后趋势将自动生成'
    : (rangeConfirmations.length === 0
      ? `${isWeekly ? '本周' : `近${days}天`}暂无用药确认记录`
      : '')

  // 图表构建
  const periodLabel = isWeekly ? '本周' : `近${days}天`
  let chartData
  const aggregated = aggregateMedicationByBucket(dailyMap, range)

  if (aggregated.values.length > 0) {
    const chartBars = toChartBars(aggregated.values, aggregated.labels, 'medication', 0)
    const yAxis = chartBars.yAxis || { floor: 0, ceil: 100 }
    chartData = {
      chartBars,
      chartA11yLabel: toAriaLabel(`${periodLabel}服药率趋势`, chartBars, '', 'medication'),
      // 用药图表参考线
      medChart: {
        labels: aggregated.labels,
        chartBars,
        chartA11yLabel: toAriaLabel(`${periodLabel}服药率趋势`, chartBars, '', 'medication'),
        hasData: chartBars.length > 0,
        refComplianceHighTop: calcRefLineTop(MED_NORMAL.complianceHigh, yAxis),
        refComplianceLowTop: calcRefLineTop(MED_NORMAL.complianceLow, yAxis)
      }
    }
  } else {
    chartData = {
      chartBars: [],
      chartA11yLabel: `${periodLabel}暂无用药趋势数据`
    }
  }

  // 当前指标摘要（图表头部显示）
  const currentSummary = {
    label: '服药率',
    value: `${totalRate}%`,
    badge: totalRate >= MED_NORMAL.complianceHigh ? '达标' : (totalRate >= MED_NORMAL.complianceLow ? '需关注' : '偏低')
  }

  // 用药确认记录列表（最近4条）
  const sortedConfirms = [...rangeConfirmations].sort((a, b) => {
    const ta = a.actionAt || ''
    const tb = b.actionAt || ''
    return tb.localeCompare(ta)
  })
  const records = sortedConfirms.slice(0, 4).map(c => ({
    id: c.id || c.logId,
    type: 'medication',
    label: '用药',
    value: c.statusText || (c.status === 'taken' ? '已服' : '已跳过'),
    unit: c.name || '',
    meta: `${c.confirmDate || ''} ${c.time || ''}`,
    status: '',
    statusType: c.status === 'taken' ? 'done' : 'skipped',
    route: 'medList',
    hasData: true
  }))

  // 指标/范围选项
  const metricOptions = [
    { key: 'bpBg', label: '血压血糖' },
    { key: 'medication', label: '用药' }
  ]
  const rangeOptions = [
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: '90d', label: '90天' }
  ]

  return {
    activeMetric: 'medication',
    activeRange: range,
    period: isWeekly ? '本周' : `近${days}天`,
    subtitle: plans.length > 0 ? `服药率 ${totalRate}%` : '暂无用药计划',
    summary,
    focusItems,
    summaryMetrics,
    emptyHint,
    metricOptions,
    rangeOptions,
    summaries: { medication: currentSummary },
    currentSummary,
    chartSeries: {},
    records,
    // bpBg 双图表清空
    bpChart: { hasData: false, systolicBars: [], diastolicBars: [], labels: [], chartA11yLabel: '' },
    bgChart: { hasData: false, chartBars: [], labels: [], chartA11yLabel: '' },
    // 单指标图表（含 medChart 参考线信息）
    chartBars: chartData.chartBars || [],
    chartA11yLabel: chartData.chartA11yLabel || '',
    medChart: chartData.medChart || null
  }
}

/**
 * @deprecated 请使用 getTrendData 替代。保留此函数签名以兼容旧引用。
 * @param {string} [metric='bpBg'] 指标键名
 * @param {string} [range='7d'] 时间范围
 * @returns {Promise<Object>} 包含摘要、关注项、图表等数据
 */
async function getReportData(metric = 'bpBg', range = '7d') {
  const data = await getTrendData(metric, range)
  return {
    period: data.period,
    subtitle: data.subtitle,
    summary: data.summary,
    focusItems: data.focusItems,
    summaryMetrics: data.summaryMetrics,
    chartBars: data.chartBars,
    chartA11yLabel: data.chartA11yLabel,
    emptyHint: data.emptyHint
  }
}

module.exports = {
  buildMedicationSummary,
  buildReportChartFromRecords,
  buildReportFocusItems,
  buildReportSummary,
  filterWeekRecords,
  filterRecordsByDays,
  getReportData,
  getTrendData,
  isAbnormalRecord,
  buildAbnormalReason,
  parseBpValues,
  parseBgValue
}
