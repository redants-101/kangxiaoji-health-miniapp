const { safeNavigateTo } = require('../../utils/route-guard')

Page({
  data: {},

  onLoad() {
    wx.setNavigationBarTitle({
      title: '数据管理'
    })
  },

  goToDataManage() {
    safeNavigateTo('/pages/data/data/index')
  }
})
