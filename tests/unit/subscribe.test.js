const {
  STORAGE_KEYS,
  clearMemoryStorage,
  writeStorage
} = require('../../services/core')

const {
  SUBSCRIBE_TEMPLATES,
  DEV_MODE,
  addSubscriptionQuota,
  addSubscriptionQuotaBatch,
  buildSubscriptionDisplay,
  consumeSubscriptionQuota,
  getStoredSubscriptionStatus,
  getSubscriptionQuota,
  getRemainingQuota,
  isAllSubscribed,
  isAllTemplatesConfigured,
  isPlaceholderTemplateId,
  isSubscribed,
  isTemplateConfigured,
  saveSubscriptionStatusLocal,
  updateSubscriptionRecord,
  requestSubscription
} = require('../../utils/subscribe')

describe('utils/subscribe', () => {
  beforeEach(() => {
    clearMemoryStorage()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('SUBSCRIBE_TEMPLATES', () => {
    it('包含三类提醒模板', () => {
      expect(SUBSCRIBE_TEMPLATES.medicine).toBeDefined()
      expect(SUBSCRIBE_TEMPLATES.measure).toBeDefined()
      expect(SUBSCRIBE_TEMPLATES.weeklyReport).toBeDefined()
    })
  })

  describe('isPlaceholderTemplateId', () => {
    it('占位符返回 true', () => {
      expect(isPlaceholderTemplateId('tmpl_medicine_reminder_placeholder')).toBe(true)
      expect(isPlaceholderTemplateId('tmpl_measure_reminder_placeholder')).toBe(true)
    })

    it('真实 ID 返回 false', () => {
      expect(isPlaceholderTemplateId('_2EGmFqX1234567890abcdefghijklm')).toBe(false)
    })

    it('空值或非字符串返回 true', () => {
      expect(isPlaceholderTemplateId('')).toBe(true)
      expect(isPlaceholderTemplateId(null)).toBe(true)
      expect(isPlaceholderTemplateId(undefined)).toBe(true)
      expect(isPlaceholderTemplateId(123)).toBe(true)
    })
  })

  describe('isTemplateConfigured', () => {
    it('已配置的模板返回 true', () => {
      expect(isTemplateConfigured('medicine')).toBe(true)
      expect(isTemplateConfigured('measure')).toBe(true)
      expect(isTemplateConfigured('weeklyReport')).toBe(true)
    })
  })

  describe('isAllTemplatesConfigured', () => {
    it('所有模板都已配置时返回 true', () => {
      expect(isAllTemplatesConfigured()).toBe(true)
    })
  })

  describe('getStoredSubscriptionStatus', () => {
    it('无记录时返回空对象', () => {
      expect(getStoredSubscriptionStatus()).toEqual({})
    })

    it('有记录时返回存储数据', () => {
      writeStorage(STORAGE_KEYS.subscriptionStatus, {
        medicine: { status: 'accept', updatedAt: '2026-04-27T00:00:00.000Z' }
      })
      const result = getStoredSubscriptionStatus()
      expect(result.medicine.status).toBe('accept')
    })
  })

  describe('saveSubscriptionStatusLocal', () => {
    it('保存授权状态并添加 updatedAt', () => {
      const result = saveSubscriptionStatusLocal({
        medicine: { status: 'accept' }
      })
      expect(result.medicine.status).toBe('accept')
      expect(result.updatedAt).toBeDefined()
    })
  })

  describe('updateSubscriptionRecord', () => {
    it('更新指定模板的授权状态', () => {
      updateSubscriptionRecord('medicine', 'accept')
      const status = getStoredSubscriptionStatus()
      expect(status.medicine.status).toBe('accept')
      expect(status.medicine.updatedAt).toBeDefined()
    })

    it('无效模板 key 不更新', () => {
      updateSubscriptionRecord('invalid_key', 'accept')
      const status = getStoredSubscriptionStatus()
      expect(status.invalid_key).toBeUndefined()
    })

    it('多次更新保留所有模板状态', () => {
      updateSubscriptionRecord('medicine', 'accept')
      updateSubscriptionRecord('measure', 'reject')
      updateSubscriptionRecord('weeklyReport', 'accept')
      const status = getStoredSubscriptionStatus()
      expect(status.medicine.status).toBe('accept')
      expect(status.measure.status).toBe('reject')
      expect(status.weeklyReport.status).toBe('accept')
    })
  })

  describe('isSubscribed', () => {
    it('未授权时返回 false', () => {
      expect(isSubscribed('medicine')).toBe(false)
    })

    it('已授权时返回 true', () => {
      updateSubscriptionRecord('medicine', 'accept')
      expect(isSubscribed('medicine')).toBe(true)
    })

    it('被拒绝时返回 false', () => {
      updateSubscriptionRecord('medicine', 'reject')
      expect(isSubscribed('medicine')).toBe(false)
    })
  })

  describe('isAllSubscribed', () => {
    it('全部未授权时返回 false', () => {
      expect(isAllSubscribed()).toBe(false)
    })

    it('部分授权时返回 false', () => {
      updateSubscriptionRecord('medicine', 'accept')
      expect(isAllSubscribed()).toBe(false)
    })

    it('全部授权时返回 true', () => {
      updateSubscriptionRecord('medicine', 'accept')
      updateSubscriptionRecord('measure', 'accept')
      updateSubscriptionRecord('weeklyReport', 'accept')
      expect(isAllSubscribed()).toBe(true)
    })
  })

  describe('buildSubscriptionDisplay', () => {
    it('无授权时返回未开启状态', () => {
      const display = buildSubscriptionDisplay()
      expect(display.status).toBe('未开启')
      expect(display.meta).toContain('提醒中心')
    })

    it('全部授权时返回已全部开启', () => {
      updateSubscriptionRecord('medicine', 'accept')
      updateSubscriptionRecord('measure', 'accept')
      updateSubscriptionRecord('weeklyReport', 'accept')
      const display = buildSubscriptionDisplay()
      expect(display.status).toBe('已全部开启')
    })

    it('部分授权时返回部分开启', () => {
      updateSubscriptionRecord('medicine', 'accept')
      const display = buildSubscriptionDisplay()
      expect(display.status).toBe('部分开启')
      expect(display.meta).toContain('1/3')
    })

    it('有拒绝记录时返回未全部开启', () => {
      updateSubscriptionRecord('medicine', 'reject')
      const display = buildSubscriptionDisplay()
      expect(display.status).toBe('未全部开启')
    })
  })

  describe('requestSubscription', () => {
    it('无效模板 key 时返回 no-valid-template', async () => {
      const result = await requestSubscription(['invalid_key'], { silent: true })
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('no-valid-template')
    })

    it('空模板数组时返回 no-valid-template', async () => {
      const result = await requestSubscription([], { silent: true })
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('no-valid-template')
    })

    it('所有模板都已配置时不再返回 template-not-configured', async () => {
      const result = await requestSubscription(['medicine', 'measure', 'weeklyReport'], { silent: true })
      expect(result.reason).not.toBe('template-not-configured')
    })

    it('DEV_MODE 为布尔值', () => {
      expect(typeof DEV_MODE).toBe('boolean')
    })
  })

  describe('订阅次数管理', () => {
    it('getSubscriptionQuota 无记录时返回空对象', () => {
      expect(getSubscriptionQuota()).toEqual({})
    })

    it('addSubscriptionQuota 增加指定模板次数', () => {
      addSubscriptionQuota('medicine')
      expect(getSubscriptionQuota().medicine).toBe(1)
      addSubscriptionQuota('medicine')
      expect(getSubscriptionQuota().medicine).toBe(2)
    })

    it('addSubscriptionQuota 无效模板不增加', () => {
      addSubscriptionQuota('invalid_key')
      expect(getSubscriptionQuota().invalid_key).toBeUndefined()
    })

    it('addSubscriptionQuotaBatch 批量增加 accept 的模板次数', () => {
      addSubscriptionQuotaBatch(
        ['medicine', 'measure', 'weeklyReport'],
        { medicine: 'accept', measure: 'reject', weeklyReport: 'accept' }
      )
      const quota = getSubscriptionQuota()
      expect(quota.medicine).toBe(1)
      expect(quota.measure).toBeUndefined()
      expect(quota.weeklyReport).toBe(1)
    })

    it('consumeSubscriptionQuota 消耗次数成功', () => {
      addSubscriptionQuota('medicine', 3)
      expect(consumeSubscriptionQuota('medicine')).toBe(true)
      expect(getRemainingQuota('medicine')).toBe(2)
    })

    it('consumeSubscriptionQuota 次数不足时返回 false', () => {
      expect(consumeSubscriptionQuota('medicine')).toBe(false)
      expect(getRemainingQuota('medicine')).toBe(0)
    })

    it('consumeSubscriptionQuota 无效模板返回 false', () => {
      expect(consumeSubscriptionQuota('invalid_key')).toBe(false)
    })

    it('getRemainingQuota 返回剩余次数', () => {
      addSubscriptionQuota('medicine', 5)
      expect(getRemainingQuota('medicine')).toBe(5)
      consumeSubscriptionQuota('medicine')
      expect(getRemainingQuota('medicine')).toBe(4)
    })

    it('getRemainingQuota 无记录时返回 0', () => {
      expect(getRemainingQuota('medicine')).toBe(0)
    })
  })
})
