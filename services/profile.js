const {
  STORAGE_KEYS,
  getRelatedCacheKeys,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorageAndInvalidate
} = require('./core')
const { deepMerge, withMockPageData, DEFAULT_PAGE_DATA } = require('./page-data')

/**
 * 个人资料服务模块。
 * 负责基础资料、本地资料缓存，以及首页/我的页中的用户称呼和关注项合并。
 */

/** @returns {Object|null} 本地保存的用户资料。 */
function getStoredProfile() {
  return readStorage(STORAGE_KEYS.profile, null)
}

/**
 * 本地保存基础资料。
 * @param {Object} payload 基础资料页完整数据。
 * @returns {Object} 保存后的资料对象。
 */
function saveProfileLocal(payload) {
  return writeStorageAndInvalidate(STORAGE_KEYS.profile, {
    ...payload,
    updatedAt: new Date().toISOString()
  }, getRelatedCacheKeys(STORAGE_KEYS.profile))
}

/**
 * 合并本地基础资料到资料页初始数据。
 * @param {Object} baseData mockData.profile。
 * @returns {Object} 合并后的资料页数据。
 */
function mergeProfile(baseData) {
  const storedProfile = getStoredProfile()
  if (!storedProfile) return baseData
  return {
    ...baseData,
    ...storedProfile
  }
}

/**
 * 将本地用户称呼同步到首页问候语。
 * @param {Object} baseData mockData.home。
 * @returns {Object} 首页数据。
 */
function mergeProfileIntoHome(baseData) {
  const storedProfile = getStoredProfile()
  const name = storedProfile && storedProfile.profile && storedProfile.profile.name
  if (!name) return baseData
  const eyebrow = typeof baseData.eyebrow === 'string' ? baseData.eyebrow : ''
  return {
    ...baseData,
    eyebrow: eyebrow.replace(/，.+$/, `，${name}`) || `你好，${name}！`
  }
}

/**
 * 将本地用户资料同步到“我的”页。
 * @param {Object} baseData mockData.me。
 * @returns {Object} 我的页数据。
 */
function mergeProfileIntoMe(baseData) {
  const storedProfile = getStoredProfile()
  const DEFAULT_SETTING_GROUPS = (DEFAULT_PAGE_DATA.me && DEFAULT_PAGE_DATA.me.settingGroups) || []

  const result = { ...baseData }
  if (!result.settingGroups || !result.settingGroups.length) {
    result.settingGroups = DEFAULT_SETTING_GROUPS
  }

  if (!storedProfile || !storedProfile.profile) return result
  const tags = (storedProfile.focusItems || [])
    .filter((item) => item.checked)
    .map((item) => item.title.replace('记录', '').replace('提醒', ''))
  return {
    ...result,
    profile: {
      ...result.profile,
      name: storedProfile.profile.name,
      role: storedProfile.profile.role === 'family' ? '帮家人管理' : '本人使用 · 家庭健康记录',
      tags: tags.length ? tags : result.profile.tags
    }
  }
}

/** @returns {Promise<Object>} 基础资料页数据，已合并本地资料。 */
function getProfileData() {
  return resolveMockData('profile')
    .then((remoteData) => withMockPageData('profile', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
    .then(mergeProfile)
}

/** @returns {Promise<Object>} 我的页数据，已合并本地资料。 */
function getMeData() {
  return resolveMockData('me')
    .then((remoteData) => withMockPageData('me', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
    .then(mergeProfileIntoMe)
}

/**
 * 保存基础资料入口，按配置切换 local/cloud/http。
 * @param {Object} payload 基础资料页完整数据。
 * @returns {Promise<Object>} 保存结果。
 */
function saveProfile(payload) {
  return resolveRemote('saveProfile', payload, saveProfileLocal, {
    mirrorLocal: true
  })
}

module.exports = {
  getMeData,
  getProfileData,
  getStoredProfile,
  mergeProfileIntoHome,
  saveProfile
}
