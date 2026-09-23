/**
 * 康小记-健康记录助手 云函数
 * 提供健康数据、用药管理、家庭共享等后端接口
 * 入参约定：
 * - 读接口：{ key, payload }
 * - 写接口：{ action, payload }
 * 出参约定：
 * - 读接口返回页面可直接 setData 的对象
 * - 写接口返回云数据库 add/update/remove 的执行结果
 */

const cloud = require('wx-server-sdk')
const { createPerfLogger } = require('./perf')
const {
  CHINA_TIME_OFFSET_MS,
  getTodayDateValue,
  buildLogId,
  getRecordStatus,
  getLimitedString,
  createAssertOwnedDocument
} = require('./payload-helpers')
const {
  validateBloodPressurePayload,
  validateBloodGlucosePayload,
  validateMedicationPlanPayload,
  validateMedicationConfirmationPayload
} = require('./payload-validation')
const {
  getDefaultFamilyMember,
  getFamilyRelationV2,
  getDefaultInviteScopesV2,
  getDefaultInviteNoticeRulesV2,
  normalizeFamilyScopesV2,
  normalizeNoticeRulesV2,
  canViewScope,
  canCallReminderPhone,
  normalizeContactPhone,
  maskContactPhone,
  getScopeTextV2,
  normalizeFamilyAuthPayloadV2,
  normalizeFamilyInvitePayloadV2,
  validateInviteCodePayload,
  createProfileDisplayName,
  createFamilyAccessContext,
  canPerformScopeAction
} = require('./family-policy')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV  // 自动使用当前云环境
})

// throwOnNotFound:false —— 事务内 doc.get 对"确认不存在"返回 data:null，
// 让 A1/A2 的事务分支能区分【不存在】与【网络/权限/冲突异常】，不再吞异常。
// 副作用核查：全仓仅 daily-stats-service 两处 doc.get（未命中原本走 catch 回退空统计），
// 改后走 data:null → getDocData 返回 null → 同样回退空统计，最终行为不变，仅日志分类更准确。
const db = cloud.database({ throwOnNotFound: false })
const _ = db.command
const $ = db.command.aggregate
const { getResultCount, logPerf, withPerfLog } = createPerfLogger(console)

// 数据库集合名称
const COLLECTIONS = {
  records: 'health_records',           // 健康记录（血压、血糖）
  medicationPlans: 'medication_plans', // 用药计划
  medicationConfirmations: 'medication_confirmations', // 用药确认记录
  familyAuth: 'family_auth',          // 家庭授权
  familyMembers: 'family_members',    // 家庭成员关系
  inviteAttempts: 'family_invite_attempts', // 邀请查询失败计数（频控，TTL 24h 控制台建）
  reminderSettings: 'reminder_settings', // 提醒设置
  privacySettings: 'privacy_settings', // 隐私设置
  feedbacks: 'feedbacks',              // 反馈建议
  dailyStats: 'health_daily_stats',     // 健康记录按天预聚合
  recordStats: 'health_record_stats',   // 健康记录用户总量预聚合
  profiles: 'profiles',                // 用户档案
  // A7：应用级运行时配置（单文档 _id='app_config'）。
  // 控制台待办：启用远程开关需创建集合并写入 { familyTabEnabled: boolean }，
  // 安全规则与其他集合一致（仅云函数读写）。集合不存在时 getAppConfigData
  // 走 catch 回退 familyTabEnabled:null，端侧按 envVersion 默认值执行，不影响运行。
  appConfigs: 'app_configs'
}

// 归属校验：云端真实 db；签名 (collection, openId, documentId, label)。
const assertOwnedDocument = createAssertOwnedDocument(db)
// 家属装配所需的 db 查询函数。
const getProfileDisplayName = createProfileDisplayName({ db, collections: COLLECTIONS })
const getFamilyAccessContext = createFamilyAccessContext({ db, collections: COLLECTIONS })

let staticPageHandlers
let reportService
let dailyStatsService
let recordService
let medicationService
let familyService
let settingsDataService

/**
 * 获取静态页面处理器模块
 * 使用单例模式延迟加载，避免重复 require
 * @returns {Object} 静态页面处理器模块
 */
function getStaticPageHandlers() {
  if (!staticPageHandlers) {
    staticPageHandlers = require('./static-pages')
  }
  return staticPageHandlers
}

/**
 * 获取报告服务单例实例
 * 首次调用时创建实例，后续调用返回缓存的实例
 * @returns {Object} 报告服务实例
 */
function getReportService() {
  if (!reportService) {
    const { createReportService } = require('./report-service')
    reportService = createReportService({
      db,
      _,
      collections: COLLECTIONS,
      statsService: getDailyStatsService(),
      logPerf
    })
  }
  return reportService
}

/**
 * 获取每日统计服务的单例实例
 * 采用懒加载模式，首次调用时创建实例，后续调用直接返回已创建的实例
 * @returns {Object} 每日统计服务实例，包含数据库操作和统计功能
 */
function getDailyStatsService() {
  if (!dailyStatsService) {
    const { createDailyStatsService } = require('./daily-stats-service')
    dailyStatsService = createDailyStatsService({
      db,
      _,
      collections: COLLECTIONS,
      logPerf
    })
  }
  return dailyStatsService
}

/**
 * 获取记录服务实例（单例模式）
 * @returns {Object} 记录服务实例，提供记录相关的数据库操作方法
 */
function getRecordService() {
  if (!recordService) {
    const { createRecordService } = require('./record-service')
    recordService = createRecordService({
      db,
      _,
      collections: COLLECTIONS,
      getRecordStatus,
      withPerfLog
    })
  }
  return recordService
}

/**
 * 获取用药服务实例（单例模式）
 * @returns {Object} 用药服务实例
 */
function getMedicationService() {
  if (!medicationService) {
    const { createMedicationService } = require('./medication-service')
    medicationService = createMedicationService({
      db,
      _,
      collections: COLLECTIONS,
      assertOwnedDocument,
      validateMedicationPlanPayload,
      validateMedicationConfirmationPayload,
      withPerfLog
    })
  }
  return medicationService
}

/**
 * 获取或创建家庭服务单例
 * @returns {FamilyService} 家庭服务实例，提供家庭成员管理、邀请码生成、权限控制等功能
 */
function getFamilyService() {
  if (!familyService) {
    const { createFamilyService } = require('./family-service')
    familyService = createFamilyService({
      db,
      _,
      collections: COLLECTIONS,
      withPerfLog,
      getProfileDisplayName,
      getFamilyAccessContext,
      getRecordStatus,
      getDefaultFamilyMember,
      getFamilyRelationV2,
      getDefaultInviteScopesV2,
      getDefaultInviteNoticeRulesV2,
      normalizeFamilyScopesV2,
      normalizeNoticeRulesV2,
      canViewScope,
      canPerformScopeAction,
      normalizeContactPhone,
      maskContactPhone,
      canCallReminderPhone,
      getScopeTextV2,
      normalizeFamilyAuthPayloadV2,
      normalizeFamilyInvitePayloadV2,
      validateInviteCodePayload,
      getLimitedString,
      createInviteCode,
      getRecordService,
      getMedicationService,
      getDailyStatsService
    })
  }
  return familyService
}

function getSettingsDataService() {
  if (!settingsDataService) {
    const { createSettingsDataService } = require('./settings-data-service')
    settingsDataService = createSettingsDataService({
      db,
      collections: COLLECTIONS,
      getDefaultReminderSettings,
      normalizeReminderSettingsPayload,
      statsService: getDailyStatsService(),
      withPerfLog
    })
  }
  return settingsDataService
}

// ============ 辅助函数 ============

/**
 * 获取当前用户的 openid
 * @param {Object} event 云函数事件对象，微信会注入 userInfo。
 * @returns {string} 当前微信用户 openId。
 * @throws {Error} 无法获取 openId 时抛出异常，避免静默使用错误身份。
 */
function getOpenId(event) {
  const openId = event.userInfo && event.userInfo.openId
  if (!openId) {
    throw new Error('无法获取用户身份，请确保在小程序环境中调用')
  }
  return openId
}

/**
 * 创建记录ID
 * @param {string} prefix 业务前缀，例如 bp / bg。
 * @returns {string} 带随机串的记录 ID。
 */
function createRecordId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 创建家庭邀请码。
 * @returns {string} 便于分享和手输的短邀请码。
 */
function createInviteCode() {
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase()
  const timePart = Date.now().toString(36).slice(-4).toUpperCase()
  return `KXJ${timePart}${randomPart}`
}

/**
 * 获取默认提醒设置。
 * @returns {Object} 提醒设置页默认数据。
 */
function getDefaultReminderSettings() {
  return {
    subscription: {
      status: '未全部开启',
      meta: '用药提醒已授权，测量提醒和周报提醒待开启。'
    },
    reminders: [
      {
        key: 'medicine',
        iconSrc: '/assets/icons/icon-data.png',
        title: '用药提醒',
        meta: '到点提醒确认是否已服药',
        enabled: true
      },
      {
        key: 'measure',
        iconSrc: '/assets/icons/icon-data.png',
        title: '测量提醒',
        meta: '按设定时间提醒记录血压或血糖',
        enabled: true
      },
      {
        key: 'weeklyReport',
        iconSrc: '/assets/icons/icon-data.png',
        title: '周报提醒',
        meta: '每周生成记录回顾后提醒查看',
        enabled: true
      },
      {
        key: 'familyMissed',
        iconSrc: '/assets/icons/tab-family.png',
        title: '家属未确认提醒',
        meta: '仅在授权家属后生效',
        enabled: false
      }
    ],
    timePlans: [
      {
        id: 'time-med',
        iconSrc: '/assets/icons/icon-medication.png',
        title: '用药计划',
        meta: '按用药计划时间提醒',
        time: '按计划',
        route: 'medList'
      },
      {
        id: 'time-measure',
        iconSrc: '/assets/icons/icon-bp.png',
        title: '健康记录',
        meta: '按设置提醒记录血压或血糖',
        time: '09:00',
        route: 'recordBp'
      },
      {
        id: 'time-report',
        iconSrc: '/assets/icons/icon-report.png',
        title: '健康周报',
        meta: '每周提醒查看',
        time: '20:00',
        route: 'report'
      }
    ],
    quietMode: true
  }
}

/**
 * 获取默认角色选项。
 * @returns {Array<Object>} 基础资料页角色选项。
 */
function getDefaultProfileRoles() {
  return [
    { key: 'self', label: '本人使用' },
    { key: 'family', label: '帮家人管理' }
  ]
}

/**
 * 获取默认关注项目。
 * @returns {Array<Object>} 基础资料页关注项目。
 */
function getDefaultFocusItems() {
  return [
    {
      key: 'bloodPressure',
      title: '血压记录',
      meta: '收缩压（高压）、舒张压（低压）、心率和场景标签',
      checked: true
    },
    {
      key: 'bloodGlucose',
      title: '血糖记录',
      meta: '血糖值、测量时间和餐前餐后标签',
      checked: true
    },
    {
      key: 'medicine',
      title: '用药提醒',
      meta: '用药计划、提醒和服药确认',
      checked: true
    },
    {
      key: 'weeklyReport',
      title: '健康周报',
      meta: '给自己和授权家属查看的记录汇总',
      checked: true
    }
  ]
}

/**
 * 归一化基础资料入参。
 * @param {Object} payload 页面提交的基础资料。
 * @returns {Object} profiles 集合目标字段。
 */
function normalizeProfilePayload(payload = {}) {
  const profile = payload.profile || {}
  return {
    name: profile.name || payload.name || '',
    birthYear: profile.birthYear || payload.birthYear || '',
    role: profile.role || payload.role || 'self',
    avatar: profile.avatar || payload.avatar || '',
    avatarText: payload.avatarText || '',
    focusItems: Array.isArray(payload.focusItems) ? payload.focusItems : []
  }
}

/**
 * 归一化提醒设置入参。
 * @param {Object} payload 页面提交的提醒设置。
 * @returns {Object} reminder_settings 集合目标字段。
 */
function normalizeReminderSettingsPayload(payload = {}) {
  const defaults = getDefaultReminderSettings()
  return {
    subscription: payload.subscription || defaults.subscription,
    reminders: Array.isArray(payload.reminders) ? payload.reminders : defaults.reminders,
    timePlans: Array.isArray(payload.timePlans) ? payload.timePlans : defaults.timePlans,
    quietMode: typeof payload.quietMode === 'boolean' ? payload.quietMode : defaults.quietMode
  }
}

/**
 * 获取首页数据（整合模拟数据 + 数据库）
 * @param {string} openId 当前用户 openId。
 * @returns {Promise<Object>} 首页概览数据。
 */
async function getHomeData(openId) {
  const parallelStartedAt = Date.now()

  // 计算本周起始日期
  const todayDate = new Date(Date.now() + CHINA_TIME_OFFSET_MS)
  const dayOfWeek = todayDate.getUTCDDay()
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(todayDate)
  monday.setUTCDate(todayDate.getUTCDate() - mondayOffset)
  const weekStart = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`
  const todayStr = getTodayDateValue()

  const [latestResult, profileResult, homeStats, medPlanResult, medConfirmResult, weekMedConfirmResult, reminderSettingsResult] = await Promise.all([
    withPerfLog({
      routeType: 'key',
      route: 'home',
      step: 'db.records.latest'
    }, () => db.collection(COLLECTIONS.records)
      .where({ _openid: openId })
      .field({ type: true, systolic: true, diastolic: true, glucose: true, measuredAt: true, tag: true, level: true, createdAt: true })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()),
    withPerfLog({
      routeType: 'key',
      route: 'home',
      step: 'db.profiles.current'
    }, () => db.collection(COLLECTIONS.profiles)
      .where({ _openid: openId })
      .field({ name: true })
      .limit(1)
      .get()),
    getDailyStatsService().getHomeStats(openId),
    withPerfLog({
      routeType: 'key',
      route: 'home',
      step: 'db.medicationPlans.list'
    }, () => db.collection(COLLECTIONS.medicationPlans)
      .where({ _openid: openId, status: '启用' })
      .field({ _id: true, name: true, dosage: true, times: true, status: true, startDate: true, endDate: true })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get()),
    withPerfLog({
      routeType: 'key',
      route: 'home',
      step: 'db.medicationConfirmations.today'
    }, () => db.collection(COLLECTIONS.medicationConfirmations)
      .where({ _openid: openId, confirmDate: getTodayDateValue() })
      .field({ logId: true, status: true, statusText: true, name: true, dosage: true, time: true, actionAt: true, confirmDate: true })
      .orderBy('actionAt', 'desc')
      .limit(50)
      .get()),
    withPerfLog({
      routeType: 'key',
      route: 'home',
      step: 'db.medicationConfirmations.week'
    }, () => db.collection(COLLECTIONS.medicationConfirmations)
      .where({
        _openid: openId,
        confirmDate: _.gte(weekStart).and(_.lte(todayStr))
      })
      .field({ logId: true, status: true, statusText: true, name: true, dosage: true, time: true, actionAt: true, confirmDate: true })
      .orderBy('actionAt', 'desc')
      .limit(200)
      .get()),
    withPerfLog({
      routeType: 'key',
      route: 'home',
      step: 'db.reminderSettings.current'
    }, () => db.collection(COLLECTIONS.reminderSettings)
      .where({ _openid: openId })
      .field({ reminders: true })
      .limit(1)
      .get())
  ])

  const profile = profileResult.data[0] || {}
  const latestRecord = latestResult.data[0]
  const dailyStats = homeStats.dailyStats || {}
  const recordStats = homeStats.recordStats || {}

  logPerf({
    routeType: 'key',
    route: 'home',
    step: 'db.home.parallel',
    durationMs: Date.now() - parallelStartedAt,
    count: (getResultCount([latestResult, profileResult, medPlanResult, medConfirmResult, weekMedConfirmResult, reminderSettingsResult]) || 0) + (dailyStats.recordCount ? 1 : 0) + (recordStats.recordCount ? 1 : 0),
    ok: true
  })

  // 构建 todayTasks
  const reminders = reminderSettingsResult?.data?.[0]?.reminders || []
  const isEnabled = (key) => {
    const item = reminders.find(r => r.key === key)
    return !item || item.enabled
  }

  const todayTasks = []
  const medPlans = medPlanResult.data || []
  // todayStr 已在 Promise.all 前声明，此处不再重复声明
  // 构建已确认记录的 logId → status 映射，用于匹配每个时间点的状态
  const confirmationMap = new Map()
  const confirmations = medConfirmResult.data || []
  confirmations.forEach(c => {
    if (c.logId && !confirmationMap.has(c.logId)) confirmationMap.set(c.logId, c)
  })

  if (medPlans.length > 0 && isEnabled('medicine')) {
    medPlans.forEach(plan => {
      const times = Array.isArray(plan.times) ? plan.times : []
      if (times.length === 0) return

      // 日期范围判断：开始日期在今天之后 → 不显示
      if (plan.startDate && plan.startDate !== '今天' && plan.startDate > todayStr) return
      // 日期范围判断：结束日期已过 → 不显示
      if (plan.endDate && plan.endDate < todayStr) return

      // 找到该计划中最靠前的一个尚未确认的时间点
      let pendingIndex = -1
      for (let i = 0; i < times.length; i++) {
        const logId = buildLogId(plan._id, times[i])
        const oldLogId = `log-${plan._id}-${i}`
        const confirmed = confirmationMap.get(logId) || confirmationMap.get(oldLogId)
        // 已服或已跳过视为已完成，继续找下一个
        if (confirmed && (confirmed.status === 'taken' || confirmed.status === 'skipped')) continue
        pendingIndex = i
        break
      }

      // 所有时间点都已完成 → 不展示该计划
      if (pendingIndex === -1) return

      const time = times[pendingIndex]
      const logId = buildLogId(plan._id, time)
      const oldLogId = `log-${plan._id}-${pendingIndex}`
      const confirmed = confirmationMap.get(logId) || confirmationMap.get(oldLogId)

      if (confirmed && confirmed.status === 'snoozed') {
        todayTasks.push({
          id: `task-med-${plan._id}-${pendingIndex}`,
          planId: plan._id,
          logId,
          title: `${time} 稍后提醒`,
          meta: `${plan.name} ${plan.dosage || '按医嘱'}`,
          actionText: '确认',
          route: 'medConfirm'
        })
      } else {
        todayTasks.push({
          id: `task-med-${plan._id}-${pendingIndex}`,
          planId: plan._id,
          logId,
          title: `${time} 用药提醒`,
          meta: `${plan.name} ${plan.dosage || '按医嘱'}`,
          actionText: '确认',
          route: 'medConfirm'
        })
      }
    })
  }

  if (isEnabled('measure')) {
    todayTasks.push({
      id: 'task-bp-1',
      title: '测量血压',
      meta: '晨起 · 空腹',
      actionText: '记录',
      route: 'recordBp'
    })
    todayTasks.push({
      id: 'task-bg-1',
      title: '测量血糖',
      meta: '餐后 · 2小时',
      actionText: '记录',
      route: 'recordBg'
    })
  }

  return {
    eyebrow: `你好，${profile.name || '用户'}！`,
    todayTasks,
    latestRecord: latestRecord ? {
      id: latestRecord._id,
      type: latestRecord.type === 'bp' ? '血压' : '血糖',
      value: latestRecord.type === 'bp' 
        ? `${latestRecord.systolic}/${latestRecord.diastolic}` 
        : latestRecord.glucose,
      unit: latestRecord.type === 'bp' ? 'mmHg' : 'mmol/L',
      time: latestRecord.measuredAt,
      tag: latestRecord.tag,
      status: getRecordStatus(latestRecord.level),
      statusType: latestRecord.level
    } : null,
    recordCount: Number(dailyStats.recordCount) || 0,
    stats: {
      bpCount: Number(recordStats.bpCount) || 0,
      bgCount: Number(recordStats.bgCount) || 0
    },
    weekConfirmations: (weekMedConfirmResult.data || []).map(c => ({
      logId: c.logId,
      status: c.status,
      statusText: c.statusText,
      name: c.name,
      dosage: c.dosage,
      time: c.time,
      confirmDate: c.confirmDate,
      actionAt: c.actionAt
    })),
    weekMedPlans: medPlans.map(p => ({
      planId: p._id,
      name: p.name,
      dosage: p.dosage,
      times: p.times,
      status: p.status,
      startDate: p.startDate || '',
      endDate: p.endDate || ''
    }))
  }
}

/**
 * 获取档案页面数据
 * @param {string} openId 当前用户 openId。
 * @returns {Promise<Object>} 个人档案页数据。
 */
async function getProfileData(openId) {
  const { data: profiles } = await db.collection(COLLECTIONS.profiles)
    .where({ _openid: openId })
    .limit(1)
    .get()

  if (profiles.length === 0) {
    // 返回默认档案数据
    return {
      profile: {
        name: '',
        birthYear: '',
        role: 'self'
      },
      avatarText: '',
      roles: getDefaultProfileRoles(),
      focusItems: getDefaultFocusItems()
    }
  }

  const profile = profiles[0]
  return {
    profile: {
      name: profile.name || '',
      birthYear: profile.birthYear || '',
      role: profile.role || 'self'
    },
    avatarText: profile.avatarText || (profile.name ? profile.name.slice(0, 1) : ''),
    roles: getDefaultProfileRoles(),
    focusItems: profile.focusItems || getDefaultFocusItems()
  }
}

/**
 * 获取"我的"页面数据
 * @param {string} openId 当前用户 openId。
 * @returns {Promise<Object>} 我的页资料摘要。
 */
async function getMeData(openId) {
  const { data: profiles } = await db.collection(COLLECTIONS.profiles)
    .where({ _openid: openId })
    .limit(1)
    .get()

  const profile = profiles[0] || {}

  return {
    eyebrow: '个人中心',
    profile: {
      name: profile.name || '未设置',
      role: profile.role === 'family' ? '帮家人管理' : '本人使用 · 家庭健康记录',
      tags: profile.focusItems?.filter(item => item.checked).map(item => 
        item.title.replace('记录', '').replace('提醒', '')
      ) || ['血压', '血糖', '用药'],
      avatar: profile.avatar || ''
    }
  }
}

/**
 * A7：应用级运行时配置（家庭 Tab 回滚开关等）。
 * 读取 app_configs 集合 _id='app_config' 单文档；集合缺失/无权限/文档不存在
 * 一律回退 familyTabEnabled:null，由端侧按 envVersion 默认值执行（正式版关、体验/开发版开）。
 * 开关只控制 Tab 展示；数据授权一律走 family-policy 服务端闸口，与本配置无关。
 * @returns {Promise<Object>} { familyTabEnabled: boolean|null }
 */
async function getAppConfigData() {
  try {
    const res = await db.collection(COLLECTIONS.appConfigs).doc('app_config').get()
    const cfg = res && res.data ? res.data : null
    return {
      familyTabEnabled: cfg && typeof cfg.familyTabEnabled === 'boolean' ? cfg.familyTabEnabled : null
    }
  } catch (e) {
    return { familyTabEnabled: null }
  }
}

// ============ 数据保存操作 ============

/**
 * 保存血压记录
 * @param {string} openId 当前用户 openId，云数据库也会自动写入 _openid。
 * @param {Object} payload 血压记录参数。
 * @param {number|string} payload.systolic 收缩压。
 * @param {number|string} payload.diastolic 舒张压。
 * @param {number|string} [payload.pulse] 心率。
 * @param {string} [payload.tag] 测量场景。
 * @param {string} [payload.level] 提示等级。
 * @param {string} [payload.measuredAt] 测量时间。
 * @param {string} [payload.note] 备注。
 * @param {string} [payload.tip] 提示文案。
 * @returns {Promise<Object>} 数据库 add 结果。
 */
async function saveBloodPressureRecord(openId, payload) {
  const record = validateBloodPressurePayload(payload)

  const result = await withPerfLog({
    routeType: 'action',
    route: 'saveBloodPressureRecord',
    step: 'db.records.add'
  }, () => db.collection(COLLECTIONS.records).add({
    data: {
      _openid: openId,
      type: 'bp',
      source: 'cloud',
      ...record,
      createdAt: db.serverDate()
    }
  }))

  await getDailyStatsService().updateRecordStats(openId, 'bp', record, 1, 'saveBloodPressureRecord')
  return result
}

/**
 * 保存血糖记录
 * @param {string} openId 当前用户 openId，云数据库也会自动写入 _openid。
 * @param {Object} payload 血糖记录参数。
 * @param {number|string} payload.glucose 血糖值。
 * @param {string} [payload.tag] 测量场景。
 * @param {string} [payload.level] 提示等级。
 * @param {string} [payload.measuredAt] 测量时间。
 * @param {string} [payload.note] 备注。
 * @param {string} [payload.tip] 提示文案。
 * @returns {Promise<Object>} 数据库 add 结果。
 */
async function saveBloodGlucoseRecord(openId, payload) {
  const record = validateBloodGlucosePayload(payload)

  const result = await withPerfLog({
    routeType: 'action',
    route: 'saveBloodGlucoseRecord',
    step: 'db.records.add'
  }, () => db.collection(COLLECTIONS.records).add({
    data: {
      _openid: openId,
      type: 'bg',
      source: 'cloud',
      ...record,
      createdAt: db.serverDate()
    }
  }))

  await getDailyStatsService().updateRecordStats(openId, 'bg', record, 1, 'saveBloodGlucoseRecord')
  return result
}

/**
 * 保存用户档案
 * @param {string} openId 当前用户 openId。
 * @param {Object} payload 档案参数。
 * @param {Object} [payload.profile] 页面资料对象。
 * @param {Array<Object>} [payload.focusItems] 关注项目。
 * @returns {Promise<Object>} 数据库 add 或 update 结果。
 */
async function saveProfile(openId, payload) {
  const profileData = normalizeProfilePayload(payload)

  // 先查询是否存在
  const { data: existing } = await db.collection(COLLECTIONS.profiles)
    .where({ _openid: openId })
    .limit(1)
    .get()

  if (existing.length > 0) {
    // 更新
    return await db.collection(COLLECTIONS.profiles).doc(existing[0]._id).update({
      data: {
        ...profileData,
        updatedAt: db.serverDate()
      }
    })
  } else {
    // 新增
    return await db.collection(COLLECTIONS.profiles).add({
      data: {
        _openid: openId,
        ...profileData,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
  }
}

/**
 * 删除健康记录
 * @param {string} openId 当前用户 openId。
 * @param {string} recordId 健康记录文档 ID。
 * @returns {Promise<Object>} 数据库 remove 结果。
 */
async function deleteRecord(openId, recordId) {
  const ownedRecord = await withPerfLog({
    routeType: 'action',
    route: 'deleteRecord',
    step: 'db.records.assertOwned'
  }, () => assertOwnedDocument(COLLECTIONS.records, openId, recordId, '健康记录'))

  const result = await withPerfLog({
    routeType: 'action',
    route: 'deleteRecord',
    step: 'db.records.remove'
  }, () => db.collection(COLLECTIONS.records).doc(ownedRecord._id).remove())

  await getDailyStatsService().updateRecordStats(openId, ownedRecord.type, ownedRecord, -1, 'deleteRecord')
  return result
}

// ============ 主入口 ============

/**
 * 云函数主入口。
 * @param {Object} event 前端传入参数；读接口使用 key，写接口使用 action。
 * @param {Object} context 云函数上下文，当前未直接使用。
 * @returns {Promise<Object>} 读接口数据、写接口结果或错误对象。
 */
exports.main = async (event, context) => {
  const { action, payload, key } = event
  let openId
  try {
    openId = getOpenId(event)
  } catch (e) {
    // rebuildRecordStats 支持管理端调用：通过 payload._adminOpenId 传入身份，或留空自动扫描全部用户
    if (action === 'rebuildRecordStats') {
      openId = (payload && payload._adminOpenId) || null
    } else {
      throw e
    }
  }
  const routeType = key ? 'key' : 'action'
  const route = key || action || 'unknown'
  const routeStartedAt = Date.now()
  /**
   * 路由执行完成后的性能日志记录包装器
   * @param {*} result - 路由执行结果
   * @param {boolean} [ok=true] - 路由执行是否成功
   * @returns {*} 返回原始路由执行结果
   */
const finishRoute = (result, ok = true) => {
    logPerf({
      routeType,
      route,
      step: 'route.total',
      durationMs: Date.now() - routeStartedAt,
      count: getResultCount(result),
      ok
    })
    return result
  }

  try {
    // GET 请求：通过 key 获取数据
    if (key) {
      // keyMap 负责把前端的 get:xxx / key 请求路由到具体读函数。
      const keyMap = {
        'privacy': () => getStaticPageHandlers().getPrivacyData(),
        'privacyDetail': () => getStaticPageHandlers().getPrivacyDetailData(),
        'privacyPolicy': () => getStaticPageHandlers().getPrivacyPolicyData(),
        'userAgreement': () => getStaticPageHandlers().getUserAgreementData(),
        'role': () => getStaticPageHandlers().getRoleData(),
        'familyJoinHint': () => getStaticPageHandlers().getFamilyJoinHintData(),
        'home': () => getHomeData(openId),
        'homeFamily': () => getFamilyService().getHomeFamilyData(openId),
        'profile': () => getProfileData(openId),
        'recordBp': () => getRecordService().getRecordBpData(),
        'recordBg': () => getRecordService().getRecordBgData(),
        'recordDetail': () => (payload && payload.familyView === true)
          ? getFamilyService().getFamilyRecordDetailData(openId, payload)
          : getRecordService().getRecordDetailData(openId, payload),
        'recordList': () => (payload && payload.familyView === true)
          ? getFamilyService().getFamilyRecordListData(openId, payload)
          : getRecordService().getRecordListData(openId, payload),
        'medList': () => (payload && payload.familyView === true)
          ? getFamilyService().getFamilyMedListData(openId, payload)
          : getMedicationService().getMedListData(openId),
        'medHistory': () => (payload && payload.familyView === true)
          ? getFamilyService().getFamilyMedHistoryData(openId, payload)
          : getMedicationService().getMedHistoryData(openId, payload),
        'medEdit': () => getMedicationService().getMedEditData(openId, payload?.planId),
        'medConfirm': () => getMedicationService().getMedConfirmData(openId, payload?.planId, payload?.logId),
        'trend': () => (payload && payload.familyView === true)
          ? getFamilyService().getFamilyTrendData(openId, payload)
          : getRecordService().getTrendData(openId, payload),
        'family': () => getFamilyService().getFamilyData(openId),
        'familyInvite': () => getFamilyService().getFamilyInviteData(),
        'familyJoin': () => getFamilyService().getFamilyJoinData(openId, payload),
        'familyAuth': () => getFamilyService().getFamilyAuthData(openId, payload),
        'report': () => getReportService().getReportData(openId),
        'reminder': () => getSettingsDataService().getReminderData(openId),
        'reminderSettings': () => getSettingsDataService().getReminderSettingsData(openId),
        'me': () => getMeData(openId),
        'appConfig': () => getAppConfigData(),
        'privacySettings': () => getSettingsDataService().getPrivacySettingsData(openId),
        'dataManagement': () => getSettingsDataService().getDataManagementData(openId),
        'help': () => getSettingsDataService().getHelpData(),
        'feedback': () => getSettingsDataService().getFeedbackData()
      }

      if (keyMap[key]) {
        return finishRoute(await keyMap[key]())
      }
      return finishRoute({ errMsg: `未知数据标识: ${key}` }, false)
    }

    // POST 请求：通过 action 执行操作
    // actionMap 负责把 save/update/delete 等写操作路由到具体数据库函数。
    const actionMap = {
      'saveBloodPressureRecord': () => saveBloodPressureRecord(openId, payload),
      'saveBloodGlucoseRecord': () => saveBloodGlucoseRecord(openId, payload),
      'saveProfile': () => saveProfile(openId, payload),
      'saveMedicationPlan': () => getMedicationService().saveMedicationPlan(openId, payload),
      'deleteMedicationPlan': () => getMedicationService().deleteMedicationPlan(openId, payload?.planId),
      'toggleMedicationPlanStatus': () => getMedicationService().toggleMedicationPlanStatus(openId, payload?.planId, payload?.status),
      'revokeMedicationConfirmation': () => getMedicationService().revokeMedicationConfirmation(openId, payload?.logId),
      'confirmMedication': () => getMedicationService().confirmMedication(openId, payload),
      'familyRecordBloodPressure': () => getFamilyService().familyRecordBloodPressure(openId, payload),
      'familyRecordBloodGlucose': () => getFamilyService().familyRecordBloodGlucose(openId, payload),
      'familyConfirmMedication': () => getFamilyService().familyConfirmMedication(openId, payload),
      'familyRevokeProxyConfirmation': () => getFamilyService().familyRevokeProxyConfirmation(openId, payload),
      'updateFamilyAuth': () => getFamilyService().updateFamilyAuth(openId, payload),
      'createFamilyInvite': () => getFamilyService().createFamilyInvite(openId, payload),
      'joinFamilyByInvite': () => getFamilyService().joinFamilyByInvite(openId, payload),
      'revokeFamilyMember': () => getFamilyService().revokeFamilyMember(openId, payload),
      'setFamilyContactPhone': () => getFamilyService().setFamilyContactPhone(openId, payload),
      'familyGetReminderPhone': () => getFamilyService().familyGetReminderPhone(openId),
      'exportUserData': () => getSettingsDataService().exportUserData(openId, payload),
      'deleteUserData': () => getSettingsDataService().deleteUserData(openId, payload),
      'clearUserAccount': () => getSettingsDataService().clearUserAccount(openId, payload),
      'saveReminderSettings': () => getSettingsDataService().saveReminderSettings(openId, payload),
      'updatePrivacySettings': () => getSettingsDataService().updatePrivacySettings(openId, payload),
      'submitFeedback': () => getSettingsDataService().submitFeedback(openId, payload),
      'deleteRecord': () => deleteRecord(openId, payload?.recordId),
      'rebuildRecordStats': () => getDailyStatsService().rebuildRecordStats(openId, payload || {})
    }

    if (actionMap[action]) {
      return finishRoute(await actionMap[action]())
    }

    return finishRoute({ errMsg: `未知操作: ${action}` }, false)

  } catch (err) {
    logPerf({
      routeType,
      route,
      step: 'route.total',
      durationMs: Date.now() - routeStartedAt,
      ok: false,
      error: err.message || err.errMsg || `${err}`
    })
    console.error('云函数错误:', err)
    return { 
      errMsg: err.message || '服务器错误',
      // A2：附带稳定错误码供客户端状态分支（无码时为空串）
      errCode: err.code || '',
      stack: err.stack
    }
  }
}
