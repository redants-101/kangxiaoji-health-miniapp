const {
  bindAdaptiveResize,
  unbindAdaptiveResize,
  loadPageData,
  clearPageLoadState
} = require('../../../utils/page-factory')
const { getMedHistoryData } = require('../../../utils/api')

function getDateDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getTodayDateValue() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

Page({
  data: {
    isLoading: true,
    loadError: '',
    activeFilter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'taken', label: '已服' },
      { key: 'skipped', label: '已跳过' }
    ],
    rangeLabel: '近7天',
    startDate: '',
    endDate: '',
    dateGroups: [],
    visibleGroups: [],
    summary: { totalRecords: 0, takenCount: 0, skippedCount: 0 },
    adaptive: {}
  },

  async loadData() {
    const startDate = this.data.startDate || getDateDaysAgo(6)
    const endDate = this.data.endDate || getTodayDateValue()
    return loadPageData(this, () => getMedHistoryData(startDate, endDate)).then(() => {
      this._applyFilter()
      try { this.setData({ _loaded: true }) } catch (e) { /* 页面可能已销毁 */ }
    })
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '历史用药记录' })
    bindAdaptiveResize(this)
    const startDate = getDateDaysAgo(6)
    const endDate = getTodayDateValue()
    this.setData({ startDate, endDate })
    this.loadData()
  },

  onShow() {
    if (this.data._loaded) {
      this.loadData()
    }
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
  },

  async reloadPage() {
    await this.loadData()
  },

  handleFilterChange(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ activeFilter: key })
    this._applyFilter()
  },

  _applyFilter() {
    const filter = this.data.activeFilter
    const dateGroups = this.data.dateGroups || []

    if (filter === 'all') {
      this.setData({ visibleGroups: dateGroups })
      return
    }

    const filtered = dateGroups.map(group => ({
      ...group,
      records: group.records.filter(r => r.status === filter)
    })).filter(group => group.records.length > 0)

    this.setData({ visibleGroups: filtered })
  },

  handleRangePrev() {
    const currentStart = this.data.startDate || getTodayDateValue()
    const d = new Date(currentStart)
    d.setDate(d.getDate() - 7)
    const newStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const newEnd = this.data.startDate || getTodayDateValue()
    const adjustedEnd = `${new Date(newEnd).getFullYear()}-${String(new Date(newEnd).getMonth() + 1).padStart(2, '0')}-${String(new Date(newEnd).getDate()).padStart(2, '0')}`

    const end = new Date(adjustedEnd)
    end.setDate(end.getDate() - 1)
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`

    this.setData({ startDate: newStart, endDate: endStr, rangeLabel: this._formatRangeLabel(newStart, endStr) })
    this.loadData()
  },

  handleRangeNext() {
    const currentEnd = this.data.endDate || getTodayDateValue()
    const today = getTodayDateValue()
    if (currentEnd >= today) return

    const d = new Date(currentEnd)
    d.setDate(d.getDate() + 1)
    const newStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    d.setDate(d.getDate() + 6)
    let newEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (newEnd > today) newEnd = today

    this.setData({ startDate: newStart, endDate: newEnd, rangeLabel: this._formatRangeLabel(newStart, newEnd) })
    this.loadData()
  },

  _formatRangeLabel(start, end) {
    const sParts = start.split('-')
    const eParts = end.split('-')
    const sLabel = `${Number(sParts[1])}/${Number(sParts[2])}`
    const eLabel = `${Number(eParts[1])}/${Number(eParts[2])}`
    return sLabel === eLabel ? sLabel : `${sLabel} - ${eLabel}`
  }
})
