const {
  STORAGE_KEYS,
  createRecordId,
  getRelatedCacheKeys,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorage,
  writeStorageAndInvalidate
} = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')

/**
 * 家庭协同服务模块。
 * 负责家属邀请、加入家庭、家庭页成员展示和家属权限持久化。
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

function getRelationMeta(relationKey) {
  const relationMap = {
    daughter: { relation: '女儿', role: '主要照护人' },
    son: { relation: '儿子', role: '紧急联系人' },
    spouse: { relation: '配偶', role: '共同管理' },
    other: { relation: '家属', role: '共同管理' }
  }
  return relationMap[relationKey] || relationMap.other
}

function getScopeText(scopes, fallback = '暂未授权') {
  if (!Array.isArray(scopes)) return fallback
  const enabledTitles = scopes.filter((item) => item.enabled).map((item) => item.title)
  return enabledTitles.length ? enabledTitles.join('、') : fallback
}

function mapFamilyMember(member, fallback = {}, index = 0) {
  const relation = member.relation || fallback.relation || '家属'
  return {
    id: member.id || member._id || fallback.id || `member-${index + 1}`,
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
  const storedAuth = getStoredFamilyAuth() || {}
  const memberId = payload.memberId || storedAuth.currentMemberId || createRecordId('member')
  const scopes = Array.isArray(payload.scopes) ? payload.scopes : storedAuth.scopes || []
  const targetCard = mapFamilyMember({
    id: memberId,
    name: payload.member && payload.member.name,
    relation: payload.member && payload.member.relation,
    role: payload.member && payload.member.role,
    status: payload.member && payload.member.status,
    scope: getScopeText(scopes)
  }, storedAuth.members && storedAuth.members.find((item) => item.id === memberId))

  const members = Array.isArray(storedAuth.members) && storedAuth.members.length
    ? storedAuth.members.map((item) => (item.id === memberId ? targetCard : item))
    : [targetCard]

  const nextState = {
    ...storedAuth,
    currentMemberId: memberId,
    member: mapMemberCardToAuthMember(targetCard),
    memberName: targetCard.name,
    members,
    scopes,
    noticeRules: Array.isArray(payload.noticeRules) ? payload.noticeRules : storedAuth.noticeRules || [],
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
  const storedAuth = getStoredFamilyAuth() || {}
  const relationMeta = getRelationMeta(payload.selectedRelation)
  const inviteCode = (remoteResult && (remoteResult.inviteCode || remoteResult.inviteId)) || createRecordId('invite').replace(/-/g, '').slice(-12)
  const memberId = storedAuth.currentMemberId || createRecordId('member')
  const scopes = Array.isArray(payload.scopes) ? payload.scopes : storedAuth.scopes || []
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
    status: 'pending',
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
  const storedAuth = getStoredFamilyAuth() || {}
  const nextState = {
    ...storedAuth,
    inviteCode: (payload && payload.inviteCode) || storedAuth.inviteCode || '',
    status: 'active',
    joinedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  writeStorageAndInvalidate(STORAGE_KEYS.familyAuth, nextState, getRelatedCacheKeys(STORAGE_KEYS.familyAuth))
  return remoteResult && remoteResult.status ? remoteResult : nextState
}

function revokeFamilyMemberLocal(payload) {
  const storedAuth = getStoredFamilyAuth() || {}
  const memberId = payload && payload.memberId ? payload.memberId : storedAuth.currentMemberId
  const currentMembers = Array.isArray(storedAuth.members) ? storedAuth.members : []
  const nextMembers = memberId
    ? currentMembers.filter((item) => item.id !== memberId)
    : currentMembers.slice(1)
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
  const targetMember = storedMembers.find((item) => item.id === targetMemberId)

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

module.exports = {
  createFamilyInvite,
  enforceHomeFamilyAccess,
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
  joinFamilyByInvite,
  mapFamilyMember,
  normalizeMemberStatus,
  revokeFamilyMember,
  updateFamilyAuth
}
