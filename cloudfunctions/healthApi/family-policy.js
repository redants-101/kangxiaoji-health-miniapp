/**
 * 家庭权限域：默认成员、三级权限规则、提醒规则与归一化。
 * 云函数 index.js、family-service.js、scripts/health-api-regression.js 共同引用，
 * 权限判断只有这一份实现。本文件不依赖 wx-server-sdk，require 无初始化/网络副作用。
 *
 * 契约来源：2026-09-22 decisions.md 与用户三项确认：
 * - write 动作要求同 scope read+write；report 不支持 write；
 * - read=false、remind=true 仅出电话提醒按钮，不显示数据或提醒明细；
 * - 提醒明细可见 = read && remind && noticeRules 对应项（合取）。
 */

const { assertPayloadObject, getLimitedString } = require('./payload-helpers')

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

// 四种 scope 的固定展示信息（标题与用途不接受前端改写）
const SCOPE_CATALOG_V2 = {
  bloodPressure: { title: '血压记录', meta: '数值、测量时间、场景标签和趋势' },
  bloodGlucose: { title: '血糖记录', meta: '数值、测量时间、测量场景和趋势' },
  medicine: { title: '用药确认', meta: '用药计划、确认状态和未确认记录' },
  report: { title: '健康记录周报', meta: '每周记录汇总和趋势回顾' }
}

const SCOPE_KEYS_V2 = Object.keys(SCOPE_CATALOG_V2)

// 八种家属关系（decisions.md 第 1 节第 6 项）
const FAMILY_RELATIONS_V2 = [
  { key: 'daughter', label: '女儿', meta: '主要照护人' },
  { key: 'son', label: '儿子', meta: '紧急联系人' },
  { key: 'spouse', label: '配偶', meta: '共同管理' },
  { key: 'granddaughter', label: '孙女', meta: '主要照护人' },
  { key: 'grandson', label: '孙子', meta: '主要照护人' },
  { key: 'sibling', label: '兄弟姐妹', meta: '共同管理' },
  { key: 'caregiver', label: '护工', meta: '协助管理' },
  { key: 'other', label: '家属', meta: '共同管理' }
]

function getFamilyRelationV2(relationKey) {
  return FAMILY_RELATIONS_V2.find(item => item.key === relationKey) || null
}

// 读取严格布尔字段：undefined 默认 false；true/false 原样；其余类型拒绝
function readBooleanField(item, field) {
  const value = item[field]
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new Error(`授权${field}必须是布尔值`)
  }
  return value
}

/**
 * 归一化三级权限 scopes（新契约）。
 * - 必须为数组；四 key 白名单，未知/重复 key 拒绝；
 * - read/write/remind 只认真布尔，缺失默认 false，旧 enabled 字段忽略；
 * - report 不接受 write（周报无代录动作）；
 * - 输出按 bloodPressure/bloodGlucose/medicine/report 固定顺序；不修改输入。
 * @param {Array<Object>} rawScopes 页面提交的 scopes。
 * @returns {Array<Object>} 归一化 scopes。
 */
function normalizeFamilyScopesV2(rawScopes) {
  if (!Array.isArray(rawScopes)) {
    throw new Error('授权范围格式不正确')
  }

  const seen = new Set()
  const byKey = {}
  rawScopes.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !item.key) {
      throw new Error('授权项格式不正确')
    }
    if (!SCOPE_CATALOG_V2[item.key]) {
      throw new Error(`未知授权项：${item.key}`)
    }
    if (seen.has(item.key)) {
      throw new Error(`授权范围不能重复：${item.key}`)
    }
    seen.add(item.key)
    byKey[item.key] = item
  })

  return SCOPE_KEYS_V2.map((key) => {
    const item = byKey[key] || { key }
    const write = readBooleanField(item, 'write')
    if (key === 'report' && write) {
      throw new Error('健康记录周报不支持代录权限')
    }
    return {
      key,
      title: SCOPE_CATALOG_V2[key].title,
      meta: SCOPE_CATALOG_V2[key].meta,
      read: readBooleanField(item, 'read'),
      write,
      remind: readBooleanField(item, 'remind')
    }
  })
}

const NOTICE_RULE_KEYS_V2 = ['missedMedicine', 'missingRecord', 'weeklyReport']

/**
 * 归一化提醒规则：三维布尔对象（统一存储/接口契约）。
 * 缺失默认 false，非布尔拒绝，多余键剔除；数组（旧页面形态）拒绝而不静默重置。
 * @param {Object} [rawRules] 页面提交的 noticeRules。
 * @returns {Object} 三维 noticeRules。
 */
function normalizeNoticeRulesV2(rawRules = {}) {
  if (Array.isArray(rawRules)) {
    throw new Error('提醒规则格式不正确')
  }
  const source = rawRules && typeof rawRules === 'object' ? rawRules : {}
  const result = {}
  NOTICE_RULE_KEYS_V2.forEach((key) => {
    const value = source[key]
    if (value === undefined) {
      result[key] = false
    } else if (typeof value !== 'boolean') {
      throw new Error(`提醒规则${key}必须是布尔值`)
    } else {
      result[key] = value
    }
  })
  return result
}

// 将 scopes 数组转为 key→scope 映射；非数组安全返回空映射
function toScopeMap(scopes) {
  const map = {}
  if (Array.isArray(scopes)) {
    scopes.forEach((scope) => {
      if (scope && scope.key) map[scope.key] = scope
    })
  }
  return map
}

/**
 * 判断 scope 数据是否可读。
 * @param {Array<Object>} scopes 归一化 scopes。
 * @param {string} key scope key。
 * @returns {boolean}
 */
function canViewScope(scopes, key) {
  const scope = toScopeMap(scopes)[key]
  return !!(scope && scope.read === true)
}

/**
 * 判断是否显示“电话提醒”按钮（号码在任一 scope.remind=true 时由接口返回）。
 * read=false 不影响按钮显示——按确认语义，此时仅出按钮、不出提醒明细。
 * @param {Array<Object>} scopes 归一化 scopes。
 * @param {string} key scope key。
 * @returns {boolean}
 */
function canShowPhoneReminder(scopes, key) {
  const scope = toScopeMap(scopes)[key]
  return !!(scope && scope.remind === true)
}

/**
 * 生成家属授权范围展示文案：read=true 的标题顿号连接；无授权返回暂未授权。
 * @param {Array<Object>} scopes 归一化 scopes。
 * @returns {string}
 */
function getScopeTextV2(scopes) {
  const titles = (Array.isArray(scopes) ? scopes : [])
    .filter(scope => scope && scope.read === true)
    .map(scope => scope.title || (SCOPE_CATALOG_V2[scope.key] && SCOPE_CATALOG_V2[scope.key].title))
    .filter(Boolean)
  return titles.length ? titles.join('、') : '暂未授权'
}

/**
 * 邀请页 scopes 初始态：四块 read+remind 默认开、write 默认关（代录须显式打开）。
 * @returns {Array<Object>}
 */
function getDefaultInviteScopesV2() {
  return normalizeFamilyScopesV2(SCOPE_KEYS_V2.map(key => ({ key, read: true, remind: true })))
}

/**
 * 邀请默认提醒规则：沿用旧默认意图（漏服开、连续未记录关、周报开）。
 * @returns {Object}
 */
function getDefaultInviteNoticeRulesV2() {
  return { missedMedicine: true, missingRecord: false, weeklyReport: true }
}

/**
 * 归一化家庭邀请入参：关系（8 种，未知拒绝，缺省女儿）+ scopes（缺省邀请初始态）+ 待加入成员。
 * @param {Object} [payload] 邀请页参数。
 * @returns {Object} { relation, scopes, member }
 */
function normalizeFamilyInvitePayloadV2(payload = {}) {
  const relation = getFamilyRelationV2(payload.selectedRelation || 'daughter')
  if (!relation) {
    throw new Error(`家属关系不合法：${payload.selectedRelation}`)
  }
  // 服务端提交校验：scopes 必须为数组。缺失/null/字符串/对象明确拒绝；
  // 空数组合法，经 normalizeFamilyScopesV2 后四块全部 false。
  // 页面预选值只存在于 familyInvite 展示接口，不作为此处缺失输入的授权兜底。
  if (!Array.isArray(payload.scopes)) {
    throw new Error('授权范围格式不正确')
  }
  const scopes = normalizeFamilyScopesV2(payload.scopes)
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
 * 归一化家属授权保存入参。scopes/noticeRules 非法时在服务入口抛错。
 * @param {Object} [payload] 页面提交的家属授权。
 * @returns {Object} family_auth 目标字段。
 */
function normalizeFamilyAuthPayloadV2(payload = {}) {
  const member = {
    ...getDefaultFamilyMember(),
    ...(payload.member || {})
  }
  return {
    member,
    memberName: payload.memberName || member.name || '',
    inviteCode: payload.inviteCode || '',
    scopes: normalizeFamilyScopesV2(
      Array.isArray(payload.scopes) ? payload.scopes : SCOPE_KEYS_V2.map(key => ({ key }))
    ),
    noticeRules: normalizeNoticeRulesV2(payload.noticeRules),
    activities: Array.isArray(payload.activities) ? payload.activities : [],
    status: payload.status || 'active'
  }
}

/**
 * 动作白名单：返回动作所需的 scope 条件；不支持的动作无条目（恒拒绝）。
 * 用药计划管理、健康记录删除对家属永远不开放。
 */
const SCOPE_ACTIONS_V2 = {
  recordBloodPressure: key => key === 'bloodPressure',
  recordBloodGlucose: key => key === 'bloodGlucose',
  confirmMedication: key => key === 'medicine',
  revokeMedicationConfirmation: key => key === 'medicine'
}

/**
 * 判断家属能否执行某动作。要求动作受支持、对应 scope read+write 同时为 true。
 * 未知动作或输入缺失一律返回 false（不抛错）。
 * @param {Array<Object>} scopes 归一化 scopes。
 * @param {string} action 动作标识。
 * @returns {boolean}
 */
function canPerformScopeAction(scopes, action) {
  const matchKey = SCOPE_ACTIONS_V2[action]
  if (typeof matchKey !== 'function') return false
  const map = toScopeMap(scopes)
  const key = SCOPE_KEYS_V2.find(k => matchKey(k))
  const scope = key ? map[key] : null
  return !!(scope && scope.read === true && scope.write === true)
}

// 提醒类型 → 需要满足的 scope 块（read+remind 合取）
const REMINDER_SCOPE_GATES_V2 = {
  missedMedicine: ['medicine'],
  missingRecord: ['bloodPressure', 'bloodGlucose'],
  weeklyReport: ['report']
}

/**
 * 判断某类提醒的明细是否对家属可见。
 * 合取：noticeRules 对应项为 true，且对应 scope 块 read+remind 同时为 true
 * （多块时任一块满足即可，如连续未记录看血压或血糖块）。
 * @param {Array<Object>} scopes 归一化 scopes。
 * @param {Object} rules 归一化 noticeRules。
 * @param {string} reminderKey 提醒类型 key。
 * @returns {boolean}
 */
function canViewReminderInfo(scopes, rules, reminderKey) {
  const gates = REMINDER_SCOPE_GATES_V2[reminderKey]
  if (!gates || !rules || rules[reminderKey] !== true) return false
  const map = toScopeMap(scopes)
  return gates.some((key) => {
    const scope = map[key]
    return scope && scope.read === true && scope.remind === true
  })
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

// ============================================================================
// A6 电话提醒（decisions #4/#12）：电话提醒替代订阅消息推送。
// - 号码属 owner 的家庭授权配置（family_auth 单文档 contactPhone 字段）；
// - 家属侧仅脱敏展示（138****1234）；完整号码只在拨号时经 action 按需返回；
// - 任一 scope.remind=true 才可见/可取号；撤销或关闭 remind 后立即不再返回；
// - 完整号码不写入日志与错误信息（错误文案固定，不回显输入）。
// ============================================================================

const CONTACT_PHONE_PATTERN = /^1[3-9]\d{9}$/

/**
 * 归一化提醒电话入参。
 * undefined/null → null（未提供，不改动既有配置）；'' → 清空；
 * 合法 11 位大陆手机号 → 原样返回；其余一律拒绝（错误信息不回显输入）。
 * @param {*} raw 页面提交的 contactPhone。
 * @returns {string|null}
 */
function normalizeContactPhone(raw) {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') {
    throw new Error('提醒电话格式不正确，请填写 11 位手机号')
  }
  const value = raw.trim()
  if (value === '') return ''
  if (!CONTACT_PHONE_PATTERN.test(value)) {
    throw new Error('提醒电话格式不正确，请填写 11 位手机号')
  }
  return value
}

/**
 * 脱敏手机号：138****1234；非法输入返回空串（不产出半掩码）。
 * @param {*} phone 完整号码。
 * @returns {string}
 */
function maskContactPhone(phone) {
  if (typeof phone !== 'string' || !CONTACT_PHONE_PATTERN.test(phone)) return ''
  return `${phone.slice(0, 3)}****${phone.slice(7)}`
}

/**
 * 是否允许电话提醒：任一 scope.remind=true（decisions 4.1）。
 * read 不参与该判断——read=false+remind=true 时仅出电话按钮。
 * @param {Array<Object>} scopes 归一化 scopes。
 * @returns {boolean}
 */
function canCallReminderPhone(scopes) {
  return (Array.isArray(scopes) ? scopes : []).some(scope => scope && scope.remind === true)
}

/**
 * 创建用户显示名称查询函数。
 * @param {Object} deps 依赖。
 * @param {Object} deps.db 数据库实例。
 * @param {Object} deps.collections 集合名映射。
 * @returns {(openId: string) => Promise<string>}
 */
function createProfileDisplayName({ db, collections }) {
  return async function getProfileDisplayName(openId) {
    const { data } = await db.collection(collections.profiles)
      .where({ _openid: openId })
      .limit(1)
      .get()
    return data[0]?.name || '家人'
  }
}

/**
 * 创建家属访问上下文查询函数（含 owner 本人预览的 ownerPreview 回退分支）。
 * @param {Object} deps 依赖。
 * @param {Object} deps.db 数据库实例。
 * @param {Object} deps.collections 集合名映射。
 * @returns {(openId: string) => Promise<Object|null>}
 */
function createFamilyAccessContext({ db, collections }) {
  return async function getFamilyAccessContext(openId) {
    const { data: relations } = await db.collection(collections.familyMembers)
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
    const { data: authList } = await db.collection(collections.familyAuth)
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
        scopes: normalizeFamilyScopesV2(
          Array.isArray(auth.scopes) ? auth.scopes : SCOPE_KEYS_V2.map(key => ({ key }))
        ),
        noticeRules: normalizeNoticeRulesV2(auth.noticeRules),
        status: auth.status || 'active'
      }
    }
  }
}

/**
 * 成员锚点文档 ID：family_members 中同一成员的确定性 _id。
 * 用于事务内把同一成员的并发加入压到同一把文档锁上（A1 1:1 保障）。
 * @param {string} memberOpenId 成员 openId。
 * @returns {string} 锚点文档 _id。
 */
function getMemberAnchorId(memberOpenId) {
  return `active-${memberOpenId}`
}

// ============================================================================
// A2：邀请错误码契约（单点定义；页面以字面量码消费，不跨包引用本文件）
// 依据 decisions #9（显式错误码与文案）、#10（频控）、#15（expiresAt 必填）。
// 频控码与邀请码错误严格分离，不混用。
// ============================================================================

const INVITE_CODE_PATTERN = /^KXJ[0-9A-Z]{9}$/
const INVITE_FAILURE_LIMIT_PER_DAY = 20

const FAMILY_INVITE_ERRORS = {
  notFound: { code: 'FAMILY_INVITE_NOT_FOUND', message: '邀请不存在或已失效' },
  invalid: { code: 'FAMILY_INVITE_INVALID', message: '邀请码无效，请核对后重试' },
  expired: { code: 'FAMILY_INVITE_EXPIRED', message: '邀请已过期，请让家人重新发起' },
  revoked: { code: 'FAMILY_INVITE_REVOKED', message: '邀请已撤销，请让家人重新发起' },
  used: { code: 'FAMILY_INVITE_USED', message: '邀请已被其他家属使用' },
  self: { code: 'FAMILY_INVITE_SELF', message: '不能加入自己创建的家庭邀请' },
  bound: { code: 'FAMILY_MEMBER_BOUND', message: '你已绑定一位家人，请先解除原绑定' },
  rateLimited: { code: 'FAMILY_INVITE_RATE_LIMITED', message: '今日尝试次数过多，请明天再试' }
}

module.exports = {
  getDefaultFamilyMember,
  SCOPE_KEYS_V2,
  FAMILY_RELATIONS_V2,
  getFamilyRelationV2,
  normalizeFamilyScopesV2,
  normalizeNoticeRulesV2,
  canViewScope,
  canShowPhoneReminder,
  canCallReminderPhone,
  normalizeContactPhone,
  maskContactPhone,
  CONTACT_PHONE_PATTERN,
  getScopeTextV2,
  getDefaultInviteScopesV2,
  getDefaultInviteNoticeRulesV2,
  normalizeFamilyInvitePayloadV2,
  normalizeFamilyAuthPayloadV2,
  canPerformScopeAction,
  canViewReminderInfo,
  validateInviteCodePayload,
  createProfileDisplayName,
  createFamilyAccessContext,
  getMemberAnchorId,
  INVITE_CODE_PATTERN,
  INVITE_FAILURE_LIMIT_PER_DAY,
  FAMILY_INVITE_ERRORS
}
