/**
 * coming-soon 组件
 * 功能未上线时的占位提示模块。
 * 使用方式：在页面 wxml 中 <coming-soon title="趋势" description="..." />
 * 后续功能上线时，移除 coming-soon 包裹即可恢复原始内容。
 */
Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    description: {
      type: String,
      value: '该功能正在紧锣密鼓地开发中，敬请期待。'
    },
    icon: {
      type: String,
      value: '🚧'
    },
    showNotify: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    handleNotifyTap() {
      wx.showModal({
        title: '即将上线',
        content: `${this.data.title || '该功能'}正在开发中，将在后续版本中上线，感谢你的关注与耐心等待！`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#168957'
      })
    }
  }
})
