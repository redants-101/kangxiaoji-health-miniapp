const { resolveMockData } = require('./core')

/**
 * 新手引导服务模块。
 * 负责角色选择等进入主流程前的静态配置数据。
 */

/** @returns {Promise<Object>} 角色选择页数据。 */
function getRoleData() {
  return resolveMockData('role')
}

module.exports = {
  getRoleData
}
