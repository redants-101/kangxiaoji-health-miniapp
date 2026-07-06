/**
 * 快捷入口组件。
 * 用于首页“记血压、记血糖、用药”等快速操作。
 */
Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    // 圆形图标文字，未传 iconSrc 时使用。
    icon: String,
    // 本地图标路径，推荐使用 assets/icons 下的 PNG。
    iconSrc: String,
    // 入口标题。
    title: String,
    // 可选说明文案。
    desc: String,
    // 点击后建议跳转的业务路由键。
    route: String
  },

  methods: {
    /**
     * 点击快捷入口。
     * @fires actiontap 出参：{ route }，父页面统一处理跳转。
     */
    onTap() {
      this.triggerEvent('actiontap', {
        route: this.data.route
      })
    }
  }
})
