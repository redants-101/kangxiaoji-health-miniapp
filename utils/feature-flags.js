/**
 * A7 运行时功能开关（家庭 Tab 开放/回滚）。
 *
 * 判定优先级：
 * 1. 远程配置：healthApi key 'appConfig' 返回的 familyTabEnabled（严格布尔才生效）；
 * 2. 端侧默认：正式发布(release)=关；体验版(trial)/开发版(develop)=开。
 *
 * 边界：
 * - 开关只控制家庭 Tab 页面展示与家庭页数据加载，不构成任何数据授权
 *   （家属数据授权一律走服务端 family-policy 闸口）；
 * - envVersion 获取异常按 release 处理（保守关闭）；
 * - 远程配置未部署/获取失败 → 回退端侧默认，不阻塞页面。
 */

/**
 * 读取当前小程序运行环境版本。
 * @returns {string} develop / trial / release；异常时按 release（保守）。
 */
function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync()
    return (info && info.miniProgram && info.miniProgram.envVersion) || 'release'
  } catch (e) {
    return 'release'
  }
}

/**
 * 端侧默认值：正式发布默认关，测试（体验/开发）版默认开——两类默认明确区分。
 * @param {string} envVersion 环境版本。
 * @returns {boolean}
 */
function defaultFamilyTabEnabled(envVersion) {
  return envVersion !== 'release'
}

/**
 * 解析家庭 Tab 开关。
 * @param {Object|null} [remoteConfig] 远程配置对象（{ familyTabEnabled?: boolean }）。
 * @returns {boolean} 开关状态。
 */
function getFamilyTabEnabled(remoteConfig) {
  if (remoteConfig && typeof remoteConfig.familyTabEnabled === 'boolean') {
    return remoteConfig.familyTabEnabled
  }
  return defaultFamilyTabEnabled(getEnvVersion())
}

module.exports = {
  getEnvVersion,
  defaultFamilyTabEnabled,
  getFamilyTabEnabled
}
