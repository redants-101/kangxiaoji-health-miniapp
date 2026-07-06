const { safeNavigateTo } = require('../../utils/route-guard')

Page({
  data: {},

  onLoad() {
    wx.setNavigationBarTitle({
      title: '家庭管理'
    })
  },

  goToFamilyInvite() {
    safeNavigateTo('/pages/family-sub/family-invite/index')
  },

  goToFamilyJoin() {
    safeNavigateTo('/pages/family-sub/family-join/index')
  },

  goToFamilyAuth() {
    safeNavigateTo('/pages/family-sub/family-auth/index')
  }
})
