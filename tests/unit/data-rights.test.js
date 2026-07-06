const {
  STORAGE_KEYS,
  readStorage,
  writeStorage,
  clearMemoryStorage
} = require('../../services/core')

const {
  getLocalDataSnapshot,
  toExportText,
  exportUserDataLocal,
  deleteUserDataLocal,
  clearUserAccountLocal
} = require('../../services/data-rights')

describe('services/data-rights', () => {
  beforeEach(() => {
    clearMemoryStorage()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('getLocalDataSnapshot', () => {
    it('返回所有本地存储数据的快照', () => {
      writeStorage(STORAGE_KEYS.records, [{ id: 'bp-1', type: 'bp' }])
      writeStorage(STORAGE_KEYS.profile, { name: '测试' })

      const snapshot = getLocalDataSnapshot()
      expect(snapshot.records).toHaveLength(1)
      expect(snapshot.profile.name).toBe('测试')
      expect(snapshot.medicationPlans).toEqual([])
      expect(snapshot.feedbacks).toEqual([])
    })

    it('无数据时返回空默认值', () => {
      const snapshot = getLocalDataSnapshot()
      expect(snapshot.records).toEqual([])
      expect(snapshot.profile).toBeNull()
      expect(snapshot.medicationPlans).toEqual([])
    })
  })

  describe('toExportText', () => {
    it('生成包含标题和 JSON 的导出文本', () => {
      const exportData = {
        version: '2026-04-27',
        generatedAt: '2026-04-27T08:00:00',
        format: 'json',
        data: { records: [{ id: '1' }], profile: null }
      }
      const text = toExportText(exportData)
      expect(text).toContain('康小记个人数据导出')
      expect(text).toContain('2026-04-27T08:00:00')
      expect(text).toContain('2026-04-27')
    })
  })

  describe('exportUserDataLocal', () => {
    it('生成完整的导出数据', () => {
      writeStorage(STORAGE_KEYS.records, [
        { id: 'bp-1', type: 'bp', value: '120/80' }
      ])

      const result = exportUserDataLocal()
      expect(result.version).toBe('2026-04-27')
      expect(result.format).toBe('json')
      expect(result.data.records).toHaveLength(1)
      expect(result.exportText).toContain('康小记个人数据导出')
    })

    it('无数据时导出空快照', () => {
      const result = exportUserDataLocal()
      expect(result.data.records).toEqual([])
      expect(result.data.profile).toBeNull()
    })
  })

  describe('deleteUserDataLocal', () => {
    it('scope=health 删除健康记录和确认记录', () => {
      writeStorage(STORAGE_KEYS.records, [{ id: '1' }])
      writeStorage(STORAGE_KEYS.medicationConfirmations, [{ id: 'c1' }])
      writeStorage(STORAGE_KEYS.medicationPlans, [{ id: 'p1' }])

      const result = deleteUserDataLocal({ scope: 'health' })
      expect(result.deleted).toBe(true)
      expect(readStorage(STORAGE_KEYS.records, [])).toEqual([])
      expect(readStorage(STORAGE_KEYS.medicationConfirmations, [])).toEqual([])
      expect(readStorage(STORAGE_KEYS.medicationPlans, [])).toHaveLength(1)
    })

    it('scope=medication 删除用药计划和确认记录', () => {
      writeStorage(STORAGE_KEYS.medicationPlans, [{ id: 'p1' }])
      writeStorage(STORAGE_KEYS.medicationConfirmations, [{ id: 'c1' }])
      writeStorage(STORAGE_KEYS.records, [{ id: '1' }])

      const result = deleteUserDataLocal({ scope: 'medication' })
      expect(result.deleted).toBe(true)
      expect(readStorage(STORAGE_KEYS.medicationPlans, [])).toEqual([])
      expect(readStorage(STORAGE_KEYS.medicationConfirmations, [])).toEqual([])
      expect(readStorage(STORAGE_KEYS.records, [])).toHaveLength(1)
    })

    it('默认 scope 为 health', () => {
      writeStorage(STORAGE_KEYS.records, [{ id: '1' }])
      const result = deleteUserDataLocal()
      expect(result.scope).toBe('health')
      expect(readStorage(STORAGE_KEYS.records, [])).toEqual([])
    })
  })

  describe('clearUserAccountLocal', () => {
    it('清除所有本地存储数据', () => {
      writeStorage(STORAGE_KEYS.records, [{ id: '1' }])
      writeStorage(STORAGE_KEYS.profile, { name: '测试' })
      writeStorage(STORAGE_KEYS.medicationPlans, [{ id: 'p1' }])
      writeStorage(STORAGE_KEYS.familyAuth, { status: 'active' })

      const result = clearUserAccountLocal()
      expect(result.cleared).toBe(true)
      expect(result.clearedAt).toBeDefined()
      expect(readStorage(STORAGE_KEYS.records, [])).toEqual([])
      expect(readStorage(STORAGE_KEYS.profile, null)).toBeNull()
    })
  })
})
