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

function createFamilyService({
  db,
  _,
  collections,
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
}) {
  async function getHomeFamilyData(openId) {
    const accessContext = await withPerfLog({
      routeType: 'key',
      route: 'homeFamily',
      step: 'db.family.accessContext'
    }, () => getFamilyAccessContext(openId))

    if (!accessContext) {
      return {
        member: {
          name: '家属',
          scopeText: '暂未授权'
        },
        todayAlert: {
          title: '暂无授权数据',
          meta: '请先在家庭页完成家属授权后再查看。'
        },
        latestMetrics: [],
        medicineLogs: [],
        reportSummary: '暂无可查看的周报数据。'
      }
    }

    const { ownerOpenId, relation } = accessContext
    const canViewBp = isRelationScopeEnabled(relation, ['bp', 'bloodPressure'])
    const canViewBg = isRelationScopeEnabled(relation, ['bg', 'bloodGlucose'])
    const canViewMedicine = isRelationScopeEnabled(relation, ['med', 'medicine'])
    const canViewReport = isRelationScopeEnabled(relation, ['report'])
    const allowedTypes = []
    if (canViewBp) allowedTypes.push('bp')
    if (canViewBg) allowedTypes.push('bg')

    const ownerNameTask = relation.ownerName
      ? Promise.resolve(relation.ownerName)
      : withPerfLog({
        routeType: 'key',
        route: 'homeFamily',
        step: 'db.profiles.ownerName'
      }, () => getProfileDisplayName(ownerOpenId))

    const [ownerName, recordsResult, plansResult, confirmationResult] = await Promise.all([
      ownerNameTask,
      allowedTypes.length
        ? withPerfLog({
          routeType: 'key',
          route: 'homeFamily',
          step: 'db.records.latestAuthorized'
        }, () => db.collection(collections.records)
          .where({ _openid: ownerOpenId, type: _.in(allowedTypes) })
          .field({
            type: true,
            systolic: true,
            diastolic: true,
            glucose: true,
            measuredAt: true,
            tag: true,
            level: true,
            createdAt: true
          })
          .orderBy('createdAt', 'desc')
          .limit(6)
          .get())
        : Promise.resolve({ data: [] }),
      canViewMedicine
        ? withPerfLog({
          routeType: 'key',
          route: 'homeFamily',
          step: 'db.medicationPlans.latestAuthorized'
        }, () => db.collection(collections.medicationPlans)
          .where({ _openid: ownerOpenId, status: '启用' })
          .field({ _id: true, name: true, dosage: true, times: true, updatedAt: true })
          .orderBy('updatedAt', 'desc')
          .limit(8)
          .get())
        : Promise.resolve({ data: [] }),
      canViewMedicine
        ? withPerfLog({
          routeType: 'key',
          route: 'homeFamily',
          step: 'db.medicationConfirmations.count'
        }, () => db.collection(collections.medicationConfirmations)
          .where({ _openid: ownerOpenId, confirmDate: getTodayDateValue() })
          .count())
        : Promise.resolve({ total: 0 })
    ])

    const records = recordsResult.data || []
    const plans = plansResult.data || []
    const confirmationTotal = confirmationResult.total || 0

    const latestMetrics = records.reduce((items, record) => {
      const label = record.type === 'bp' ? '血压' : '血糖'
      if (items.some(item => item.label === label)) return items
      items.push({
        label,
        value: record.type === 'bp'
          ? `${record.systolic}/${record.diastolic}`
          : `${record.glucose}`,
        unit: record.type === 'bp' ? 'mmHg' : 'mmol/L',
        meta: `${record.measuredAt || '未记录时间'} · ${record.tag || '未标注场景'}`,
        status: getRecordStatus(record.level),
        statusType: record.level || ''
      })
      return items
    }, [])

    const medicineLogs = plans.flatMap((plan) => {
      const times = Array.isArray(plan.times) && plan.times.length ? plan.times : ['08:00']
      return times.map((time, index) => ({
        id: `log-${plan._id}-${index}`,
        time,
        name: plan.name,
        dosage: plan.dosage || '按医嘱',
        statusText: index === 0 ? '待确认' : '待到点',
        statusType: index === 0 ? 'warn' : 'future',
        actionText: index === 0 ? '提醒中' : '待到点',
        action: index === 0 ? 'confirm' : 'view'
      }))
    })

    const firstMedicine = medicineLogs[0]

    return {
      member: {
        name: ownerName,
        scopeText: getScopeText(relation)
      },
      todayAlert: firstMedicine ? {
        title: `${firstMedicine.time} 用药待确认`,
        meta: `${firstMedicine.name} ${firstMedicine.dosage}，目前还没有确认记录。`
      } : {
        title: latestMetrics.length ? '有新的健康记录' : '暂无新的家庭记录',
        meta: latestMetrics.length ? '可查看已授权的最新记录。' : '授权范围内暂未产生新记录。'
      },
      latestMetrics,
      medicineLogs,
      reportSummary: canViewReport
        ? `已授权记录 ${records.length} 条，已确认用药 ${confirmationTotal} 次。`
        : '暂未授权查看周报。'
    }
  }

  async function getFamilyData(openId) {
    const { data: relations = [] } = await withPerfLog({
      routeType: 'key',
      route: 'family',
      step: 'db.familyMembers.ownerActive'
    }, () => db.collection(collections.familyMembers)
      .where({
        ownerOpenId: openId,
        status: 'active'
      })
      .field({
        _id: true,
        member: true,
        memberName: true,
        scopes: true,
        updatedAt: true,
        status: true
      })
      .orderBy('updatedAt', 'desc')
      .get())

    if (relations.length) {
      return {
        eyebrow: '家庭管理',
        members: relations.map((relation) => ({
          id: relation._id,
          initial: relation.member?.relation ? relation.member.relation.slice(0, 1) : '家',
          name: relation.memberName || relation.member?.name || '家庭成员',
          relation: relation.member?.relation || '家属',
          role: relation.member?.role || '家属',
          status: relation.member?.status || '已授权',
          scope: getScopeText(relation),
          lastSeen: relation.updatedAt ? '最近刚更新授权' : '最近暂无查看记录',
          isOwner: false
        })),
        familyCount: relations.length,
        inviteCode: '',
        authStatus: 'active'
      }
    }

    const { data: authList = [] } = await withPerfLog({
      routeType: 'key',
      route: 'family',
      step: 'db.familyAuth.current'
    }, () => db.collection(collections.familyAuth)
      .where({ _openid: openId })
      .field({
        _id: true,
        member: true,
        memberName: true,
        scopes: true,
        inviteCode: true,
        status: true,
        updatedAt: true
      })
      .limit(1)
      .get())

    const auth = authList[0] || {}
    const scope = getScopeText(auth)

    if (!auth._id || auth.status === 'revoked') {
      return {
        eyebrow: '家庭管理',
        familyCount: 0,
        members: [],
        inviteCode: '',
        authStatus: 'pending'
      }
    }

    return {
      eyebrow: '家庭管理',
      familyCount: 1,
      members: [
        {
          id: auth._id || 'member-owner',
          initial: auth.member?.relation ? auth.member.relation.slice(0, 1) : '家',
          name: auth.memberName || auth.member?.name || '家庭成员',
          relation: auth.member?.relation || '家属',
          role: auth.member?.role || '管理员',
          status: auth.status === 'pending' ? '待加入' : '已授权',
          scope,
          lastSeen: auth.updatedAt ? '最近刚更新授权' : '最近暂无查看记录',
          isOwner: true
        }
      ],
      inviteCode: auth.inviteCode || '',
      authStatus: auth.status || 'pending'
    }
  }

  async function getFamilyInviteData() {
    return {
      selectedRelation: 'daughter',
      relations: getDefaultInviteRelations(),
      scopes: [
        {
          key: 'bloodPressure',
          title: '血压记录',
          meta: '数值、测量时间、趋势',
          enabled: true
        },
        {
          key: 'bloodGlucose',
          title: '血糖记录',
          meta: '数值、测量时间、趋势',
          enabled: true
        },
        {
          key: 'medicine',
          title: '用药确认',
          meta: '用药计划、提醒状态、确认记录',
          enabled: true
        },
        {
          key: 'report',
          title: '健康记录周报',
          meta: '每周记录汇总和趋势回顾',
          enabled: true
        },
        {
          key: 'missedNotice',
          title: '未确认提醒',
          meta: '用药未确认时提醒家属查看',
          enabled: false
        }
      ],
      invitePreview: {
        title: '邀请家属查看健康记录',
        meta: '可查看：血压记录、血糖记录、用药确认、健康记录周报',
        expire: '24 小时'
      }
    }
  }

  async function getFamilyJoinData(payload = {}) {
    const inviteCode = payload.inviteCode || payload.inviteId
    if (inviteCode) {
      const { data: authList = [] } = await withPerfLog({
        routeType: 'key',
        route: 'familyJoin',
        step: 'db.familyAuth.byInvite'
      }, () => db.collection(collections.familyAuth)
        .where({ inviteCode })
        .field({
          _id: true,
          _openid: true,
          ownerOpenId: true,
          ownerName: true,
          status: true,
          member: true,
          scopes: true,
          expiresAt: true
        })
        .limit(1)
        .get())

      const auth = authList[0]
      if (auth) {
        const ownerOpenId = auth.ownerOpenId || auth._openid
        const ownerName = auth.ownerName || await withPerfLog({
          routeType: 'key',
          route: 'familyJoin',
          step: 'db.profiles.ownerName'
        }, () => getProfileDisplayName(ownerOpenId))
        const expiresAt = auth.expiresAt ? new Date(auth.expiresAt).getTime() : Date.now() + 24 * 60 * 60 * 1000
        const remainHours = Math.max(0, Math.ceil((expiresAt - Date.now()) / (60 * 60 * 1000)))
        const relation = auth.member || getDefaultFamilyMember()
        return {
          inviteCode,
          inviteTitle: `${ownerName}邀请你查看健康记录`,
          inviteSubtitle: '加入后，你只能查看对方授权给你的内容，并可接收授权范围内的提醒。',
          remainHours,
          agreed: false,
          identity: {
            initial: relation.relation ? relation.relation.slice(0, 1) : '家',
            title: relation.relation || relation.name || '家属',
            meta: `${relation.role || '家属'} · 可在家庭页查看授权记录`
          },
          scopes: (auth.scopes || []).filter(scope => scope.enabled)
        }
      }
    }
    return {
      inviteCode: inviteCode || '',
      inviteTitle: '家庭健康记录邀请',
      inviteSubtitle: '加入后，你只能查看对方授权给你的内容，并可接收授权范围内的提醒。',
      remainHours: 24,
      agreed: false,
      identity: {
        initial: '家',
        title: '家属',
        meta: '可在家庭页查看授权记录'
      },
      scopes: getDefaultFamilyScopes()
    }
  }

  async function getFamilyAuthData(openId, payload = {}) {
    const memberId = payload && payload.memberId
    if (memberId) {
      const { data: relations = [] } = await withPerfLog({
        routeType: 'key',
        route: 'familyAuth',
        step: 'db.familyMembers.byMemberId'
      }, () => db.collection(collections.familyMembers)
        .where({
          _id: memberId,
          ownerOpenId: openId
        })
        .field({
          _id: true,
          member: true,
          memberName: true,
          scopes: true,
          noticeRules: true,
          activities: true
        })
        .limit(1)
        .get())

      if (relations.length) {
        const relation = relations[0]
        return {
          eyebrow: '授权管理',
          memberId: relation._id,
          member: {
            ...getDefaultFamilyMember(),
            ...(relation.member || {}),
            name: relation.memberName || relation.member?.name || '家属'
          },
          scopes: relation.scopes || getDefaultFamilyScopes(),
          noticeRules: relation.noticeRules || getDefaultNoticeRules(),
          activities: relation.activities || [],
          memberName: relation.memberName || relation.member?.name || ''
        }
      }
    }

    const { data: authList = [] } = await withPerfLog({
      routeType: 'key',
      route: 'familyAuth',
      step: 'db.familyAuth.current'
    }, () => db.collection(collections.familyAuth)
      .where({ _openid: openId })
      .field({
        _id: true,
        member: true,
        memberName: true,
        scopes: true,
        noticeRules: true,
        activities: true
      })
      .limit(1)
      .get())

    const auth = authList[0] || {}

    return {
      eyebrow: '授权管理',
      memberId: auth._id || '',
      member: auth.member || getDefaultFamilyMember(),
      scopes: auth.scopes || getDefaultFamilyScopes(),
      noticeRules: auth.noticeRules || getDefaultNoticeRules(),
      activities: auth.activities || [],
      memberName: auth.memberName || ''
    }
  }

  async function updateFamilyAuth(openId, payload) {
    const memberId = payload && payload.memberId
    const authData = {
      ...normalizeFamilyAuthPayload(payload),
      updatedAt: db.serverDate()
    }

    const { data: existing = [] } = await withPerfLog({
      routeType: 'action',
      route: 'updateFamilyAuth',
      step: 'db.familyAuth.current'
    }, () => db.collection(collections.familyAuth)
      .where({ _openid: openId })
      .limit(1)
      .get())

    if (existing.length > 0) {
      const result = await withPerfLog({
        routeType: 'action',
        route: 'updateFamilyAuth',
        step: 'db.familyAuth.update'
      }, () => db.collection(collections.familyAuth).doc(existing[0]._id).update({
        data: authData
      }))

      const relationWhere = memberId
        ? {
          _id: memberId,
          ownerOpenId: openId,
          status: 'active'
        }
        : {
          ownerOpenId: openId,
          status: 'active'
        }

      const relationData = memberId
        ? {
          member: authData.member,
          memberName: authData.memberName,
          scopes: authData.scopes,
          noticeRules: authData.noticeRules,
          activities: authData.activities,
          updatedAt: db.serverDate()
        }
        : {
          scopes: authData.scopes,
          noticeRules: authData.noticeRules,
          updatedAt: db.serverDate()
        }

      await withPerfLog({
        routeType: 'action',
        route: 'updateFamilyAuth',
        step: 'db.familyMembers.sync'
      }, () => db.collection(collections.familyMembers)
        .where(relationWhere)
        .update({ data: relationData }))

      return result
    }

    return await withPerfLog({
      routeType: 'action',
      route: 'updateFamilyAuth',
      step: 'db.familyAuth.add'
    }, () => db.collection(collections.familyAuth).add({
      data: {
        _openid: openId,
        ...authData,
        createdAt: db.serverDate()
      }
    }))
  }

  async function createFamilyInvite(openId, payload) {
    const invite = normalizeFamilyInvitePayload(payload)
    const [ownerName, { data: existing = [] }] = await Promise.all([
      withPerfLog({
        routeType: 'action',
        route: 'createFamilyInvite',
        step: 'db.profiles.ownerName'
      }, () => getProfileDisplayName(openId)),
      withPerfLog({
        routeType: 'action',
        route: 'createFamilyInvite',
        step: 'db.familyAuth.current'
      }, () => db.collection(collections.familyAuth)
        .where({ _openid: openId })
        .limit(1)
        .get())
    ])

    const inviteCode = createInviteCode()
    const inviteData = {
      ownerOpenId: openId,
      ownerName,
      member: invite.member,
      memberName: invite.member.name,
      inviteCode,
      scopes: invite.scopes,
      noticeRules: getDefaultNoticeRules(),
      activities: [],
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      updatedAt: db.serverDate()
    }

    if (existing.length) {
      await withPerfLog({
        routeType: 'action',
        route: 'createFamilyInvite',
        step: 'db.familyAuth.update'
      }, () => db.collection(collections.familyAuth).doc(existing[0]._id).update({
        data: inviteData
      }))
    } else {
      await withPerfLog({
        routeType: 'action',
        route: 'createFamilyInvite',
        step: 'db.familyAuth.add'
      }, () => db.collection(collections.familyAuth).add({
        data: {
          _openid: openId,
          ...inviteData,
          createdAt: db.serverDate()
        }
      }))
    }

    const enabledScopes = invite.scopes
      .filter(scope => scope.enabled)
      .map(scope => scope.title)

    return {
      inviteCode,
      inviteId: inviteCode,
      sharePath: `/pages/family-sub/family-join/index?inviteCode=${inviteCode}`,
      invitePreview: {
        title: `${ownerName}邀请${invite.relation.label}查看健康记录`,
        meta: enabledScopes.length ? `可查看：${enabledScopes.join('、')}` : '暂未选择可查看内容',
        expire: '24 小时'
      }
    }
  }

  async function joinFamilyByInvite(openId, payload) {
    const inviteCode = validateInviteCodePayload(payload)
    const { data: authList = [] } = await withPerfLog({
      routeType: 'action',
      route: 'joinFamilyByInvite',
      step: 'db.familyAuth.byInvite'
    }, () => db.collection(collections.familyAuth)
      .where({ inviteCode })
      .limit(1)
      .get())

    const auth = authList[0]
    if (!auth) {
      throw new Error('邀请不存在或已失效')
    }
    if (auth.status === 'revoked') {
      throw new Error('邀请已撤销')
    }
    if (auth.status === 'active' && auth.memberOpenId && auth.memberOpenId !== openId) {
      throw new Error('邀请已被其他家属使用')
    }
    if (auth.expiresAt && new Date(auth.expiresAt).getTime() < Date.now()) {
      throw new Error('邀请已过期')
    }

    const ownerOpenId = auth.ownerOpenId || auth._openid
    if (ownerOpenId === openId) {
      throw new Error('不能加入自己创建的家庭邀请')
    }

    const [ownerName, { data: existing = [] }] = await Promise.all([
      auth.ownerName
        ? Promise.resolve(auth.ownerName)
        : withPerfLog({
          routeType: 'action',
          route: 'joinFamilyByInvite',
          step: 'db.profiles.ownerName'
        }, () => getProfileDisplayName(ownerOpenId)),
      withPerfLog({
        routeType: 'action',
        route: 'joinFamilyByInvite',
        step: 'db.familyMembers.existing'
      }, () => db.collection(collections.familyMembers)
        .where({
          ownerOpenId,
          memberOpenId: openId
        })
        .limit(1)
        .get())
    ])

    const relationData = {
      ownerOpenId,
      ownerName,
      memberOpenId: openId,
      member: {
        ...(auth.member || getDefaultFamilyMember()),
        status: '已授权'
      },
      memberName: auth.memberName || auth.member?.name || '家属',
      inviteCode,
      scopes: auth.scopes || getDefaultFamilyScopes(),
      noticeRules: auth.noticeRules || getDefaultNoticeRules(),
      status: 'active',
      joinedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    const relationWrite = existing.length
      ? db.collection(collections.familyMembers).doc(existing[0]._id).update({
        data: relationData
      })
      : db.collection(collections.familyMembers).add({
        data: {
          _openid: openId,
          ...relationData,
          createdAt: db.serverDate()
        }
      })

    const [result] = await withPerfLog({
      routeType: 'action',
      route: 'joinFamilyByInvite',
      step: 'db.familyJoin.writes'
    }, () => Promise.all([
      relationWrite,
      db.collection(collections.familyAuth).doc(auth._id).update({
        data: {
          ownerName,
          memberOpenId: openId,
          member: relationData.member,
          memberName: relationData.memberName,
          status: 'active',
          updatedAt: db.serverDate()
        }
      })
    ]))

    return {
      ...result,
      ownerOpenId,
      memberOpenId: openId,
      status: 'active'
    }
  }

  async function revokeFamilyMember(openId, payload = {}) {
    const memberId = getLimitedString(payload.memberId, '家属ID', 64)

    if (memberId) {
      const [{ data: relations = [] }, { data: authList = [] }] = await Promise.all([
        withPerfLog({
          routeType: 'action',
          route: 'revokeFamilyMember',
          step: 'db.familyMembers.byMemberId'
        }, () => db.collection(collections.familyMembers)
          .where({
            _id: memberId,
            ownerOpenId: openId
          })
          .limit(1)
          .get()),
        withPerfLog({
          routeType: 'action',
          route: 'revokeFamilyMember',
          step: 'db.familyAuth.current'
        }, () => db.collection(collections.familyAuth)
          .where({ _openid: openId })
          .limit(1)
          .get())
      ])

      if (!relations.length) {
        throw new Error('家属关系不存在或无权操作')
      }

      const relation = relations[0]
      const writes = [
        db.collection(collections.familyMembers).doc(relation._id).update({
          data: {
            status: 'revoked',
            updatedAt: db.serverDate()
          }
        })
      ]

      if (authList.length && authList[0].memberOpenId === relation.memberOpenId) {
        writes.push(db.collection(collections.familyAuth).doc(authList[0]._id).update({
          data: {
            status: 'revoked',
            memberOpenId: '',
            updatedAt: db.serverDate()
          }
        }))
      }

      await withPerfLog({
        routeType: 'action',
        route: 'revokeFamilyMember',
        step: 'db.familyRevoke.writes'
      }, () => Promise.all(writes))

      return {
        memberId: relation._id,
        status: 'revoked'
      }
    }

    const { data: authList = [] } = await withPerfLog({
      routeType: 'action',
      route: 'revokeFamilyMember',
      step: 'db.familyAuth.current'
    }, () => db.collection(collections.familyAuth)
      .where({ _openid: openId })
      .limit(1)
      .get())

    if (!authList.length) {
      throw new Error('当前没有可解除的家属授权')
    }

    await withPerfLog({
      routeType: 'action',
      route: 'revokeFamilyMember',
      step: 'db.familyAuth.revoke'
    }, () => db.collection(collections.familyAuth).doc(authList[0]._id).update({
      data: {
        status: 'revoked',
        memberOpenId: '',
        updatedAt: db.serverDate()
      }
    }))

    return {
      memberId: authList[0]._id,
      status: 'revoked'
    }
  }

  return {
    createFamilyInvite,
    getFamilyAuthData,
    getFamilyData,
    getFamilyInviteData,
    getFamilyJoinData,
    getHomeFamilyData,
    joinFamilyByInvite,
    revokeFamilyMember,
    updateFamilyAuth
  }
}

module.exports = {
  createFamilyService
}
