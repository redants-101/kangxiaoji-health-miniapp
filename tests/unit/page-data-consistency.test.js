const { DEFAULT_PAGE_DATA } = require('../../services/page-data')

/**
 * 页面数据结构一致性测试：确保合并后 DEFAULT_PAGE_DATA 结构正确。
 */
describe('DEFAULT_PAGE_DATA 一致性验证（合并后）', () => {
  it('不包含 report 键', () => {
    expect(DEFAULT_PAGE_DATA).not.toHaveProperty('report')
  })

  it('trend 键包含合并后的完整字段', () => {
    const trend = DEFAULT_PAGE_DATA.trend
    expect(trend).toBeDefined()

    // 原趋势页字段
    expect(trend).toHaveProperty('summaries')
    expect(trend).toHaveProperty('activeMetric')
    expect(trend).toHaveProperty('activeRange')
    expect(trend).toHaveProperty('currentSummary')
    expect(trend).toHaveProperty('records')

    // 从周报迁入的字段
    expect(trend).toHaveProperty('period')
    expect(trend).toHaveProperty('subtitle')
    expect(trend).toHaveProperty('summary')
    expect(trend).toHaveProperty('focusItems')
    expect(trend).toHaveProperty('summaryMetrics')
    expect(trend).toHaveProperty('emptyHint')
    expect(trend).toHaveProperty('chartBars')
    expect(trend).toHaveProperty('chartA11yLabel')
    expect(trend).toHaveProperty('chartSeries')
  })

  it('trend.metricOptions 包含血压血糖复合指标和用药指标', () => {
    const trend = DEFAULT_PAGE_DATA.trend
    expect(trend.metricOptions).toEqual([
      { key: 'bpBg', label: '血压血糖' },
      { key: 'medication', label: '用药' }
    ])
  })

  it('trend.rangeOptions 包含三档时间', () => {
    const trend = DEFAULT_PAGE_DATA.trend
    expect(trend.rangeOptions).toHaveLength(3)
    const keys = trend.rangeOptions.map(o => o.key)
    expect(keys).toEqual(['7d', '30d', '90d'])
  })

  it('trend 默认值为 7天+血压血糖', () => {
    const trend = DEFAULT_PAGE_DATA.trend
    expect(trend.activeMetric).toBe('bpBg')
    expect(trend.activeRange).toBe('7d')
  })

  it('reminder 任务使用 trend 路由', () => {
    const reminder = DEFAULT_PAGE_DATA.reminder
    expect(reminder).toBeDefined()
    const tasks = reminder.tasks || []
    const reportTask = tasks.find(t => t.id === 'task-weekly-report')
    expect(reportTask).toBeDefined()
    expect(reportTask.route).toBe('trend')
  })

  it('reminder 任务标题已更新', () => {
    const reminder = DEFAULT_PAGE_DATA.reminder
    const tasks = reminder.tasks || []
    const reportTask = tasks.find(t => t.id === 'task-weekly-report')
    expect(reportTask.title).toContain('趋势')
  })
})
