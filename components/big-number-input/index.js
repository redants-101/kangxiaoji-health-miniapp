/**
 * 大号数字输入组件。
 * 父页面通过 field 区分字段，通过 valuechange 事件拿到最新输入值。
 */
Component({
  properties: {
    // 展示标签，例如“收缩压”“血糖值”。
    label: String,
    // 当前输入值，由父页面传入。
    value: {
      type: String,
      value: ''
    },
    // 单位，例如 mmHg / mmol/L。
    unit: String,
    // 字段名，会原样透传给父页面，方便更新 form[field]。
    field: String,
    placeholder: String,
    hint: String,
    // 字段错误文案，由父页面校验后传入。
    error: String,
    inputType: {
      type: String,
      value: 'number'
    }
  },

  methods: {
    /**
     * 输入事件。
     * @param {Object} event 微信 input 事件，event.detail.value 是输入值。
     * @fires valuechange 出参：{ field, value }。
     */
    onInput(event) {
      this.triggerEvent('valuechange', {
        field: this.data.field,
        value: event.detail.value
      })
    }
  }
})
