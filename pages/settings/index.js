const { safeNavigateTo } = require('../../utils/route-guard')

Page({
  data: {},

  onLoad() {
    wx.setNavigationBarTitle({
      title: '设置'
    })
  },

  goToPrivacy() {
    safeNavigateTo('/pages/settings/privacy/index')
  },

  goToProfile() {
    safeNavigateTo('/pages/settings/profile/index')
  },

  goToPrivacySettings() {
    safeNavigateTo('/pages/settings/privacy-settings/index')
  },

  goToFeedback() {
    safeNavigateTo('/pages/settings/feedback/index')
  },

  goToHelp() {
    safeNavigateTo('/pages/settings/help/index')
  }
})
