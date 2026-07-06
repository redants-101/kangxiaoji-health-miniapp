const {
  parseBpValues,
  parseBgValue,
  filterWeekRecords,
  filterRecordsByDays,
  buildReportSummary,
  isAbnormalRecord,
  buildAbnormalReason,
  buildReportFocusItems,
  buildReportChartFromRecords,
  getReportData,
  getTrendData
} = require('../../services/report')

// ─── parseBpValues ──────────────────────────────────────────

describe('services/report', () => {
  describe('parseBpValues', () => {
    it('解析标准血压值 "128/78"', () => {
      const result = parseBpValues({ value: '128/78' })
      expect(result.systolic).toBe(128)
      expect(result.diastolic).toBe(78)
    })

    it('解析三位数/两位数 "180/110"', () => {
      const result = parseBpValues({ value: '180/110' })
      expect(result.systolic).toBe(180)
      expect(result.diastolic).toBe(110)
    })

    it('value 为空字符串时返回 0/0', () => {
      const result = parseBpValues({ value: '' })
      expect(result.systolic).toBe(0)
      expect(result.diastolic).toBe(0)
    })

    it('value 为 undefined 时返回 0/0', () => {
      const result = parseBpValues({})
      expect(result.systolic).toBe(0)
      expect(result.diastolic).toBe(0)
    })

    it('非数字部分被过滤，返回 0', () => {
      const result = parseBpValues({ value: 'abc/def' })
      expect(result.systolic).toBe(0)
      expect(result.diastolic).toBe(0)
    })
  })

  // ─── parseBgValue ──────────────────────────────────────────

  describe('parseBgValue', () => {
    it('解析标准血糖值 "6.1"', () => {
      expect(parseBgValue({ value: '6.1' })).toBeCloseTo(6.1)
    })

    it('解析整数血糖 "7"', () => {
      expect(parseBgValue({ value: '7' })).toBe(7)
    })

    it('value 为空时返回 0', () => {
      expect(parseBgValue({ value: '' })).toBe(0)
    })

    it('value 为非数字时返回 0', () => {
      expect(parseBgValue({ value: 'abc' })).toBe(0)
    })
  })

  // ─── filterWeekRecords ──────────────────────────────────────

  describe('filterWeekRecords', () => {
    it('筛选本周内的记录', () => {
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const records = [
        { id: '1', createdAt: todayStr },
        { id: '2', createdAt: '2020-01-01' }
      ]
      const result = filterWeekRecords(records)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('1')
    })

    it('空数组返回空', () => {
      expect(filterWeekRecords([])).toHaveLength(0)
    })
  })

  // ─── filterRecordsByDays ──────────────────────────────────────

  describe('filterRecordsByDays', () => {
    it('7天时调用 filterWeekRecords', () => {
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const records = [{ id: '1', createdAt: todayStr }]
      const result = filterRecordsByDays(records, 7)
      expect(result).toHaveLength(1)
    })

    it('30天时筛选近30天记录', () => {
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const records = [
        { id: '1', createdAt: todayStr },
        { id: '2', createdAt: tenDaysAgo },
        { id: '3', createdAt: fortyDaysAgo }
      ]
      const result = filterRecordsByDays(records, 30)
      expect(result).toHaveLength(2)
    })

    it('90天时筛选近90天记录', () => {
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const fiftyDaysAgo = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const records = [
        { id: '1', createdAt: todayStr },
        { id: '2', createdAt: fiftyDaysAgo }
      ]
      const result = filterRecordsByDays(records, 90)
      expect(result).toHaveLength(2)
    })
  })

  // ─── buildReportSummary ──────────────────────────────────────

  describe('buildReportSummary', () => {
    it('血压记录生成血压摘要', () => {
      const bpRecords = [
        { value: '120/80', type: 'bp' },
        { value: '130/85', type: 'bp' }
      ]
      const summary = buildReportSummary(bpRecords, [])
      expect(summary).toHaveLength(1)
      expect(summary[0].label).toBe('血压')
      expect(summary[0].items).toHaveLength(4)
      expect(summary[0].items[0].label).toBe('平均收缩压（高压）')
      expect(summary[0].items[0].value).toBe(125)
      expect(summary[0].items[1].label).toBe('平均舒张压（低压）')
      expect(summary[0].items[1].value).toBe(83)
      expect(summary[0].items[3].value).toBe('2次')
    })

    it('血糖记录生成血糖摘要', () => {
      const bgRecords = [
        { value: '5.8', type: 'bg' },
        { value: '6.4', type: 'bg' }
      ]
      const summary = buildReportSummary([], bgRecords)
      expect(summary).toHaveLength(1)
      expect(summary[0].label).toBe('血糖')
      expect(summary[0].items[0].value).toBe('6.1')
    })

    it('血压+血糖都存在时生成两组摘要', () => {
      const bpRecords = [{ value: '128/78', type: 'bp' }]
      const bgRecords = [{ value: '6.1', type: 'bg' }]
      const summary = buildReportSummary(bpRecords, bgRecords)
      expect(summary).toHaveLength(2)
    })

    it('都为空时返回空数组', () => {
      expect(buildReportSummary([], [])).toEqual([])
    })
  })

  // ─── isAbnormalRecord ──────────────────────────────────────

  describe('isAbnormalRecord', () => {
    it('statusType=warn 时为异常', () => {
      expect(isAbnormalRecord({ statusType: 'warn', type: 'bp', value: '120/80' })).toBe(true)
    })

    it('status=建议复测 时为异常', () => {
      expect(isAbnormalRecord({ status: '建议复测', type: 'bp', value: '120/80' })).toBe(true)
    })

    it('收缩压 >= 140 为异常（高血压）', () => {
      expect(isAbnormalRecord({ type: 'bp', value: '145/85' })).toBe(true)
    })

    it('舒张压 >= 90 为异常（高血压）', () => {
      expect(isAbnormalRecord({ type: 'bp', value: '130/92' })).toBe(true)
    })

    it('收缩压 < 90 为异常（低血压）', () => {
      expect(isAbnormalRecord({ type: 'bp', value: '85/55' })).toBe(true)
    })

    it('舒张压 < 60 为异常（低血压）', () => {
      expect(isAbnormalRecord({ type: 'bp', value: '115/55' })).toBe(true)
    })

    it('正常血压不为异常', () => {
      expect(isAbnormalRecord({ type: 'bp', value: '120/80' })).toBe(false)
    })

    it('收缩压=0 时不判低血压（避免误判空值）', () => {
      expect(isAbnormalRecord({ type: 'bp', value: '0/0' })).toBe(false)
    })

    it('血糖 >= 7.0 为异常（高血糖）', () => {
      expect(isAbnormalRecord({ type: 'bg', value: '7.5' })).toBe(true)
    })

    it('血糖 <= 3.9 为异常（低血糖）', () => {
      expect(isAbnormalRecord({ type: 'bg', value: '3.5' })).toBe(true)
    })

    it('血糖=0 时不判低血糖', () => {
      expect(isAbnormalRecord({ type: 'bg', value: '0' })).toBe(false)
    })

    it('正常血糖不为异常', () => {
      expect(isAbnormalRecord({ type: 'bg', value: '5.8' })).toBe(false)
    })
  })

  // ─── buildAbnormalReason ──────────────────────────────────────

  describe('buildAbnormalReason', () => {
    it('有 tip 时优先返回 tip', () => {
      expect(buildAbnormalReason({ tip: '自定义提示', type: 'bp', value: '145/90' })).toBe('自定义提示')
    })

    it('收缩压 >= 180 返回高危提示', () => {
      expect(buildAbnormalReason({ type: 'bp', value: '185/100' })).toContain('高危')
    })

    it('收缩压 >= 140 返回偏高提示', () => {
      expect(buildAbnormalReason({ type: 'bp', value: '145/90' })).toContain('偏高')
    })

    it('收缩压 < 90 返回偏低提示', () => {
      expect(buildAbnormalReason({ type: 'bp', value: '85/55' })).toContain('偏低')
    })

    it('血糖 >= 11.1 返回显著偏高提示', () => {
      expect(buildAbnormalReason({ type: 'bg', value: '12.0' })).toContain('显著偏高')
    })

    it('血糖 >= 7.0 返回偏高提示', () => {
      expect(buildAbnormalReason({ type: 'bg', value: '8.0' })).toContain('偏高')
    })

    it('血糖 <= 3.9 返回偏低提示', () => {
      expect(buildAbnormalReason({ type: 'bg', value: '3.2' })).toContain('偏低')
    })

    it('无法判断时返回通用异常提示', () => {
      expect(buildAbnormalReason({ type: 'unknown', value: '100' })).toContain('异常')
    })
  })

  // ─── buildReportFocusItems ──────────────────────────────────────

  describe('buildReportFocusItems', () => {
    it('只保留异常记录', () => {
      const records = [
        { id: '1', type: 'bp', value: '120/80' },
        { id: '2', type: 'bp', value: '145/92' }
      ]
      const items = buildReportFocusItems(records)
      expect(items).toHaveLength(1)
      expect(items[0].id).toBe('2')
    })

    it('异常记录的 type 显示中文', () => {
      const records = [{ id: '1', type: 'bp', value: '145/92' }]
      const items = buildReportFocusItems(records)
      expect(items[0].type).toBe('血压')
    })

    it('血糖异常记录 type 显示"血糖"', () => {
      const records = [{ id: '1', type: 'bg', value: '8.0' }]
      const items = buildReportFocusItems(records)
      expect(items[0].type).toBe('血糖')
    })

    it('全部正常时返回空数组', () => {
      const records = [{ id: '1', type: 'bp', value: '120/80' }]
      expect(buildReportFocusItems(records)).toEqual([])
    })
  })

  // ─── buildReportChartFromRecords ──────────────────────────────

  describe('buildReportChartFromRecords', () => {
    it('血压+血糖记录生成混合图表', () => {
      const bpRecords = [
        { type: 'bp', value: '128/78', createdAt: '2026-06-10T08:00:00.000Z' }
      ]
      const bgRecords = [
        { type: 'bg', value: '6.1', createdAt: '2026-06-11T08:00:00.000Z' }
      ]
      const result = buildReportChartFromRecords(bpRecords, bgRecords)
      expect(result.chartBars.length).toBeGreaterThan(0)
      expect(result.chartA11yLabel).toBeDefined()
    })

    it('无记录时返回空图表', () => {
      const result = buildReportChartFromRecords([], [])
      expect(result.chartBars).toEqual([])
      expect(result.chartA11yLabel).toContain('暂无')
    })

    it('无记录时自定义 periodLabel', () => {
      const result = buildReportChartFromRecords([], [], '近30天')
      expect(result.chartA11yLabel).toContain('近30天')
      expect(result.chartA11yLabel).toContain('暂无')
    })

    it('有记录时自定义 periodLabel', () => {
      const bpRecords = [
        { type: 'bp', value: '128/78', createdAt: '2026-06-10T02:00:00.000Z' }
      ]
      const result = buildReportChartFromRecords(bpRecords, [], '近90天')
      expect(result.chartA11yLabel).toContain('近90天')
      expect(result.chartA11yLabel).toContain('趋势')
    })

    it('同日同类型取最新记录', () => {
      // 同一天 2026-06-10，同类型 bp，应取 createdAt 更大的那条
      // 使用凌晨时段确保任何时区下都在同一天
      const bpRecords = [
        { type: 'bp', value: '120/80', createdAt: '2026-06-10T02:00:00.000Z' },
        { type: 'bp', value: '135/88', createdAt: '2026-06-10T04:00:00.000Z' }
      ]
      const result = buildReportChartFromRecords(bpRecords, [])
      expect(result.chartBars).toHaveLength(1)
      // 135 是较新的记录
      expect(result.chartBars[0].value).toBe(135)
    })
  })

  // ─── getTrendData 集成测试（需 mock wx.cloud） ────────────────

  describe('getTrendData', () => {
    let originalDataSource

    beforeAll(() => {
      // 切换到 local 数据源，避免 wx.cloud 依赖
      const apiConfig = require('../../utils/api-config')
      originalDataSource = apiConfig.dataSource
      apiConfig.dataSource = 'local'
    })

    afterAll(() => {
      const apiConfig = require('../../utils/api-config')
      apiConfig.dataSource = originalDataSource
    })

    it('7天档位返回 summary/focusItems/summaryMetrics', async () => {
      const data = await getTrendData('bpBg', '7d')
      expect(data.activeMetric).toBe('bpBg')
      expect(data.activeRange).toBe('7d')
      expect(data.period).toBe('本周')
      expect(data.metricOptions).toHaveLength(2)
      expect(data.rangeOptions).toHaveLength(3)
      expect(data.summaryMetrics).toBeDefined()
      expect(Array.isArray(data.summary)).toBe(true)
      expect(Array.isArray(data.focusItems)).toBe(true)
    })

    it('30天档位返回 summary/focusItems/summaryMetrics', async () => {
      const data = await getTrendData('bpBg', '30d')
      expect(data.activeRange).toBe('30d')
      expect(data.period).toContain('近30天')
      expect(Array.isArray(data.summary)).toBe(true)
      expect(Array.isArray(data.focusItems)).toBe(true)
      expect(data.summaryMetrics).toBeDefined()
      expect(data.focusItems.length).toBeLessThanOrEqual(4)
    })

    it('90天档位返回 summary/focusItems/summaryMetrics', async () => {
      const data = await getTrendData('bpBg', '90d')
      expect(data.activeRange).toBe('90d')
      expect(Array.isArray(data.summary)).toBe(true)
      expect(Array.isArray(data.focusItems)).toBe(true)
      expect(data.summaryMetrics).toBeDefined()
      expect(data.focusItems.length).toBeLessThanOrEqual(4)
    })

    it('返回 metricOptions 包含 bpBg 和 medication', async () => {
      const data = await getTrendData()
      const keys = data.metricOptions.map(o => o.key)
      expect(keys).toContain('bpBg')
      expect(keys).toContain('medication')
    })

    it('返回 rangeOptions 包含三档时间', async () => {
      const data = await getTrendData()
      const keys = data.rangeOptions.map(o => o.key)
      expect(keys).toContain('7d')
      expect(keys).toContain('30d')
      expect(keys).toContain('90d')
    })

    it('默认参数为 bpBg + 7d', async () => {
      const data = await getTrendData()
      expect(data.activeMetric).toBe('bpBg')
      expect(data.activeRange).toBe('7d')
    })

    it('chartBars 始终为数组', async () => {
      const data = await getTrendData()
      expect(Array.isArray(data.chartBars)).toBe(true)
    })

    it('records 最多 20 条', async () => {
      const data = await getTrendData()
      expect(data.records.length).toBeLessThanOrEqual(20)
    })

    it('指标切换到 bloodGlucose 时正常返回', async () => {
      const data = await getTrendData('bloodGlucose', '7d')
      expect(data.activeMetric).toBe('bloodGlucose')
    })

    it('指标切换到 bloodPressure 时正常返回', async () => {
      const data = await getTrendData('bloodPressure', '7d')
      expect(data.activeMetric).toBe('bloodPressure')
    })

    it('指标切换到 medication 时正常返回', async () => {
      const data = await getTrendData('medication', '7d')
      expect(data.activeMetric).toBe('medication')
    })

    it('bpBg 复合指标返回双图表数据', async () => {
      const data = await getTrendData('bpBg', '7d')
      expect(data.activeMetric).toBe('bpBg')
      expect(data.bpChart).toBeDefined()
      expect(data.bgChart).toBeDefined()
      expect(typeof data.bpChart.hasData).toBe('boolean')
      expect(typeof data.bgChart.hasData).toBe('boolean')
    })
  })

  // ─── getReportData 向后兼容 ──────────────────────────────────

  describe('getReportData (deprecated)', () => {
    let originalDataSource

    beforeAll(() => {
      const apiConfig = require('../../utils/api-config')
      originalDataSource = apiConfig.dataSource
      apiConfig.dataSource = 'local'
    })

    afterAll(() => {
      const apiConfig = require('../../utils/api-config')
      apiConfig.dataSource = originalDataSource
    })

    it('返回与 getTrendData 一致的核心字段', async () => {
      const data = await getReportData()
      expect(data).toHaveProperty('period')
      expect(data).toHaveProperty('subtitle')
      expect(data).toHaveProperty('summary')
      expect(data).toHaveProperty('focusItems')
      expect(data).toHaveProperty('summaryMetrics')
      expect(data).toHaveProperty('chartBars')
      expect(data).toHaveProperty('chartA11yLabel')
      expect(data).toHaveProperty('emptyHint')
    })

    it('默认为本周数据', async () => {
      const data = await getReportData()
      expect(data.period).toBe('本周')
    })

    it('支持传入 metric 和 range 参数', async () => {
      const data = await getReportData('bloodGlucose', '30d')
      expect(data.period).toContain('近30天')
    })
  })
})
