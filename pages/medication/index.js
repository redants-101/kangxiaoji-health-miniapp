const { safeNavigateTo } = require('../../utils/route-guard')

Page({
  data: {},

  onLoad() {
    wx.setNavigationBarTitle({
      title: '用药管理'
    })
    safeNavigateTo('/pages/medication/med-list/index')
  }
})
