/**
 * 小程序全局入口。
 * 这里放全局只读配置，页面可通过 getApp().globalData 读取。
 */
const { buildAdaptiveState } = require('./utils/adaptive')

/**
 * 全局注入分享能力。
 * 覆写 Page 构造器：
 * - 所有页面：默认注入 onShareAppMessage（转发给朋友 + 复制链接）
 * - 首页/家庭页：由页面自定义 onShareAppMessage + onShareTimeline，此处不覆盖
 */
const originalPage = Page
Page = function (config) {
  if (!config.onShareAppMessage) {
    config.onShareAppMessage = function () {
      return {
        title: '康小记 — 家人健康，一眼便知',
        path: '/pages/home/index',
        imageUrl: ''
      }
    }
  }
  originalPage(config)
}

App({
  onLaunch() {
    // cloudReady 标记云环境是否初始化完成
    this.globalData.cloudReady = new Promise((resolve) => {
      if (!wx.cloud) {
        console.error('请使用 2.2.3 或以上的基础库以使用云能力')
        resolve(false)
        return
      }
      wx.cloud.init({
        env: 'kangxiaoji-d5gw2k203f0488a9e',
        traceUser: true
      })
      // cloud.init 完成后立即可调用云函数，无需额外等待回调
      resolve(true)
    })

    this.globalData.adaptive = buildAdaptiveState().adaptive
  },
  globalData: {
    appName: '康小记',
    privacyVersion: '2026-04-19',
    adaptive: {},
    cloudReady: null
  }
})
