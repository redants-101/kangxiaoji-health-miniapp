/**
 * 数据源配置。
 * dataSource:
 * - local：默认走 mock-data + wx 本地缓存，适合原型和本地 MVP。
 * - cloud：走微信云函数 healthApi，适合后续云开发数据库。
 * - http：走自建后端接口，适合未来独立服务端。
 */
const apiConfig = {
  dataSource: 'cloud',
  cloudFunctionName: 'healthApi',
  httpBaseUrl: ''
}

module.exports = apiConfig
