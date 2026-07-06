const {
  deepMerge,
  withMockPageData,
  mergeArrayItemDefaults,
  clone
} = require('../../services/page-data')

describe('services/page-data', () => {
  describe('clone', () => {
    it('深拷贝对象', () => {
      const obj = { a: 1, b: { c: 2 } }
      const cloned = clone(obj)
      expect(cloned).toEqual(obj)
      cloned.b.c = 999
      expect(obj.b.c).toBe(2)
    })

    it('深拷贝数组', () => {
      const arr = [1, [2, 3]]
      const cloned = clone(arr)
      expect(cloned).toEqual(arr)
      cloned[1][0] = 999
      expect(arr[1][0]).toBe(2)
    })

    it('undefined 返回 undefined', () => {
      expect(clone(undefined)).toBeUndefined()
    })

    it('null 返回 null', () => {
      expect(clone(null)).toBeNull()
    })
  })

  describe('deepMerge', () => {
    it('基础对象合并', () => {
      const base = { a: 1, b: 2 }
      const override = { b: 3, c: 4 }
      const result = deepMerge(base, override)
      expect(result).toEqual({ a: 1, b: 3, c: 4 })
    })

    it('嵌套对象递归合并', () => {
      const base = { nested: { a: 1, b: 2 } }
      const override = { nested: { b: 3, c: 4 } }
      const result = deepMerge(base, override)
      expect(result.nested).toEqual({ a: 1, b: 3, c: 4 })
    })

    it('override 为数组时直接替换', () => {
      const base = { items: [1, 2, 3] }
      const override = { items: [4, 5] }
      const result = deepMerge(base, override)
      expect(result.items).toEqual([4, 5])
    })

    it('override 为 undefined 时返回 base 的克隆', () => {
      const base = { a: 1 }
      const result = deepMerge(base, undefined)
      expect(result).toEqual({ a: 1 })
    })

    it('不修改原始对象', () => {
      const base = { a: { b: 1 } }
      const override = { a: { c: 2 } }
      deepMerge(base, override)
      expect(base).toEqual({ a: { b: 1 } })
    })

    it('override 为原始值时直接替换', () => {
      const base = { value: 'old' }
      const override = { value: 'new' }
      const result = deepMerge(base, override)
      expect(result.value).toBe('new')
    })
  })

  describe('withMockPageData', () => {
    it('无 transform 函数时执行 deepMerge', () => {
      const result = withMockPageData('home', { title: '自定义标题' })
      expect(result.title).toBe('自定义标题')
    })

    it('有 transform 函数时执行自定义合并', () => {
      const result = withMockPageData('home', { extra: 'data' }, (base, remote) => {
        return { ...base, ...remote, merged: true }
      })
      expect(result.merged).toBe(true)
      expect(result.extra).toBe('data')
    })

    it('未知 key 返回空对象或默认数据', () => {
      const result = withMockPageData('nonexistentKey', {})
      expect(result).toBeDefined()
    })
  })

  describe('mergeArrayItemDefaults', () => {
    it('按 identityKey 合并默认值', () => {
      const baseItems = [
        { key: 'a', label: '默认A', enabled: true },
        { key: 'b', label: '默认B', enabled: true }
      ]
      const overrideItems = [
        { key: 'a', enabled: false },
        { key: 'c', label: '新增C' }
      ]
      const result = mergeArrayItemDefaults(baseItems, overrideItems, 'key')
      expect(result).toHaveLength(2)
      expect(result[0].label).toBe('默认A')
      expect(result[0].enabled).toBe(false)
      expect(result[1].label).toBe('新增C')
    })

    it('override 为非数组时返回 base 克隆', () => {
      const baseItems = [{ key: 'a', label: 'A' }]
      const result = mergeArrayItemDefaults(baseItems, null, 'key')
      expect(result).toEqual([{ key: 'a', label: 'A' }])
    })

    it('base 为空数组时返回 override 克隆', () => {
      const overrideItems = [{ key: 'a', label: 'A' }]
      const result = mergeArrayItemDefaults([], overrideItems, 'key')
      expect(result).toEqual([{ key: 'a', label: 'A' }])
    })
  })
})
