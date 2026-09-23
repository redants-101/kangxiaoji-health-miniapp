const { safeNavigateBack } = require('../../../utils/page-factory')
const { getRecordDetailData, deleteRecord } = require('../../../utils/api')

Page({
  data: {
    record: null,
    details: [],
    adaptive: {},
    isFamilyView: false,
    familyDenied: false
  },

  onUnload() {
    if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null }
  },

  async onLoad(options) {
    const { id, familyView } = options
    wx.setNavigationBarTitle({
      title: '记录详情'
    })
    if (familyView === '1' || familyView === true) {
      this.setData({ isFamilyView: true })
    }
    try {
      const data = await getRecordDetailData(id, this.data.isFamilyView || undefined)
      this.setData({
        record: data.record,
        details: data.details || [],
        familyDenied: !!(data.familyView && data.familyView.allowed === false)
      })
    } catch (error) {
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  handleDelete() {
    // A3：家属视图只读，禁止删除
    if (this.data.isFamilyView) {
      wx.showToast({ title: '家属视图为只读', icon: 'none' })
      return
    }
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
