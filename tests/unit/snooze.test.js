const {
  STORAGE_KEYS,
  clearMemoryStorage,
  writeStorage
} = require('../../services/core')

const {
  DEFAULT_SNOOZE_MINUTES,
  cleanupExpiredSnoozeReminders,
  createSnoozeReminder,
  getDueSnoozeReminders,
  getPendingSnoozeReminders,
  getStoredSnoozeReminders,
  removeSnoozeReminder,
  removeSnoozeReminderByLogId,
  rescheduleSnoozeReminder
} = require('../../services/snooze')

describe('services/snooze', () => {
  beforeEach(() => {
    clearMemoryStorage()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('DEFAULT_SNOOZE_MINUTES', () => {
    it('默认延时为 15 分钟', () => {
      expect(DEFAULT_SNOOZE_MINUTES).toBe(15)
    })
  })

  describe('getStoredSnoozeReminders', () => {
    it('无记录时返回空数组', () => {
      expect(getStoredSnoozeReminders()).toEqual([])
    })
  })

  describe('createSnoozeReminder', () => {
    it('创建 snooze 任务并写入存储', () => {
      const reminder = createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      expect(reminder.id).toMatch(/^snooze-/)
      expect(reminder.logId).toBe('log-plan-1-0700')
      expect(reminder.planId).toBe('plan-1')
      expect(reminder.name).toBe('降压药')
      expect(reminder.dosage).toBe('1片')
      expect(reminder.time).toBe('07:00')
      expect(reminder.delayMinutes).toBe(15)
      expect(reminder.dueAt).toBeDefined()
      expect(reminder.status).toBe('pending')
      expect(reminder.confirmDate).toBeDefined()

      const list = getStoredSnoozeReminders()
      expect(list).toHaveLength(1)
    })

    it('使用自定义延时分钟数', () => {
      const reminder = createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00',
        delayMinutes: 30
      })
      expect(reminder.delayMinutes).toBe(30)
    })

    it('同 logId 只保留最新一条', () => {
      createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const list = getStoredSnoozeReminders()
      expect(list).toHaveLength(1)
    })

    it('不同 logId 保留多条', () => {
      createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      createSnoozeReminder({
        logId: 'log-plan-1-2100',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '21:00'
      })
      const list = getStoredSnoozeReminders()
      expect(list).toHaveLength(2)
    })

    it('dueAt 为未来时间', () => {
      const before = Date.now()
      const reminder = createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const dueAt = new Date(reminder.dueAt).getTime()
      expect(dueAt).toBeGreaterThan(before + 14 * 60 * 1000)
      expect(dueAt).toBeLessThan(before + 16 * 60 * 1000)
    })
  })

  describe('getPendingSnoozeReminders', () => {
    it('未到期任务返回', () => {
      createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const pending = getPendingSnoozeReminders()
      expect(pending).toHaveLength(1)
    })

    it('已到期任务不返回', () => {
      // 创建一个已过期的任务
      const list = [{
        id: 'snooze-expired',
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00',
        delayMinutes: 15,
        dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        confirmDate: '2026-04-27',
        status: 'pending'
      }]
      writeStorage(STORAGE_KEYS.snoozeReminders, list)
      const pending = getPendingSnoozeReminders()
      expect(pending).toHaveLength(0)
    })
  })

  describe('getDueSnoozeReminders', () => {
    it('未到期任务不返回', () => {
      createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const due = getDueSnoozeReminders()
      expect(due).toHaveLength(0)
    })

    it('已到期任务返回', () => {
      const list = [{
        id: 'snooze-due',
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00',
        delayMinutes: 15,
        dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        confirmDate: '2026-04-27',
        status: 'pending'
      }]
      writeStorage(STORAGE_KEYS.snoozeReminders, list)
      const due = getDueSnoozeReminders()
      expect(due).toHaveLength(1)
      expect(due[0].id).toBe('snooze-due')
    })

    it('按到期时间升序排列', () => {
      const now = Date.now()
      const list = [
        {
          id: 'snooze-later',
          logId: 'log-plan-1-2100',
          planId: 'plan-1',
          name: '降压药',
          dosage: '1片',
          time: '21:00',
          delayMinutes: 15,
          dueAt: new Date(now - 30 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          confirmDate: '2026-04-27',
          status: 'pending'
        },
        {
          id: 'snooze-earlier',
          logId: 'log-plan-1-0700',
          planId: 'plan-1',
          name: '降压药',
          dosage: '1片',
          time: '07:00',
          delayMinutes: 15,
          dueAt: new Date(now - 120 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          confirmDate: '2026-04-27',
          status: 'pending'
        }
      ]
      writeStorage(STORAGE_KEYS.snoozeReminders, list)
      const due = getDueSnoozeReminders()
      expect(due).toHaveLength(2)
      expect(due[0].id).toBe('snooze-earlier')
      expect(due[1].id).toBe('snooze-later')
    })
  })

  describe('removeSnoozeReminder', () => {
    it('按 ID 移除任务', () => {
      const reminder = createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const removed = removeSnoozeReminder(reminder.id)
      expect(removed).not.toBeNull()
      expect(removed.id).toBe(reminder.id)
      expect(getStoredSnoozeReminders()).toHaveLength(0)
    })

    it('不存在的 ID 返回 null', () => {
      const removed = removeSnoozeReminder('nonexistent')
      expect(removed).toBeNull()
    })
  })

  describe('removeSnoozeReminderByLogId', () => {
    it('按 logId 移除任务', () => {
      createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const removed = removeSnoozeReminderByLogId('log-plan-1-0700')
      expect(removed).not.toBeNull()
      expect(getStoredSnoozeReminders()).toHaveLength(0)
    })

    it('空 logId 返回 null', () => {
      expect(removeSnoozeReminderByLogId('')).toBeNull()
      expect(removeSnoozeReminderByLogId(null)).toBeNull()
    })

    it('不存在的 logId 返回 null', () => {
      expect(removeSnoozeReminderByLogId('nonexistent')).toBeNull()
    })
  })

  describe('rescheduleSnoozeReminder', () => {
    it('重新调度任务并更新 dueAt', () => {
      const reminder = createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const originalDueAt = reminder.dueAt
      const updated = rescheduleSnoozeReminder(reminder.id, 30)
      expect(updated).not.toBeNull()
      expect(updated.delayMinutes).toBe(30)
      expect(new Date(updated.dueAt).getTime()).toBeGreaterThan(new Date(originalDueAt).getTime())
    })

    it('使用默认延时 15 分钟', () => {
      const reminder = createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const updated = rescheduleSnoozeReminder(reminder.id)
      expect(updated.delayMinutes).toBe(15)
    })

    it('不存在的 ID 返回 null', () => {
      expect(rescheduleSnoozeReminder('nonexistent')).toBeNull()
    })
  })

  describe('cleanupExpiredSnoozeReminders', () => {
    it('清理超过 24 小时的过期任务', () => {
      const now = Date.now()
      const list = [
        {
          id: 'snooze-old',
          logId: 'log-plan-1-0700',
          planId: 'plan-1',
          name: '降压药',
          dosage: '1片',
          time: '07:00',
          delayMinutes: 15,
          dueAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          confirmDate: '2026-04-27',
          status: 'pending'
        },
        {
          id: 'snooze-recent',
          logId: 'log-plan-1-2100',
          planId: 'plan-1',
          name: '降压药',
          dosage: '1片',
          time: '21:00',
          delayMinutes: 15,
          dueAt: new Date(now - 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          confirmDate: '2026-04-27',
          status: 'pending'
        }
      ]
      writeStorage(STORAGE_KEYS.snoozeReminders, list)
      const removed = cleanupExpiredSnoozeReminders()
      expect(removed).toBe(1)
      const remaining = getStoredSnoozeReminders()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe('snooze-recent')
    })

    it('无过期任务时返回 0', () => {
      createSnoozeReminder({
        logId: 'log-plan-1-0700',
        planId: 'plan-1',
        name: '降压药',
        dosage: '1片',
        time: '07:00'
      })
      const removed = cleanupExpiredSnoozeReminders()
      expect(removed).toBe(0)
    })

    it('空列表时返回 0', () => {
      const removed = cleanupExpiredSnoozeReminders()
      expect(removed).toBe(0)
    })
  })
})
