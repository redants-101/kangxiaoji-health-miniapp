const routes = require('../../utils/routes')
const { getOnboardingState } = require('../../utils/onboarding-state')
const { safeRedirectTo, safeSwitchTab } = require('../../utils/route-guard')

function goByState(state) {
  if (!state.privacyAgreed) {
    safeRedirectTo(routes.privacy)
    return
  }

  if (!state.profileReady) {
    safeRedirectTo(routes.profile)
    return
  }

  safeSwitchTab(routes.home)
}

Page({
  data: {
    isChecking: true,
    loadError: ''
  },

  async onLoad() {
    await this.routeByCloudState()
  },

  async routeByCloudState() {
    this.setData({
      isChecking: true,
      loadError: ''
    })
    try {
      const app = getApp()
      if (app && app.globalData && app.globalData.cloudReady) {
        await app.globalData.cloudReady
      }
      const state = await getOnboardingState()
      goByState(state)
    } catch (error) {
      this.setData({
        isChecking: false,
        loadError: error && error.message ? error.message : '云端状态加载失败'
      })
    }
  }
})
