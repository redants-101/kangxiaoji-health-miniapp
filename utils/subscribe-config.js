/**
 * 订阅消息模板 ID 配置文件。
 *
 * 模板申请位置：微信公众平台 → 功能 → 订阅消息 → 公共模板库
 *
 * 已配置模板：
 * - medicine（用药提醒）：
 *   模板 ID：qoFwVTDFbfd3VewxWP9q77s1cRV8BoAv2HNZ6enxUJg
 *   模板编号：73500
 *   标题：每日用药提醒
 *   类目：健康管理
 *   字段映射：
 *     thing1            - 服药人（用户昵称或“我”）
 *     thing3            - 药品名称
 *     time2             - 用药时间（HH:mm）
 *     character_string4 - 剂量
 *     thing5            - 备注（如“请确认服药”）
 *
 * - measure（测量提醒）：
 *   模板 ID：gKW7PCNOvOuRABIErKmkvkUU5CAiK7sQl1bsbUzLxSs
 *   模板编号：7023
 *   标题：健康测评提醒
 *   类目：健康管理
 *   场景说明：血压、血糖测量提醒
 *   字段映射：
 *     thing12 - 测评项目（如“血压”、“血糖”）
 *     time2   - 提醒时间（HH:mm）
 *     thing1  - 备注（如“请记录测量结果”）
 *
 * - weeklyReport（健康周报）：
 *   模板 ID：KG7G70GC2i91aCDibDDVl6NT1zQRJlVQcM1GGmqSYIE
 *   模板编号：41645
 *   标题：查看报告提醒
 *   类目：健康管理
 *   场景说明：健康周报生成提醒
 *   字段映射：
 *     thing5 - 成员（如“我”、家属姓名）
 *     thing1 - 报告类型（固定“健康周报”）
 *     time2  - 生成时间（HH:mm）
 *     thing3 - 报告结果（周报摘要，如“本周用药完成率 85%”）
 *     thing4 - 温馨提示（如“点击查看详情”）
 *
 * 注意：
 * - 模板 ID 格式为 40 位字符串
 * - 占位符格式为 xxx_placeholder，代码会检测并提示未配置
 * - 模板审核通过后才能使用，审核通常需要 1-2 个工作日
 * - 不同小程序选用同一模板，生成的模板 ID 不同
 * - 三个模板均已配置，DEV_MODE 可设为 false 进入生产模式
 */
const SUBSCRIBE_TEMPLATE_IDS = {
  medicine: 'qoFwVTDFbfd3VewxWP9q77s1cRV8BoAv2HNZ6enxUJg',
  measure: 'gKW7PCNOvOuRABIErKmkvkUU5CAiK7sQl1bsbUzLxSs',
  weeklyReport: 'KG7G70GC2i91aCDibDDVl6NT1zQRJlVQcM1GGmqSYIE'
}

/**
 * 开发模式开关。
 * 设为 true 时，模板 ID 未配置也不阻塞流程，仅记录日志，便于本地开发测试。
 * 设为 false 时（生产环境），模板 ID 未配置会给出明确提示。
 * 上线前必须设为 false。
 */
const DEV_MODE = false

module.exports = {
  SUBSCRIBE_TEMPLATE_IDS,
  DEV_MODE
}

