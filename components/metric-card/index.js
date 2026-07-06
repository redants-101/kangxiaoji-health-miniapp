/**
 * 指标卡片组件。
 * 用于首页/家属页展示最新血压、血糖等指标，并把 route 透传给父页面跳转。
 */
Component({
  properties: {
    // 指标名称，例如“血压”“血糖”。
    label: String,
    // 指标主数值。
    value: String,
    // 指标单位。
    unit: String,
    // 副信息，例如时间和场景。
    meta: String,
    // 状态文案。
    status: String,
    // 状态类型，用于样式区分。
    statusType: String,
    // 关联的记录 ID，用于进入指定记录详情。
    recordId: String,
    // 点击后建议跳转的业务路由键。
    route: String
  },

  methods: {
    /**
     * 点击指标卡。
     * @fires cardtap 出参：{ route, recordId }，父页面决定如何跳转。
     */
    onTap() {
      this.triggerEvent('cardtap', {
        route: this.data.route,
        recordId: this.data.recordId
      })
    }
  }
})
