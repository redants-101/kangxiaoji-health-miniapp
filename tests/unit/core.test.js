const {
  STORAGE_KEYS,
  readStorage,
  writeStorage,
  writeStorageAndInvalidate,
  getRelatedCacheKeys,
  resolveMockData,
  resolveRemote,
  clearCloudReadCache,
  clearMemoryStorage,
  createRecordId,
  isTransientError,
  getRetryDelay
} = require('../../services/core')

describe('services/core', () => {
  beforeEach(() => {
    clearMemoryStorage()
    clearCloudReadCache()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('createRecordId', () => {
    it('生成带前缀的唯一 ID', () => {
      const id1 = createRecordId('bp')
      const id2 = createRecordId('bp')
      expect(id1).toMatch(/^bp-\d+/)
      expect(id1).not.toBe(id2)
    })

    it('不同前缀生成不同格式的 ID', () => {
      expect(createRecordId('bp')).toMatch(/^bp-/)
      expect(createRecordId('bg')).toMatch(/^bg-/)
      expect(createRecordId('plan')).toMatch(/^plan-/)
    })
  })

  describe('readStorage / writeStorage', () => {
    it('写入后可读取相同数据', () => {
      const key = 'test_key_v1'
      const value = { name: '测试', items: [1, 2, 3] }
      writeStorage(key, value)
      const result = readStorage(key, null)
      expect(result).toEqual(value)
    })

    it('读取不存在的键返回 fallback', () => {
      const result = readStorage('nonexistent_key', '默认值')
      expect(result).toBe('默认值')
    })

    it('写入后读取的是深拷贝，修改不影响原存储', () => {
      const key = 'test_deep_copy'
      const value = { nested: { count: 1 } }
      writeStorage(key, value)
      const result = readStorage(key, null)
      result.nested.count = 999
      const result2 = readStorage(key, null)
      expect(result2.nested.count).toBe(1)
    })

    it('写入数组后可正确读取', () => {
      const key = 'test_array'
      const value = [{ id: 1 }, { id: 2 }]
      writeStorage(key, value)
      const result = readStorage(key, [])
      expect(result).toEqual(value)
    })
  })

  describe('writeStorageAndInvalidate', () => {
    it('写入数据并清除相关缓存', () => {
      const key = STORAGE_KEYS.records
      const value = [{ id: 'bp-1', type: 'bp' }]
      const result = writeStorageAndInvalidate(key, value, getRelatedCacheKeys(key))
      expect(result).toEqual(value)
    })
  })

  describe('getRelatedCacheKeys', () => {
    it('records 变更影响 home/recordList/trend', () => {
      const keys = getRelatedCacheKeys(STORAGE_KEYS.records)
      expect(keys).toContain('home')
      expect(keys).toContain('recordList')
      expect(keys).toContain('trend')
    })

    it('profile 变更影响 home/me', () => {
      const keys = getRelatedCacheKeys(STORAGE_KEYS.profile)
      expect(keys).toContain('home')
      expect(keys).toContain('me')
    })

    it('未知键返回空数组', () => {
      const keys = getRelatedCacheKeys('unknown_key')
      expect(keys).toEqual([])
    })
  })

  describe('isTransientError', () => {
    it('识别超时错误', () => {
      expect(isTransientError({ errMsg: 'request:timeout' })).toBe(true)
    })

    it('识别网络错误', () => {
      expect(isTransientError({ errMsg: 'network error' })).toBe(true)
    })

    it('识别连接重置错误', () => {
      expect(isTransientError({ message: 'ECONNRESET' })).toBe(true)
    })

    it('非瞬态错误返回 false', () => {
      expect(isTransientError({ errMsg: 'invalid parameter' })).toBe(false)
    })

    it('空错误返回 false', () => {
      expect(isTransientError(null)).toBe(false)
      expect(isTransientError(undefined)).toBe(false)
    })
  })

  describe('getRetryDelay', () => {
    it('首次重试延迟在合理范围内', () => {
      const delay = getRetryDelay(1)
      expect(delay).toBeGreaterThanOrEqual(800)
      expect(delay).toBeLessThanOrEqual(1000)
    })

    it('延迟随重试次数指数增长', () => {
      const delay1 = getRetryDelay(1)
      const delay2 = getRetryDelay(2)
      expect(delay2).toBeGreaterThanOrEqual(delay1)
    })

    it('延迟不超过最大值', () => {
      const delay = getRetryDelay(10)
      expect(delay).toBeLessThanOrEqual(3500)
    })
  })

  describe('resolveMockData', () => {
    it('local 模式返回默认 mock 数据', async () => {
      const originalDataSource = require('../../utils/api-config').dataSource
      if (originalDataSource === 'local') {
        const data = await resolveMockData('home')
        expect(data).toBeDefined()
        expect(data.title).toBeDefined()
      }
    })

    it('未知 key 返回空对象', async () => {
      const originalDataSource = require('../../utils/api-config').dataSource
      if (originalDataSource === 'local') {
        const data = await resolveMockData('nonexistentKey')
        expect(data).toEqual({})
      }
    })
  })
})
