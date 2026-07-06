const {
  STORAGE_KEYS,
  readStorage,
  writeStorage,
  clearMemoryStorage
} = require('../../services/core')

const {
  getStoredMedicationPlans,
  getStoredMedicationConfirmations,
  upsertMedicationPlan,
  appendMedicationConfirmation,
  saveMedicationPlanLocal,
  deleteMedicationPlanLocal,
  toggleMedicationPlanStatusLocal,
  confirmMedicationLocal,
  revokeMedicationConfirmationLocal,
  mapMedicationPlanToListItem,
  mergeListByTimestamp,
  mergeConfirmationsByLogId,
  parseMedTaskId,
  findNextPendingTime
} = require('../../services/medication')

describe('services/medication', () => {
  beforeEach(() => {
    clearMemoryStorage()
    if (typeof wx !== 'undefined' && wx.clearStorageSync) {
      wx.clearStorageSync()
    }
  })

  describe('getStoredMedicationPlans', () => {
    it('无计划时返回空数组', () => {
      expect(getStoredMedicationPlans()).toEqual([])
    })

    it('有计划时返回数组', () => {
      writeStorage(STORAGE_KEYS.medicationPlans, [
        { id: 'plan-1', name: '降压药' }
      ])
      expect(getStoredMedicationPlans()).toHaveLength(1)
    })
  })

  describe('getStoredMedicationConfirmations', () => {
    it('无确认记录时返回空数组', () => {
      expect(getStoredMedicationConfirmations()).toEqual([])
    })
  })

  describe('upsertMedicationPlan', () => {
    it('新增计划', () => {
      const plan = { id: 'plan-1', name: '降压药', times: ['07:00'] }
      upsertMedicationPlan(plan)
      expect(getStoredMedicationPlans()).toHaveLength(1)
      expect(getStoredMedicationPlans()[0].name).toBe('降压药')
    })

    it('更新已有计划', () => {
      upsertMedicationPlan({ id: 'plan-1', name: '降压药', times: ['07:00'] })
      upsertMedicationPlan({ id: 'plan-1', name: '降压药', times: ['07:00', '21:00'] })
      expect(getStoredMedicationPlans()).toHaveLength(1)
      expect(getStoredMedicationPlans()[0].times).toHaveLength(2)
    })
  })

  describe('appendMedicationConfirmation', () => {
    it('新增确认记录', () => {
      const confirmation = {
        logId: 'log-plan-1-0',
        status: 'taken',
        confirmDate: '2026-04-27'
      }
      appendMedicationConfirmation(confirmation)
      expect(getStoredMedicationConfirmations()).toHaveLength(1)
    })

    it('同 logId 同日期更新而非新增', () => {
      appendMedicationConfirmation({
        logId: 'log-plan-1-0',
        status: 'taken',
        confirmDate: '2026-04-27'
      })
      appendMedicationConfirmation({
        logId: 'log-plan-1-0',
        status: 'skipped',
        confirmDate: '2026-04-27'
      })
      expect(getStoredMedicationConfirmations()).toHaveLength(1)
      expect(getStoredMedicationConfirmations()[0].status).toBe('skipped')
    })

    it('不同日期新增记录', () => {
      appendMedicationConfirmation({
        logId: 'log-plan-1-0',
        status: 'taken',
        confirmDate: '2026-04-27'
      })
      appendMedicationConfirmation({
        logId: 'log-plan-1-0',
        status: 'taken',
        confirmDate: '2026-04-28'
      })
      expect(getStoredMedicationConfirmations()).toHaveLength(2)
    })
  })

  describe('saveMedicationPlanLocal', () => {
    it('创建新计划', () => {
      const plan = saveMedicationPlanLocal({
        name: '维生素D',
        dosage: '1粒',
        times: ['08:00'],
        subscribe: true
      })
      expect(plan.name).toBe('维生素D')
      expect(plan.id).toBeDefined()
      expect(plan.status).toBe('启用')
    })

    it('更新已有计划保持状态', () => {
      const existing = saveMedicationPlanLocal({
        name: '降压药',
        dosage: '1片',
        times: ['07:00']
      })
      const updated = saveMedicationPlanLocal({
        id: existing.id,
        name: '降压药',
        dosage: '2片',
        times: ['07:00', '21:00']
      })
      expect(updated.status).toBe('启用')
      expect(updated.times).toHaveLength(2)
    })
  })

  describe('deleteMedicationPlanLocal', () => {
    it('删除指定计划', () => {
      saveMedicationPlanLocal({ name: '降压药', dosage: '1片', times: ['07:00'] })
      const plans = getStoredMedicationPlans()
      const result = deleteMedicationPlanLocal(plans[0].id)
      expect(result.deleted).toBe(true)
      expect(getStoredMedicationPlans()).toHaveLength(0)
    })

    it('删除不存在的计划返回 deleted=true', () => {
      const result = deleteMedicationPlanLocal('nonexistent')
      expect(result.deleted).toBe(true)
    })
  })

  describe('toggleMedicationPlanStatusLocal', () => {
    it('启用→已停用', () => {
      const plan = saveMedicationPlanLocal({ name: '降压药', dosage: '1片', times: ['07:00'] })
      const result = toggleMedicationPlanStatusLocal(plan.id)
      expect(result.status).toBe('已停用')
    })

    it('已停用→启用', () => {
      const plan = saveMedicationPlanLocal({ name: '降压药', dosage: '1片', times: ['07:00'] })
      toggleMedicationPlanStatusLocal(plan.id)
      const result = toggleMedicationPlanStatusLocal(plan.id)
      expect(result.status).toBe('启用')
    })

    it('不存在的计划返回 null', () => {
      expect(toggleMedicationPlanStatusLocal('nonexistent')).toBeNull()
    })
  })

  describe('confirmMedicationLocal', () => {
    it('创建确认记录', () => {
      const result = confirmMedicationLocal({
        logId: 'log-plan-1-0',
        time: '07:00',
        name: '降压药',
        dosage: '1片',
        status: 'taken',
        statusText: '已服'
      })
      expect(result.logId).toBe('log-plan-1-0')
      expect(result.status).toBe('taken')
      expect(result.confirmDate).toBeDefined()
    })
  })

  describe('revokeMedicationConfirmationLocal', () => {
    it('撤销今日确认记录', () => {
      confirmMedicationLocal({
        logId: 'log-plan-1-0',
        time: '07:00',
        name: '降压药',
        dosage: '1片',
        status: 'taken',
        statusText: '已服'
      })
      const result = revokeMedicationConfirmationLocal('log-plan-1-0')
      expect(result).not.toBeNull()
      expect(result.logId).toBe('log-plan-1-0')
    })

    it('撤销不存在的记录返回 null', () => {
      expect(revokeMedicationConfirmationLocal('nonexistent')).toBeNull()
    })
  })

  describe('mapMedicationPlanToListItem', () => {
    it('映射计划到列表项', () => {
      const plan = { id: 'p1', name: '降压药', times: ['07:00', '21:00'], status: '启用' }
      const item = mapMedicationPlanToListItem(plan)
      expect(item.id).toBe('p1')
      expect(item.name).toBe('降压药')
      expect(item.schedule).toContain('07:00')
      expect(item.schedule).toContain('21:00')
      expect(item.status).toBe('启用')
    })
  })

  describe('mergeListByTimestamp', () => {
    it('合并本地和远程记录，取较新者', () => {
      const local = [
        { id: '1', name: '降压药', updatedAt: '2026-04-28' }
      ]
      const remote = [
        { id: '1', name: '降压药(更新)', updatedAt: '2026-04-27' },
        { id: '2', name: '维生素D', updatedAt: '2026-04-27' }
      ]
      const result = mergeListByTimestamp(local, remote)
      expect(result).toHaveLength(2)
      expect(result.find(r => r.id === '1').name).toBe('降压药')
      expect(result.find(r => r.id === '2').name).toBe('维生素D')
    })

    it('空数组合并', () => {
      expect(mergeListByTimestamp([], [])).toEqual([])
      expect(mergeListByTimestamp([{ id: '1' }], [])).toHaveLength(1)
      expect(mergeListByTimestamp([], [{ id: '1' }])).toHaveLength(1)
    })
  })

  describe('mergeConfirmationsByLogId', () => {
    it('按 logId 合并，取较新者', () => {
      const local = [
        { logId: 'log-1', actionAt: '2026-04-28', status: 'taken' }
      ]
      const remote = [
        { logId: 'log-1', actionAt: '2026-04-27', status: 'skipped' },
        { logId: 'log-2', actionAt: '2026-04-27', status: 'taken' }
      ]
      const result = mergeConfirmationsByLogId(local, remote)
      expect(result).toHaveLength(2)
      expect(result.find(r => r.logId === 'log-1').status).toBe('taken')
    })
  })

  describe('parseMedTaskId', () => {
    it('解析标准格式 task-med-{planId}-{index}', () => {
      const result = parseMedTaskId('task-med-plan-1-0')
      expect(result.planId).toBe('plan-1')
      expect(result.index).toBe(0)
    })

    it('解析含多段横线的 planId', () => {
      const result = parseMedTaskId('task-med-plan-abc-123-2')
      expect(result.planId).toBe('plan-abc-123')
      expect(result.index).toBe(2)
    })

    it('非 task-med 前缀返回 null', () => {
      expect(parseMedTaskId('task-bp-1')).toBeNull()
      expect(parseMedTaskId('')).toBeNull()
      expect(parseMedTaskId(null)).toBeNull()
    })
  })

  describe('findNextPendingTime', () => {
    it('找到下一个待确认时间点', () => {
      const plan = {
        id: 'plan-1',
        times: ['07:00', '21:00'],
        status: '启用',
        startDate: '今天'
      }
      const confirmationMap = new Map()
      const todayStr = '2026-04-27'
      const result = findNextPendingTime(plan, confirmationMap, todayStr)
      expect(result).not.toBeNull()
      expect(result.time).toBe('07:00')
      // logId 使用时间格式（buildLogId）：log-{planId}-{HHmm}
      expect(result.logId).toBe('log-plan-1-0700')
    })

    it('已停用计划返回 null', () => {
      const plan = {
        id: 'plan-1',
        times: ['07:00'],
        status: '已停用'
      }
      const result = findNextPendingTime(plan, new Map(), '2026-04-27')
      expect(result).toBeNull()
    })

    it('全部已确认返回 null', () => {
      const plan = {
        id: 'plan-1',
        times: ['07:00'],
        status: '启用',
        startDate: '今天'
      }
      const confirmationMap = new Map([
        ['log-plan-1-0', { status: 'taken' }]
      ])
      const result = findNextPendingTime(plan, confirmationMap, '2026-04-27')
      expect(result).toBeNull()
    })
  })
})
