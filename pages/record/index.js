/**
 * 记录子包入口页
 * 提供血压/血糖记录入口选择
 */
const { safeNavigateTo } = require('../../utils/route-guard')

Page({
  data: {
    adaptive: {}
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '健康记录'
    })
  },

  goToBloodPressure() {
    safeNavigateTo('/pages/record/record-bp/index')
  },

  goToBloodGlucose() {
    safeNavigateTo('/pages/record/record-bg/index')
  },

  goToRecordList() {
    safeNavigateTo('/pages/record/record-list/index')
  }
})
