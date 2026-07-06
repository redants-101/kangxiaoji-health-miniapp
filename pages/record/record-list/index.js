const { safeNavigateTo } = require('../../../utils/page-factory')
const { getRecordListData } = require('../../../utils/api')

Page({
  data: {
    activeFilter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'bp', label: '血压' },
      { key: 'bg', label: '血糖' }
    ],
    records: [],
    visibleRecords: [],
    adaptive: {}
  },

  async onLoad() {
    wx.setNavigationBarTitle({
      title: '历史记录'
    })
    
    try {
      const data = await getRecordListData()
      this.setData({
        records: data.records || [],
        visibleRecords: data.records || []
      })
    } catch (error) {
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  handleFilterChange(event) {
    const key = event.currentTarget.dataset.key
    const filtered = key === 'all'
      ? this.data.records
      : this.data.records.filter(item => item.type === key)
    
    this.setData({
      activeFilter: key,
      visibleRecords: filtered
    })
  },

  handleRecordTap(event) {
    const id = event.currentTarget.dataset.id
    safeNavigateTo(`/pages/record/record-detail/index?id=${id}`)
  }
})
