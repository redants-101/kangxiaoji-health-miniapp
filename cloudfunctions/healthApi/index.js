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

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV  // 自动使用当前云环境
})

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
const { getResultCount, logPerf, withPerfLog } = createPerfLogger(console)

// 本地日期（与 medication-service.js 保持一致，避免 UTC 偏移导致午夜附近日期错误）
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

function getTodayDateValue() {
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

// 数据库集合名称
const COLLECTIONS = {
  records: 'health_records',           // 健康记录（血压、血糖）
  medicationPlans: 'medication_plans', // 用药计划
  medicationConfirmations: 'medication_confirmations', // 用药确认记录
  familyAuth: 'family_auth',          // 家庭授权
  familyMembers: 'family_members',    // 家庭成员关系
  reminderSettings: 'reminder_settings', // 提醒设置
  privacySettings: 'privacy_settings', // 隐私设置
  feedbacks: 'feedbacks',              // 反馈建议
  dailyStats: 'health_daily_stats',     // 健康记录按天预聚合
  recordStats: 'health_record_stats',   // 健康记录用户总量预聚合
  profiles: 'profiles'                 // 用户档案
}

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
      isRelationScopeEnabled,
      getScopeText,
      getRecordStatus,
      getDefaultFamilyMember,
      getDefaultFamilyScopes,
      getDefaultNoticeRules,
      getDefaultInviteRelations,
      normalizeFamilyAuthPayload,
      normalizeFamilyInvitePayload,
      validateInviteCodePayload,
      getLimitedString,
      createInviteCode
    })
/**
 * 获取设置数据服务实例（单例模式）
 * @returns {Object} 设置数据服务实例，提供提醒设置相关的数据库操作方法
 */
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
 * 格式化记录状态
 * @param {string} level 记录等级，warn 表示建议复测。
 * @returns {string} 页面展示状态。
 */
function getRecordStatus(level) {
  if (level === 'warn') return '建议复测'
  return '正常'
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
 * 断言 payload 是对象。
 * @param {*} payload 云函数入参。
 * @param {string} label 业务名称。
 * @returns {Object} payload 对象。
 */
function assertPayloadObject(payload, label) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${label}参数不能为空`)
  }
  return payload
}

/**
 * 读取必填数字并校验范围。
 * @param {Object} payload 入参对象。
 * @param {string} field 字段名。
 * @param {string} label 展示名称。
 * @param {number} min 最小值。
 * @param {number} max 最大值。
 * @returns {number} 校验后的数字。
 */
function getRequiredNumber(payload, field, label, min, max) {
  const value = Number(payload[field])
  if (!Number.isFinite(value)) {
    throw new Error(`${label}必须是数字`)
  }
  if (value < min || value > max) {
    throw new Error(`${label}范围应为 ${min}-${max}`)
  }
  return value
}

/**
 * 读取可选数字并校验范围。
 * @param {Object} payload 入参对象。
 * @param {string} field 字段名。
 * @param {string} label 展示名称。
 * @param {number} min 最小值。
 * @param {number} max 最大值。
 * @returns {number|null} 校验后的数字或 null。
 */
function getOptionalNumber(payload, field, label, min, max) {
  if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
    return null
  }
  return getRequiredNumber(payload, field, label, min, max)
}

/**
 * 限制文本长度。
 * @param {*} value 原始值。
 * @param {string} label 展示名称。
 * @param {number} maxLength 最大长度。
 * @param {boolean} required 是否必填。
 * @returns {string} 清理后的文本。
 */
function getLimitedString(value, label, maxLength, required = false) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) {
    throw new Error(`${label}不能为空`)
  }
  if (text.length > maxLength) {
    throw new Error(`${label}不能超过 ${maxLength} 个字`)
  }
  return text
}

/**
 * 校验提醒时间格式。
 * @param {string} time 时间字符串。
 * @returns {boolean} true 表示 HH:mm 格式有效。
 */
function isValidTime(time) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
}

/**
 * 校验状态枚举。
 * @param {string} value 状态值。
 * @param {Array<string>} allowed 允许值。
 * @param {string} label 展示名称。
 * @returns {string} 状态值。
 */
function getEnumValue(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label}不合法`)
  }
  return value
}

/**
 * 获取默认家属展示信息。
 * @returns {Object} 家属权限页和家属首页共用的默认成员对象。
 */
function getDefaultFamilyMember() {
  return {
    name: '家属',
    relation: '家属',
    role: '主要照护人',
    status: '已授权',
    desc: '可协助查看记录、用药确认和周报。权限变更后立即生效。'
  }
}

/**
 * 获取默认家属授权范围。
 * @returns {Array<Object>} 默认授权项。
 */
function getDefaultFamilyScopes() {
  return [
    {
      key: 'bloodPressure',
      title: '血压记录',
      meta: '数值、测量时间、场景标签和趋势',
      enabled: true
    },
    {
      key: 'bloodGlucose',
      title: '血糖记录',
      meta: '数值、测量时间、测量场景和趋势',
      enabled: true
    },
    {
      key: 'medicine',
      title: '用药确认',
      meta: '用药计划、确认状态和未确认记录',
      enabled: true
    },
    {
      key: 'report',
      title: '健康记录周报',
      meta: '每周记录汇总和趋势回顾',
      enabled: true
    }
  ]
}

/**
 * 获取默认家属提醒规则。
 * @returns {Array<Object>} 默认提醒规则。
 */
function getDefaultNoticeRules() {
  return [
    {
      key: 'missedMedicine',
      title: '用药未确认提醒',
      meta: '超过设定时间未确认时提醒家属查看',
      enabled: true
    },
    {
      key: 'missingRecord',
      title: '连续未记录提醒',
      meta: '连续多天未记录时提醒家属关注',
      enabled: false
    },
    {
      key: 'weeklyReport',
      title: '周报生成提醒',
      meta: '周报生成后通知家属查看',
      enabled: true
    }
  ]
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
 * 获取邀请页默认关系。
 * @returns {Array<Object>} 可选择的家属关系。
 */
function getDefaultInviteRelations() {
  return [
    { key: 'daughter', label: '女儿', meta: '主要照护人' },
    { key: 'son', label: '儿子', meta: '紧急联系人' },
    { key: 'spouse', label: '配偶', meta: '共同管理' },
    { key: 'other', label: '其他', meta: '自定义关系' }
  ]
}

/**
 * 获取邀请关系配置。
 * @param {string} relationKey 关系 key。
 * @returns {Object} 命中的关系配置。
 */
function getInviteRelation(relationKey) {
  return getDefaultInviteRelations().find(item => item.key === relationKey) || getDefaultInviteRelations()[0]
}

/**
 * 判断授权项是否开启。
 * @param {Object} auth 家属授权文档。
 * @param {Array<string>} keys 可接受的授权 key，兼容页面长 key 和云端短 key。
 * @returns {boolean} true 表示当前授权允许查看。
 */
function isScopeEnabled(auth, keys) {
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : []
  return scopes.some(scope => keys.includes(scope.key) && scope.enabled)
}

/**
 * 从授权关系中判断 scope 是否开启。
 * @param {Object} relation 家庭成员关系文档。
 * @param {Array<string>} keys 授权 key 列表。
 * @returns {boolean} true 表示可查看。
 */
function isRelationScopeEnabled(relation, keys) {
  return isScopeEnabled({ scopes: relation.scopes || [] }, keys)
}

/**
 * 生成家属授权范围展示文案。
 * @param {Object} auth 家属授权文档。
 * @returns {string} 已授权范围文案。
 */
function getScopeText(auth) {
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : []
  const enabledTitles = scopes
    .filter(scope => scope.enabled)
    .map(scope => scope.title)
  return enabledTitles.length ? enabledTitles.join('、') : '暂未授权'
}

/**
 * 查询并校验文档归属当前用户。
 * @param {string} collection 集合名。
 * @param {string} openId 当前用户 openId。
 * @param {string} documentId 文档 ID。
 * @param {string} label 错误提示中的业务名称。
 * @returns {Promise<Object>} 当前用户名下的文档。
 */
async function assertOwnedDocument(collection, openId, documentId, label) {
  if (!documentId) {
    throw new Error(`${label}ID不能为空`)
  }
  const { data } = await db.collection(collection)
    .where({ _id: documentId, _openid: openId })
    .limit(1)
    .get()
  if (!data.length) {
    throw new Error(`${label}不存在或无权操作`)
  }
  return data[0]
}

/**
 * 获取用户显示名称。
 * @param {string} openId 用户 openId。
 * @returns {Promise<string>} 用户称呼。
 */
async function getProfileDisplayName(openId) {
  const { data } = await db.collection(COLLECTIONS.profiles)
    .where({ _openid: openId })
    .limit(1)
    .get()
  return data[0]?.name || '家人'
}

/**
 * 获取当前家属账号可查看的家庭关系。
 * @param {string} openId 当前用户 openId。
 * @returns {Promise<Object|null>} 家属关系上下文；没有关系时返回 null。
 */
async function getFamilyAccessContext(openId) {
  const { data: relations } = await db.collection(COLLECTIONS.familyMembers)
    .where({
      memberOpenId: openId,
      status: 'active'
    })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()

  if (relations.length) {
    return {
      mode: 'member',
      ownerOpenId: relations[0].ownerOpenId,
      relation: relations[0]
    }
  }

  // 本人预览家属视角时使用自己的授权配置，不跨账号读取。
  const { data: authList } = await db.collection(COLLECTIONS.familyAuth)
    .where({ _openid: openId })
    .limit(1)
    .get()

  const auth = authList[0]
  if (!auth || auth.status === 'revoked') return null
  return {
    mode: 'ownerPreview',
    ownerOpenId: openId,
    relation: {
      ownerOpenId: openId,
      memberOpenId: auth.memberOpenId || '',
      member: auth.member || getDefaultFamilyMember(),
      memberName: auth.memberName || auth.member?.name || '家属',
      scopes: auth.scopes || getDefaultFamilyScopes(),
      noticeRules: auth.noticeRules || getDefaultNoticeRules(),
      status: auth.status || 'active'
    }
  }
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
 * 归一化家属授权入参。
 * @param {Object} payload 页面提交的家属授权。
 * @returns {Object} family_auth 集合目标字段。
 */
function normalizeFamilyAuthPayload(payload = {}) {
  const member = {
    ...getDefaultFamilyMember(),
    ...(payload.member || {})
  }
  return {
    member,
    memberName: payload.memberName || member.name || '',
    inviteCode: payload.inviteCode || '',
    scopes: Array.isArray(payload.scopes) ? payload.scopes : getDefaultFamilyScopes(),
    noticeRules: Array.isArray(payload.noticeRules) ? payload.noticeRules : getDefaultNoticeRules(),
    activities: Array.isArray(payload.activities) ? payload.activities : [],
    status: payload.status || 'active'
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
 * 校验血压记录入参并归一化。
 * @param {Object} payload 血压记录入参。
 * @returns {Object} 可落库的血压记录字段。
 */
function validateBloodPressurePayload(payload) {
  const data = assertPayloadObject(payload, '血压记录')
  const systolic = getRequiredNumber(data, 'systolic', '收缩压（高压）', 50, 260)
  const diastolic = getRequiredNumber(data, 'diastolic', '舒张压（低压）', 30, 160)
  if (systolic <= diastolic) {
    throw new Error('收缩压（高压）需要大于舒张压（低压）')
  }
  return {
    systolic,
    diastolic,
    pulse: getOptionalNumber(data, 'pulse', '心率', 30, 220),
    tag: getLimitedString(data.tag, '测量场景', 20),
    level: data.level === 'warn' ? 'warn' : '',
    tip: getLimitedString(data.tip, '提示文案', 120),
    note: getLimitedString(data.note, '备注', 200),
    measuredAt: getLimitedString(data.measuredAt, '测量时间', 40) || (() => {
      const c = new Date(Date.now() + CHINA_TIME_OFFSET_MS)
      return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}-${String(c.getUTCDate()).padStart(2, '0')} ${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`
    })()
  }
}

/**
 * 校验血糖记录入参并归一化。
 * @param {Object} payload 血糖记录入参。
 * @returns {Object} 可落库的血糖记录字段。
 */
function validateBloodGlucosePayload(payload) {
  const data = assertPayloadObject(payload, '血糖记录')
  return {
    glucose: getRequiredNumber(data, 'glucose', '血糖值', 1.0, 33.3),
    tag: getLimitedString(data.tag, '测量场景', 20),
    level: data.level === 'warn' ? 'warn' : '',
    tip: getLimitedString(data.tip, '提示文案', 120),
    note: getLimitedString(data.note, '备注', 200),
    measuredAt: getLimitedString(data.measuredAt, '测量时间', 40) || (() => {
      const c = new Date(Date.now() + CHINA_TIME_OFFSET_MS)
      return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}-${String(c.getUTCDate()).padStart(2, '0')} ${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`
    })()
  }
}

/**
 * 校验用药计划入参并归一化。
 * @param {Object} payload 用药计划入参。
 * @returns {Object} 可落库的用药计划字段。
 */
function validateMedicationPlanPayload(payload) {
  const data = assertPayloadObject(payload, '用药计划')
  const times = Array.isArray(data.times) ? data.times : []
  if (!times.length) {
    throw new Error('请至少选择一个提醒时间')
  }
  if (times.length > 8) {
    throw new Error('提醒时间不能超过 8 个')
  }
  const cleanTimes = times.map(time => `${time}`.trim())
  const invalidTime = cleanTimes.find(time => !isValidTime(time))
  if (invalidTime) {
    throw new Error(`提醒时间格式不正确：${invalidTime}`)
  }
  const endDate = getLimitedString(data.endDate, '结束日期', 30)
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('结束日期格式不正确，应为 YYYY-MM-DD')
  }

  return {
    id: data.id || '',
    name: getLimitedString(data.name, '药品名称', 50, true),
    dosage: getLimitedString(data.dosage, '剂量说明', 80),
    times: Array.from(new Set(cleanTimes)),
    subscribe: !!data.subscribe,
    startDate: getLimitedString(data.startDate, '开始日期', 30) || '今天',
    endDate: endDate || ''
  }
}

/**
 * 校验用药确认入参并归一化。
 * @param {Object} payload 用药确认入参。
 * @returns {Object} 可落库的用药确认字段。
 */
function validateMedicationConfirmationPayload(payload) {
  const data = assertPayloadObject(payload, '用药确认')
  const status = getEnumValue(data.status, ['taken', 'skipped', 'snoozed'], '用药确认状态')
  const defaultStatusText = {
    taken: '已服',
    skipped: '已跳过',
    snoozed: '稍后提醒'
  }
  return {
    logId: getLimitedString(data.logId, '用药日志ID', 80, true),
    time: getLimitedString(data.time, '用药时间', 20, true),
    name: getLimitedString(data.name, '药品名称', 50, true),
    dosage: getLimitedString(data.dosage, '剂量说明', 80),
    status,
    statusText: getLimitedString(data.statusText, '状态文案', 20) || defaultStatusText[status]
  }
}

/**
 * 校验邀请码。
 * @param {Object} payload 入参。
 * @returns {string} 邀请码。
 */
function validateInviteCodePayload(payload) {
  const data = assertPayloadObject(payload, '家庭邀请')
  return getLimitedString(data.inviteCode || data.inviteId, '邀请码', 32, true)
}

/**
 * 归一化家庭邀请入参。
 * @param {Object} payload 邀请页参数。
 * @returns {Object} 家庭邀请配置。
 */
function normalizeFamilyInvitePayload(payload = {}) {
  const relation = getInviteRelation(payload.selectedRelation)
  const scopes = Array.isArray(payload.scopes)
    ? payload.scopes.filter(scope => scope && scope.key)
    : getDefaultFamilyScopes()
  if (!scopes.some(scope => scope.enabled)) {
    throw new Error('请至少选择一个授权范围')
  }
  return {
    relation,
    scopes,
    member: {
      ...getDefaultFamilyMember(),
      name: relation.label,
      relation: relation.label,
      role: relation.meta,
      status: '待加入',
      desc: '家属加入后，可在授权范围内查看健康记录和提醒状态。'
    }
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
  const dayOfWeek = todayDate.getUTCDay()
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
        'recordDetail': () => getRecordService().getRecordDetailData(openId, payload),
        'recordList': () => getRecordService().getRecordListData(openId, payload),
        'medList': () => getMedicationService().getMedListData(openId),
        'medHistory': () => getMedicationService().getMedHistoryData(openId, payload),
        'medEdit': () => getMedicationService().getMedEditData(openId, payload?.planId),
        'medConfirm': () => getMedicationService().getMedConfirmData(openId, payload?.planId, payload?.logId),
        'trend': () => getRecordService().getTrendData(openId, payload),
        'family': () => getFamilyService().getFamilyData(openId),
        'familyInvite': () => getFamilyService().getFamilyInviteData(),
        'familyJoin': () => getFamilyService().getFamilyJoinData(payload),
        'familyAuth': () => getFamilyService().getFamilyAuthData(openId, payload),
        'report': () => getReportService().getReportData(openId),
        'reminder': () => getSettingsDataService().getReminderData(openId),
        'reminderSettings': () => getSettingsDataService().getReminderSettingsData(openId),
        'me': () => getMeData(openId),
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
      'updateFamilyAuth': () => getFamilyService().updateFamilyAuth(openId, payload),
      'createFamilyInvite': () => getFamilyService().createFamilyInvite(openId, payload),
      'joinFamilyByInvite': () => getFamilyService().joinFamilyByInvite(openId, payload),
      'revokeFamilyMember': () => getFamilyService().revokeFamilyMember(openId, payload),
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
      stack: err.stack
    }
  }
}
