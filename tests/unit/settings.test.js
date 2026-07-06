const {
  STORAGE_KEYS,
  writeStorage,
  clearMemoryStorage
} = require('../../services/core')

const {
  getStoredReminderSettings,
  saveReminderSettingsLocal,
  applyReminderSettings,
  mergeReminderSettings,
  ensureWeeklyReportTask,
  ensureUpcomingTasks,
  mergeLocalCompletedTasks
} = require('../../services/settings')

const {
  appendMedicationConfirmation
} = require('../../services/medication-confirm')

describe('services/settings', () => {
  beforeEach(() => {
    clearMemoryStorage()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('getStoredReminderSettings', () => {
    it('无设置时返回 null', () => {
      expect(getStoredReminderSettings()).toBeNull()
    })

    it('有设置时返回存储数据', () => {
      writeStorage(STORAGE_KEYS.reminderSettings, {
        reminders: [{ key: 'medicine', enabled: true }],
        quietMode: false
      })
      const result = getStoredReminderSettings()
      expect(result.reminders).toHaveLength(1)
      expect(result.quietMode).toBe(false)
    })
  })

  describe('saveReminderSettingsLocal', () => {
    it('保存提醒设置并添加 updatedAt', () => {
      const payload = {
        reminders: [{ key: 'medicine', enabled: false }],
        quietMode: true
      }
      const result = saveReminderSettingsLocal(payload)
      expect(result.reminders).toHaveLength(1)
      expect(result.quietMode).toBe(true)
      expect(result.updatedAt).toBeDefined()
    })

    it('保存后可通过 getStoredReminderSettings 读取', () => {
      saveReminderSettingsLocal({ quietMode: true })
      const stored = getStoredReminderSettings()
      expect(stored.quietMode).toBe(true)
    })
  })

  describe('applyReminderSettings', () => {
    it('无设置时不过滤任务', () => {
      const baseData = {
        tasks: [
          { route: 'medConfirm', title: '用药' },
          { route: 'recordBp', title: '血压' },
          { route: 'trend', title: '趋势' }
        ]
      }
      const result = applyReminderSettings(baseData)
      expect(result.tasks).toHaveLength(3)
    })

    it('关闭用药提醒后过滤用药任务', () => {
      saveReminderSettingsLocal({
        reminders: [
          { key: 'medicine', enabled: false },
          { key: 'measure', enabled: true },
          { key: 'weeklyReport', enabled: true }
        ]
      })
      const baseData = {
        tasks: [
          { route: 'medConfirm', title: '用药' },
          { route: 'recordBp', title: '血压' },
          { route: 'trend', title: '趋势' }
        ]
      }
      const result = applyReminderSettings(baseData)
      expect(result.tasks).toHaveLength(2)
      expect(result.tasks.every(t => t.route !== 'medConfirm')).toBe(true)
    })

    it('关闭测量提醒后过滤测量任务', () => {
      saveReminderSettingsLocal({
        reminders: [
          { key: 'medicine', enabled: true },
          { key: 'measure', enabled: false },
          { key: 'weeklyReport', enabled: true }
        ]
      })
      const baseData = {
        tasks: [
          { route: 'medConfirm', title: '用药' },
          { route: 'recordBp', title: '血压' },
          { route: 'recordBg', title: '血糖' },
          { route: 'trend', title: '趋势' }
        ]
      }
      const result = applyReminderSettings(baseData)
      expect(result.tasks).toHaveLength(2)
    })

    it('关闭周报提醒后过滤周报任务', () => {
      saveReminderSettingsLocal({
        reminders: [
          { key: 'medicine', enabled: true },
          { key: 'measure', enabled: true },
          { key: 'weeklyReport', enabled: false }
        ]
      })
      const baseData = {
        tasks: [
          { route: 'medConfirm', title: '用药' },
          { route: 'trend', title: '趋势' }
        ]
      }
      const result = applyReminderSettings(baseData)
      expect(result.tasks).toHaveLength(1)
    })
  })

  describe('mergeReminderSettings', () => {
    it('无本地设置时返回原始数据', () => {
      const baseData = {
        reminders: [{ key: 'medicine', enabled: true }],
        quietMode: false
      }
      const result = mergeReminderSettings(baseData)
      expect(result.reminders).toHaveLength(1)
    })

    it('有本地设置时合并', () => {
      saveReminderSettingsLocal({
        reminders: [{ key: 'medicine', enabled: false }],
        quietMode: true
      })
      const baseData = {
        reminders: [{ key: 'medicine', enabled: true, title: '用药提醒' }],
        quietMode: false
      }
      const result = mergeReminderSettings(baseData)
      expect(result.quietMode).toBe(true)
    })
  })

  describe('ensureWeeklyReportTask', () => {
    it('已有周报任务时不重复添加', () => {
      const baseData = {
        tasks: [
          { route: 'trend', title: '查看本周健康趋势' }
        ]
      }
      const result = ensureWeeklyReportTask(baseData)
      expect(result.tasks).toHaveLength(1)
    })

    it('无周报任务时自动添加', () => {
      const baseData = {
        tasks: [
          { route: 'medConfirm', title: '用药' }
        ]
      }
      const result = ensureWeeklyReportTask(baseData)
      expect(result.tasks).toHaveLength(2)
      expect(result.tasks[1].route).toBe('trend')
    })

    it('空任务列表时添加周报任务', () => {
      const baseData = { tasks: [] }
      const result = ensureWeeklyReportTask(baseData)
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0].id).toBe('task-weekly-report')
    })
  })

  describe('applyReminderSettings - 已完成分组', () => {
    it('已完成分组任务不受开关影响', () => {
      saveReminderSettingsLocal({
        reminders: [
          { key: 'medicine', enabled: false },
          { key: 'measure', enabled: false },
          { key: 'weeklyReport', enabled: false }
        ]
      })
      const baseData = {
        tasks: [
          { route: 'medConfirm', title: '用药', tab: 'today' },
          { route: 'recordBp', title: '血压', tab: 'today' },
          { route: 'trend', title: '趋势', tab: 'today' },
          { route: 'medList', title: '已服用药', tab: 'completed', logId: 'log-1' }
        ]
      }
      const result = applyReminderSettings(baseData)
      // today 分组全部被过滤
      expect(result.tasks.filter(t => t.tab === 'today')).toHaveLength(0)
      // completed 分组保留
      expect(result.tasks.filter(t => t.tab === 'completed')).toHaveLength(1)
    })
  })

  describe('ensureUpcomingTasks', () => {
    it('无今日用药任务时不生成即将到来任务', () => {
      const baseData = { tasks: [] }
      const result = ensureUpcomingTasks(baseData)
      expect(result.tasks).toHaveLength(0)
    })

    it('有今日用药任务时生成未来 3 天的即将到来任务', () => {
      const baseData = {
        tasks: [
          {
            id: 'task-med-plan-1-0',
            tab: 'today',
            time: '07:00',
            title: '07:00 用药提醒',
            meta: '降压药 1片',
            route: 'medConfirm',
            planId: 'plan-1',
            logId: 'log-plan-1-0700'
          }
        ]
      }
      const result = ensureUpcomingTasks(baseData)
      const upcomingTasks = result.tasks.filter(t => t.tab === 'upcoming')
      expect(upcomingTasks).toHaveLength(3)
      upcomingTasks.forEach(task => {
        expect(task.route).toBe('medConfirm')
        expect(task.planId).toBe('plan-1')
        expect(task.status).toBe('future')
        expect(task.statusText).toBe('待提醒')
      })
    })

    it('已有即将到来任务时不重复生成', () => {
      const baseData = {
        tasks: [
          {
            id: 'task-med-plan-1-0',
            tab: 'today',
            time: '07:00',
            title: '07:00 用药提醒',
            meta: '降压药 1片',
            route: 'medConfirm',
            planId: 'plan-1',
            logId: 'log-plan-1-0700'
          },
          {
            id: 'task-upcoming-existing',
            tab: 'upcoming',
            time: '07:00',
            title: '明天 07:00',
            meta: '降压药 1片',
            route: 'medConfirm',
            planId: 'plan-1',
            status: 'future',
            statusText: '待提醒'
          }
        ]
      }
      const result = ensureUpcomingTasks(baseData)
      const upcomingTasks = result.tasks.filter(t => t.tab === 'upcoming')
      expect(upcomingTasks).toHaveLength(1)
    })
  })

  describe('mergeLocalCompletedTasks', () => {
    it('无本地确认记录时不添加任务', () => {
      const baseData = { tasks: [] }
      const result = mergeLocalCompletedTasks(baseData)
      expect(result.tasks).toHaveLength(0)
    })

    it('有今日已确认记录时添加到已完成分组', () => {
      appendMedicationConfirmation({
        logId: 'log-plan-1-0700',
        time: '07:00',
        name: '降压药',
        dosage: '1片',
        status: 'taken',
        statusText: '已服',
        confirmDate: new Date().toISOString().slice(0, 10),
        actionAt: new Date().toISOString()
      })
      const baseData = { tasks: [] }
      const result = mergeLocalCompletedTasks(baseData)
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0].tab).toBe('completed')
      expect(result.tasks[0].status).toBe('taken')
      expect(result.tasks[0].statusText).toBe('已服')
    })

    it('跳过状态的确认记录也加入已完成分组', () => {
      appendMedicationConfirmation({
        logId: 'log-plan-1-2100',
        time: '21:00',
        name: '降压药',
        dosage: '1片',
        status: 'skipped',
        statusText: '已跳过',
        confirmDate: new Date().toISOString().slice(0, 10),
        actionAt: new Date().toISOString()
      })
      const baseData = { tasks: [] }
      const result = mergeLocalCompletedTasks(baseData)
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0].status).toBe('skipped')
    })

    it('不重复添加已存在的已完成任务', () => {
      appendMedicationConfirmation({
        logId: 'log-plan-1-0700',
        time: '07:00',
        name: '降压药',
        dosage: '1片',
        status: 'taken',
        statusText: '已服',
        confirmDate: new Date().toISOString().slice(0, 10),
        actionAt: new Date().toISOString()
      })
      const baseData = {
        tasks: [
          {
            id: 'task-done-existing',
            tab: 'completed',
            logId: 'log-plan-1-0700',
            status: 'taken',
            statusText: '已服'
          }
        ]
      }
      const result = mergeLocalCompletedTasks(baseData)
      expect(result.tasks).toHaveLength(1)
    })

    it('snoozed 状态不加入已完成分组', () => {
      appendMedicationConfirmation({
        logId: 'log-plan-1-0700',
        time: '07:00',
        name: '降压药',
        dosage: '1片',
        status: 'snoozed',
        statusText: '稍后提醒',
        confirmDate: new Date().toISOString().slice(0, 10),
        actionAt: new Date().toISOString()
      })
      const baseData = { tasks: [] }
      const result = mergeLocalCompletedTasks(baseData)
      expect(result.tasks).toHaveLength(0)
    })
  })
})
