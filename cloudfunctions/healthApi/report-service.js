const DAY_MS = 24 * 60 * 60 * 1000
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

function getDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date()
  return new Date(safeDate.getTime() + CHINA_TIME_OFFSET_MS).toISOString().slice(0, 10)
}

function getStartDateKey(days) {
  return getDateKey(new Date(Date.now() - Math.max(days - 1, 0) * DAY_MS))
}

function sumNumber(items, field) {
  return items.reduce((total, item) => {
    const value = Number(item && item[field])
    return Number.isFinite(value) ? total + value : total
  }, 0)
}

function calcAvg(total, count) {
  const safeCount = Number(count)
  if (!Number.isFinite(safeCount) || safeCount <= 0) return '--'
  return (Number(total || 0) / safeCount).toFixed(1)
}

function calcBpAverage(stats) {
  const count = sumNumber(stats, 'bpCount')
  if (!count) return '--'
  return `${calcAvg(sumNumber(stats, 'bpSystolicTotal'), count)}/${calcAvg(sumNumber(stats, 'bpDiastolicTotal'), count)}`
}

function calcBgAverage(stats) {
  const count = sumNumber(stats, 'bgCount')
  if (!count) return '--'
  return calcAvg(sumNumber(stats, 'bgGlucoseTotal'), count)
}

function createReportService({ statsService }) {
  /**
   * 获取健康报告数据。
   * 报告优先读取 `health_daily_stats` 日预聚合结果，避免每次拉取原始记录再做内存统计。
   * @param {string} openId 当前用户 openId。
   * @returns {Promise<Object>} 周报摘要数据。
   */
  async function getReportData(openId) {
    const today = new Date()
    const stats = await statsService.getRecentDailyStats(openId, 30)
    const weekStartKey = getStartDateKey(7)
    const weekStats = stats.filter((item) => item.dayKey >= weekStartKey)

    return {
      eyebrow: '健康周报',
      weekSummary: {
        recordCount: sumNumber(weekStats, 'recordCount'),
        avgBp: calcBpAverage(stats),
        avgBg: calcBgAverage(stats)
      },
      tips: [
        '本周记录次数较上周增加，继续保持',
        '建议每天固定时间测量，数据更有参考价值'
      ],
      generatedAt: getDateKey(today)
    }
  }

  return {
    getReportData
  }
}

module.exports = {
  createReportService
}
