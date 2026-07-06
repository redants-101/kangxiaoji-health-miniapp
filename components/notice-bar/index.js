/**
 * 通知提示条组件。
 * text 是提示内容，level 可控制普通/警示样式。
 */
Component({
  properties: {
    // 提示文案。
    text: {
      type: String,
      value: ''
    },
    // 提示等级，例如 warn。
    level: {
      type: String,
      value: ''
    }
  }
})
