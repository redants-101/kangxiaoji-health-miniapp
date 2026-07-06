const { safeNavigateBack } = require('../../../utils/page-factory')
const { getRecordDetailData, deleteRecord } = require('../../../utils/api')

Page({
  data: {
    record: null,
    details: [],
    adaptive: {}
  },

  onUnload() {
    if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null }
  },

  async onLoad(options) {
    const { id } = options
    wx.setNavigationBarTitle({
      title: '记录详情'
    })
    
    try {
      const data = await getRecordDetailData(id)
      this.setData({
        record: data.record,
        details: data.details || []
      })
    } catch (error) {
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  handleDelete() {
    wx.showModal({
      title: '删除记录',
      content: '确认删除这条记录吗？',
      confirmText: '删除',
      confirmColor: '#C8463A',
      success: async (result) => {
        if (result.confirm) {
          try {
            await deleteRecord(this.data.record.id)
            wx.showToast({
              title: '已删除',
              icon: 'success'
            })
            this._navTimer = setTimeout(() => {
              safeNavigateBack()
            }, 1000)
          } catch (error) {
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            })
          }
        }
      }
    })
  }
})
