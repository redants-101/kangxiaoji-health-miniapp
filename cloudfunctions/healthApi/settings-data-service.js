const DEFAULT_PRIVACY_PERMISSIONS = [
  {
    key: 'privacyGuide',
    iconSrc: '/assets/icons/icon-data.png',
    title: '隐私政策',
    meta: '开始使用前必须确认，记录处理范围以政策为准。',
    enabled: true,
    locked: true
  },
  {
    key: 'healthData',
    iconSrc: '/assets/icons/icon-data.png',
    title: '健康记录处理',
    meta: '用于血压、血糖、用药记录、趋势和周报。',
    enabled: true
  },
  {
    key: 'familyShare',
    iconSrc: '/assets/icons/tab-family.png',
    title: '家属共享',
    meta: '按授权范围向家属展示记录和提醒状态。',
    enabled: true
  },
  {
    key: 'subscribeMessage',
    iconSrc: '/assets/icons/icon-data.png',
    title: '订阅消息',
    meta: '用于用药、测量和周报提醒。',
    enabled: false
  }
]

const DEFAULT_PRIVACY_LINKS = [
  {
    label: '查看隐私政策',
    iconSrc: '/assets/icons/icon-data.png',
    meta: '处理目的、信息范围和用户权利',
    route: 'privacyPolicy'
  },
  {
    label: '查看用户服务协议',
    iconSrc: '/assets/icons/icon-data.png',
    meta: '服务边界、使用规则和免责声明',
    route: 'userAgreement'
  },
  {
    label: '家属授权管理',
    iconSrc: '/assets/icons/tab-family.png',
    meta: '查看家属成员和共享范围',
    route: 'family'
  },
  {
    label: '订阅消息授权状态',
    iconSrc: '/assets/icons/icon-data.png',
    meta: '管理微信提醒授权',
    route: 'reminderSettings'
  },
  {
    label: '数据管理',
    iconSrc: '/assets/icons/icon-data.png',
    meta: '导出、删除健康数据或清空账号',
    route: 'data'
  }
]

const DEFAULT_PRIVACY_LOGS = [
  {
    id: 'log-privacy',
    title: '同意隐私政策',
    time: '最近',
    meta: '基础授权'
  }
]

const EXPORT_VERSION = '2026-04-27'
const EXPORT_PAGE_SIZE = 100
const MAX_EXPORT_PAGES = 20
const MAX_DELETE_BATCHES = 30

// 北京时间日期（云函数运行在 UTC 时区，必须加偏移后取 UTC 方法，否则 0:00-8:00 会取到前一天）
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000
function getTodayDateValue() {
  const now = new Date()
  const chinaTime = new Date(now.getTime() + CHINA_TIME_OFFSET_MS)
  const y = chinaTime.getUTCFullYear()
  const m = String(chinaTime.getUTCMonth() + 1).padStart(2, '0')
  const d = String(chinaTime.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function createSettingsDataService({
  db,
  collections,
  getDefaultReminderSettings,
  normalizeReminderSettingsPayload,
  statsService,
  withPerfLog
}) {
  function getCollection(name) {
    return db.collection(collections[name])
  }

  async function readCollectionPage(route, collectionName, where, pageIndex, options = {}) {
    return await withPerfLog({
      routeType: 'action',
      route,
      step: `db.${collectionName}.exportPage`
    }, () => {
      let query = getCollection(collectionName).where(where)
      if (options.field) query = query.field(options.field)
      if (options.orderBy) query = query.orderBy(options.orderBy.field, options.orderBy.direction)
      if (pageIndex > 0 && typeof query.skip === 'function') {
        query = query.skip(pageIndex * EXPORT_PAGE_SIZE)
      }
      return query.limit(EXPORT_PAGE_SIZE).get()
    })
  }

  async function readCollectionAll(route, collectionName, where, options = {}) {
    const list = []
    for (let pageIndex = 0; pageIndex < MAX_EXPORT_PAGES; pageIndex += 1) {
      const { data = [] } = await readCollectionPage(route, collectionName, where, pageIndex, options)
      list.push(...data)
      if (data.length < EXPORT_PAGE_SIZE) break
    }
    return list
  }

  function dedupeById(items) {
    const map = new Map()
    items.forEach((item) => {
      if (!item || !item._id || map.has(item._id)) return
      map.set(item._id, item)
    })
    return Array.from(map.values())
  }

  function buildExportText(exportData) {
    return [
      '康小记个人数据导出',
      `导出时间：${exportData.generatedAt}`,
      `导出版本：${exportData.version}`,
      '',
      JSON.stringify(exportData.data, null, 2)
    ].join('\n')
  }

  async function removeDocsByWhere(route, collectionName, where) {
    let removed = 0
    for (let batchIndex = 0; batchIndex < MAX_DELETE_BATCHES; batchIndex += 1) {
      const { data = [] } = await withPerfLog({
        routeType: 'action',
        route,
        step: `db.${collectionName}.deleteScan`
      }, () => getCollection(collectionName)
        .where(where)
        .field({ _id: true })
        .limit(EXPORT_PAGE_SIZE)
        .get())

      if (!data.length) break

      await withPerfLog({
        routeType: 'action',
        route,
        step: `db.${collectionName}.deleteBatch`
      }, () => Promise.all(data.map((item) => getCollection(collectionName).doc(item._id).remove())))

      removed += data.length
      if (data.length < EXPORT_PAGE_SIZE) break
    }
    return removed
  }

  async function updateFamilyAuthByMember(route, openId) {
    return await withPerfLog({
      routeType: 'action',
      route,
      step: 'db.familyAuth.revokeByMember'
    }, () => getCollection('familyAuth')
      .where({ memberOpenId: openId })
      .update({
        data: {
          status: 'revoked',
          memberOpenId: '',
          updatedAt: db.serverDate()
        }
      }))
  }

  async function getReminderData(openId) {
    const [settingsResult, medPlanResult, medConfirmResult] = await Promise.all([
      withPerfLog({
        routeType: 'key',
        route: 'reminder',
        step: 'db.reminderSettings.current'
      }, () => db.collection(collections.reminderSettings)
        .where({ _openid: openId })
        .field({ reminders: true })
        .limit(1)
        .get()),
      withPerfLog({
        routeType: 'key',
        route: 'reminder',
        step: 'db.medicationPlans.list'
      }, () => db.collection(collections.medicationPlans)
        .where({ _openid: openId, status: '启用' })
        .field({ _id: true, name: true, dosage: true, times: true, startDate: true, endDate: true })
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get()),
      withPerfLog({
        routeType: 'key',
        route: 'reminder',
        step: 'db.medicationConfirmations.today'
      }, () => db.collection(collections.medicationConfirmations)
        .where({ _openid: openId, confirmDate: getTodayDateValue() })
        .field({ logId: true, status: true, statusText: true, name: true, dosage: true, time: true, actionAt: true })
        .orderBy('actionAt', 'desc')
        .limit(50)
        .get())
    ])

    const reminders = settingsResult?.data?.[0]?.reminders || []

    const isEnabled = (key) => {
      const item = reminders.find(r => r.key === key)
      return !item || item.enabled
    }

    const tasks = []

    // 用药提醒：按实际计划状态生成任务
    if (isEnabled('medicine')) {
      const medPlans = medPlanResult.data || []
      const confirmationMap = new Map()
      const confirmations = medConfirmResult.data || []
      confirmations.forEach(c => {
        if (c.logId && !confirmationMap.has(c.logId)) confirmationMap.set(c.logId, c)
      })

      // 补充：为每个计划的每个时间点生成 index 格式的 logId 索引
      // 确保旧格式确认记录也能被匹配到
      medPlans.forEach(plan => {
        const times = Array.isArray(plan.times) ? plan.times : []
        times.forEach((time, i) => {
          const newLogId = `log-${plan._id}-${String(time).replace(':', '')}`
          const oldLogId = `log-${plan._id}-${i}`
          // 如果新格式有确认记录但旧格式没有，则补充旧格式索引
          if (confirmationMap.has(newLogId) && !confirmationMap.has(oldLogId)) {
            confirmationMap.set(oldLogId, confirmationMap.get(newLogId))
          }
          // 如果旧格式有确认记录但新格式没有，则补充新格式索引
          if (confirmationMap.has(oldLogId) && !confirmationMap.has(newLogId)) {
            confirmationMap.set(newLogId, confirmationMap.get(oldLogId))
          }
        })
      })

      const todayStr = getTodayDateValue()

      medPlans.forEach(plan => {
        const times = Array.isArray(plan.times) ? plan.times : []
        if (times.length === 0) return

        if (plan.startDate && plan.startDate !== '今天' && plan.startDate > todayStr) return
        if (plan.endDate && plan.endDate < todayStr) return

        let pendingIndex = -1
        for (let i = 0; i < times.length; i++) {
          // 同时匹配新旧两种 logId 格式：新格式用时间（0700），旧格式用索引（0）
          const newLogId = `log-${plan._id}-${String(times[i]).replace(':', '')}`
          const oldLogId = `log-${plan._id}-${i}`
          const confirmed = confirmationMap.get(newLogId) || confirmationMap.get(oldLogId)
          if (confirmed && (confirmed.status === 'taken' || confirmed.status === 'skipped')) continue
          pendingIndex = i
          break
        }

        if (pendingIndex === -1) return

        const time = times[pendingIndex]
        // 统一使用时间格式 logId，与前端 buildLogId 保持一致
        const logId = `log-${plan._id}-${String(time).replace(':', '')}`
        const newLogId = logId
        const oldLogId = `log-${plan._id}-${pendingIndex}`
        const confirmed = confirmationMap.get(newLogId) || confirmationMap.get(oldLogId)

        if (confirmed && confirmed.status === 'snoozed') {
          tasks.push({
            id: `task-med-${plan._id}-${pendingIndex}`,
            planId: plan._id,
            logId,
            tab: 'today',
            title: `${time} 稍后提醒`,
            meta: `${plan.name} ${plan.dosage || '按医嘱'}`,
            actionText: '确认',
            route: 'medConfirm'
          })
        } else {
          tasks.push({
            id: `task-med-${plan._id}-${pendingIndex}`,
            planId: plan._id,
            logId,
            tab: 'today',
            title: `${time} 用药提醒`,
            meta: `${plan.name} ${plan.dosage || '按医嘱'}`,
            actionText: '确认',
            route: 'medConfirm'
          })
        }
      })

      // 所有用药计划均已确认时不生成汇总任务，提醒中心仅展示待办事项
    }

    if (isEnabled('measure')) {
      tasks.push({
        id: 'task-bp-1',
        tab: 'today',
        title: '测量血压',
        meta: '晨起 · 空腹',
        actionText: '记录',
        route: 'recordBp'
      })
      tasks.push({
        id: 'task-bg-1',
        tab: 'today',
        title: '测量血糖',
        meta: '餐后 · 2小时',
        actionText: '记录',
        route: 'recordBg'
      })
    }

    // 已完成分组：展示今日已确认（taken/skipped）的用药记录
    const completedTasks = []
    if (isEnabled('medicine')) {
      const confirmations = medConfirmResult.data || []
      confirmations.forEach(c => {
        if (c.status !== 'taken' && c.status !== 'skipped') return
        completedTasks.push({
          id: `task-done-${c.logId}`,
          tab: 'completed',
          time: c.time || '',
          title: `${c.time || ''} ${c.name || '用药'}`,
          meta: `${c.name || ''} ${c.dosage || '按医嘱'}`,
          route: 'medList',
          planId: '',
          logId: c.logId,
          status: c.status,
          statusText: c.statusText || (c.status === 'taken' ? '已服' : '已跳过')
        })
      })
    }

    const allTasks = tasks.concat(completedTasks)

    return {
      eyebrow: '健康提醒',
      tasks: allTasks,
      activeTab: 'today',
      tabs: [
        { key: 'today', label: '今天' },
        { key: 'upcoming', label: '即将到来' },
        { key: 'completed', label: '已完成' }
      ],
      visibleTasks: allTasks
    }
  }

  async function getReminderSettingsData(openId) {
    const { data: settings = [] } = await withPerfLog({
      routeType: 'key',
      route: 'reminderSettings',
      step: 'db.reminderSettings.current'
    }, () => db.collection(collections.reminderSettings)
      .where({ _openid: openId })
      .field({
        subscription: true,
        reminders: true,
        timePlans: true,
        quietMode: true
      })
      .limit(1)
      .get())

    const current = settings[0] || {}
    const defaults = getDefaultReminderSettings()

    return {
      eyebrow: '提醒设置',
      subscription: current.subscription || defaults.subscription,
      reminders: current.reminders || defaults.reminders,
      timePlans: current.timePlans || defaults.timePlans,
      quietMode: typeof current.quietMode === 'boolean' ? current.quietMode : defaults.quietMode
    }
  }

  async function getPrivacySettingsData(openId) {
    const { data: settings = [] } = await withPerfLog({
      routeType: 'key',
      route: 'privacySettings',
      step: 'db.privacySettings.current'
    }, () => db.collection(collections.privacySettings)
      .where({ _openid: openId })
      .field({
        agreed: true,
        agreedAt: true,
        permissions: true,
        links: true,
        logs: true
      })
      .limit(1)
      .get())

    const current = settings[0] || {}

    return {
      agreed: current.agreed === true,
      agreedAt: current.agreedAt || '',
      permissions: current.permissions || DEFAULT_PRIVACY_PERMISSIONS,
      links: current.links || DEFAULT_PRIVACY_LINKS,
      logs: current.logs || DEFAULT_PRIVACY_LOGS
    }
  }

  async function getDataManagementData(openId) {
    const [recordStats, { total: planTotal }, { total: feedbackTotal }, { total: ownedFamilyTotal }, { total: joinedFamilyTotal }] = await Promise.all([
      statsService.getRecordStats(openId, 'dataManagement'),
      withPerfLog({
        routeType: 'key',
        route: 'dataManagement',
        step: 'db.medicationPlans.count'
      }, () => db.collection(collections.medicationPlans).where({ _openid: openId }).count()),
      withPerfLog({
        routeType: 'key',
        route: 'dataManagement',
        step: 'db.feedbacks.count'
      }, () => db.collection(collections.feedbacks).where({ _openid: openId }).count()),
      withPerfLog({
        routeType: 'key',
        route: 'dataManagement',
        step: 'db.familyMembers.ownerCount'
      }, () => db.collection(collections.familyMembers).where({ ownerOpenId: openId, status: 'active' }).count()),
      withPerfLog({
        routeType: 'key',
        route: 'dataManagement',
        step: 'db.familyMembers.memberCount'
      }, () => db.collection(collections.familyMembers).where({ memberOpenId: openId, status: 'active' }).count())
    ])
    const recordTotal = Number(recordStats.recordCount) || 0

    return {
      eyebrow: '数据管理',
      summary: [
        { label: '健康记录', value: `${recordTotal}条` },
        { label: '用药计划', value: `${planTotal}条` },
        { label: '家属关系', value: `${ownedFamilyTotal + joinedFamilyTotal}位` },
        { label: '反馈记录', value: `${feedbackTotal}条` }
      ]
    }
  }

  async function getHelpData() {
    return {
      eyebrow: '帮助与反馈',
      sections: [
        {
          title: '常见问题',
          items: [
            { q: '如何记录血压？', a: '首页点击"记录血压"按钮，输入测量值即可。' },
            { q: '如何设置用药提醒？', a: '在"用药管理"中添加用药计划，开启提醒即可。' },
            { q: '如何与家人共享数据？', a: '在"家庭"页面生成邀请码，家人输入邀请码即可加入。' }
          ]
        }
      ]
    }
  }

  async function getFeedbackData() {
    return {
      eyebrow: '意见反馈',
      types: [
        { value: 'function', label: '功能建议' },
        { value: 'bug', label: '问题反馈' },
        { value: 'other', label: '其他' }
      ]
    }
  }

  async function saveReminderSettings(openId, payload) {
    const reminderData = {
      ...normalizeReminderSettingsPayload(payload),
      updatedAt: db.serverDate()
    }

    const { data: existing = [] } = await withPerfLog({
      routeType: 'action',
      route: 'saveReminderSettings',
      step: 'db.reminderSettings.current'
    }, () => db.collection(collections.reminderSettings)
      .where({ _openid: openId })
      .limit(1)
      .get())

    if (existing.length > 0) {
      return await withPerfLog({
        routeType: 'action',
        route: 'saveReminderSettings',
        step: 'db.reminderSettings.update'
      }, () => db.collection(collections.reminderSettings).doc(existing[0]._id).update({
        data: reminderData
      }))
    }

    return await withPerfLog({
      routeType: 'action',
      route: 'saveReminderSettings',
      step: 'db.reminderSettings.add'
    }, () => db.collection(collections.reminderSettings).add({
      data: {
        _openid: openId,
        ...reminderData,
        createdAt: db.serverDate()
      }
    }))
  }

  async function updatePrivacySettings(openId, payload) {
    const { agreed, agreedAt, permissions, links, logs } = payload || {}

    const privacyData = {
      ...(agreed !== undefined ? { agreed: agreed === true } : {}),
      ...(agreedAt ? { agreedAt } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
      ...(links !== undefined ? { links } : {}),
      ...(logs !== undefined ? { logs } : {}),
      updatedAt: db.serverDate()
    }

    const { data: existing = [] } = await withPerfLog({
      routeType: 'action',
      route: 'updatePrivacySettings',
      step: 'db.privacySettings.current'
    }, () => db.collection(collections.privacySettings)
      .where({ _openid: openId })
      .limit(1)
      .get())

    if (existing.length > 0) {
      return await withPerfLog({
        routeType: 'action',
        route: 'updatePrivacySettings',
        step: 'db.privacySettings.update'
      }, () => db.collection(collections.privacySettings).doc(existing[0]._id).update({
        data: privacyData
      }))
    }

    return await withPerfLog({
      routeType: 'action',
      route: 'updatePrivacySettings',
      step: 'db.privacySettings.add'
    }, () => db.collection(collections.privacySettings).add({
      data: {
        _openid: openId,
        ...privacyData,
        createdAt: db.serverDate()
      }
    }))
  }

  async function submitFeedback(openId, payload) {
    const { type, content, contact } = payload

    return await withPerfLog({
      routeType: 'action',
      route: 'submitFeedback',
      step: 'db.feedbacks.add'
    }, () => db.collection(collections.feedbacks).add({
      data: {
        _openid: openId,
        type,
        content,
        contact: contact || '',
        createdAt: db.serverDate()
      }
    }))
  }

  async function exportUserData(openId) {
    const [
      profiles,
      records,
      medicationPlans,
      medicationConfirmations,
      familyAuthOwned,
      familyAuthJoined,
      familyMembersOwned,
      familyMembersJoined,
      reminderSettings,
      privacySettings,
      feedbacks,
      dailyStats,
      recordStats
    ] = await Promise.all([
      readCollectionAll('exportUserData', 'profiles', { _openid: openId }),
      readCollectionAll('exportUserData', 'records', { _openid: openId }, { orderBy: { field: 'createdAt', direction: 'desc' } }),
      readCollectionAll('exportUserData', 'medicationPlans', { _openid: openId }, { orderBy: { field: 'updatedAt', direction: 'desc' } }),
      readCollectionAll('exportUserData', 'medicationConfirmations', { _openid: openId }, { orderBy: { field: 'actionAt', direction: 'desc' } }),
      readCollectionAll('exportUserData', 'familyAuth', { _openid: openId }),
      readCollectionAll('exportUserData', 'familyAuth', { memberOpenId: openId }),
      readCollectionAll('exportUserData', 'familyMembers', { ownerOpenId: openId }),
      readCollectionAll('exportUserData', 'familyMembers', { memberOpenId: openId }),
      readCollectionAll('exportUserData', 'reminderSettings', { _openid: openId }),
      readCollectionAll('exportUserData', 'privacySettings', { _openid: openId }),
      readCollectionAll('exportUserData', 'feedbacks', { _openid: openId }, { orderBy: { field: 'createdAt', direction: 'desc' } }),
      readCollectionAll('exportUserData', 'dailyStats', { _openid: openId }),
      readCollectionAll('exportUserData', 'recordStats', { _openid: openId })
    ])

    const exportData = {
      version: EXPORT_VERSION,
      generatedAt: new Date().toISOString(),
      format: 'json',
      data: {
        profiles,
        healthRecords: records,
        medicationPlans,
        medicationConfirmations,
        familyAuth: dedupeById([...familyAuthOwned, ...familyAuthJoined]),
        familyMembers: dedupeById([...familyMembersOwned, ...familyMembersJoined]),
        reminderSettings,
        privacySettings,
        feedbacks,
        dailyStats,
        recordStats
      }
    }

    return {
      ...exportData,
      exportText: buildExportText(exportData)
    }
  }

  async function deleteUserData(openId, payload = {}) {
    const scope = payload.scope || 'health'
    if (scope === 'medication') {
      const [planDeleted, confirmationDeleted] = await Promise.all([
        removeDocsByWhere('deleteUserData', 'medicationPlans', { _openid: openId }),
        removeDocsByWhere('deleteUserData', 'medicationConfirmations', { _openid: openId })
      ])
      return { scope, deleted: { medicationPlans: planDeleted, medicationConfirmations: confirmationDeleted } }
    }

    const [recordDeleted, dailyStatsDeleted, recordStatsDeleted] = await Promise.all([
      removeDocsByWhere('deleteUserData', 'records', { _openid: openId }),
      removeDocsByWhere('deleteUserData', 'dailyStats', { _openid: openId }),
      removeDocsByWhere('deleteUserData', 'recordStats', { _openid: openId })
    ])

    return {
      scope,
      deleted: {
        records: recordDeleted,
        dailyStats: dailyStatsDeleted,
        recordStats: recordStatsDeleted
      }
    }
  }

  async function clearUserAccount(openId, payload = {}) {
    if (!payload.confirm) {
      throw new Error('请确认清空账号后再提交')
    }

    const [
      profilesDeleted,
      recordsDeleted,
      medicationPlansDeleted,
      medicationConfirmationsDeleted,
      familyAuthOwnedDeleted,
      familyMembersOwnedDeleted,
      familyMembersJoinedDeleted,
      reminderSettingsDeleted,
      privacySettingsDeleted,
      feedbacksDeleted,
      dailyStatsDeleted,
      recordStatsDeleted
    ] = await Promise.all([
      removeDocsByWhere('clearUserAccount', 'profiles', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'records', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'medicationPlans', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'medicationConfirmations', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'familyAuth', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'familyMembers', { ownerOpenId: openId }),
      removeDocsByWhere('clearUserAccount', 'familyMembers', { memberOpenId: openId }),
      removeDocsByWhere('clearUserAccount', 'reminderSettings', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'privacySettings', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'feedbacks', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'dailyStats', { _openid: openId }),
      removeDocsByWhere('clearUserAccount', 'recordStats', { _openid: openId }),
      updateFamilyAuthByMember('clearUserAccount', openId)
    ])

    return {
      cleared: true,
      clearedAt: new Date().toISOString(),
      deleted: {
        profiles: profilesDeleted,
        records: recordsDeleted,
        medicationPlans: medicationPlansDeleted,
        medicationConfirmations: medicationConfirmationsDeleted,
        familyAuth: familyAuthOwnedDeleted,
        familyMembers: familyMembersOwnedDeleted + familyMembersJoinedDeleted,
        reminderSettings: reminderSettingsDeleted,
        privacySettings: privacySettingsDeleted,
        feedbacks: feedbacksDeleted,
        dailyStats: dailyStatsDeleted,
        recordStats: recordStatsDeleted
      }
    }
  }

  return {
    clearUserAccount,
    deleteUserData,
    exportUserData,
    getDataManagementData,
    getFeedbackData,
    getHelpData,
    getPrivacySettingsData,
    getReminderData,
    getReminderSettingsData,
    saveReminderSettings,
    submitFeedback,
    updatePrivacySettings
  }
}

module.exports = {
  createSettingsDataService
}
