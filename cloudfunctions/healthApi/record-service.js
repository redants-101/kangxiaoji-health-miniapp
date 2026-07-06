const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 将 createdAt（可能是 ISO 时间戳或 Date 对象）转换为北京时间日期字符串 YYYY-MM-DD。
 * 云函数运行在 UTC 时区，必须加偏移后取 UTC 方法，否则北京时间 0:00-8:00 会取到前一天。
 */
function toChinaDateStr(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    // 纯日期字符串（无时间部分）：直接返回
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    // ISO 时间戳（含 T）：解析后转北京时间
    if (/T/.test(value)) {
      const d = new Date(value)
      if (Number.isFinite(d.getTime())) {
        const chinaTime = new Date(d.getTime() + CHINA_TIME_OFFSET_MS)
        const y = chinaTime.getUTCFullYear()
        const m = String(chinaTime.getUTCMonth() + 1).padStart(2, '0')
        const day = String(chinaTime.getUTCDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
      }
    }
    // 其他字符串格式：回退 slice
    return value.slice(0, 10)
  }
  // Date 对象：转北京时间
  if (value instanceof Date || Number.isFinite(new Date(value).getTime())) {
    const d = value instanceof Date ? value : new Date(value)
    const chinaTime = new Date(d.getTime() + CHINA_TIME_OFFSET_MS)
    const y = chinaTime.getUTCFullYear()
    const m = String(chinaTime.getUTCMonth() + 1).padStart(2, '0')
    const day = String(chinaTime.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return ''
}

function createRecordService({ db, _, collections, getRecordStatus, withPerfLog }) {
  function formatListRecord(record) {
    return {
      id: record._id,
      type: record.type,
      title: record.type === 'bp'
        ? `血压 ${record.systolic}/${record.diastolic} mmHg`
        : `血糖 ${record.glucose} mmol/L`,
      value: record.type === 'bp'
        ? `${record.systolic}/${record.diastolic}`
        : record.glucose,
      unit: record.type === 'bp' ? 'mmHg' : 'mmol/L',
      time: record.measuredAt,
      tag: record.tag,
      status: getRecordStatus(record.level),
      statusType: record.level,
      createdAt: record.createdAt || ''
    }
  }

  function formatDetailRecord(record) {
    const createdAtDate = toChinaDateStr(record.createdAt)
    return {
      eyebrow: '记录详情',
      recordId: record._id,
      record: {
        type: record.type === 'bp' ? '血压' : '血糖',
        value: record.type === 'bp'
          ? `${record.systolic}/${record.diastolic}`
          : record.glucose,
        unit: record.type === 'bp' ? 'mmHg' : 'mmol/L',
        time: record.measuredAt,
        tag: record.tag,
        status: getRecordStatus(record.level),
        statusType: record.level,
        tip: record.tip,
        tipLevel: record.level,
        createdAt: createdAtDate
      },
      details: record.type === 'bp'
        ? [
          { label: '收缩压（高压）', value: `${record.systolic} mmHg` },
          { label: '舒张压（低压）', value: `${record.diastolic} mmHg` },
          { label: '心率', value: `${record.pulse || '-'} 次/分` },
          { label: '备注', value: record.note || '未填写' }
        ]
        : [
          { label: '血糖值', value: `${record.glucose} mmol/L` },
          { label: '测量场景', value: record.tag },
          { label: '测量时间', value: record.measuredAt },
          { label: '备注', value: record.note || '未填写' }
        ]
    }
  }

  function getRecordBpData() {
    return {
      eyebrow: '记录血压',
      quickTags: ['空腹', '早餐后', '午餐前', '午餐后', '晚餐前', '晚餐后', '睡前'],
      levelConfig: {
        normal: { maxSystolic: 120, maxDiastolic: 80, label: '正常' },
        elevated: { maxSystolic: 139, maxDiastolic: 89, label: '偏高' },
        high: { minSystolic: 140, minDiastolic: 90, label: '偏高' }
      },
      tips: {
        normal: '本次记录在常见范围内，建议继续保持记录',
        warn: '本次记录偏高，建议安静休息后复测；如持续异常，请咨询医生'
      }
    }
  }

  function getRecordBgData() {
    return {
      eyebrow: '记录血糖',
      quickTags: ['空腹', '早餐后', '午餐前', '午餐后', '晚餐前', '晚餐后', '睡前'],
      levelConfig: {
        normal: { maxGlucose: 6.1, label: '正常' },
        warn: { maxGlucose: 7.8, label: '偏高' }
      },
      tips: {
        normal: '血糖控制良好',
        warn: '血糖偏高，请注意饮食控制'
      }
    }
  }

  async function getRecordDetailData(openId, payload = {}) {
    const recordId = payload && payload.recordId
    const query = db.collection(collections.records)
      .where(recordId ? { _openid: openId, _id: recordId } : { _openid: openId })
      .orderBy('createdAt', 'desc')
      .limit(1)
    const { data: records } = await withPerfLog({
      routeType: 'key',
      route: 'recordDetail',
      step: 'db.records.detail'
    }, () => query.get())

    if (records.length === 0) {
      return {
        eyebrow: '记录详情',
        recordId: recordId || '',
        record: null,
        details: []
      }
    }

    return formatDetailRecord(records[0])
  }

  async function getRecordListData(openId, payload = {}) {
    const type = payload.type === 'bp' || payload.type === 'bg' ? payload.type : ''
    const limit = Math.min(Math.max(Number(payload.limit) || 20, 1), 50)
    const offset = Math.max(Number(payload.offset) || 0, 0)
    const condition = type ? { _openid: openId, type } : { _openid: openId }

    const { data = [] } = await withPerfLog({
      routeType: 'key',
      route: 'recordList',
      step: 'db.records.list'
    }, () => db.collection(collections.records)
      .where(condition)
      .orderBy('createdAt', 'desc')
      .skip(offset)
      .limit(limit + 1)
      .get())

    const records = data.slice(0, limit)

    return {
      eyebrow: '健康记录',
      records: records.map(formatListRecord),
      total: offset + records.length + (data.length > limit ? 1 : 0),
      hasMore: data.length > limit
    }
  }

  async function getTrendData(openId, payload = {}) {
    const type = payload.type === 'bg' ? 'bg' : 'bp'
    const days = Math.min(Math.max(Number(payload.days) || 30, 7), 180)
    // 按北京时间计算起始日期，确保 UTC 0:00-8:00 时查询范围与用户预期一致
    const DAY_MS = 24 * 60 * 60 * 1000
    const startDate = new Date(Date.now() - days * DAY_MS)

    const { data: records = [] } = await withPerfLog({
      routeType: 'key',
      route: 'trend',
      step: 'db.records.trend'
    }, () => db.collection(collections.records)
      .where({
        _openid: openId,
        type,
        createdAt: _.gte(startDate)
      })
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get())

    const chartData = records.map(record => ({
      date: record.measuredAt?.substr(5, 5) || '',
      value: type === 'bp' ? record.systolic : record.glucose,
      value2: type === 'bp' ? record.diastolic : null
    }))
    const values = records.map(record => type === 'bp' ? record.systolic : record.glucose)
    const avg = values.length > 0 ? (values.reduce((total, value) => total + value, 0) / values.length).toFixed(1) : 0

    return {
      eyebrow: '健康趋势',
      type,
      title: type === 'bp' ? '血压趋势' : '血糖趋势',
      unit: type === 'bp' ? 'mmHg' : 'mmol/L',
      chartData,
      stats: {
        avg,
        max: values.length > 0 ? Math.max(...values) : 0,
        min: values.length > 0 ? Math.min(...values) : 0,
        count: records.length
      },
      days
    }
  }

  return {
    getRecordBgData,
    getRecordBpData,
    getRecordDetailData,
    getRecordListData,
    getTrendData
  }
}

module.exports = {
  createRecordService
}
