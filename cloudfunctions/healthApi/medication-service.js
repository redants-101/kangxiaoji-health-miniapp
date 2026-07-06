const DEFAULT_TIMES = [
  { value: '07:00', label: '早餐', enabled: false },
  { value: '12:00', label: '午餐', enabled: false },
  { value: '18:00', label: '晚餐', enabled: false },
  { value: '21:00', label: '睡前', enabled: false }
]

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

function getTodayDateValue() {
  // 云函数运行在 UTC 时区，需手动转换为北京时间
  const now = new Date()
  const chinaTime = new Date(now.getTime() + CHINA_TIME_OFFSET_MS)
  const y = chinaTime.getUTCFullYear()
  const m = String(chinaTime.getUTCMonth() + 1).padStart(2, '0')
  const d = String(chinaTime.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildLogId(planId, time) {
  return `log-${planId}-${String(time).replace(':', '')}`
}

function createMedicationService({
  db,
  _,
  collections,
  assertOwnedDocument,
  validateMedicationPlanPayload,
  validateMedicationConfirmationPayload,
  withPerfLog
}) {
  async function getMedListData(openId) {
    const todayStr = getTodayDateValue()
    const [{ data: plans = [] }, { data: confirmations = [] }] = await Promise.all([
      withPerfLog({
        routeType: 'key',
        route: 'medList',
        step: 'db.medicationPlans.list'
      }, () => db.collection(collections.medicationPlans)
        .where({ _openid: openId })
        .field({ _id: true, name: true, dosage: true, times: true, status: true, startDate: true, endDate: true, updatedAt: true })
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get()),
      withPerfLog({
        routeType: 'key',
        route: 'medList',
        step: 'db.medicationConfirmations.today'
      }, () => db.collection(collections.medicationConfirmations)
        .where({ _openid: openId, confirmDate: todayStr })
        .field({ logId: true, status: true, statusText: true, time: true, name: true, dosage: true, confirmDate: true, actionAt: true })
        .orderBy('actionAt', 'desc')
        .limit(50)
        .get())
    ])

    const confirmationMap = new Map()
    confirmations.forEach(c => {
      if (c.logId && !confirmationMap.has(c.logId)) confirmationMap.set(c.logId, c)
    })

    const todayCards = []
    const planListItems = []

    plans.forEach(plan => {
      const times = Array.isArray(plan.times) ? plan.times : []
      if (times.length === 0) return

      planListItems.push({
        id: plan._id,
        name: plan.name,
        schedule: `每天 ${times.join(', ')}`,
        status: plan.status || '启用'
      })

      if (plan.status === '已停用') return

      if (plan.startDate && plan.startDate !== '今天') {
        if (plan.startDate > todayStr) return
      }

      if (plan.endDate && plan.endDate < todayStr) return

      const logs = times.map((time, index) => {
        const logId = buildLogId(plan._id, time)
        const oldLogId = `log-${plan._id}-${index}`
        const confirmed = confirmationMap.get(logId) || confirmationMap.get(oldLogId)
        if (confirmed && (confirmed.status === 'taken' || confirmed.status === 'skipped')) {
          return {
            id: logId,
            time,
            status: confirmed.status,
            statusText: confirmed.status === 'taken' ? '已服' : '已跳过',
            statusType: confirmed.status === 'taken' ? 'done' : 'skipped',
            actionText: '撤销',
            action: 'revoke'
          }
        }
        if (confirmed && confirmed.status === 'snoozed') {
          return {
            id: logId,
            time,
            status: 'snoozed',
            statusText: '稍后提醒',
            statusType: 'pending',
            actionText: '确认',
            action: 'confirm'
          }
        }
        return {
          id: logId,
          time,
          status: 'pending',
          statusText: '待确认',
          statusType: 'pending',
          actionText: '确认',
          action: 'confirm'
        }
      })

      const allDone = logs.every(log => log.status === 'taken' || log.status === 'skipped')
      if (allDone) return

      const pendingIndex = logs.findIndex(log => log.status !== 'taken' && log.status !== 'skipped')

      todayCards.push({
        id: plan._id,
        name: plan.name,
        dosage: plan.dosage || '按医嘱',
        logs,
        pendingIndex,
        summary: pendingIndex >= 0
          ? `${logs[pendingIndex].time} 待确认`
          : '',
        progress: `${logs.filter(l => l.status === 'taken' || l.status === 'skipped').length}/${logs.length}`
      })
    })

    const confirmationList = confirmations
      .filter(c => c.status === 'taken' || c.status === 'skipped')
      .slice(0, 50)
      .map(c => ({
        id: c._id,
        logId: c.logId,
        name: c.name,
        dosage: c.dosage,
        time: c.time,
        status: c.status,
        statusText: c.statusText,
        confirmDate: c.confirmDate || '',
        actionAt: c.actionAt
      }))

    return {
      eyebrow: '用药管理',
      todayCards,
      plans: planListItems,
      confirmations: confirmationList
    }
  }

  async function getMedEditData(openId, planId) {
    if (!planId) {
      return {
        eyebrow: '添加用药',
        times: DEFAULT_TIMES,
        form: {
          name: '',
          dosage: '',
          subscribe: false,
          startDate: '今天',
          endDate: ''
        }
      }
    }

    const { data: plans = [] } = await withPerfLog({
      routeType: 'key',
      route: 'medEdit',
      step: 'db.medicationPlans.detail'
    }, () => db.collection(collections.medicationPlans)
      .where({ _openid: openId, _id: planId })
        .field({ _id: true, name: true, dosage: true, times: true, subscribe: true, startDate: true, endDate: true })
      .limit(1)
      .get())

    if (plans.length === 0) {
      return {
        eyebrow: '编辑用药',
        times: DEFAULT_TIMES,
        form: { name: '', dosage: '', subscribe: false, startDate: '今天', endDate: '' },
        loadWarning: '未找到该用药计划，请返回重试。'
      }
    }

    const plan = plans[0]
    const planTimes = Array.isArray(plan.times) ? plan.times : []
    const knownValues = DEFAULT_TIMES.map(item => item.value)
    const defaultItems = DEFAULT_TIMES.map(item => ({
      ...item,
      enabled: planTimes.includes(item.value)
    }))
    const extraItems = planTimes
      .filter(time => !knownValues.includes(time))
      .map(time => ({ value: time, enabled: true }))

    return {
      eyebrow: '编辑用药',
      planId: plan._id,
      form: {
        name: plan.name,
        dosage: plan.dosage,
        subscribe: plan.subscribe,
        startDate: plan.startDate,
        endDate: plan.endDate || ''
      },
      times: defaultItems.concat(extraItems)
    }
  }

  async function getMedConfirmData(openId, planId, targetLogId) {
    const todayStr = getTodayDateValue()
    const planWhere = planId
      ? { _openid: openId, _id: planId }
      : { _openid: openId }

    const [{ data: plans = [] }, { data: confirmations = [] }] = await Promise.all([
      withPerfLog({
        routeType: 'key',
        route: 'medConfirm',
        step: 'db.medicationPlans.latest'
      }, () => db.collection(collections.medicationPlans)
        .where(planWhere)
        .field({ _id: true, name: true, dosage: true, times: true, status: true, startDate: true, endDate: true, updatedAt: true })
        .orderBy('updatedAt', 'desc')
        .limit(planId ? 1 : 50)
        .get()),
      withPerfLog({
        routeType: 'key',
        route: 'medConfirm',
        step: 'db.medicationConfirmations.today'
      }, () => db.collection(collections.medicationConfirmations)
        .where({ _openid: openId, confirmDate: todayStr })
        .field({ logId: true, status: true, actionAt: true })
        .orderBy('actionAt', 'desc')
        .limit(50)
        .get())
    ])

    if (plans.length === 0) {
      return {
        eyebrow: '确认用药',
        medication: null
      }
    }

    const confirmedLogIds = new Set()
    confirmations.forEach(c => {
      if (c.logId && (c.status === 'taken' || c.status === 'skipped')) {
        confirmedLogIds.add(c.logId)
      }
    })

    // 如果指定了 targetLogId，优先精确匹配该 logId 对应的用药项
    if (targetLogId) {
      for (const plan of plans) {
        const times = Array.isArray(plan.times) ? plan.times : []
        for (let i = 0; i < times.length; i++) {
          const logId = buildLogId(plan._id, times[i])
          const oldLogId = `log-${plan._id}-${i}`
          if (logId === targetLogId || oldLogId === targetLogId) {
            return {
              eyebrow: '确认用药',
              medication: {
                logId,
                time: times[i],
                name: plan.name,
                dosage: plan.dosage || '按医嘱',
                planId: plan._id,
                planName: plan.name
              }
            }
          }
        }
      }
    }

    // 回退：返回该计划中第一个未确认项
    for (const plan of plans) {
      if (plan.status === '已停用') continue
      const times = Array.isArray(plan.times) ? plan.times : []
      if (times.length === 0) continue

      // 日期范围判断：开始日期在今天之后或结束日期已过 → 跳过
      if (plan.startDate && plan.startDate !== '今天' && plan.startDate > todayStr) continue
      if (plan.endDate && plan.endDate < todayStr) continue

      for (let i = 0; i < times.length; i++) {
        const logId = buildLogId(plan._id, times[i])
        const oldLogId = `log-${plan._id}-${i}`
        if (!confirmedLogIds.has(logId) && !confirmedLogIds.has(oldLogId)) {
          return {
            eyebrow: '确认用药',
            medication: {
              logId,
              time: times[i],
              name: plan.name,
              dosage: plan.dosage || '按医嘱',
              planId: plan._id,
              planName: plan.name
            }
          }
        }
      }
    }

    return {
      eyebrow: '确认用药',
      medication: null
    }
  }

  async function saveMedicationPlan(openId, payload) {
    const validated = validateMedicationPlanPayload(payload)
    const { id, name, dosage, times, subscribe, startDate, endDate } = validated
    const planData = {
      name,
      dosage: dosage || '',
      times: times || [],
      subscribe: !!subscribe,
      startDate: startDate || '今天',
      endDate: endDate || '',
      updatedAt: db.serverDate()
    }

    if (id) {
      const ownedPlan = await assertOwnedDocument(collections.medicationPlans, openId, id, '用药计划')
      return await withPerfLog({
        routeType: 'action',
        route: 'saveMedicationPlan',
        step: 'db.medicationPlans.update'
      }, () => db.collection(collections.medicationPlans).doc(ownedPlan._id).update({ data: planData }))
    }

    return await withPerfLog({
      routeType: 'action',
      route: 'saveMedicationPlan',
      step: 'db.medicationPlans.add'
    }, () => db.collection(collections.medicationPlans).add({
      data: {
        _openid: openId,
        ...planData,
        status: '启用',
        createdAt: db.serverDate()
      }
    }))
  }

  async function deleteMedicationPlan(openId, planId) {
    const ownedPlan = await assertOwnedDocument(collections.medicationPlans, openId, planId, '用药计划')
    return await withPerfLog({
      routeType: 'action',
      route: 'deleteMedicationPlan',
      step: 'db.medicationPlans.remove'
    }, () => db.collection(collections.medicationPlans).doc(ownedPlan._id).remove())
  }

  async function toggleMedicationPlanStatus(openId, planId, newStatus) {
    const ownedPlan = await assertOwnedDocument(collections.medicationPlans, openId, planId, '用药计划')
    return await withPerfLog({
      routeType: 'action',
      route: 'toggleMedicationPlanStatus',
      step: 'db.medicationPlans.updateStatus'
    }, () => db.collection(collections.medicationPlans).doc(ownedPlan._id).update({
      data: {
        status: newStatus,
        updatedAt: db.serverDate()
      }
    }))
  }

  async function confirmMedication(openId, payload) {
    const { logId, time, name, dosage, status, statusText } = validateMedicationConfirmationPayload(payload)
    const todayStr = getTodayDateValue()

    // 先查找同一 logId + confirmDate 是否已有记录，有则更新，无则新增（upsert 语义）
    const { data: existing } = await withPerfLog({
      routeType: 'action',
      route: 'confirmMedication',
      step: 'db.medicationConfirmations.lookup'
    }, () => db.collection(collections.medicationConfirmations)
      .where({ _openid: openId, logId, confirmDate: todayStr })
      .limit(1)
      .get())

    if (existing && existing.length > 0) {
      return await withPerfLog({
        routeType: 'action',
        route: 'confirmMedication',
        step: 'db.medicationConfirmations.update'
      }, () => db.collection(collections.medicationConfirmations).doc(existing[0]._id).update({
        data: {
          status,
          statusText,
          time,
          name,
          dosage,
          actionAt: db.serverDate()
        }
      }))
    }

    return await withPerfLog({
      routeType: 'action',
      route: 'confirmMedication',
      step: 'db.medicationConfirmations.add'
    }, () => db.collection(collections.medicationConfirmations).add({
      data: {
        _openid: openId,
        logId,
        time,
        name,
        dosage,
        status,
        statusText,
        confirmDate: todayStr,
        createdAt: db.serverDate(),
        actionAt: db.serverDate()
      }
    }))
  }

  async function revokeMedicationConfirmation(openId, logId) {
    const todayStr = getTodayDateValue()
    return await withPerfLog({
      routeType: 'action',
      route: 'revokeMedicationConfirmation',
      step: 'db.medicationConfirmations.remove'
    }, () => db.collection(collections.medicationConfirmations)
      .where({ _openid: openId, logId, confirmDate: todayStr })
      .remove())
  }

  async function getMedHistoryData(openId, { startDate, endDate, status } = {}) {
    const todayStr = getTodayDateValue()
    const start = startDate || (() => {
      // 云函数 UTC 时区，需加偏移后用 UTC 方法取北京日期
      const DAY_MS = 24 * 60 * 60 * 1000
      const d = new Date(Date.now() - 6 * DAY_MS)
      const chinaD = new Date(d.getTime() + CHINA_TIME_OFFSET_MS)
      return `${chinaD.getUTCFullYear()}-${String(chinaD.getUTCMonth() + 1).padStart(2, '0')}-${String(chinaD.getUTCDate()).padStart(2, '0')}`
    })()
    const end = endDate || todayStr

    const where = {
      _openid: openId,
      confirmDate: _.gte(start).and(_.lte(end)),
      status: _.in(['taken', 'skipped'])
    }
    if (status && ['taken', 'skipped'].includes(status)) {
      where.status = status
    }

    const { data: confirmations = [] } = await withPerfLog({
      routeType: 'key',
      route: 'medHistory',
      step: 'db.medicationConfirmations.range'
    }, () => db.collection(collections.medicationConfirmations)
      .where(where)
      .field({ logId: true, status: true, statusText: true, time: true, name: true, dosage: true, confirmDate: true, actionAt: true })
      .orderBy('confirmDate', 'desc')
      .orderBy('actionAt', 'desc')
      .limit(200)
      .get())

    // 按日期分组
    const dateGroupMap = new Map()
    let takenCount = 0
    let skippedCount = 0

    confirmations.forEach(c => {
      const date = c.confirmDate || ''
      if (!dateGroupMap.has(date)) {
        dateGroupMap.set(date, [])
      }
      dateGroupMap.get(date).push({
        id: c._id,
        logId: c.logId,
        name: c.name,
        dosage: c.dosage,
        time: c.time,
        status: c.status,
        statusText: c.statusText,
        confirmDate: date,
        actionAt: c.actionAt
      })
      if (c.status === 'taken') takenCount++
      if (c.status === 'skipped') skippedCount++
    })

    const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const dateGroups = []
    for (const [date, records] of dateGroupMap) {
      const parts = date.split('-')
      const d = parts.length === 3 ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) : new Date()
      const dateLabel = `${Number(parts[1])}月${Number(parts[2])}日 ${WEEK_DAYS[d.getDay()]}`
      dateGroups.push({ date, dateLabel, records })
    }

    return {
      eyebrow: '历史用药记录',
      startDate: start,
      endDate: end,
      dateGroups,
      summary: {
        totalRecords: confirmations.length,
        takenCount,
        skippedCount
      }
    }
  }

  return {
    confirmMedication,
    deleteMedicationPlan,
    getMedConfirmData,
    getMedEditData,
    getMedHistoryData,
    getMedListData,
    revokeMedicationConfirmation,
    saveMedicationPlan,
    toggleMedicationPlanStatus
  }
}

module.exports = {
  createMedicationService
}
