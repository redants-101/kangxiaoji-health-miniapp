/**
 * 健康趋势图表引擎。
 *
 * 设计要点：
 * 1. 血压血糖(bPBG)拆分为双图表：血压图（收缩压/舒张压双柱）+ 血糖图
 * 2. X轴刻度：7天按日 / 30天按3-4天 / 90天按周聚合
 * 3. 异常柱状色：超过正常范围自动变色（血压偏高橙/偏低蓝，血糖同理）
 * 4. 参考线：血压正常范围 90-140 mmHg，血糖 3.9-7.0 mmol/L
 * 5. 性能：长周期数据自动采样聚合，柱状条数上限 14
 */

// ─── 常量 ──────────────────────────────────────────────────

/** 血压正常范围 (mmHg) */
const BP_NORMAL = { systolicLow: 90, systolicHigh: 140, diastolicLow: 60, diastolicHigh: 90 }

/** 血糖正常范围 (mmol/L) */
const BG_NORMAL = { low: 3.9, high: 7.0 }

/** 服药率参考线 (%)：80% 达标线，50% 警示线 */
const MED_NORMAL = { complianceLow: 50, complianceHigh: 80 }

/** 柱状条数上限（避免长周期数据过多） */
const MAX_BARS = 14

/** 时间聚合配置：range → { bucketMs, labelFormat } */
const TIME_BUCKET = {
  '7d':  { bucketMs: 1 * 24 * 3600 * 1000, labelFmt: 'daily' },
  '30d': { bucketMs: 4 * 24 * 3600 * 1000, labelFmt: '4day'  },
  '90d': { bucketMs: 7 * 24 * 3600 * 1000, labelFmt: 'weekly' }
}

// ─── Fallback 数据（本地/离线模式） ────────────────────────

const TREND_SERIES_MAP = {
  bloodPressure: {
    '7d': { labels: ['4/11', '4/13', '4/15', '4/17'], values: [128, 135, 142, 132] },
    '30d': { labels: ['3/18', '3/28', '4/07', '4/17'], values: [130, 136, 133, 132] },
    '90d': { labels: ['1月', '2月', '3月', '4月'], values: [138, 136, 134, 132] }
  },
  bloodGlucose: {
    '7d': { labels: ['4/11', '4/13', '4/15', '4/17'], values: [5.8, 6.2, 6.5, 6.1] },
    '30d': { labels: ['3/18', '3/28', '4/07', '4/17'], values: [6.0, 6.3, 6.2, 6.1] },
    '90d': { labels: ['1月', '2月', '3月', '4月'], values: [6.5, 6.3, 6.2, 6.1] }
  },
  medication: {
    '7d': { labels: ['4/11', '4/13', '4/15', '4/17'], values: [72, 81, 85, 90] },
    '30d': { labels: ['3/18', '3/28', '4/07', '4/17'], values: [68, 76, 83, 85] },
    '90d': { labels: ['1月', '2月', '3月', '4月'], values: [62, 70, 78, 85] }
  }
}

const REPORT_SERIES_FALLBACK = {
  labels: ['周一', '周三', '周五', '周日'],
  values: [122, 134, 129, 138]
}

// ─── 基础工具 ──────────────────────────────────────────────

function normalizeSeries(input, fallback) {
  if (!input) return fallback
  if (Array.isArray(input)) {
    return { labels: fallback.labels, values: input }
  }
  return {
    labels: Array.isArray(input.labels) && input.labels.length ? input.labels : fallback.labels,
    values: Array.isArray(input.values) && input.values.length ? input.values : fallback.values
  }
}

/**
 * 柱状条高度计算（百分比），含异常状态判定。
 * @param {number[]} values  数值数组
 * @param {string}   type    'bp-systolic' / 'bp-diastolic' / 'bg' / 'default'
 * @param {number}  [minFloor] 强制 Y 轴下限（如血压60、血糖3），避免正常值挤在底部
 * @returns {Object[]} bars 数组，每项含 id/label/value/valueText/height/status
 *   以及附在数组上的 yAxis 属性: { floor, ceil, minFloor }
 */
function toChartBars(values, labels, type = 'default', minFloor) {
  const safeValues = values.map(v => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  })

  // 计算数据范围，支持 minFloor 提升底线，ceil 自动包含参考线上限
  const dataMin = Math.min(...safeValues)
  const dataMax = Math.max(...safeValues, 1)
  const floor = typeof minFloor === 'number' ? Math.min(minFloor, dataMin) : dataMin
  let ceil = dataMax
  if (type === 'bp-systolic') ceil = Math.max(ceil, BP_NORMAL.systolicHigh + 1)
  else if (type === 'bp-diastolic') ceil = Math.max(ceil, BP_NORMAL.diastolicHigh + 1)
  else if (type === 'bg') ceil = Math.max(ceil, BG_NORMAL.high + 1)
  else if (type === 'medication') ceil = Math.max(ceil, 100)
  const rawRange = ceil - floor
  // 单值或所有值相同时，Y 轴范围退化 → 用默认高度
  const range = rawRange || 1
  const isSingleValue = rawRange === 0

  const bars = safeValues.map((value, index) => {
    const height = isSingleValue
      ? 72
      : Math.round(30 + ((value - floor) / range) * 58)
    const label = labels[index] || `第${index + 1}项`
    const status = getBarStatus(value, type)
    return {
      id: `bar-${index + 1}`,
      label,
      value,
      valueText: Number.isInteger(value) ? `${value}` : `${value.toFixed(1)}`,
      height: Math.max(12, Math.min(88, height)),
      status // 'normal' | 'high' | 'low'
    }
  })

  // 将 Y 轴范围信息挂到数组上，供参考线计算使用
  bars.yAxis = { floor, ceil, minFloor: typeof minFloor === 'number' ? minFloor : null }
  return bars
}

/**
 * 根据 Y 轴范围计算参考线在图表中的 top 百分比位置。
 *
 * 图表布局：chart-canvas 高度 = 柱状区域（约 BAR_ZONE_RATIO）+ 标签区域（约 1-BAR_ZONE_RATIO）
 * 参考线只映射到柱状区域：value=ceil → top=0%, value=floor → top=BAR_ZONE_RATIO*100%
 *
 * @param {number} refValue  参考值（如 140, 90, 7.0）
 * @param {{ floor: number, ceil: number }} yAxis Y 轴范围
 * @returns {string} 如 '25.7%' 或空字符串（值超出范围时不显示）
 */
function calcRefLineTop(refValue, yAxis) {
  if (!yAxis || refValue == null) return ''
  const { floor, ceil } = yAxis
  const range = ceil - floor
  if (range <= 0) return ''
  if (refValue > ceil || refValue < floor) return ''
  // 柱状区域占 chart-canvas 的比例（底部是标签区，不参与 Y 轴映射）
  // bar height 范围 12%~88%，对应柱状区域约 76%+padding ≈ 80%
  const BAR_ZONE_RATIO = 0.80
  const pct = ((ceil - refValue) / range) * BAR_ZONE_RATIO * 100
  return `${Math.round(pct * 10) / 10}%`
}

/** 判定柱状条异常状态 */
function getBarStatus(value, type) {
  if (type === 'bp-systolic') {
    if (value >= BP_NORMAL.systolicHigh) return 'high'
    if (value > 0 && value < BP_NORMAL.systolicLow) return 'low'
  }
  if (type === 'bp-diastolic') {
    if (value >= BP_NORMAL.diastolicHigh) return 'high'
    if (value > 0 && value < BP_NORMAL.diastolicLow) return 'low'
  }
  if (type === 'bg') {
    if (value >= BG_NORMAL.high) return 'high'
    if (value > 0 && value < BG_NORMAL.low) return 'low'
  }
  if (type === 'medication') {
    // 服药率：低于 50% 为偏低(low)，90%+ 为优秀达标(high)
    if (value > 0 && value < MED_NORMAL.complianceLow) return 'low'
    if (value >= 90) return 'high'
  }
  return 'normal'
}

function toAriaLabel(title, bars, suffix = '', type = '') {
  const parts = bars.map(item => {
    let statusText = ''
    if (item.status !== 'normal') {
      if (type === 'medication' && item.status === 'high') {
        statusText = '(优秀达标)'
      } else if (type === 'medication' && item.status === 'low') {
        statusText = '(偏低)'
      } else {
        statusText = item.status === 'high' ? '(偏高)' : '(偏低)'
      }
    }
    return `${item.label}${item.valueText}${statusText}`
  })
  return [title, parts.join('；'), suffix].filter(Boolean).join('，')
}

// ─── 单指标趋势图表 ────────────────────────────────────────

function buildTrendChart(metricKey, rangeKey, currentSummary = {}, chartSeriesMap) {
  const fallbackMetric = TREND_SERIES_MAP[metricKey] || TREND_SERIES_MAP.bloodPressure
  const fallbackSeries = fallbackMetric[rangeKey] || fallbackMetric['7d']
  const sourceMetric = chartSeriesMap && chartSeriesMap[metricKey]
  const normalized = normalizeSeries(sourceMetric && sourceMetric[rangeKey], fallbackSeries)
  const barType = metricKey === 'bloodGlucose' ? 'bg' : (metricKey === 'medication' ? 'medication' : 'bp-systolic')
  const minFloor = metricKey === 'bloodGlucose' ? 3 : (metricKey === 'medication' ? 0 : 60)
  const chartBars = toChartBars(normalized.values, normalized.labels, barType, minFloor)

  return {
    chartBars,
    chartA11yLabel: toAriaLabel(currentSummary.label || '趋势图', chartBars, currentSummary.badge || '', barType === 'medication' ? 'medication' : '')
  }
}

// ─── 血压血糖双图表（核心新增） ─────────────────────────────

/**
 * 从记录列表构建血压血糖双图表数据。
 * 支持按 range 聚合：7天按日、30天按4天、90天按周。
 * 也支持直接消费云端 chartSeriesMap 聚合数据（无需本地二次聚合）。
 *
 * @param {Object[]} bpRecords 血压记录
 * @param {Object[]} bgRecords 血糖记录
 * @param {string}   range     '7d' | '30d' | '90d'
 * @param {string}   periodLabel '本周' | '近30天' | '近90天'
 * @param {Object}   [chartSeriesMap] 云端图表序列数据（如有则优先使用）
 * @returns {{ bpChart: Object, bgChart: Object }}
 */
function buildBpBgCharts(bpRecords, bgRecords, range = '7d', periodLabel = '本周', chartSeriesMap) {
  let bpLabels, systolicValues, diastolicValues
  let bgLabels, bgValues

  // 优先使用云端聚合数据
  const cloudBp = chartSeriesMap && chartSeriesMap.bloodPressure && chartSeriesMap.bloodPressure[range]
  const cloudBpDiastolic = chartSeriesMap && chartSeriesMap.bloodPressureDiastolic && chartSeriesMap.bloodPressureDiastolic[range]
  const cloudBg = chartSeriesMap && chartSeriesMap.bloodGlucose && chartSeriesMap.bloodGlucose[range]

  if (cloudBp) {
    const normalized = normalizeSeries(cloudBp, TREND_SERIES_MAP.bloodPressure[range] || TREND_SERIES_MAP.bloodPressure['7d'])
    bpLabels = normalized.labels
    systolicValues = normalized.values
    // 云端舒张压序列（如 bloodPressureDiastolic）
    if (cloudBpDiastolic) {
      const normalizedD = normalizeSeries(cloudBpDiastolic, { labels: bpLabels, values: bpLabels.map(() => 80) })
      diastolicValues = normalizedD.values
    } else {
      diastolicValues = [] // 无云端舒张压数据，从本地记录补充
    }
  } else {
    // 本地记录聚合
    const bucket = TIME_BUCKET[range] || TIME_BUCKET['7d']
    const bpBuckets = aggregateByBucket(bpRecords, bucket.bucketMs, bucket.labelFmt, 'bp').slice(0, MAX_BARS)
    bpLabels = bpBuckets.map(b => b.label)
    systolicValues = bpBuckets.map(b => b.systolicAvg || 0)
    diastolicValues = bpBuckets.map(b => b.diastolicAvg || 0)
  }

  if (cloudBg) {
    const normalized = normalizeSeries(cloudBg, TREND_SERIES_MAP.bloodGlucose[range] || TREND_SERIES_MAP.bloodGlucose['7d'])
    bgLabels = normalized.labels
    bgValues = normalized.values
  } else {
    const bucket = TIME_BUCKET[range] || TIME_BUCKET['7d']
    const bgBuckets = aggregateByBucket(bgRecords, bucket.bucketMs, bucket.labelFmt, 'bg').slice(0, MAX_BARS)
    bgLabels = bgBuckets.map(b => b.label)
    bgValues = bgBuckets.map(b => b.valueAvg || 0)
  }

  // 构建柱状条数据
  const systolicBars = toChartBars(systolicValues, bpLabels, 'bp-systolic', 60)

  // 舒张压补充：云端无舒张压数据时，从本地记录聚合补充
  if (diastolicValues.length === 0 && bpRecords.length > 0 && bpLabels.length > 0) {
    const bucket = TIME_BUCKET[range] || TIME_BUCKET['7d']
    const bpBuckets = aggregateByBucket(bpRecords, bucket.bucketMs, bucket.labelFmt, 'bp').slice(0, MAX_BARS)
    const localDiastolic = bpBuckets.map(b => b.diastolicAvg || 0)
    diastolicValues = localDiastolic
  }
  const diastolicBars = toChartBars(diastolicValues, bpLabels, 'bp-diastolic', 60)
  const bgBars = toChartBars(bgValues, bgLabels, 'bg', 3)

  // 动态计算参考线位置
  const sysYAxis = systolicBars.yAxis || { floor: 60, ceil: 180 }
  const bgYAxis = bgBars.yAxis || { floor: 3, ceil: 10 }

  return {
    bpChart: {
      labels: bpLabels,
      systolicBars,
      diastolicBars,
      chartA11yLabel: toAriaLabel(`${periodLabel}血压趋势`, systolicBars, ''),
      hasData: systolicBars.length > 0,
      // 参考线位置（百分比 top）
      refSystolicHighTop: calcRefLineTop(BP_NORMAL.systolicHigh, sysYAxis),
      refSystolicLowTop: calcRefLineTop(BP_NORMAL.systolicLow, sysYAxis),
      refDiastolicHighTop: calcRefLineTop(BP_NORMAL.diastolicHigh, sysYAxis),
      refDiastolicLowTop: calcRefLineTop(BP_NORMAL.diastolicLow, sysYAxis)
    },
    bgChart: {
      labels: bgLabels,
      chartBars: bgBars,
      chartA11yLabel: toAriaLabel(`${periodLabel}血糖趋势`, bgBars, ''),
      hasData: bgBars.length > 0,
      // 参考线位置（百分比 top）
      refHighTop: calcRefLineTop(BG_NORMAL.high, bgYAxis),
      refLowTop: calcRefLineTop(BG_NORMAL.low, bgYAxis)
    }
  }
}

/**
 * 按时间桶聚合记录。
 * 每个桶内取最新一条记录的值，血压取收缩压/舒张压均值，血糖取均值。
 */
function aggregateByBucket(records, bucketMs, labelFmt, type) {
  if (!records.length) return []

  // 按时间排序
  const sorted = [...records].sort((a, b) => {
    const ta = new Date(a.createdAt || a.measuredAt || 0).getTime()
    const tb = new Date(b.createdAt || b.measuredAt || 0).getTime()
    return ta - tb
  })

  // 分桶
  const earliest = new Date(sorted[0].createdAt || sorted[0].measuredAt || 0).getTime()
  const buckets = []

  sorted.forEach(r => {
    const ts = new Date(r.createdAt || r.measuredAt || 0).getTime()
    const bucketIdx = Math.floor((ts - earliest) / bucketMs)

    if (!buckets[bucketIdx]) {
      buckets[bucketIdx] = { records: [], ts }
    }
    buckets[bucketIdx].records.push(r)
    // 保留桶的最新时间戳用于标签
    buckets[bucketIdx].ts = Math.max(buckets[bucketIdx].ts, ts)
  })

  // 计算每个桶的聚合值
  return buckets.filter(Boolean).map(bucket => {
    const label = formatBucketLabel(bucket.ts, labelFmt)
    const recs = bucket.records

    if (type === 'bp') {
      const systolics = []
      const diastolics = []
      recs.forEach(r => {
        const parts = String(r.value || '').split('/')
        const s = parseInt(parts[0], 10)
        const d = parseInt(parts[1], 10)
        if (s > 0) systolics.push(s)
        if (d > 0) diastolics.push(d)
      })
      return {
        label,
        systolicAvg: systolics.length ? Math.round(systolics.reduce((a, b) => a + b, 0) / systolics.length) : 0,
        diastolicAvg: diastolics.length ? Math.round(diastolics.reduce((a, b) => a + b, 0) / diastolics.length) : 0
      }
    } else {
      const vals = recs.map(r => parseFloat(r.value)).filter(v => v > 0)
      return {
        label,
        valueAvg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : 0
      }
    }
  })
}

/** 格式化桶标签 */
function formatBucketLabel(timestamp, fmt) {
  const d = new Date(timestamp)
  const m = d.getMonth() + 1
  const day = d.getDate()
  if (fmt === 'daily') return `${m}/${day}`
  if (fmt === '4day') return `${m}/${day}`
  if (fmt === 'weekly') return `${m}周`
  return `${m}/${day}`
}

// ─── 兼容旧接口 ────────────────────────────────────────────

function buildReportChart(period, chartMeta, chartSeries) {
  const normalized = normalizeSeries(chartSeries, REPORT_SERIES_FALLBACK)
  const chartBars = toChartBars(normalized.values, normalized.labels)

  return {
    chartBars,
    chartA11yLabel: toAriaLabel(`${period} 周报趋势`, chartBars, chartMeta || '')
  }
}

function buildRecordDetailChart(record = {}, details = []) {
  const isBloodPressure = (record.type || '').includes('血压')
  const todayLabel = (record.time || '今天').split(' ')[0]
  let todayValue = 0

  if (isBloodPressure) {
    const systolicDetail = details.find((item) => item.label === '收缩压（高压）')
    todayValue = Number.parseFloat((systolicDetail && systolicDetail.value) || String(record.value).split('/')[0])
  } else {
    todayValue = Number.parseFloat(String(record.value).split(' ')[0])
  }

  const safeValue = Number.isFinite(todayValue) ? todayValue : (isBloodPressure ? 128 : 6.1)
  const previousValues = isBloodPressure
    ? [Math.max(safeValue - 8, 90), Math.max(safeValue - 3, 90)]
    : [Math.max(safeValue - 0.7, 3.5), Math.max(safeValue - 0.3, 3.5)]
  const labels = ['前天', '昨天', todayLabel]
  const values = [...previousValues, safeValue]
  const barType = isBloodPressure ? 'bp-systolic' : 'bg'
  const minFloor = isBloodPressure ? 60 : 3
  const chartBars = toChartBars(values, labels, barType, minFloor)
  const valueLabel = isBloodPressure ? '收缩压（高压）' : record.type || '记录值'

  return {
    chartBars,
    chartA11yLabel: toAriaLabel(`近 3 次${record.type || '记录'}回顾`, chartBars, `${valueLabel}变化`)
  }
}

module.exports = {
  BG_NORMAL,
  BP_NORMAL,
  MED_NORMAL,
  TIME_BUCKET,
  buildBpBgCharts,
  buildRecordDetailChart,
  buildReportChart,
  buildTrendChart,
  calcRefLineTop,
  formatBucketLabel,
  toChartBars,
  toAriaLabel
}
