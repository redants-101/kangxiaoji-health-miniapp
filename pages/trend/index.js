const {
  autoPreCheck,
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  safeNavigateTo,
  unbindAdaptiveResize
} = require('../../utils/page-factory')
const { getTrendData } = require('../../utils/api')
const { markClean } = require('../../services/core')
const { buildTrendChart, buildBpBgCharts } = require('../../utils/chart-adapter')
const { parseDisplayDateTime } = require('../../utils/date-helper')
const { promptSubscribeAfterAction } = require('../../utils/subscribe-prompt')

/** 指标键名 → 中文名 */
const METRIC_LABELS = {
  bpBg: '血压血糖',
  bloodPressure: '血压',
  bloodGlucose: '血糖',
  medication: '用药'
}

/**
 * 格式化记录的 meta 信息（日期 · 标签），与首页 metric-card 风格一致。
 */
function formatRecordMeta(record) {
  const rawTime = record.time || record.measuredAt || ''
  const parsed = parseDisplayDateTime(rawTime)
  let dateValue = parsed.dateValue
  const timeOnly = /^\d{1,2}:\d{2}$/.test(rawTime.trim())
  if (timeOnly && record.createdAt) {
    const isoMatch = String(record.createdAt).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) dateValue = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }
  const parts = dateValue.split('-')
  let dateLabel = ''
  if (parts.length === 3) dateLabel = `${Number(parts[1])}月${Number(parts[2])}日`
  const tagLabel = record.tag || ''
  const segments = [`${dateLabel} ${parsed.timeValue}`]
  if (tagLabel) segments.push(tagLabel)
  return segments.join(' · ')
}

/**
 * 将记录转换为 metric-card 所需的数据格式。
 */
function buildMetricItem(record) {
  // 用药记录已由 getMedicationTrendData 格式化完毕，跳过二次转换
  if (record.type === 'medication') {
    return {
      id: record.id,
      type: record.type,
      label: record.label || '用药',
      value: record.value,
      unit: record.unit,
      meta: record.meta || '',
      status: record.status || '',
      statusType: record.statusType || '',
      route: record.route || 'medList',
      hasData: true
    }
  }
  return {
    id: record.id,
    type: record.type,
    label: record.type === 'bp' ? '血压' : '血糖',
    value: record.value,
    unit: record.unit,
    meta: formatRecordMeta(record),
    status: '看详情',
    statusType: record.statusType || '',
    route: 'recordDetail',
    hasData: true
  }
}

/**
 * 将记录列表转换为 metric-card 数据列表。
 * 每条记录生成一张卡片，最多4条。
 */
function buildLatestMetrics(records) {
  return (records || []).slice(0, 4).map(buildMetricItem)
}

/**
 * 趋势页。
 * 职责：展示血压/血糖/用药确认趋势摘要，支持指标和时间范围切换。
 * 所有档位（7天/30天/90天）均展示统计摘要和关注项。
 */
Page({
  data: {
    isLoading: true,
    loadError: ''
  },

  /**
   * 加载趋势页数据。
   * @param {Object} [options] 页面参数，支持 metric / range 覆盖默认值。
   * @returns {Promise<void>} 数据写入 this.data。
   */
  async loadData(options) {
    const metric = (options && options.metric) || this.data.activeMetric || 'bpBg'
    const range = (options && options.range) || this.data.activeRange || '7d'
    const loader = () => getTrendData(metric, range)
    const data = await loadPageData(this, loader)
    if (data) {
      // 将 records 转换为 metric-card 数据格式
      const latestMetrics = buildLatestMetrics(this.data.records)
      this.setData({ latestMetrics })
      this.updateChart()
    }
    return data
  },

  /**
   * 页面加载生命周期。
   * @param {Object} options 页面参数，支持 metric / range。
   * @returns {Promise<void>} 设置标题并加载趋势数据。
   */
  async onLoad(options) {
    wx.setNavigationBarTitle({
      title: '趋势'
    })
    bindAdaptiveResize(this)
    await this.loadData(options || {})
    // 首次加载完成后，引导授权下周健康周报提醒（事件驱动）
    this._promptWeeklyReportReminder()
  },

  /**
   * 引导授权下周健康周报提醒。
   * 事件驱动授权：用户查看趋势数据后，累积 1 次周报推送权限。
   * 防打扰：24 小时内同一场景只引导 1 次，拒绝后 7 天冷却。
   * 仅在页面首次加载时触发，避免切换指标/范围时反复弹窗。
   * @returns {void}
   */
  _promptWeeklyReportReminder() {
    if (this._weeklyPrompted) return
    this._weeklyPrompted = true
    promptSubscribeAfterAction(['weeklyReport'], { scene: 'trend-viewed' })
      .then(result => {
        if (result.ok) {
          wx.showToast({
            title: '已开启健康周报提醒',
            icon: 'success',
            duration: 1500
          })
        }
      })
      .catch(() => { /* 静默处理，不阻塞业务 */ })
  },

  /**
   * 页面显示时执行预检查并刷新数据。
   * tabBar 页面切回时重新拉取数据，确保记录/用药变更后趋势图更新。
   * @returns {void}
   */
  onShow() {
    autoPreCheck(this)
    if (this.data._loaded) {
      markClean('trend')
      this.loadData()
    }
  },

  /** @returns {void} 页面卸载时移除窗口监听。 */
  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  /** @returns {void} 根据当前指标和时间范围刷新响应式图表。 */
  updateChart() {
    if (this.data.activeMetric === 'bpBg') {
      // bpBg 双图表：使用当前已有的记录数据和云端序列重建
      const bpRecords = (this.data.records || []).filter(r => r.type === 'bp')
      const bgRecords = (this.data.records || []).filter(r => r.type === 'bg')
      const periodLabel = this.data.period || '本周'
      const chartData = buildBpBgCharts(bpRecords, bgRecords, this.data.activeRange, periodLabel, this.data.chartSeries)
      this.setData({
        bpChart: chartData.bpChart,
        bgChart: chartData.bgChart
      })
    } else if (this.data.activeMetric === 'medication') {
      // 用药趋势图表：使用 medChart 数据（含参考线位置），已由 getTrendData 计算完成
      const medChart = this.data.medChart
      if (medChart && medChart.hasData) {
        // 参考线位置已在 medChart 中计算，直接使用
        this.setData({
          chartBars: medChart.chartBars,
          chartA11yLabel: medChart.chartA11yLabel
        })
      }
    } else {
      // 单指标图表（血压/血糖）
      const chartMetric = this.data.activeMetric === 'bpBg' ? 'bloodPressure' : this.data.activeMetric
      const chartData = buildTrendChart(
        chartMetric,
        this.data.activeRange,
        this.data.currentSummary,
        this.data.chartSeries
      )
      this.setData(chartData)
    }
  },

  /** @returns {Promise<void>} 重新拉取趋势数据。 */
  async reloadPage() {
    await this.loadData()
  },

  /**
   * 切换趋势指标。
   * @param {Object} event 点击事件；dataset.key 为 bloodPressure/bloodGlucose/medication。
   * @returns {void} 更新 activeMetric 和 currentSummary，重新加载数据。
   */
  async selectMetric(event) {
    const activeMetric = event.currentTarget.dataset.key
    this.setData({
      activeMetric,
      currentSummary: (this.data.summaries && this.data.summaries[activeMetric]) || {}
    })
    await this.loadData({ metric: activeMetric, range: this.data.activeRange })
  },

  /**
   * 切换时间范围。
   * @param {Object} event 点击事件；dataset.key 为 7d/30d/90d。
   * @returns {void} 更新 activeRange，重新加载数据。
   */
  async selectRange(event) {
    const activeRange = event.currentTarget.dataset.key
    this.setData({ activeRange })
    await this.loadData({ metric: this.data.activeMetric, range: activeRange })
  },

  /**
   * 窗口尺寸变化时保持图表和语义摘要同步。
   * @returns {void}
   */
  onAdaptiveChange() {
    this.updateChart()
  },

  /** @returns {void} 进入历史记录页（用药时跳转历史用药记录，否则跳转记录列表）。 */
  goRecordList() {
    const route = this.data.activeMetric === 'medication' ? 'medHistory' : 'recordList'
    goRoute(route)
  },

  /**
   * 点击指标卡片，进入记录详情。
   * @param {Object} event 组件事件；detail.recordId 为记录 ID。
   * @returns {void}
   */
  handleMetricTap(event) {
    if (event.detail.recordId) {
      safeNavigateTo(`/pages/record/record-detail/index?id=${event.detail.recordId}`)
      return
    }
    goRoute(event.detail.route)
  },

  /**
   * 分享给微信好友。
   * @returns {Object} 分享卡片配置。
   */
  onShareAppMessage() {
    const { period, subtitle, activeMetric, activeRange } = this.data
    const metricLabel = METRIC_LABELS[activeMetric] || '健康'
    const title = subtitle && subtitle !== '暂无记录'
      ? `${period || ''}${metricLabel}趋势：${subtitle}`
      : `${period || ''}${metricLabel}趋势 - 康小记`
    return {
      title,
      path: `/pages/trend/index?metric=${activeMetric || 'bpBg'}&range=${activeRange || '7d'}`,
      imageUrl: '/assets/icons/icon-trend.png'
    }
  },

  /**
   * 分享到朋友圈。
   * @returns {Object} 分享卡片配置。
   */
  onShareTimeline() {
    const { period, subtitle, activeMetric, activeRange } = this.data
    const metricLabel = METRIC_LABELS[activeMetric] || '健康'
    const title = subtitle && subtitle !== '暂无记录'
      ? `${period || ''}${metricLabel}趋势：${subtitle}`
      : `${period || ''}${metricLabel}趋势 - 康小记`
    return {
      title,
      query: `metric=${activeMetric || 'bpBg'}&range=${activeRange || '7d'}`
    }
  },

  /** @returns {void} 提示用户使用右上角分享。 */
  handleShare() {
    const { period, activeMetric } = this.data
    const metricLabel = METRIC_LABELS[activeMetric] || '健康'
    wx.showToast({ title: `请点击右上角分享${period || ''}${metricLabel}趋势`, icon: 'none' })
  }
})
