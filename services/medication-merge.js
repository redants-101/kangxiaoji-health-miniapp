const { STORAGE_KEYS, readStorage, resolveMockData } = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')
const { getTodayDateValue, normalizeDateValue } = require('../utils/date-helper')
// 延迟 require 避免 medication-merge ↔ medication-plan 残留循环依赖问题
let _medicationPlan = null
function getMedicationPlan() {
  if (!_medicationPlan) _medicationPlan = require('./medication-plan')
  return _medicationPlan
}
const { getStoredMedicationConfirmations, getLatestMedicationConfirmation, mergeConfirmationsByLogId, mapConfirmationToListItem } = require('./medication-confirm')

/**
 * 根据用药计划 ID 和时间生成日志 ID。
 * 本文件内联定义，避免 medication-merge ↔ medication-plan 循环依赖。
 */
function buildLogId(planId, time) {
  return `log-${planId}-${String(time).replace(':', '')}`
}

function buildMedTask(planId, nextPending, plan, extra) {
  const idx = plan.times.indexOf(nextPending.time)
  const base = {
    id: `task-med-${planId}-${idx}`,
    planId,
    logId: nextPending.logId,
    title: nextPending.status === 'snoozed' ? `${nextPending.time} 稍后提醒` : `${nextPending.time} 用药提醒`,
    meta: `${plan.name} ${plan.dosage || '按医嘱'}`,
    actionText: '确认',
    route: 'medConfirm'
  }
  return extra ? { ...base, ...extra } : base
}

function updateTasksWithConfirmations(tasks, confirmationMap, planMap, todayStr, extra) {
  const updatedTasks = []
  tasks.forEach(task => {
    if (extra && task.route !== 'medConfirm' && task.route !== 'medList') {
      updatedTasks.push(task); return
    }
    if (!extra && (!task.id || !task.id.startsWith('task-med-'))) {
      updatedTasks.push(task); return
    }
    // 优先使用 task 自带的 logId（云函数已用 buildLogId 生成）
    if (task.logId) {
      const confirmed = confirmationMap.get(task.logId)
      if (confirmed && (confirmed.status === 'taken' || confirmed.status === 'skipped')) {
        // 已确认的任务：尝试推算同计划下一个待确认时间
        const parsed = parseMedTaskId(task.id)
        const plan = parsed ? planMap.get(parsed.planId) : null
        const nextPending = plan ? findNextPendingTime(plan, confirmationMap, todayStr) : null
        if (!nextPending) return // 该计划所有时间点都已确认，丢弃任务
        updatedTasks.push(buildMedTask(parsed ? parsed.planId : '', nextPending, plan, extra))
        return
      }
    }
    // 回退：用 task ID 解析 planId + index（兼容旧格式 logId）
    const parsed = parseMedTaskId(task.id)
    if (!parsed) { updatedTasks.push(task); return }
    const { planId, index } = parsed
    const plan = planMap.get(planId)
    const newLogId = plan && plan.times && plan.times[index] ? buildLogId(planId, plan.times[index]) : null
    const oldLogId = `log-${planId}-${index}`
    const confirmed = (newLogId && confirmationMap.get(newLogId)) || confirmationMap.get(oldLogId)
    if (confirmed && (confirmed.status === 'taken' || confirmed.status === 'skipped')) {
      // 已确认的任务：尝试推算同计划下一个待确认时间
      const nextPending = plan ? findNextPendingTime(plan, confirmationMap, todayStr) : null
      if (!nextPending) return // 该计划所有时间点都已确认，丢弃任务
      updatedTasks.push(buildMedTask(planId, nextPending, plan, extra))
      return
    }
    updatedTasks.push(task)
  })
  return updatedTasks
}

function patchRemoteCardLogs(card, confirmationMap) {
  if (!card.logs) return card
  const logs = card.logs.map(log => {
    const confirmed = confirmationMap.get(log.id)
    if (!confirmed) return log
    if (confirmed.status === 'taken' || confirmed.status === 'skipped') {
      return { ...log, status: confirmed.status, statusText: confirmed.status === 'taken' ? '已服' : '已跳过', statusType: confirmed.status === 'taken' ? 'done' : 'skipped', actionText: '撤销', action: 'revoke' }
    }
    if (confirmed.status === 'snoozed') {
      return { ...log, status: 'snoozed', statusText: '稍后提醒', statusType: 'pending', actionText: '确认', action: 'confirm' }
    }
    return log
  })
  const pendingIndex = logs.findIndex(l => l.status !== 'taken' && l.status !== 'skipped')
  return { ...card, logs, pendingIndex, summary: pendingIndex >= 0 && logs[pendingIndex] ? `${logs[pendingIndex].time} 待确认` : '', progress: `${logs.filter(l => l.status === 'taken' || l.status === 'skipped').length}/${logs.length}` }
}

function buildPlanLogEntry(time, index, planId, confirmationMap) {
  const logId = buildLogId(planId, time)
  const oldLogId = `log-${planId}-${index}`
  const confirmed = confirmationMap.get(logId) || confirmationMap.get(oldLogId)
  if (confirmed && (confirmed.status === 'taken' || confirmed.status === 'skipped')) {
    return { id: logId, time, status: confirmed.status, statusText: confirmed.status === 'taken' ? '已服' : '已跳过', statusType: confirmed.status === 'taken' ? 'done' : 'skipped', actionText: '撤销', action: 'revoke' }
  }
  if (confirmed && confirmed.status === 'snoozed') {
    return { id: logId, time, status: 'snoozed', statusText: '稍后提醒', statusType: 'pending', actionText: '确认', action: 'confirm' }
  }
  return { id: logId, time, status: 'pending', statusText: '待确认', statusType: 'pending', actionText: '确认', action: 'confirm' }
}

function mergeListByTimestamp(localItems, remoteItems) {
  const itemMap = new Map()
  remoteItems.forEach((item) => {
    if (!item || !item.id) return
    itemMap.set(item.id, item)
  })
  localItems.forEach((item) => {
    if (!item || !item.id) return
    const existing = itemMap.get(item.id)
    if (!existing) {
      itemMap.set(item.id, item)
      return
    }
    const localTs = item.updatedAt || item.actionAt || ''
    const remoteTs = existing.updatedAt || existing.actionAt || ''
    if (localTs >= remoteTs) {
      itemMap.set(item.id, item)
    }
  })
  return Array.from(itemMap.values())
}

function mergeMedicationPlans(baseData) {
  const storedPlans = getMedicationPlan().getStoredMedicationPlans()
  const storedConfirmations = getStoredMedicationConfirmations()
  const todayStr = getTodayDateValue()

  // 构建 confirmationMap：先加入远程确认记录（优先级低），再加入本地确认记录（优先级高，覆盖远程）
  // 这样当本地确认记录为空时（如用户清空数据），仍能从远程确认记录获取正确的确认状态
  const confirmationMap = new Map()
  const remoteConfirmationRaw = Array.isArray(baseData.confirmations) ? baseData.confirmations : []
  remoteConfirmationRaw.forEach(c => {
    if (c.logId && !confirmationMap.has(c.logId)) confirmationMap.set(c.logId, c)
  })
  storedConfirmations.forEach(c => {
    if (c.logId && c.confirmDate === todayStr) confirmationMap.set(c.logId, c)
  })

  if (!storedPlans.length) {
    const remoteCards = Array.isArray(baseData.todayCards) ? baseData.todayCards : []
    const remoteConfirmations = Array.isArray(baseData.confirmations) ? baseData.confirmations : []
    const localConfirmationList = storedConfirmations
      .filter(c => (c.status === 'taken' || c.status === 'skipped') && c.confirmDate === todayStr)
      .slice(0, 50)
      .map(mapConfirmationToListItem)

    let patchedCards = remoteCards
    if (remoteCards.length && confirmationMap.size) {
      patchedCards = remoteCards.map(card => patchRemoteCardLogs(card, confirmationMap))
    }
    return {
      ...baseData,
      todayCards: patchedCards,
      confirmations: mergeConfirmationsByLogId(localConfirmationList, remoteConfirmations)
    }
  }

  const remotePlans = Array.isArray(baseData.plans) ? baseData.plans : []
  const remoteCards = Array.isArray(baseData.todayCards) ? baseData.todayCards : []

  // 构建远程卡片的 logId → log 映射，用于本地卡片回退匹配（双重保障）
  const remoteLogMap = new Map()
  remoteCards.forEach(card => {
    if (!card.logs) return
    card.logs.forEach(log => {
      if (log.id) remoteLogMap.set(log.id, log)
    })
  })

  const localCards = []
  const localPlans = []

  storedPlans.forEach(plan => {
    const times = Array.isArray(plan.times) ? plan.times : []
    if (times.length === 0) return

    localPlans.push(getMedicationPlan().mapMedicationPlanToListItem(plan))

    if (plan.status === '已停用') return

    if (plan.startDate && plan.startDate !== '今天') {
      const startDate = normalizeDateValue(plan.startDate)
      if (startDate > todayStr) return
    }

    if (plan.endDate && plan.endDate < todayStr) return

    const logs = times.map((time, index) => {
      // 优先用本地确认记录匹配
      let logEntry = buildPlanLogEntry(time, index, plan.id, confirmationMap)
      // 如果本地无匹配，尝试用远程卡片的 log 状态回退（新旧 logId 都试）
      if (logEntry.status === 'pending') {
        const remoteLog = remoteLogMap.get(logEntry.id) || remoteLogMap.get(`log-${plan.id}-${index}`)
        if (remoteLog && remoteLog.status !== 'pending') {
          logEntry = { ...remoteLog }
        }
      }
      return logEntry
    })

    const allDone = logs.every(log => log.status === 'taken' || log.status === 'skipped')
    if (allDone) return

    const pendingIndex = logs.findIndex(log => log.status !== 'taken' && log.status !== 'skipped')

    localCards.push({
      id: plan.id,
      name: plan.name,
      dosage: plan.dosage || '按医嘱',
      logs,
      pendingIndex,
      summary: pendingIndex >= 0 ? `${logs[pendingIndex].time} 待确认` : '',
      progress: `${logs.filter(l => l.status === 'taken' || l.status === 'skipped').length}/${logs.length}`
    })
  })

  const confirmationList = storedConfirmations
    .filter(c => (c.status === 'taken' || c.status === 'skipped') && c.confirmDate === todayStr)
    .slice(0, 50)
    .map(mapConfirmationToListItem)

  const remoteConfirmations = Array.isArray(baseData.confirmations) ? baseData.confirmations : []

  return {
    ...baseData,
    todayCards: mergeListByTimestamp(localCards, remoteCards),
    plans: mergeListByTimestamp(localPlans, remotePlans),
    confirmations: mergeConfirmationsByLogId(confirmationList, remoteConfirmations)
  }
}

function mergeHomeFamilyMedicationStatus(baseData) {
  const latestConfirmation = getLatestMedicationConfirmation()
  if (!latestConfirmation) return baseData

  const medicineLogs = Array.isArray(baseData.medicineLogs) ? baseData.medicineLogs : []

  return {
    ...baseData,
    medicineLogs: medicineLogs.map((item) => {
      if (item.id !== latestConfirmation.logId) return item
      return {
        ...item,
        statusText: latestConfirmation.statusText,
        actionText: latestConfirmation.status === 'taken' ? '已服' : '查看',
        statusType: latestConfirmation.status === 'taken' ? 'done' : 'warn',
        action: 'view'
      }
    })
  }
}

function mergeMedConfirmMedication(baseData, planId, targetLogId) {
  if (baseData.medication) return baseData

  const plans = getMedicationPlan().getStoredMedicationPlans()
  if (!plans.length) return baseData

  const todayStr = getTodayDateValue()
  const storedConfirmations = getStoredMedicationConfirmations()
  const confirmedLogIds = new Set()
  storedConfirmations.forEach(c => {
    if (c.logId && (c.status === 'taken' || c.status === 'skipped') && c.confirmDate === todayStr) {
      confirmedLogIds.add(c.logId)
    }
  })

  const targetPlans = planId ? plans.filter(p => p.id === planId) : plans

  if (targetLogId) {
    for (const plan of targetPlans) {
      const times = Array.isArray(plan.times) ? plan.times : []
      for (let i = 0; i < times.length; i++) {
        const logId = buildLogId(plan.id, times[i])
        const oldLogId = `log-${plan.id}-${i}`
        if (logId === targetLogId || oldLogId === targetLogId) {
          return {
            ...baseData,
            medication: {
              logId,
              time: times[i],
              name: plan.name,
              dosage: plan.dosage || '按医嘱',
              planId: plan.id,
              planName: plan.name
            }
          }
        }
      }
    }
  }

  for (const plan of targetPlans) {
    if (plan.status === '已停用') continue
    const times = Array.isArray(plan.times) ? plan.times : []
    if (!times.length) continue

    for (let i = 0; i < times.length; i++) {
      const logId = buildLogId(plan.id, times[i])
      const oldLogId = `log-${plan.id}-${i}`
      if (!confirmedLogIds.has(logId) && !confirmedLogIds.has(oldLogId)) {
        return {
          ...baseData,
          medication: {
            logId,
            time: times[i],
            name: plan.name,
            dosage: plan.dosage || '按医嘱',
            planId: plan.id,
            planName: plan.name
          }
        }
      }
    }
  }

  return baseData
}

function parseMedTaskId(taskId) {
  if (!taskId || !taskId.startsWith('task-med-')) return null
  const suffix = taskId.slice('task-med-'.length)
  const lastDash = suffix.lastIndexOf('-')
  if (lastDash < 0) return null
  const index = parseInt(suffix.slice(lastDash + 1), 10)
  if (isNaN(index)) return null
  const planId = suffix.slice(0, lastDash)
  return { planId, index }
}

function findNextPendingTime(plan, confirmationMap, todayStr) {
  if (!plan || !Array.isArray(plan.times) || plan.status === '已停用') return null

  if (plan.startDate && plan.startDate !== '今天') {
    if (normalizeDateValue(plan.startDate) > todayStr) return null
  }
  if (plan.endDate && plan.endDate < todayStr) return null

  for (let i = 0; i < plan.times.length; i++) {
    const logId = buildLogId(plan.id, plan.times[i])
    const oldLogId = `log-${plan.id}-${i}`
    const confirmed = confirmationMap.get(logId) || confirmationMap.get(oldLogId)
    if (confirmed && (confirmed.status === 'taken' || confirmed.status === 'skipped')) continue
    return { time: plan.times[i], logId, status: confirmed ? confirmed.status : 'pending' }
  }
  return null
}

function mergeHomeMedicationStatus(baseData) {
  const todayStr = getTodayDateValue()
  const storedConfirmations = getStoredMedicationConfirmations()
  const todayConfirmations = storedConfirmations.filter(c => c.confirmDate === todayStr)

  if (!Array.isArray(baseData.todayTasks)) return baseData

  const storedPlans = getMedicationPlan().getStoredMedicationPlans()

  if (!todayConfirmations.length && storedPlans.length) {
    const cloudPlanIds = new Set()
    baseData.todayTasks.forEach(task => {
      if (task.id && task.id.startsWith('task-med-')) {
        const parsed = parseMedTaskId(task.id)
        if (parsed) cloudPlanIds.add(parsed.planId)
      }
    })

    const confirmationMap = new Map()
    const additionalTasks = []

    storedPlans.forEach(plan => {
      if (cloudPlanIds.has(plan.id)) return
      const nextPending = findNextPendingTime(plan, confirmationMap, todayStr)
      if (!nextPending) return
      additionalTasks.push(buildMedTask(plan.id, nextPending, plan))
    })

    if (additionalTasks.length) {
      const measureIndex = baseData.todayTasks.findIndex(
        t => t.id && (t.id.startsWith('task-bp-') || t.id.startsWith('task-bg-'))
      )
      const updatedTasks = [...baseData.todayTasks]
      if (measureIndex >= 0) {
        updatedTasks.splice(measureIndex, 0, ...additionalTasks)
      } else {
        updatedTasks.push(...additionalTasks)
      }
      return { ...baseData, todayTasks: updatedTasks }
    }
  }

  if (!todayConfirmations.length) return baseData

  const confirmationMap = new Map()
  todayConfirmations.forEach(c => {
    if (c.logId && !confirmationMap.has(c.logId)) confirmationMap.set(c.logId, c)
  })

  const planMap = new Map()
  storedPlans.forEach(p => planMap.set(p.id, p))

  return {
    ...baseData,
    todayTasks: updateTasksWithConfirmations(baseData.todayTasks, confirmationMap, planMap, todayStr)
  }
}

function mergeReminderMedicationStatus(baseData) {
  const todayStr = getTodayDateValue()
  const storedConfirmations = getStoredMedicationConfirmations()
  const todayConfirmations = storedConfirmations.filter(c => c.confirmDate === todayStr)

  if (!todayConfirmations.length || !Array.isArray(baseData.tasks)) return baseData

  const confirmationMap = new Map()
  todayConfirmations.forEach(c => {
    if (c.logId && !confirmationMap.has(c.logId)) confirmationMap.set(c.logId, c)
  })

  const storedPlans = getMedicationPlan().getStoredMedicationPlans()
  const planMap = new Map()
  storedPlans.forEach(p => planMap.set(p.id, p))

  // 补充：为每个计划的每个时间点建立新旧格式互索引
  // 确保无论确认记录用哪种格式存储，都能被匹配
  // 优先使用 baseData 中的云端计划数据（更全），本地 planMap 作为补充
  const allPlanIds = new Set()
  const planTimesMap = new Map()
  // 从 baseData.tasks 中提取 plan 信息
  ;(baseData.tasks || []).forEach(task => {
    if (task.id && task.id.startsWith('task-med-')) {
      const parsed = parseMedTaskId(task.id)
      if (parsed && !allPlanIds.has(parsed.planId)) {
        allPlanIds.add(parsed.planId)
        // 优先用本地 plan 的 times，回退用 task 中的信息
        const localPlan = planMap.get(parsed.planId)
        if (localPlan && Array.isArray(localPlan.times)) {
          planTimesMap.set(parsed.planId, localPlan.times)
        }
      }
    }
  })
  // 补充本地 plan 中未被 tasks 覆盖的计划
  planMap.forEach((plan, planId) => {
    if (!planTimesMap.has(planId) && Array.isArray(plan.times)) {
      planTimesMap.set(planId, plan.times)
    }
  })
  // 为每个计划的每个时间点建立新旧格式互索引
  planTimesMap.forEach((times, planId) => {
    times.forEach((time, i) => {
      const newLogId = buildLogId(planId, time)
      const oldLogId = `log-${planId}-${i}`
      if (confirmationMap.has(newLogId) && !confirmationMap.has(oldLogId)) {
        confirmationMap.set(oldLogId, confirmationMap.get(newLogId))
      }
      if (confirmationMap.has(oldLogId) && !confirmationMap.has(newLogId)) {
        confirmationMap.set(newLogId, confirmationMap.get(oldLogId))
      }
    })
  })

  return {
    ...baseData,
    tasks: updateTasksWithConfirmations(baseData.tasks, confirmationMap, planMap, todayStr, { tab: 'today' })
  }
}

function normalizeMedListData(remoteData) {
  return withMockPageData('medList', remoteData, (baseData, remote) => deepMerge(baseData, remote))
}

function getMedListData() {
  return resolveMockData('medList')
    .then(normalizeMedListData)
    .then(mergeMedicationPlans)
}

function getMedConfirmData(planId, targetLogId) {
  const payload = {}
  if (planId) payload.planId = planId
  if (targetLogId) payload.logId = targetLogId
  const { normalizeMedConfirmData } = require('./medication-confirm')
  return resolveMockData('medConfirm', payload)
    .then(normalizeMedConfirmData)
    .then(baseData => mergeMedConfirmMedication(baseData, planId, targetLogId))
}

/**
 * 构建本周用药概览统计数据。
 * 基于用药计划推算应服次数，结合确认记录计算服药率。
 *
 * 核心公式：
 *   服药率 = 已服次数 / 应服次数 × 100%
 *   应服次数 = Σ(每个启用计划在本周有效天数 × 每日时间点数)
 *   按每个启用计划独立统计，分别展示各自的服药率与详细数据
 *
 * @param {string} weekStart 本周起始日期 YYYY-MM-DD
 * @param {string} todayStr  今日日期 YYYY-MM-DD
 * @param {Array} [remoteConfirmations=[]] 云端返回的确认记录数组
 * @param {Array} [medPlans=[]] 启用中的用药计划数组（含 planId/name/times/status/startDate/endDate）
 * @returns {{ pills: string[], emptyHint: string }}
 */
function buildWeeklyMedicationOverview(weekStart, todayStr, remoteConfirmations, medPlans) {
  const storedConfirmations = getStoredMedicationConfirmations()

  // ─── 1. 合并本地 + 云端确认记录 ───
  // 去重 key = logId + confirmDate（同一天同一时间点只保留一条，本地优先覆盖云端）
  const confirmationMap = new Map()
  const remoteArr = Array.isArray(remoteConfirmations) ? remoteConfirmations : []
  function confirmKey(c) { return `${c.logId}::${c.confirmDate || ''}` }
  remoteArr.forEach(c => {
    if (c && c.logId && !confirmationMap.has(confirmKey(c))) confirmationMap.set(confirmKey(c), c)
  })
  storedConfirmations.forEach(c => {
    if (c && c.logId) confirmationMap.set(confirmKey(c), c)
  })

  // ─── 2. 筛选本周确认记录（按 planId 分组）───
  // logId 格式：log-{planId}-{time}，如 log-43834a1...-0700
  const weekConfirmationsByPlan = new Map() // planId → { taken: number, skipped: number }
  confirmationMap.forEach(c => {
    if (c.status !== 'taken' && c.status !== 'skipped') return
    const d = c.confirmDate || ''
    if (d < weekStart || d > todayStr) return
    // 从 logId 提取 planId
    const planId = extractPlanIdFromLogId(c.logId)
    if (!planId) return
    if (!weekConfirmationsByPlan.has(planId)) {
      weekConfirmationsByPlan.set(planId, { taken: 0, skipped: 0 })
    }
    const stat = weekConfirmationsByPlan.get(planId)
    if (c.status === 'taken') stat.taken++
    if (c.status === 'skipped') stat.skipped++
  })

  // ─── 3. 合并云端 + 本地用药计划 ───
  const cloudPlans = Array.isArray(medPlans) ? medPlans : []
  const localPlans = getMedicationPlan().getStoredMedicationPlans()
    .filter(p => p.status !== '已停用')
    .map(p => ({
      planId: p.id,
      name: p.name,
      dosage: p.dosage,
      times: p.times,
      status: p.status,
      startDate: p.startDate || '',
      endDate: p.endDate || ''
    }))
  const planMap = new Map()
  cloudPlans.forEach(p => { if (p && p.planId && p.status !== '已停用') planMap.set(p.planId, p) })
  localPlans.forEach(p => { if (p && p.planId) planMap.set(p.planId, p) })
  const plans = Array.from(planMap.values())

  // ─── 4. 按计划独立统计，生成 pills ───
  const pills = []

  if (plans.length > 0) {
    // 有启用计划：逐计划独立统计
    plans.forEach(plan => {
      const times = Array.isArray(plan.times) ? plan.times : []
      if (times.length === 0 || plan.status === '已停用') return

      // 计算该计划本周应服次数
      const planStart = (plan.startDate && plan.startDate !== '今天') ? plan.startDate : ''
      const planEnd = plan.endDate || ''
      let shouldTake = 0

      const weekStartMs = new Date(weekStart + 'T00:00:00').getTime()
      const todayMs = new Date(todayStr + 'T00:00:00').getTime()
      const DAY_MS = 24 * 60 * 60 * 1000

      for (let d = weekStartMs; d <= todayMs; d += DAY_MS) {
        const dateStr = formatDateFromMs(d)
        if (planStart && dateStr < planStart) continue
        if (planEnd && dateStr > planEnd) continue
        shouldTake += times.length
      }

      if (shouldTake === 0) return

      // 该计划的确认记录
      const confirmStat = weekConfirmationsByPlan.get(plan.planId) || { taken: 0, skipped: 0 }
      const taken = confirmStat.taken
      const skipped = confirmStat.skipped
      const unconfirmed = Math.max(0, shouldTake - taken - skipped)
      const complianceRate = shouldTake > 0 ? Math.round((taken / shouldTake) * 100) : 0

      // pill 1：计划名 + 服药率
      pills.push(`${plan.name} · 服药率 ${complianceRate}%`)
      // pill 2：详细数据
      if (skipped > 0 && unconfirmed > 0) {
        pills.push(`应服 ${shouldTake} · 已服 ${taken} · 跳过 ${skipped} · 未确认 ${unconfirmed}`)
      } else if (skipped > 0) {
        pills.push(`应服 ${shouldTake} · 已服 ${taken} · 跳过 ${skipped}`)
      } else if (unconfirmed > 0) {
        pills.push(`应服 ${shouldTake} · 已服 ${taken} · 未确认 ${unconfirmed}`)
      } else {
        pills.push(`应服 ${shouldTake} · 已服 ${taken}`)
      }
    })
  } else {
    // 无启用计划：退回旧逻辑（仅统计确认记录）
    let totalTaken = 0
    let totalSkipped = 0
    weekConfirmationsByPlan.forEach(stat => {
      totalTaken += stat.taken
      totalSkipped += stat.skipped
    })
    const totalCount = totalTaken + totalSkipped
    if (totalCount === 0) return { group: '', pills: [], emptyHint: '' }
    const onTimeRate = totalCount > 0 ? Math.round((totalTaken / totalCount) * 100) : 0
    pills.push(`用药 ${totalCount} 次 · 服药率 ${onTimeRate}%`)
    if (totalSkipped > 0) {
      pills.push(`已服 ${totalTaken} 次 · 跳过 ${totalSkipped} 次`)
    }
  }

  return { group: '用药', pills, emptyHint: '' }
}

/**
 * 从 logId 提取 planId。
 * logId 格式：log-{planId}-{time}，如 log-43834a186a2151c400342e764a38b231-0700
 * planId 可能含连字符，time 格式为 HHMM（4位数字），以最后一个连字符后的数字部分为 time
 */
function extractPlanIdFromLogId(logId) {
  if (!logId || typeof logId !== 'string') return ''
  // logId 格式：log-{planId}-{HHMM}
  // 找最后一个 - 后面是时间部分（4位数字），前面的是 planId
  const lastDash = logId.lastIndexOf('-')
  if (lastDash < 4) return '' // "log-" 至少4字符
  const afterDash = logId.slice(lastDash + 1)
  // 确认 afterDash 是时间格式（如 0700、2100）
  if (/^\d{3,4}$/.test(afterDash)) {
    return logId.slice(4, lastDash) // 去掉 "log-" 前缀和 "-time" 后缀
  }
  return logId.slice(4) // 兜底：去掉 "log-" 前缀
}

/**
 * 将毫秒时间戳转为 YYYY-MM-DD 格式
 */
function formatDateFromMs(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

module.exports = {
  buildLogId,
  buildWeeklyMedicationOverview,
  findNextPendingTime,
  getMedConfirmData,
  getMedListData,
  mergeHomeFamilyMedicationStatus,
  mergeHomeMedicationStatus,
  mergeListByTimestamp,
  mergeMedConfirmMedication,
  mergeMedicationPlans,
  mergeReminderMedicationStatus,
  parseMedTaskId
}
