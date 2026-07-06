const {
  buildTrendChart,
  buildReportChart,
  buildRecordDetailChart,
  buildBpBgCharts,
  calcRefLineTop,
  toChartBars,
  BP_NORMAL,
  BG_NORMAL
} = require('../../utils/chart-adapter')

describe('utils/chart-adapter', () => {
  describe('toChartBars', () => {
    it('将数值数组转为柱状图数据', () => {
      const bars = toChartBars([120, 135, 128, 142], ['周一', '周三', '周五', '周日'])
      expect(bars).toHaveLength(4)
      expect(bars[0].label).toBe('周一')
      expect(bars[0].value).toBe(120)
      expect(bars[0].valueText).toBe('120')
      expect(bars[0].height).toBeGreaterThanOrEqual(12)
      expect(bars[0].height).toBeLessThanOrEqual(88)
      expect(bars[0].status).toBe('normal')
    })

    it('处理小数值', () => {
      const bars = toChartBars([5.8, 6.2, 5.5], ['A', 'B', 'C'])
      expect(bars[0].valueText).toBe('5.8')
      expect(bars[1].valueText).toBe('6.2')
    })

    it('所有值相同时高度一致', () => {
      const bars = toChartBars([100, 100, 100], ['A', 'B', 'C'])
      expect(bars[0].height).toBe(bars[1].height)
      expect(bars[1].height).toBe(bars[2].height)
    })

    it('处理空值和 NaN', () => {
      const bars = toChartBars([100, NaN, 0], ['A', 'B', 'C'])
      expect(bars).toHaveLength(3)
      expect(bars[1].value).toBe(0)
      expect(bars[2].value).toBe(0)
    })

    it('单值数据', () => {
      const bars = toChartBars([128], ['今天'])
      expect(bars).toHaveLength(1)
      expect(bars[0].height).toBe(72)
    })

    it('血压收缩压偏高标记 status=high', () => {
      const bars = toChartBars([145, 120], ['A', 'B'], 'bp-systolic', 60)
      expect(bars[0].status).toBe('high')
      expect(bars[1].status).toBe('normal')
    })

    it('血压收缩压偏低标记 status=low', () => {
      const bars = toChartBars([85, 120], ['A', 'B'], 'bp-systolic', 60)
      expect(bars[0].status).toBe('low')
    })

    it('血糖偏高标记 status=high', () => {
      const bars = toChartBars([7.5, 5.8], ['A', 'B'], 'bg', 3)
      expect(bars[0].status).toBe('high')
      expect(bars[1].status).toBe('normal')
    })

    it('血糖偏低标记 status=low', () => {
      const bars = toChartBars([3.2, 5.8], ['A', 'B'], 'bg', 3)
      expect(bars[0].status).toBe('low')
    })

    it('返回 yAxis 信息供参考线计算', () => {
      const bars = toChartBars([120, 135, 128], ['A', 'B', 'C'], 'bp-systolic', 60)
      expect(bars.yAxis).toBeDefined()
      expect(bars.yAxis.floor).toBe(60)
      expect(bars.yAxis.ceil).toBeGreaterThanOrEqual(135)
      expect(bars.yAxis.minFloor).toBe(60)
    })

    it('无 minFloor 时 yAxis.minFloor 为 null', () => {
      const bars = toChartBars([100, 200], ['A', 'B'])
      expect(bars.yAxis.minFloor).toBeNull()
    })
  })

  describe('buildBpBgCharts', () => {
    const bpRecords = [
      { id: '1', type: 'bp', value: '128/78', createdAt: '2026-06-10T02:00:00.000Z' },
      { id: '2', type: 'bp', value: '145/92', createdAt: '2026-06-11T02:00:00.000Z' },
      { id: '3', type: 'bp', value: '118/72', createdAt: '2026-06-12T02:00:00.000Z' }
    ]
    const bgRecords = [
      { id: '4', type: 'bg', value: '6.1', createdAt: '2026-06-10T02:00:00.000Z' },
      { id: '5', type: 'bg', value: '7.5', createdAt: '2026-06-11T02:00:00.000Z' }
    ]

    it('7天模式：按日聚合，返回血压+血糖双图表', () => {
      const result = buildBpBgCharts(bpRecords, bgRecords, '7d', '本周')
      expect(result.bpChart).toBeDefined()
      expect(result.bgChart).toBeDefined()
      expect(result.bpChart.hasData).toBe(true)
      expect(result.bgChart.hasData).toBe(true)
      expect(result.bpChart.systolicBars.length).toBeGreaterThan(0)
      expect(result.bpChart.diastolicBars.length).toBeGreaterThan(0)
      expect(result.bgChart.chartBars.length).toBeGreaterThan(0)
    })

    it('30天模式：按4天聚合', () => {
      const result = buildBpBgCharts(bpRecords, bgRecords, '30d', '近30天')
      expect(result.bpChart.hasData).toBe(true)
      expect(result.bgChart.hasData).toBe(true)
    })

    it('90天模式：按周聚合', () => {
      const result = buildBpBgCharts(bpRecords, bgRecords, '90d', '近90天')
      expect(result.bpChart.hasData).toBe(true)
    })

    it('空记录返回 hasData=false', () => {
      const result = buildBpBgCharts([], [], '7d', '本周')
      expect(result.bpChart.hasData).toBe(false)
      expect(result.bgChart.hasData).toBe(false)
    })

    it('异常血压值标记 high status', () => {
      const result = buildBpBgCharts(bpRecords, bgRecords, '7d', '本周')
      const highBar = result.bpChart.systolicBars.find(b => b.status === 'high')
      expect(highBar).toBeDefined()
      expect(highBar.value).toBeGreaterThanOrEqual(BP_NORMAL.systolicHigh)
    })

    it('异常血糖值标记 high status', () => {
      const result = buildBpBgCharts(bpRecords, bgRecords, '7d', '本周')
      const highBar = result.bgChart.chartBars.find(b => b.status === 'high')
      expect(highBar).toBeDefined()
      expect(highBar.value).toBeGreaterThanOrEqual(BG_NORMAL.high)
    })

    it('柱状条数不超过 MAX_BARS=14', () => {
      // 生成20条记录
      const manyBp = Array.from({ length: 20 }, (_, i) => ({
        id: `bp-${i}`, type: 'bp', value: '120/80',
        createdAt: new Date(Date.now() - i * 86400000).toISOString()
      }))
      const result = buildBpBgCharts(manyBp, [], '7d', '本周')
      expect(result.bpChart.systolicBars.length).toBeLessThanOrEqual(14)
    })

    it('返回动态参考线位置', () => {
      const result = buildBpBgCharts(bpRecords, bgRecords, '7d', '本周')
      // 收缩压参考线（140 上限、90 下限）
      expect(result.bpChart.refSystolicHighTop).toBeTruthy()
      expect(result.bpChart.refSystolicHighTop).toContain('%')
      expect(result.bpChart.refSystolicLowTop).toBeTruthy()
      // 舒张压参考线（90 上限、60 下限）
      expect(result.bpChart.refDiastolicHighTop).toBeTruthy()
      expect(result.bpChart.refDiastolicLowTop).toBeTruthy()
      // 血糖参考线
      expect(result.bgChart.refHighTop).toBeTruthy()
      expect(result.bgChart.refLowTop).toBeTruthy()
    })

    it('支持云端 chartSeriesMap 直接消费', () => {
      const chartSeriesMap = {
        bloodPressure: {
          '7d': { labels: ['6/10', '6/11', '6/12'], values: [128, 135, 118] }
        },
        bloodGlucose: {
          '7d': { labels: ['6/10', '6/11'], values: [6.1, 7.5] }
        }
      }
      const result = buildBpBgCharts([], [], '7d', '本周', chartSeriesMap)
      expect(result.bpChart.hasData).toBe(true)
      expect(result.bgChart.hasData).toBe(true)
      expect(result.bpChart.systolicBars).toHaveLength(3)
      expect(result.bgChart.chartBars).toHaveLength(2)
      // 云端数据有参考线
      expect(result.bpChart.refSystolicHighTop).toBeTruthy()
      expect(result.bgChart.refHighTop).toBeTruthy()
    })

    it('云端数据优先于本地记录', () => {
      const chartSeriesMap = {
        bloodPressure: {
          '7d': { labels: ['A', 'B'], values: [130, 125] }
        }
      }
      const result = buildBpBgCharts(bpRecords, [], '7d', '本周', chartSeriesMap)
      // 应使用云端2条数据，而非本地3条
      expect(result.bpChart.systolicBars).toHaveLength(2)
    })

    it('支持云端 bloodPressureDiastolic 序列', () => {
      const chartSeriesMap = {
        bloodPressure: {
          '7d': { labels: ['6/10', '6/11'], values: [128, 135] }
        },
        bloodPressureDiastolic: {
          '7d': { labels: ['6/10', '6/11'], values: [78, 85] }
        },
        bloodGlucose: {
          '7d': { labels: ['6/10'], values: [6.1] }
        }
      }
      const result = buildBpBgCharts([], [], '7d', '本周', chartSeriesMap)
      expect(result.bpChart.systolicBars).toHaveLength(2)
      expect(result.bpChart.diastolicBars).toHaveLength(2)
      expect(result.bpChart.diastolicBars[0].value).toBe(78)
      expect(result.bpChart.diastolicBars[1].value).toBe(85)
    })

    it('云端无舒张压时从本地记录补充', () => {
      const chartSeriesMap = {
        bloodPressure: {
          '7d': { labels: ['6/10', '6/11', '6/12'], values: [128, 145, 118] }
        }
      }
      // 本地有3条血压记录，可从中提取舒张压
      const result = buildBpBgCharts(bpRecords, bgRecords, '7d', '本周', chartSeriesMap)
      expect(result.bpChart.systolicBars).toHaveLength(3)
      // 舒张压从本地记录补充
      expect(result.bpChart.diastolicBars.length).toBeGreaterThan(0)
    })
  })

  describe('calcRefLineTop', () => {
    it('计算正常范围内的参考线位置（含底部标签区偏移）', () => {
      const top = calcRefLineTop(140, { floor: 60, ceil: 200 })
      expect(top).toBeTruthy()
      expect(top).toContain('%')
      // 140 在 60-200 之间，(200-140)/140 * 0.80 * 100 ≈ 34.3%
      // 偏低值应在上半部分（< 80%）
      expect(parseFloat(top)).toBeGreaterThan(0)
      expect(parseFloat(top)).toBeLessThan(80)
    })

    it('参考线位置低于 80%（柱状区域上界）', () => {
      // 极低值靠近 floor，参考线应在柱状区域底部附近
      const top = calcRefLineTop(61, { floor: 60, ceil: 200 })
      expect(parseFloat(top)).toBeLessThan(80)
      expect(parseFloat(top)).toBeGreaterThan(70)
    })

    it('参考值超出上限返回空字符串', () => {
      const top = calcRefLineTop(300, { floor: 60, ceil: 200 })
      expect(top).toBe('')
    })

    it('参考值低于下限返回空字符串', () => {
      const top = calcRefLineTop(30, { floor: 60, ceil: 200 })
      expect(top).toBe('')
    })

    it('Y 轴范围为0返回空字符串', () => {
      const top = calcRefLineTop(100, { floor: 100, ceil: 100 })
      expect(top).toBe('')
    })

    it('参数缺失返回空字符串', () => {
      expect(calcRefLineTop(100, null)).toBe('')
      expect(calcRefLineTop(null, { floor: 60, ceil: 200 })).toBe('')
    })
  })

  describe('buildTrendChart', () => {
    it('使用默认数据构建趋势图', () => {
      const result = buildTrendChart('bloodPressure', '7d', { label: '血压' })
      expect(result.chartBars).toBeDefined()
      expect(result.chartBars.length).toBeGreaterThan(0)
      expect(result.chartA11yLabel).toContain('血压')
    })

    it('使用自定义 chartSeriesMap', () => {
      const chartSeriesMap = {
        bloodPressure: {
          '7d': { labels: ['1日', '2日', '3日'], values: [130, 125, 128] }
        }
      }
      const result = buildTrendChart('bloodPressure', '7d', {}, chartSeriesMap)
      expect(result.chartBars).toHaveLength(3)
      expect(result.chartBars[0].label).toBe('1日')
    })

    it('未知指标使用血压默认值', () => {
      const result = buildTrendChart('unknownMetric', '7d', {})
      expect(result.chartBars).toBeDefined()
      expect(result.chartBars.length).toBeGreaterThan(0)
    })

    it('未知时间范围使用 7d 默认值', () => {
      const result = buildTrendChart('bloodPressure', '1y', {})
      expect(result.chartBars).toBeDefined()
    })

    it('血糖指标使用 bg type 和 minFloor', () => {
      const result = buildTrendChart('bloodGlucose', '7d', {})
      expect(result.chartBars[0].status).toBeDefined()
    })
  })

  describe('buildReportChart', () => {
    it('使用默认数据构建周报图表', () => {
      const result = buildReportChart('本周', '血压趋势')
      expect(result.chartBars).toBeDefined()
      expect(result.chartA11yLabel).toContain('本周')
      expect(result.chartA11yLabel).toContain('血压趋势')
    })

    it('使用自定义数据', () => {
      const chartSeries = { labels: ['A', 'B'], values: [100, 110] }
      const result = buildReportChart('本周', '', chartSeries)
      expect(result.chartBars).toHaveLength(2)
    })
  })

  describe('buildRecordDetailChart', () => {
    it('血压记录生成3日趋势', () => {
      const record = { type: '血压', value: '128/78', time: '今天 08:00' }
      const details = [
        { label: '收缩压（高压）', value: '128 mmHg' }
      ]
      const result = buildRecordDetailChart(record, details)
      expect(result.chartBars).toHaveLength(3)
      expect(result.chartA11yLabel).toContain('近 3 次')
    })

    it('血糖记录生成3日趋势', () => {
      const record = { type: '血糖', value: '5.8', time: '今天 06:30' }
      const details = [
        { label: '血糖值', value: '5.8 mmol/L' }
      ]
      const result = buildRecordDetailChart(record, details)
      expect(result.chartBars).toHaveLength(3)
    })

    it('空记录使用默认值', () => {
      const result = buildRecordDetailChart({}, [])
      expect(result.chartBars).toHaveLength(3)
    })
  })
})
