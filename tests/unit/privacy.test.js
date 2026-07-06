const {
  STORAGE_KEYS,
  readStorage,
  writeStorage,
  clearMemoryStorage
} = require('../../services/core')

const {
  getStoredPrivacySettings,
  updatePrivacySettingsLocal,
  mergePrivacySettings
} = require('../../services/privacy')

describe('services/privacy', () => {
  beforeEach(() => {
    clearMemoryStorage()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('getStoredPrivacySettings', () => {
    it('无设置时返回 null', () => {
      expect(getStoredPrivacySettings()).toBeNull()
    })

    it('有设置时返回存储数据', () => {
      writeStorage(STORAGE_KEYS.privacySettings, {
        agreed: true,
        agreedAt: '2026-04-27T08:00:00'
      })
      const result = getStoredPrivacySettings()
      expect(result.agreed).toBe(true)
      expect(result.agreedAt).toBe('2026-04-27T08:00:00')
    })
  })

  describe('updatePrivacySettingsLocal', () => {
    it('首次创建隐私设置', () => {
      const result = updatePrivacySettingsLocal({
        agreed: true,
        agreedAt: '2026-04-27T08:00:00'
      })
      expect(result.agreed).toBe(true)
      expect(result.agreedAt).toBe('2026-04-27T08:00:00')
      expect(result.updatedAt).toBeDefined()
    })

    it('部分更新不覆盖已有字段', () => {
      updatePrivacySettingsLocal({
        agreed: true,
        agreedAt: '2026-04-27T08:00:00',
        permissions: [{ key: 'healthData', enabled: true }]
      })
      const result = updatePrivacySettingsLocal({
        permissions: [{ key: 'healthData', enabled: false }]
      })
      expect(result.agreed).toBe(true)
      expect(result.agreedAt).toBe('2026-04-27T08:00:00')
      expect(result.permissions[0].enabled).toBe(false)
    })

    it('undefined 字段不覆盖已有值', () => {
      updatePrivacySettingsLocal({
        agreed: true,
        agreedAt: '2026-04-27T08:00:00'
      })
      const result = updatePrivacySettingsLocal({
        links: [{ route: 'privacyPolicy', title: '隐私政策' }]
      })
      expect(result.agreed).toBe(true)
      expect(result.links).toHaveLength(1)
    })
  })

  describe('mergePrivacySettings', () => {
    it('无本地设置时返回原始数据', () => {
      const baseData = {
        permissions: [{ key: 'healthData', enabled: true }],
        links: [],
        logs: []
      }
      const result = mergePrivacySettings(baseData)
      expect(result.permissions).toHaveLength(1)
    })

    it('有本地设置时合并', () => {
      updatePrivacySettingsLocal({
        agreed: true,
        permissions: [{ key: 'healthData', enabled: false }]
      })
      const baseData = {
        permissions: [{ key: 'healthData', enabled: true, title: '健康数据' }],
        links: [{ route: 'privacyPolicy', title: '隐私政策' }],
        logs: []
      }
      const result = mergePrivacySettings(baseData)
      expect(result.agreed).toBe(true)
    })
  })
})
