const {
  STORAGE_KEYS,
  readStorage,
  writeStorage,
  clearMemoryStorage
} = require('../../services/core')

const {
  checkPrivacyAgreed,
  checkProfileSetup,
  ensurePrivacyAgreed,
  ensureProfileSetup,
  isProtectedPage,
  isPrivacyFreePage,
  isProfileFreePage
} = require('../../utils/pre-check')

describe('utils/pre-check', () => {
  beforeEach(() => {
    clearMemoryStorage()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('checkPrivacyAgreed', () => {
    it('无隐私设置时返回 false', () => {
      expect(checkPrivacyAgreed()).toBe(false)
    })

    it('agreed=true 时返回 true', () => {
      writeStorage(STORAGE_KEYS.privacySettings, {
        agreed: true
      })
      expect(checkPrivacyAgreed()).toBe(true)
    })

    it('agreedAt 有值时返回 true', () => {
      writeStorage(STORAGE_KEYS.privacySettings, {
        agreedAt: '2026-04-27T08:00:00'
      })
      expect(checkPrivacyAgreed()).toBe(true)
    })

    it('agreed=false 且无 agreedAt 时返回 false', () => {
      writeStorage(STORAGE_KEYS.privacySettings, {
        agreed: false
      })
      expect(checkPrivacyAgreed()).toBe(false)
    })
  })

  describe('checkProfileSetup', () => {
    it('无资料时返回 false', () => {
      expect(checkProfileSetup()).toBe(false)
    })

    it('有姓名时返回 true', () => {
      writeStorage(STORAGE_KEYS.profile, {
        profile: { name: '王阿姨' }
      })
      expect(checkProfileSetup()).toBe(true)
    })

    it('姓名为空字符串时返回 false', () => {
      writeStorage(STORAGE_KEYS.profile, {
        profile: { name: '' }
      })
      expect(checkProfileSetup()).toBe(false)
    })

    it('姓名为纯空格时返回 false', () => {
      writeStorage(STORAGE_KEYS.profile, {
        profile: { name: '   ' }
      })
      expect(checkProfileSetup()).toBe(false)
    })

    it('兼容扁平结构 profile.name', () => {
      writeStorage(STORAGE_KEYS.profile, {
        name: '测试用户'
      })
      expect(checkProfileSetup()).toBe(true)
    })
  })

  describe('isProtectedPage', () => {
    it('首页是受保护页面', () => {
      expect(isProtectedPage('pages/home/index')).toBe(true)
    })

    it('趋势页是受保护页面', () => {
      expect(isProtectedPage('pages/trend/index')).toBe(true)
    })

    it('隐私页不是受保护页面', () => {
      expect(isProtectedPage('pages/settings/privacy/index')).toBe(false)
    })

    it('启动页不是受保护页面', () => {
      expect(isProtectedPage('pages/launch/index')).toBe(false)
    })
  })

  describe('isPrivacyFreePage', () => {
    it('隐私页是免隐私检查页面', () => {
      expect(isPrivacyFreePage('pages/settings/privacy/index')).toBe(true)
    })

    it('隐私政策页是免隐私检查页面', () => {
      expect(isPrivacyFreePage('pages/settings/privacy-policy/index')).toBe(true)
    })

    it('用户协议页是免隐私检查页面', () => {
      expect(isPrivacyFreePage('pages/settings/user-agreement/index')).toBe(true)
    })

    it('首页不是免隐私检查页面', () => {
      expect(isPrivacyFreePage('pages/home/index')).toBe(false)
    })
  })

  describe('isProfileFreePage', () => {
    it('隐私页是免资料检查页面', () => {
      expect(isProfileFreePage('pages/settings/privacy/index')).toBe(true)
    })

    it('角色选择页是免资料检查页面', () => {
      expect(isProfileFreePage('pages/settings/role/index')).toBe(true)
    })

    it('资料编辑页是免资料检查页面', () => {
      expect(isProfileFreePage('pages/settings/profile/index')).toBe(true)
    })

    it('首页不是免资料检查页面', () => {
      expect(isProfileFreePage('pages/home/index')).toBe(false)
    })
  })
})
