/**
 * 底部固定主操作按钮组件。
 * 用于保存、提交、邀请等页面底部主动作。
 */
Component({
  properties: {
    // 按钮文案。
    text: String,
    // 是否禁用；禁用时点击不触发事件。
    disabled: {
      type: Boolean,
      value: false
    },
    loading: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    /**
     * 点击底部按钮。
     * @returns {void} 禁用状态直接返回；可点击时触发 actiontap。
     * @fires actiontap 通知父页面执行主动作。
     */
    onTap() {
      if (this.data.disabled || this.data.loading) return
      this.triggerEvent('actiontap')
    }
  }
})
