const {
  STORAGE_KEYS,
  getRelatedCacheKeys,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorageAndInvalidate
} = require('./core')
const { deepMerge, mergeArrayItemDefaults, withMockPageData } = require('./page-data')

/**
 * 隐私与协议服务模块。
 * 负责隐私确认、隐私政策、用户协议和隐私授权设置。
 */

/** @returns {Object|null} 本地隐私授权设置。 */
function getStoredPrivacySettings() {
  return readStorage(STORAGE_KEYS.privacySettings, null)
}

/**
 * 本地保存隐私授权设置。
 * @param {Object} payload 隐私与授权页完整数据。
 * @param {boolean} [payload.agreed] 是否已同意隐私协议。
 * @param {string} [payload.agreedAt] 同意时间（ISO 格式）。
 * @param {Array<Object>} [payload.permissions] 授权项目列表。
 * @param {Array<Object>} [payload.links] 管理入口列表。
 * @param {Array<Object>} [payload.logs] 最近授权日志。
 * @returns {Object} 保存后的隐私设置。
 */
function updatePrivacySettingsLocal(payload) {
  const existing = getStoredPrivacySettings() || {}
  const {
    agreed,
    agreedAt,
    permissions,
    links,
    logs
  } = payload || {}

  return writeStorageAndInvalidate(STORAGE_KEYS.privacySettings, {
    // 保留已有数据
    ...existing,
    // 更新传入的字段
    ...(agreed !== undefined ? { agreed } : {}),
    ...(agreedAt ? { agreedAt } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    ...(links !== undefined ? { links } : {}),
    ...(logs !== undefined ? { logs } : {}),
    updatedAt: new Date().toISOString()
  }, getRelatedCacheKeys(STORAGE_KEYS.privacySettings))
}

/**
 * 合并本地隐私设置到隐私与授权页。
 * @param {Object} baseData mockData.privacySettings。
 * @returns {Object} 隐私授权页数据。
 */
function mergePrivacySettings(baseData) {
  const storedSettings = getStoredPrivacySettings()
  if (!storedSettings) return baseData
  const merged = {
    ...baseData,
    ...storedSettings
  }
  return {
    ...merged,
    permissions: mergeArrayItemDefaults(baseData.permissions, merged.permissions, 'key'),
    links: mergeArrayItemDefaults(baseData.links, merged.links, 'route')
  }
}

/** @returns {Promise<Object>} 首次隐私确认页数据。 */
function getPrivacyData() {
  return resolveMockData('privacy')
    .then((remoteData) => withMockPageData('privacy', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
}

/** @returns {Promise<Object>} 隐私摘要页数据，兼容旧页面。 */
function getPrivacyDetailData() {
  return resolveMockData('privacyDetail')
    .then((remoteData) => withMockPageData('privacyDetail', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
}

/** @returns {Promise<Object>} 完整隐私政策页数据。 */
function getPrivacyPolicyData() {
  return resolveMockData('privacyPolicy')
    .then((remoteData) => withMockPageData('privacyPolicy', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
}

/** @returns {Promise<Object>} 用户服务协议页数据。 */
function getUserAgreementData() {
  return resolveMockData('userAgreement')
    .then((remoteData) => withMockPageData('userAgreement', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
}

/** @returns {Promise<Object>} 隐私与授权页数据，已合并本地设置。 */
function getPrivacySettingsData() {
  return resolveMockData('privacySettings')
    .then((remoteData) => withMockPageData('privacySettings', remoteData, (baseData, remote) => {
      const merged = deepMerge(baseData, remote)
      return {
        ...merged,
        permissions: mergeArrayItemDefaults(baseData.permissions, merged.permissions, 'key'),
        links: mergeArrayItemDefaults(baseData.links, merged.links, 'route')
      }
    }))
    .then(mergePrivacySettings)
}

/**
 * 更新隐私授权设置入口，按配置切换 local/cloud/http。
 * @param {Object} payload 隐私授权页完整数据。
 * @param {Array<Object>} payload.permissions 授权项目列表。
 * @param {Array<Object>} payload.links 管理入口列表。
 * @param {Array<Object>} payload.logs 最近授权日志。
 * @returns {Promise<Object>} 保存结果。
 */
function updatePrivacySettings(payload) {
  return resolveRemote('updatePrivacySettings', payload, updatePrivacySettingsLocal, {
    mirrorLocal: true
  })
}

module.exports = {
  getPrivacyData,
  getPrivacyDetailData,
  getPrivacyPolicyData,
  getPrivacySettingsData,
  getStoredPrivacySettings,
  getUserAgreementData,
  mergePrivacySettings,
  updatePrivacySettings,
  updatePrivacySettingsLocal
}
