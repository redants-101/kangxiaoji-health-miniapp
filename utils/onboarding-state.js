const { resolveMockData, readStorage, STORAGE_KEYS } = require('../services/core')

function hasPrivacyAgreed(privacySettings) {
  if (!privacySettings) return false
  return privacySettings.agreed === true || !!privacySettings.agreedAt
}

function hasProfileReady(profileData) {
  const profile = profileData && profileData.profile ? profileData.profile : profileData
  const name = profile && typeof profile.name === 'string' ? profile.name.trim() : ''
  return !!name
}

/**
 * 从本地存储检查隐私是否已同意（作为云端写后读延迟的回退）。
 */
function hasLocalPrivacyAgreed() {
  const stored = readStorage(STORAGE_KEYS.privacySettings, null)
  if (!stored) return false
  return stored.agreed === true || !!stored.agreedAt
}

/**
 * 从本地存储检查资料是否已就绪（作为云端写后读延迟的回退）。
 */
function hasLocalProfileReady() {
  const stored = readStorage(STORAGE_KEYS.profile, null)
  if (!stored) return false
  const name = (stored.profile && stored.profile.name) || stored.name || ''
  return !!name.trim()
}

async function getOnboardingState() {
  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData && app.globalData.cloudReady) {
      await app.globalData.cloudReady
    }
  }

  const privacySettings = await resolveMockData('privacySettings')
  let privacyAgreed = hasPrivacyAgreed(privacySettings)

  // 云端因写后读延迟可能返回旧数据，回退检查本地存储
  if (!privacyAgreed && hasLocalPrivacyAgreed()) {
    console.info('[OnboardingState] 云端隐私未同意但本地已同意，视为已同意（写后读延迟）')
    privacyAgreed = true
  }

  if (!privacyAgreed) {
    return {
      privacyAgreed: false,
      profileReady: false,
      privacySettings,
      profileData: null
    }
  }

  const profileData = await resolveMockData('profile')
  let profileReady = hasProfileReady(profileData)

  // 云端因写后读延迟可能返回旧数据，回退检查本地存储
  if (!profileReady && hasLocalProfileReady()) {
    console.info('[OnboardingState] 云端资料未就绪但本地已有资料，视为已设置（写后读延迟）')
    profileReady = true
  }

  return {
    privacyAgreed,
    profileReady,
    privacySettings,
    profileData
  }
}

module.exports = {
  getOnboardingState,
  hasPrivacyAgreed,
  hasProfileReady,
  hasLocalPrivacyAgreed,
  hasLocalProfileReady
}
