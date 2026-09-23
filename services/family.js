const {
  STORAGE_KEYS,
  clearCacheByKeys,
  createRecordId,
  getRelatedCacheKeys,
  markDirty,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorageAndInvalidate
} = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')

// A5：家族事件（撤销/改权/加入/代录成功）后需要失效并重载的页面键。
// 家族敏感读本身零缓存（services/core isFamilySensitiveRead），这里同时负责：
// 1) 清掉这些键的 owner 模式缓存条目（同键不同 payload 共享前缀）；
// 2) 置脏标记，驱动已打开页面 onShow 重载，拿到撤销/改权/代录后的最新服务端状态。
const FAMILY_PAGE_KEYS = ['homeFamily', 'family', 'trend', 'recordList', 'recordDetail', 'medList', 'medHistory']

/**
 * 家族事件后的精准缓存失效：清七个家族页面键并置脏。
 * 只在云端动作成功后调用；本地镜像另行按 memberId 精确更新，不做全量清空。
 * @returns {void}
 */
function invalidateFamilyCaches() {
  clearCacheByKeys(FAMILY_PAGE_KEYS)
  markDirty(FAMILY_PAGE_KEYS)
}

/**
 * 家庭协同服务模块（三级权限契约）。
 * 负责家属邀请、加入家庭、家庭页成员展示和家属权限的本地镜像持久化。
 * 注意：本地镜像只在云端成功后写入，用于离线回显与缓存，
 * 不是授权依据；任何接口以云端 family-policy 判定为准，镜像不放行任何动作。
 */

function getStoredFamilyAuth() {
  return readStorage(STORAGE_KEYS.familyAuth, null)
}

function normalizeMemberStatus(status) {
  if (status === 'active' || status === '已授权') return '已授权'
  if (status === 'pending' || status === '待加入') return '待加入'
  if (status === 'revoked' || status === '已解除') return '已解除'
  return status || '已授权'
}

function getRelationInitial(relation = '') {
  return relation ? relation.slice(0, 1) : '家'
}

// 小程序端关系目录：与云端 FAMILY_RELATIONS_V2 保持一致（云端目录无法打包进小程序，故前端自持一份展示数据）
const FAMILY_RELATIONS = [
  { key: 'daughter', label: '女儿', meta: '主要照护人' },
  { key: 'son', label: '儿子', meta: '紧急联系人' },
  { key: 'spouse', label: '配偶', meta: '共同管理' },
  { key: 'granddaughter', label: '孙女', meta: '主要照护人' },
  { key: 'grandson', label: '孙子', meta: '主要照护人' },
  { key: 'sibling', label: '兄弟姐妹', meta: '共同管理' },
  { key: 'caregiver', label: '护工', meta: '协助管理' },
  { key: 'other', label: '家属', meta: '共同管理' }
]

function getRelationMeta(relationKey) {
  const found = FAMILY_RELATIONS.find(item => item.key === relationKey) || FAMILY_RELATIONS[0]
  return { relation: found.label, role: found.meta }
}

// scope 展示目录（与云端 SCOPE_CATALOG_V2 一致，供 UI 初始化与文案兜底）
const SCOPE_CATALOG = {
  bloodPressure: { title: '血压记录', meta: '数值、测量时间、场景标签和趋势' },
  bloodGlucose: { title: '血糖记录', meta: '数值、测量时间、测量场景和趋势' },
  medicine: { title: '用药确认', meta: '用药计划、确认状态和未确认记录' },
  report: { title: '健康记录周报', meta: '每周记录汇总和趋势回顾' }
}
const SCOPE_KEYS = Object.keys(SCOPE_CATALOG)

function getScopeText(scopes, fallback = '暂未授权') {
  if (!Array.isArray(scopes)) return fallback
  const readTitles = scopes
    .filter(item => item && item.read === true)
    .map(item => item.title || (SCOPE_CATALOG[item.key] && SCOPE_CATALOG[item.key].title))
    .filter(Boolean)
  return readTitles.length ? readTitles.join('、') : fallback
}

// 邀请页 scopes 初始态：查看/提醒默认开、代录默认关（与云端默认一致）
function getDefaultInviteScopes() {
  return SCOPE_KEYS.map(key => ({
    key,
    title: SCOPE_CATALOG[key].title,
    meta: SCOPE_CATALOG[key].meta,
    read: true,
    write: false,
    remind: true
  }))
}

// 提醒规则固定目录：noticeRules 存储为对象，页面列表经显式转换
const NOTICE_RULE_CATALOG = [
  { key: 'missedMedicine', title: '用药未确认提醒', meta: '超过设定时间未确认时提醒家属查看' },
  { key: 'missingRecord', title: '连续未记录提醒', meta: '连续多天未记录时提醒家属关注' },
  { key: 'weeklyReport', title: '周报生成提醒', meta: '周报生成后通知家属查看' }
]

function noticeRulesToList(noticeRules) {
  const rules = noticeRules || {}
  return NOTICE_RULE_CATALOG.map(item => ({
    key: item.key,
    title: item.title,
    meta: item.meta,
    checked: rules[item.key] === true
  }))
}

function mapFamilyMember(member, fallback = {}, index = 0) {
  const relation = member.relation || fallback.relation || '家属'
  // bound=false 的成员卡（邀请预览）不是关系行：保留空 id，禁止客户端拿合成 id 提交改权/撤销
  const bound = member.bound !== false && fallback.bound !== false
  const id = bound
    ? (member.id || member._id || fallback.id || `member-${index + 1}`)
    : (member.id || '')
  return {
    id,
    bound,
    initial: member.initial || fallback.initial || getRelationInitial(relation),
    name: member.name || member.memberName || fallback.name || '家庭成员',
    relation,
    role: member.role || fallback.role || '主要照护人',
    status: normalizeMemberStatus(member.status || fallback.status),
    scope: member.scope || member.scopeText || fallback.scope || '暂未授权',
    lastSeen: member.lastSeen || fallback.lastSeen || '最近暂无查看记录'
  }
}

function mapMemberCardToAuthMember(memberCard) {
  return {
    name: memberCard.name,
    relation: memberCard.relation,
    role: memberCard.role,
    status: memberCard.status,
    desc: '可协助查看记录、用药确认和周报。权限变更后立即生效。'
  }
}

function updateFamilyAuthLocal(payload, remoteResult) {
  // A5：云端改权已成功——家族页面缓存精准失效并置脏（镜像按 memberId 精确更新，见下）
  invalidateFamilyCaches()
  // A1：镜像必须携带服务端确认的 memberId；缺失时不镜像、不造卡，直接返回远端结果。
  // 镜像仅用于离线回显，不是授权依据；服务端拒绝时 resolveRemote 已抛错，本函数不会执行。
  const memberId = payload && payload.memberId
  if (!memberId) return remoteResult

  const storedAuth = getStoredFamilyAuth() || {}
  const storedMembers = Array.isArray(storedAuth.members) ? storedAuth.members : []
  // 本地找不到对应成员卡（缓存过期）时跳过镜像，等下次拉取刷新；不新建假卡
  if (!storedMembers.some(item => item.id === memberId)) return remoteResult

  const scopes = Array.isArray(payload.scopes) ? payload.scopes : storedAuth.scopes || []
  const targetCard = mapFamilyMember({
    id: memberId,
    bound: true,
    name: payload.member && payload.member.name,
    relation: payload.member && payload.member.relation,
    role: payload.member && payload.member.role,
    status: payload.member && payload.member.status,
    scope: getScopeText(scopes)
  }, storedMembers.find(item => item.id === memberId))

  const members = storedMembers.map(item => (item.id === memberId ? targetCard : item))

  const nextState = {
    ...storedAuth,
    currentMemberId: memberId,
    member: mapMemberCardToAuthMember(targetCard),
    memberName: targetCard.name,
    members,
    scopes,
    noticeRules: payload.noticeRules || storedAuth.noticeRules || {},
    activities: Array.isArray(payload.activities) ? payload.activities : storedAuth.activities || [],
    status: payload.status || storedAuth.status || 'active',
    updatedAt: new Date().toISOString()
  }

  writeStorageAndInvalidate(STORAGE_KEYS.familyAuth, nextState, getRelatedCacheKeys(STORAGE_KEYS.familyAuth))
  return remoteResult && remoteResult.memberId
    ? { ...remoteResult, localState: nextState }
    : nextState
}

function createFamilyInviteLocal(payload, remoteResult) {
  // A5：云端邀请已成功——家庭页/家属页缓存失效（新待加入卡片）
  invalidateFamilyCaches()
  const storedAuth = getStoredFamilyAuth() || {}
  const relationMeta = getRelationMeta(payload.selectedRelation)
  const inviteCode = (remoteResult && (remoteResult.inviteCode || remoteResult.inviteId)) || createRecordId('invite').replace(/-/g, '').slice(-12)
  const memberId = storedAuth.currentMemberId || createRecordId('member')
  // 本地镜像不做授权兜底：非数组输入按最小授权镜像（正常情况下云端会先拒绝，镜像根本不执行）
  const scopes = Array.isArray(payload.scopes) ? payload.scopes : SCOPE_KEYS.map(key => ({ key }))
  const previewMember = mapFamilyMember({
    id: memberId,
    name: storedAuth.memberName || relationMeta.relation,
    relation: relationMeta.relation,
    role: relationMeta.role,
    status: '待加入',
    scope: getScopeText(scopes)
  })

  const nextState = {
    ...storedAuth,
    currentMemberId: memberId,
    inviteCode,
    memberName: previewMember.name,
    member: mapMemberCardToAuthMember(previewMember),
    members: Array.isArray(storedAuth.members) && storedAuth.members.length ? storedAuth.members : [previewMember],
    scopes,
    noticeRules: { missedMedicine: true, missingRecord: false, weeklyReport: true },
    status: 'pending',
    // A2（decisions #15）：本地镜像同样携带 24h 有效期，供本地模式过期校验
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    sharePath: (remoteResult && remoteResult.sharePath) || `/pages/family-sub/family-join/index?inviteCode=${inviteCode}`,
    updatedAt: new Date().toISOString()
  }

  writeStorageAndInvalidate(STORAGE_KEYS.familyAuth, nextState, getRelatedCacheKeys(STORAGE_KEYS.familyAuth))
  return {
    ...nextState,
    inviteCode,
    inviteId: inviteCode,
    sharePath: nextState.sharePath
  }
}

function joinFamilyByInviteLocal(payload, remoteResult) {
  // A5：云端加入已成功——B 端家族页面缓存失效并置脏（拒绝态页面需重载为授权态）
  invalidateFamilyCaches()
  const storedAuth = getStoredFamilyAuth() || {}
  const inviteCode = (payload && payload.inviteCode) || ''

  // A2（decisions #15）：本地模式镜像校验——码必须匹配且未过期，失败不假成功。
  // 错误码与云端契约一致，页面可统一消费。
  const localInviteError = (code, message) => {
    const error = new Error(message)
    error.code = code
    throw error
  }
  // 无码（payload 与本地记录都没有）：尚未获得邀请，不得假成功
  if (!inviteCode && !storedAuth.inviteCode) {
    localInviteError('FAMILY_INVITE_NOT_FOUND', '邀请不存在或已失效')
  }
  if (storedAuth.inviteCode && inviteCode !== storedAuth.inviteCode) {
    localInviteError('FAMILY_INVITE_NOT_FOUND', '邀请不存在或已失效')
  }
  if (storedAuth.inviteCode) {
    if (!storedAuth.expiresAt) {
      localInviteError('FAMILY_INVITE_INVALID', '邀请码无效，请核对后重试')
    }
    if (new Date(storedAuth.expiresAt).getTime() < Date.now()) {
      localInviteError('FAMILY_INVITE_EXPIRED', '邀请已过期，请让家人重新发起')
    }
  }

  const nextState = {
    ...storedAuth,
    inviteCode,
    status: 'active',
    joinedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  writeStorageAndInvalidate(STORAGE_KEYS.familyAuth, nextState, getRelatedCacheKeys(STORAGE_KEYS.familyAuth))
  return remoteResult && remoteResult.status ? remoteResult : nextState
}

function revokeFamilyMemberLocal(payload, remoteResult) {
  // A5：云端撤销已成功——家族页面缓存精准失效并置脏；
  // 镜像只按服务端确认的 memberId 精确移除（撤 M1 不动 M2 的卡片）。
  invalidateFamilyCaches()
  // A1：撤销镜像只按服务端确认的 memberId 精确移除；缺失时不镜像。
  const memberId = payload && payload.memberId
  if (!memberId) return remoteResult

  const storedAuth = getStoredFamilyAuth() || {}
  const currentMembers = Array.isArray(storedAuth.members) ? storedAuth.members : []
  const nextMembers = currentMembers.filter(item => item.id !== memberId)
  const nextCurrent = nextMembers[0] || null

  const nextState = {
    ...storedAuth,
    members: nextMembers,
    currentMemberId: nextCurrent ? nextCurrent.id : '',
    member: nextCurrent ? mapMemberCardToAuthMember(nextCurrent) : null,
    memberName: nextCurrent ? nextCurrent.name : '',
    status: nextCurrent ? storedAuth.status || 'active' : 'revoked',
    updatedAt: new Date().toISOString()
  }

  writeStorageAndInvalidate(STORAGE_KEYS.familyAuth, nextState, getRelatedCacheKeys(STORAGE_KEYS.familyAuth))
  return {
    memberId,
    revoked: true
  }
}

function getNoFamilyAccessData(baseData) {
  return {
    ...baseData,
    member: {
      name: '家属',
      scopeText: '暂未授权'
    },
    todayAlert: {
      title: '暂无授权数据',
      meta: '授权已解除或尚未完成家庭授权，请重新获得邀请后查看。'
    },
    latestMetrics: [],
    medicineLogs: [],
    reportSummary: '暂无可查看的周报数据。'
  }
}

function enforceHomeFamilyAccess(baseData) {
  const storedAuth = getStoredFamilyAuth()
  if (!storedAuth) return baseData
  if (storedAuth.status === 'revoked') return getNoFamilyAccessData(baseData)
  if (Array.isArray(storedAuth.members) && !storedAuth.members.length && !storedAuth.inviteCode) {
    return getNoFamilyAccessData(baseData)
  }
  return baseData
}

function mergeFamilyMemberScope(baseData) {
  const storedAuth = getStoredFamilyAuth()
  if (!storedAuth) return baseData

  const storedMembers = Array.isArray(storedAuth.members) ? storedAuth.members : []
  if (storedMembers.length) {
    const baseMembers = Array.isArray(baseData.members) ? baseData.members : []
    return {
      ...baseData,
      familyCount: storedMembers.length,
      members: storedMembers.map((item, index) => mapFamilyMember(item, baseMembers[index], index))
    }
  }

  if (!storedAuth.scopes) return baseData
  const scope = getScopeText(storedAuth.scopes)
  const members = Array.isArray(baseData.members) ? baseData.members : []
  return {
    ...baseData,
    members: members.map((item, index) => {
      if (index !== 0) return item
      return {
        ...item,
        scope
      }
    })
  }
}

function normalizeFamilyData(remoteData) {
  return withMockPageData('family', remoteData, (baseData, remote) => {
    const merged = deepMerge(baseData, remote)
    const remoteMembers = Array.isArray(remote.members) ? remote.members : []
    if (!remoteMembers.length) {
      return mergeFamilyMemberScope(merged)
    }

    const baseMembers = Array.isArray(baseData.members) ? baseData.members : []
    const members = remoteMembers.map((item, index) => mapFamilyMember(item, baseMembers[index], index))
    return mergeFamilyMemberScope({
      ...merged,
      familyCount: members.length,
      members
    })
  })
}

function normalizeFamilyInviteData(remoteData) {
  return withMockPageData('familyInvite', remoteData, (baseData, remote) => deepMerge(baseData, remote))
}

function normalizeFamilyJoinData(remoteData) {
  return withMockPageData('familyJoin', remoteData, (baseData, remote) => deepMerge(baseData, remote))
}

function mergeFamilyAuth(baseData, memberId) {
  const storedAuth = getStoredFamilyAuth()
  const merged = storedAuth ? deepMerge(baseData, storedAuth) : baseData
  const targetMemberId = memberId || (storedAuth && storedAuth.currentMemberId)
  const storedMembers = storedAuth && Array.isArray(storedAuth.members) ? storedAuth.members : []
  const targetMember = storedMembers.find(item => item.id === targetMemberId)

  if (!targetMember) {
    return {
      ...merged,
      memberId: targetMemberId || '',
      member: merged.member || baseData.member
    }
  }

  return {
    ...merged,
    memberId: targetMember.id,
    member: {
      ...(merged.member || {}),
      ...mapMemberCardToAuthMember(targetMember)
    }
  }
}

function normalizeFamilyAuthData(remoteData, memberId) {
  return withMockPageData('familyAuth', remoteData, (baseData, remote) => {
    const merged = deepMerge(baseData, remote)
    return mergeFamilyAuth(merged, memberId)
  })
}

function getFamilyJoinHintData() {
  return resolveMockData('familyJoinHint')
}

function getFamilyData() {
  return resolveMockData('family').then(normalizeFamilyData)
}

function getFamilyInviteData() {
  return resolveMockData('familyInvite').then(normalizeFamilyInviteData)
}

function getFamilyJoinData(payload = {}) {
  return resolveMockData('familyJoin', payload).then(normalizeFamilyJoinData)
}

function getFamilyAuthData(memberId) {
  const payload = memberId ? { memberId } : {}
  return resolveMockData('familyAuth', payload).then((remoteData) => normalizeFamilyAuthData(remoteData, memberId))
}

function updateFamilyAuth(payload) {
  return resolveRemote('updateFamilyAuth', payload, updateFamilyAuthLocal, {
    mirrorLocal: true
  })
}

function createFamilyInvite(payload) {
  return resolveRemote('createFamilyInvite', payload, createFamilyInviteLocal, {
    mirrorLocal: true
  })
}

function joinFamilyByInvite(payload) {
  return resolveRemote('joinFamilyByInvite', payload, joinFamilyByInviteLocal, {
    mirrorLocal: true
  })
}

function revokeFamilyMember(payload) {
  return resolveRemote('revokeFamilyMember', payload, revokeFamilyMemberLocal, {
    mirrorLocal: true
  })
}

// A4 家属代录写路由（服务端闸口鉴权；本地不缓存写入结果，以云端响应为准）
// A5：云端成功后精准失效家族页面缓存并置脏（owner 侧数据已变化，onShow 重载拉新）
function withFamilyInvalidation(promise) {
  return promise.then((res) => { invalidateFamilyCaches(); return res })
}
function familyRecordBloodPressure(payload) { return withFamilyInvalidation(resolveRemote('familyRecordBloodPressure', payload)) }
function familyRecordBloodGlucose(payload) { return withFamilyInvalidation(resolveRemote('familyRecordBloodGlucose', payload)) }
function familyConfirmMedication(payload) { return withFamilyInvalidation(resolveRemote('familyConfirmMedication', payload)) }
function familyRevokeProxyConfirmation(payload) { return withFamilyInvalidation(resolveRemote('familyRevokeProxyConfirmation', payload)) }

// A6 电话提醒（decisions #4/#12）：
// - setFamilyContactPhone：owner 设置/修改/清空提醒电话（action，成功后失效家族页缓存）；
// - familyGetReminderPhone：家属拨号时按需取完整号码——action 路由不入读缓存，
//   调用方只用于本次 wx.makePhoneCall，不得写入 data/storage（完整号码不进长期本地缓存）。
function setFamilyContactPhone(payload) {
  return resolveRemote('setFamilyContactPhone', payload).then((res) => { invalidateFamilyCaches(); return res })
}
function familyGetReminderPhone() {
  return resolveRemote('familyGetReminderPhone', {})
}

module.exports = {
  FAMILY_PAGE_KEYS,
  FAMILY_RELATIONS,
  SCOPE_KEYS,
  createFamilyInvite,
  createFamilyInviteLocal,
  familyRecordBloodPressure,
  familyRecordBloodGlucose,
  familyConfirmMedication,
  familyRevokeProxyConfirmation,
  familyGetReminderPhone,
  setFamilyContactPhone,
  enforceHomeFamilyAccess,
  getDefaultInviteScopes,
  getFamilyAuthData,
  getFamilyData,
  getFamilyInviteData,
  getFamilyJoinData,
  getFamilyJoinHintData,
  getNoFamilyAccessData,
  getRelationInitial,
  getRelationMeta,
  getScopeText,
  getStoredFamilyAuth,
  invalidateFamilyCaches,
  joinFamilyByInvite,
  joinFamilyByInviteLocal,
  mapFamilyMember,
  normalizeFamilyJoinData,
  normalizeMemberStatus,
  noticeRulesToList,
  revokeFamilyMember,
  revokeFamilyMemberLocal,
  updateFamilyAuth,
  updateFamilyAuthLocal
}
