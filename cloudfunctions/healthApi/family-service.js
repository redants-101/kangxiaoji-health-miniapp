// 关系目录、成员锚点、邀请错误码契约与北京日期口径直接引用共享模块（同部署目录、无循环依赖）
const {
  FAMILY_RELATIONS_V2,
  SCOPE_KEYS_V2,
  getMemberAnchorId,
  FAMILY_INVITE_ERRORS,
  INVITE_CODE_PATTERN,
  INVITE_FAILURE_LIMIT_PER_DAY
} = require('./family-policy')
const { getTodayDateValue } = require('./payload-helpers')
const { validateBloodPressurePayload, validateBloodGlucosePayload } = require('./payload-validation')

function minimalScopes() {
  return SCOPE_KEYS_V2.map(key => ({ key }))
}

function createFamilyService({
  db,
  _,
  collections,
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
}) {
  // ============ A2：邀请错误码、原子频控与失效分类 ============

  // 构造带稳定错误码的异常（errMsg 供 toast，code 供页面状态分支）
  function inviteError(key) {
    const spec = FAMILY_INVITE_ERRORS[key]
    const error = new Error(spec.message)
    error.code = spec.code
    return error
  }

  // 计入失败额量的错误码（枚举类失败）；自绑/已绑定/频控本身不占额度
  const COUNTED_FAILURE_CODES = new Set([
    FAMILY_INVITE_ERRORS.notFound.code,
    FAMILY_INVITE_ERRORS.invalid.code,
    FAMILY_INVITE_ERRORS.expired.code,
    FAMILY_INVITE_ERRORS.revoked.code,
    FAMILY_INVITE_ERRORS.used.code
  ])

  // 频控计数文档：每 (openId, 北京自然日) 一条，_id 确定性生成。
  // 日界正确性由 key 内嵌 day 保证；TTL 索引只负责物理清理。
  function inviteFailureKey(openId) {
    return `invite-fail-${openId}-${getTodayDateValue()}`
  }

  /**
   * 原子预留一个失败额度（reserve）：
   * 条件更新 where({_id, count < 20}).update(count+1) 依赖单文档写原子性
   * （MongoDB 官方乐观锁模式，能力来源见 rate-limit-plan.md §2），
   * 并发请求不可能全部先通过门限再各自探测邀请。
   * 文档不存在时以确定性 _id 创建；add 撞唯一冲突则回到条件更新重试一次。
   * @returns {Promise<{key: string}|null>} null 表示额度已满，应拒绝（RATE_LIMITED）。
   */
  async function reserveFailureSlot(openId) {
    const key = inviteFailureKey(openId)
    const day = getTodayDateValue()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await db.collection(collections.inviteAttempts)
        .where({ _id: key, count: _.lt(INVITE_FAILURE_LIMIT_PER_DAY) })
        .update({ data: { count: _.inc(1), updatedAt: db.serverDate() } })
      if (res && res.stats && res.stats.updated > 0) {
        return { key }
      }
      const { data } = await db.collection(collections.inviteAttempts)
        .where({ _id: key })
        .limit(1)
        .get()
      if (data.length) {
        return null // 文档存在但条件更新未命中 → count 已达上限
      }
      try {
        await db.collection(collections.inviteAttempts).add({
          data: {
            _id: key,
            openId,
            day,
            count: 1,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
        return { key }
      } catch (e) {
        // 仅"已确认的重复键冲突"（并发创建撞 _id）回到条件更新重试；
        // 网络/权限等基础设施异常原样上抛，不得伪装成频控拒绝。
        // 重复键签名 E11000/duplicate key 为 Mongo 标准报文透传（本地 SDK 无专属错误码，
        // 真实云端签名属测试环境待验证项；若签名不匹配则按基础设施异常上抛，方向 fail-closed）。
        const msg = String((e && (e.errMsg || e.message)) || e)
        if (!/E11000|duplicate key/i.test(msg)) {
          throw e
        }
      }
    }
    return null // 两轮仍未取得额度：保守拒绝（fail-closed）
  }

  /**
   * 退还预留额度（成功/非枚举类业务拒绝/基础设施异常时调用）。
   * 退还失败只会使额度偏紧（fail-closed），不放宽，不阻断主流程。
   */
  async function releaseFailureSlot(key) {
    try {
      await db.collection(collections.inviteAttempts)
        .where({ _id: key, count: _.gt(0) })
        .update({ data: { count: _.inc(-1), updatedAt: db.serverDate() } })
    } catch (e) {
      // 方向安全（只会更严），静默
    }
  }

  // 邀请文档失效分类（decisions #9/#15 + 收尾修正）：
  // 不存在 → notFound；expiresAt 缺失或不可解析一律 invalid（不做兼容）；
  // revoked/used 依序判定；刚好到期（<=now）按 expired。
  // self/bound 不在本分类内（需结合调用者身份，由 join 流程单独判定）。
  function classifyInviteAuth(auth, openId) {
    if (!auth) return 'notFound'
    if (!auth.expiresAt) return 'invalid'
    if (auth.status === 'revoked') return 'revoked'
    if (auth.status === 'active' && auth.memberOpenId && auth.memberOpenId !== openId) return 'used'
    const expiry = new Date(auth.expiresAt).getTime()
    if (!Number.isFinite(expiry)) return 'invalid'
    if (expiry <= Date.now()) return 'expired'
    return null
  }

  // 邀请码唯一性前置检查（decisions #11 的代码侧部分）：
  // 候选码与任何现存文档同码（含 owner 自己的当前码）都视为冲突并重新生成——
  // 重邀必须发新码，否则旧码在重邀后仍有效，构成"重邀/加入交错"的攻击面。
  // 并发唯一性的最终保障是云端 family_auth.inviteCode sparse 唯一索引（已建）。
  async function generateUniqueInviteCode() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = createInviteCode()
      // 生成器异常输出按冲突处理，继续重试；3 次后统一抛错
      if (typeof candidate !== 'string' || !INVITE_CODE_PATTERN.test(candidate)) {
        continue
      }
      const { data: dup = [] } = await db.collection(collections.familyAuth)
        .where({ inviteCode: candidate })
        .limit(1)
        .get()
      if (!dup.length) {
        return candidate
      }
    }
    throw new Error('邀请码生成冲突，请稍后重试')
  }

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
        reportSummary: '暂无可查看的周报数据。',
        // A6：无授权时电话入口同样关闭（形状稳定，页面按 remindAllowed 渲染）
        readPermissions: { bloodPressure: false, bloodGlucose: false, medicine: false, report: false },
        phoneReminder: { remindAllowed: false, configured: false, canCall: false, masked: '' }
      }
    }

    const { ownerOpenId, relation } = accessContext
    const canViewBp = canViewScope(relation.scopes, 'bloodPressure')
    const canViewBg = canViewScope(relation.scopes, 'bloodGlucose')
    const canViewMedicine = canViewScope(relation.scopes, 'medicine')
    const canViewReport = canViewScope(relation.scopes, 'report')
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

    // A6：任一 scope.remind=true 才回传脱敏号码（read 不参与；完整号码只在拨号 action 返回）
    const remindAllowed = canCallReminderPhone(relation.scopes)

    const [ownerName, recordsResult, plansResult, confirmationResult, ownerPhone] = await Promise.all([
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
        : Promise.resolve({ total: 0 }),
      remindAllowed
        ? withPerfLog({
          routeType: 'key',
          route: 'homeFamily',
          step: 'db.familyAuth.contactPhone'
        }, () => getOwnerContactPhone(ownerOpenId))
        : Promise.resolve('')
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
        scopeText: getScopeTextV2(relation.scopes)
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
        : '暂未授权查看周报。',
      // A4：家属态写能力下发（read+write 才为 true；report 恒 false）
      writePermissions: {
        bloodPressure: canPerformScopeAction(relation.scopes, 'recordBloodPressure'),
        bloodGlucose: canPerformScopeAction(relation.scopes, 'recordBloodGlucose'),
        medicine: canPerformScopeAction(relation.scopes, 'confirmMedication'),
        report: false
      },
      // A6：读能力下发（read=false+remind=true 时页面只保留电话提醒入口）
      readPermissions: {
        bloodPressure: canViewBp,
        bloodGlucose: canViewBg,
        medicine: canViewMedicine,
        report: canViewReport
      },
      // A6：电话提醒入口（脱敏号码；完整号码由 familyGetReminderPhone 拨号时按需返回）
      phoneReminder: {
        remindAllowed,
        configured: remindAllowed && !!ownerPhone,
        canCall: remindAllowed && !!ownerPhone,
        masked: remindAllowed ? maskContactPhone(ownerPhone) : ''
      }
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
          bound: true,
          initial: relation.member?.relation ? relation.member.relation.slice(0, 1) : '家',
          name: relation.memberName || relation.member?.name || '家庭成员',
          relation: relation.member?.relation || '家属',
          role: relation.member?.role || '家属',
          status: relation.member?.status || '已授权',
          scope: getScopeTextV2(relation.scopes),
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
    const scope = getScopeTextV2(auth.scopes)

    // A6：纯电话配置文档（无邀请码且无绑定成员）不构成邀请预览卡
    if (!auth._id || auth.status === 'revoked' || (!auth.inviteCode && !auth.memberOpenId)) {
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
          // 邀请预览卡不是关系行：id 置空、bound=false，客户端不得据此提交改权/撤销
          id: '',
          bound: false,
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
      relations: FAMILY_RELATIONS_V2,
      scopes: getDefaultInviteScopesV2(),
      invitePreview: {
        title: '邀请家属查看健康记录',
        meta: '可查看：血压记录、血糖记录、用药确认、健康记录周报',
        expire: '24 小时'
      }
    }
  }

  async function getFamilyJoinData(openId, payload = {}) {
    const rawCode = payload ? (payload.inviteCode !== undefined ? payload.inviteCode : payload.inviteId) : undefined

    // 无邀请码说明态：仅 undefined/null/空串/纯空白串；不显示有效期与可查看范围，不计失败
    const isAbsent = rawCode === undefined || rawCode === null ||
      (typeof rawCode === 'string' && rawCode.trim() === '')
    if (isAbsent) {
      return {
        noInvite: true,
        inviteCode: '',
        inviteTitle: '尚未获得邀请',
        inviteSubtitle: '请通过家人分享的邀请链接或邀请码进入。',
        remainHours: 0,
        agreed: false,
        identity: {
          initial: '家',
          title: '家属',
          meta: '获得邀请后可查看授权范围'
        },
        scopes: []
      }
    }

    const basePage = {
      inviteCode: typeof rawCode === 'string' ? rawCode.trim() : '',
      inviteTitle: '家庭健康记录邀请',
      inviteSubtitle: '加入后，你只能查看对方授权给你的内容，并可接收授权范围内的提醒。',
      remainHours: 24,
      agreed: false,
      identity: {
        initial: '家',
        title: '家属',
        meta: '可在家庭页查看授权记录'
      },
      scopes: getDefaultInviteScopesV2().filter(scope => scope.read === true)
    }

    const failPage = (key) => ({
      ...basePage,
      scopes: [],
      remainHours: 0,
      inviteError: { ...FAMILY_INVITE_ERRORS[key] }
    })

    // 原子预留额度（查询与 join 共用；预留成功才允许探测邀请）
    const slot = await reserveFailureSlot(openId)
    if (!slot) return failPage('rateLimited')

    // 非字符串真值属非法输入，不得冒充缺码：按 INVALID 处理并占用额度
    if (typeof rawCode !== 'string') {
      return failPage('invalid')
    }
    const inviteCode = rawCode.trim()

    let auth = null
    let failureKey = null
    try {
      if (!INVITE_CODE_PATTERN.test(inviteCode)) {
        failureKey = 'invalid'
      } else {
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
        auth = authList[0]
        failureKey = classifyInviteAuth(auth, openId)
      }
    } catch (err) {
      // 基础设施异常：退还额度（不计为用户失败），原样上抛走页面网络失败态
      await releaseFailureSlot(slot.key)
      throw err
    }

    if (failureKey) {
      return failPage(failureKey) // 预留额度即失败计数，不退还
    }

    // 查询成功：退还额度
    await releaseFailureSlot(slot.key)

    const ownerOpenId = auth.ownerOpenId || auth._openid
    const ownerName = auth.ownerName || await withPerfLog({
      routeType: 'key',
      route: 'familyJoin',
      step: 'db.profiles.ownerName'
    }, () => getProfileDisplayName(ownerOpenId))
    // classify 已保证 expiresAt 存在、可解析且未到期，remainHours 必为有限正数
    const remainHours = Math.max(1, Math.ceil((new Date(auth.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000)))
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
      scopes: (Array.isArray(auth.scopes) ? auth.scopes : [])
        .filter(scope => scope.read === true)
    }
  }

  async function getFamilyAuthData(openId, payload = {}) {
    // A6：提醒电话属 owner 配置，授权管理页（owner 本人）可回读完整号用于编辑
    const contactPhone = await getOwnerContactPhone(openId)
    const contactPhoneMasked = maskContactPhone(contactPhone)
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
          scopes: Array.isArray(relation.scopes)
            ? relation.scopes
            : normalizeFamilyScopesV2(minimalScopes()),
          noticeRules: normalizeNoticeRulesV2(relation.noticeRules),
          activities: relation.activities || [],
          memberName: relation.memberName || '',
          contactPhone,
          contactPhoneMasked
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
      // 预览分支没有绑定成员：memberId 置空，客户端据此禁止成员改权/撤销提交
      memberId: '',
      member: auth.member || getDefaultFamilyMember(),
      scopes: Array.isArray(auth.scopes)
        ? auth.scopes
        : normalizeFamilyScopesV2(minimalScopes()),
      noticeRules: normalizeNoticeRulesV2(auth.noticeRules),
      activities: auth.activities || [],
      memberName: auth.memberName || '',
      contactPhone,
      contactPhoneMasked
    }
  }

  async function updateFamilyAuth(openId, payload) {
    // A1：memberId 必填（decisions 4.2），校验通过前零写入。
    const memberId = getLimitedString(payload && payload.memberId, '家属ID', 64, true)

    const { data: relations = [] } = await withPerfLog({
      routeType: 'action',
      route: 'updateFamilyAuth',
      step: 'db.familyMembers.byMemberId'
    }, () => db.collection(collections.familyMembers)
      .where({
        _id: memberId,
        ownerOpenId: openId,
        status: 'active'
      })
      .limit(1)
      .get())

    if (!relations.length) {
      throw new Error('家属关系不存在或无权操作')
    }
    const relation = relations[0]

    const normalized = normalizeFamilyAuthPayloadV2(payload)
    const memberData = {
      member: normalized.member,
      memberName: normalized.memberName,
      scopes: normalized.scopes,
      noticeRules: normalized.noticeRules,
      activities: normalized.activities,
      updatedAt: db.serverDate()
    }

    // 只更新目标成员关系行（doc 级），不做按 owner 的批量兜底
    const result = await withPerfLog({
      routeType: 'action',
      route: 'updateFamilyAuth',
      step: 'db.familyMembers.updateTarget'
    }, () => db.collection(collections.familyMembers).doc(memberId).update({
      data: memberData
    }))

    // family_auth 同步：仅当当前邀请配置确实绑定该成员（memberOpenId 匹配）时，
    // 才同步展示与权限字段；待加入/他人的邀请配置不被成员改权覆盖。
    const { data: authList = [] } = await withPerfLog({
      routeType: 'action',
      route: 'updateFamilyAuth',
      step: 'db.familyAuth.current'
    }, () => db.collection(collections.familyAuth)
      .where({ _openid: openId })
      .limit(1)
      .get())

    const auth = authList[0]
    if (auth && auth.memberOpenId && auth.memberOpenId === relation.memberOpenId) {
      await withPerfLog({
        routeType: 'action',
        route: 'updateFamilyAuth',
        step: 'db.familyAuth.syncBoundMember'
      }, () => db.collection(collections.familyAuth).doc(auth._id).update({
        data: {
          member: memberData.member,
          memberName: memberData.memberName,
          scopes: memberData.scopes,
          noticeRules: memberData.noticeRules,
          updatedAt: db.serverDate()
        }
      }))
    }

    return result
  }

  async function createFamilyInvite(openId, payload) {
    const invite = normalizeFamilyInvitePayloadV2(payload)
    // A6：邀请可携带提醒电话；先校验后写入（非法号码在任何写库前抛错，零写入）。
    // undefined/null = 未提供，不改动既有配置；'' = 显式清空。
    const contactPhone = normalizeContactPhone(payload ? payload.contactPhone : null)
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

    const inviteCode = await generateUniqueInviteCode()
    const inviteData = {
      ownerOpenId: openId,
      ownerName,
      member: invite.member,
      memberName: invite.member.name,
      inviteCode,
      scopes: invite.scopes,
      noticeRules: getDefaultInviteNoticeRulesV2(),
      activities: [],
      status: 'pending',
      // 重新邀请显式清空上一位成员的绑定（decisions 4.2），已有 family_members 关系行不受影响
      memberOpenId: '',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      updatedAt: db.serverDate(),
      // A6：仅在显式提供时写入（未提供保留既有号码）
      ...(contactPhone !== null ? { contactPhone } : {})
    }

    if (existing.length) {
      await withPerfLog({
        routeType: 'action',
        route: 'createFamilyInvite',
        step: 'db.familyAuth.createInvite.update'
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

    const readScopes = invite.scopes
      .filter(scope => scope.read === true)
      .map(scope => scope.title)

    return {
      inviteCode,
      inviteId: inviteCode,
      sharePath: `/pages/family-sub/family-join/index?inviteCode=${inviteCode}`,
      invitePreview: {
        title: `${ownerName}邀请${invite.relation.label}查看健康记录`,
        meta: readScopes.length ? `可查看：${readScopes.join('、')}` : '暂未选择可查看内容',
        expire: '24 小时'
      }
    }
  }

  // 组装加入时落库的关系行数据（权限以邀请文档配置为准，经 V2 严格归一化）
  function buildJoinRelationData(auth, ownerOpenId, ownerName, memberOpenId, inviteCode) {
    return {
      _openid: memberOpenId,
      ownerOpenId,
      ownerName,
      memberOpenId,
      member: {
        ...(auth.member || getDefaultFamilyMember()),
        status: '已授权'
      },
      memberName: auth.memberName || auth.member?.name || '家属',
      inviteCode,
      scopes: normalizeFamilyScopesV2(
        Array.isArray(auth.scopes) ? auth.scopes : minimalScopes()
      ),
      noticeRules: normalizeNoticeRulesV2(auth.noticeRules),
      status: 'active',
      joinedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  }

  function assertJoinableAuth(auth, openId) {
    const failureKey = classifyInviteAuth(auth, openId)
    if (failureKey) {
      throw inviteError(failureKey)
    }
    const ownerOpenId = auth.ownerOpenId || auth._openid
    if (ownerOpenId === openId) {
      throw inviteError('self')
    }
    return ownerOpenId
  }

  async function joinFamilyByInvite(openId, payload) {
    const inviteCode = validateInviteCodePayload(payload)

    // 原子预留额度：join 与查询共用同一计数（防止绕过查询接口直接刷 join 枚举）。
    // 预留成功才允许探测邀请；额度已满直接拒绝，不发生任何邀请查询。
    const slot = await reserveFailureSlot(openId)
    if (!slot) {
      throw inviteError('rateLimited')
    }

    let result
    try {
      result = await executeFamilyJoin(openId, inviteCode)
    } catch (err) {
      // 枚举类失败（notFound/invalid/expired/revoked/used）保留额度即计数；
      // 自绑/已绑定等非枚举业务拒绝与基础设施异常（无 code）退还额度后原样上抛。
      if (!err || !COUNTED_FAILURE_CODES.has(err.code)) {
        await releaseFailureSlot(slot.key)
      }
      throw err
    }
    await releaseFailureSlot(slot.key) // 成功（含幂等重复加入）退还额度
    return result
  }

  async function executeFamilyJoin(openId, inviteCode) {
    if (!INVITE_CODE_PATTERN.test(inviteCode)) {
      throw inviteError('invalid')
    }

    const { data: authList = [] } = await withPerfLog({
      routeType: 'action',
      route: 'joinFamilyByInvite',
      step: 'db.familyAuth.byInvite'
    }, () => db.collection(collections.familyAuth)
      .where({ inviteCode })
      .limit(1)
      .get())

    const auth = authList[0]
    const failureKey = classifyInviteAuth(auth, openId)
    if (failureKey) {
      throw inviteError(failureKey)
    }
    const ownerOpenId = assertJoinableAuth(auth, openId)

    // 1:1 预检（decisions 第 2 项）：本人已有 active 关系时，
    // 绑定他人 → 拒绝；同一 owner → 幂等返回，零写入、不重置已调整权限。
    // 该查询同时兜住锚点方案之前的存量随机 id 关系行。
    const { data: boundActive = [] } = await withPerfLog({
      routeType: 'action',
      route: 'joinFamilyByInvite',
      step: 'db.familyMembers.boundActive'
    }, () => db.collection(collections.familyMembers)
      .where({ memberOpenId: openId, status: 'active' })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get())

    if (boundActive.length) {
      const bound = boundActive[0]
      if (bound.ownerOpenId !== ownerOpenId) {
        throw inviteError('bound')
      }
      return { _id: bound._id, ownerOpenId, memberOpenId: openId, status: 'active', idempotent: true }
    }

    const ownerName = auth.ownerName
      ? auth.ownerName
      : await withPerfLog({
        routeType: 'action',
        route: 'joinFamilyByInvite',
        step: 'db.profiles.ownerName'
      }, () => getProfileDisplayName(ownerOpenId))

    // 原子路径（云函数环境）：确定性锚点文档把同一成员的并发加入压到同一把事务锁；
    // 事务内重读邀请文档并复核 inviteCode 一致性——owner 重邀换码后，
    // 持旧码的在途请求按 notFound 拒绝，不得消耗新邀请。
    // doc.get 依赖 cloud.database({throwOnNotFound:false})：不存在返回 data:null（确认的不存在），
    // 网络/权限/事务冲突等异常直接上抛，绝不吞掉后继续写入。
    if (typeof db.runTransaction === 'function') {
      return await db.runTransaction(async (transaction) => {
        const anchorId = getMemberAnchorId(openId)
        const anchorRef = transaction.collection(collections.familyMembers).doc(anchorId)
        const anchorRes = await anchorRef.get()
        const anchor = anchorRes && anchorRes.data ? anchorRes.data : null
        if (anchor && anchor.status === 'active') {
          if (anchor.ownerOpenId !== ownerOpenId) {
            throw inviteError('bound')
          }
          return { _id: anchor._id || anchorId, ownerOpenId, memberOpenId: openId, status: 'active', idempotent: true }
        }

        const authRef = transaction.collection(collections.familyAuth).doc(auth._id)
        const authRes = await authRef.get()
        const latestAuth = authRes && authRes.data ? authRes.data : null
        // 重验提交码与最新邀请一致（重邀交错防线）
        if (!latestAuth || latestAuth.inviteCode !== inviteCode) {
          throw inviteError('notFound')
        }
        // 复核状态/有效期/自绑
        const txOwnerOpenId = assertJoinableAuth(latestAuth, openId)
        if (txOwnerOpenId !== ownerOpenId) {
          throw inviteError('notFound')
        }

        const relationData = buildJoinRelationData(latestAuth, ownerOpenId, ownerName, openId, inviteCode)
        if (anchor) {
          await anchorRef.update({ data: relationData })
        } else {
          await anchorRef.set({ data: relationData })
        }
        await authRef.update({
          data: {
            ownerName,
            memberOpenId: openId,
            member: relationData.member,
            memberName: relationData.memberName,
            status: 'active',
            updatedAt: db.serverDate()
          }
        })
        return { _id: anchorId, ownerOpenId, memberOpenId: openId, status: 'active' }
      })
    }

    // 回退路径（无事务能力的环境，如本地 Mock）：先查后写。
    // 注意：该路径不具备并发保障，仅用于本地测试；不得视为已验证的原子性。
    const { data: existing = [] } = await withPerfLog({
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

    const relationData = buildJoinRelationData(auth, ownerOpenId, ownerName, openId, inviteCode)

    const relationWrite = existing.length
      ? db.collection(collections.familyMembers).doc(existing[0]._id).update({
        data: relationData
      })
      : db.collection(collections.familyMembers).add({
        data: {
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
    // A1：memberId 必填（decisions 4.2），校验通过前零写入；不再有无 memberId 的整体撤销分支。
    const memberId = getLimitedString(payload.memberId, '家属ID', 64, true)

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
    if (relation.status === 'revoked') {
      // 重复撤销：幂等返回，零写入，不触碰其他成员与当前邀请配置
      return {
        memberId: relation._id,
        status: 'revoked',
        alreadyRevoked: true
      }
    }

    const writes = [
      db.collection(collections.familyMembers).doc(relation._id).update({
        data: {
          status: 'revoked',
          updatedAt: db.serverDate()
        }
      })
    ]

    // family_auth 仅当确实绑定该成员时重置；绑定他人或待加入的邀请配置不动
    const auth = authList[0]
    if (auth && auth.memberOpenId && auth.memberOpenId === relation.memberOpenId) {
      writes.push(db.collection(collections.familyAuth).doc(auth._id).update({
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

  // ============ A3：家属视图闸口（二级页只读闭环） ============
  // 数据主体只能由服务端从 active 绑定关系推导（getFamilyAccessContext），
  // 客户端传入的 ownerOpenId 等参数一律忽略；拒绝响应显式带 familyView.allowed=false + reason，
  // 不用空数据冒充权限验证结果。

  function familyViewDenied(reason) {
    return { familyView: { allowed: false, reason } }
  }

  async function resolveFamilyView(openId, payload) {
    if (!payload || payload.familyView !== true) return { mode: 'self' }
    const ctx = await getFamilyAccessContext(openId)
    if (ctx && ctx.mode === 'member') {
      return { mode: 'member', ownerOpenId: ctx.ownerOpenId, relation: ctx.relation }
    }
    if (ctx && ctx.mode === 'ownerPreview') return { mode: 'self' }
    // 无成员关系：若本人是 owner（持有关系行或邀请文档）按 self 处理；
    // 否则区分已撤销成员与完全无绑定。
    const [{ data: ownedRows = [] }, { data: authRows = [] }, { data: myRows = [] }] = await Promise.all([
      db.collection(collections.familyMembers).where({ ownerOpenId: openId }).limit(1).get(),
      db.collection(collections.familyAuth).where({ _openid: openId }).limit(1).get(),
      db.collection(collections.familyMembers).where({ memberOpenId: openId }).limit(1).get()
    ])
    if (ownedRows.length || authRows.length) return { mode: 'self' }
    if (myRows.length && myRows[0].status === 'revoked') {
      return { mode: 'denied', reason: 'revoked' }
    }
    return { mode: 'denied', reason: 'noBinding' }
  }

  function familyReadAllowed(resolution, keys) {
    return keys.every(key => canViewScope(resolution.relation.scopes, key))
  }

  function decorateFamilyView(data, resolution) {
    data.familyView = {
      allowed: true,
      readOnly: true,
      ownerName: resolution.relation.ownerName || ''
    }
    return data
  }

  async function getFamilyTrendData(openId, payload = {}) {
    const resolution = await resolveFamilyView(openId, payload)
    if (resolution.mode === 'self') return getRecordService().getTrendData(openId, payload)
    if (resolution.mode === 'denied') return familyViewDenied(resolution.reason)
    const metric = payload.metric || 'bpBg'
    const required = metric === 'medication' ? ['medicine'] : ['bloodPressure', 'bloodGlucose']
    if (!familyReadAllowed(resolution, required)) return familyViewDenied('scopeDenied')
    return decorateFamilyView(
      await getRecordService().getTrendData(resolution.ownerOpenId, payload),
      resolution
    )
  }

  async function getFamilyRecordListData(openId, payload = {}) {
    const resolution = await resolveFamilyView(openId, payload)
    if (resolution.mode === 'self') return getRecordService().getRecordListData(openId, payload)
    if (resolution.mode === 'denied') return familyViewDenied(resolution.reason)
    const allowedTypes = []
    if (canViewScope(resolution.relation.scopes, 'bloodPressure')) allowedTypes.push('bp')
    if (canViewScope(resolution.relation.scopes, 'bloodGlucose')) allowedTypes.push('bg')
    if (!allowedTypes.length) return familyViewDenied('scopeDenied')
    if (payload.type && !allowedTypes.includes(payload.type)) return familyViewDenied('scopeDenied')
    return decorateFamilyView(
      await getRecordService().getRecordListData(resolution.ownerOpenId, payload, { allowedTypes }),
      resolution
    )
  }

  async function getFamilyMedListData(openId, payload = {}) {
    const resolution = await resolveFamilyView(openId, payload)
    if (resolution.mode === 'self') return getMedicationService().getMedListData(openId)
    if (resolution.mode === 'denied') return familyViewDenied(resolution.reason)
    if (!familyReadAllowed(resolution, ['medicine'])) return familyViewDenied('scopeDenied')
    const data = await getMedicationService().getMedListData(resolution.ownerOpenId)
    // A4：家属态写能力下发与"仅本人代确认可撤销"标记
    const canConfirm = canPerformScopeAction(resolution.relation.scopes, 'confirmMedication')
    if (data && typeof data === 'object') {
      data.familyView = {
        allowed: true,
        readOnly: !canConfirm,
        ownerName: resolution.relation.ownerName || '',
        writePermissions: { medicine: canConfirm }
      }
      if (Array.isArray(data.confirmations)) {
        data.confirmations = data.confirmations.map(c => ({
          ...c,
          canRevokeProxy: c.createdByMemberOpenId === openId
        }))
      }
    }
    return data
  }

  async function getFamilyMedHistoryData(openId, payload = {}) {
    const resolution = await resolveFamilyView(openId, payload)
    if (resolution.mode === 'self') return getMedicationService().getMedHistoryData(openId, payload)
    if (resolution.mode === 'denied') return familyViewDenied(resolution.reason)
    if (!familyReadAllowed(resolution, ['medicine'])) return familyViewDenied('scopeDenied')
    return decorateFamilyView(
      await getMedicationService().getMedHistoryData(resolution.ownerOpenId, payload),
      resolution
    )
  }

  async function getFamilyRecordDetailData(openId, payload = {}) {
    const resolution = await resolveFamilyView(openId, payload)
    if (resolution.mode === 'self') return getRecordService().getRecordDetailData(openId, payload)
    if (resolution.mode === 'denied') return familyViewDenied(resolution.reason)
    const data = await getRecordService().getRecordDetailData(resolution.ownerOpenId, payload)
    const type = data && data.record && data.record.type
    const key = type === 'bp' ? 'bloodPressure' : type === 'bg' ? 'bloodGlucose' : null
    if (!key || !canViewScope(resolution.relation.scopes, key)) {
      return familyViewDenied('scopeDenied')
    }
    return decorateFamilyView(data, resolution)
  }

  // ============ A4：家属代录写入闭环 ============
  // ownerOpenId 一律由服务端 active 关系推导；客户端传入的 ownerOpenId /
  // createdByMemberOpenId / _openid / memberId 一律忽略（不入参）。
  // 失败路径零写入；写库顺序 = 先鉴权 → 再校验 → 最后写。

  function familyWriteDenied(reason) {
    return { familyWrite: { allowed: false, reason } }
  }

  async function resolveMemberWriter(openId) {
    const ctx = await getFamilyAccessContext(openId)
    if (ctx && ctx.mode === 'member') {
      if (ctx.relation.status !== 'active') return { denied: familyWriteDenied('revoked') }
      return { ownerOpenId: ctx.ownerOpenId, memberOpenId: openId, relation: ctx.relation }
    }
    if (ctx && ctx.mode === 'ownerPreview') return { denied: familyWriteDenied('notMember') }
    const { data: rows = [] } = await db.collection(collections.familyMembers)
      .where({ memberOpenId: openId })
      .limit(1)
      .get()
    if (rows.length && rows[0].status === 'revoked') return { denied: familyWriteDenied('revoked') }
    return { denied: familyWriteDenied('noBinding') }
  }

  function memberAudit(writer) {
    return {
      ownerOpenId: writer.ownerOpenId,
      createdByMemberOpenId: writer.memberOpenId,
      createdByRole: 'member'
    }
  }

  async function familyRecordBloodPressure(openId, payload = {}) {
    const writer = await resolveMemberWriter(openId)
    if (writer.denied) return writer.denied
    if (!canPerformScopeAction(writer.relation.scopes, 'recordBloodPressure')) {
      return familyWriteDenied('scopeDenied')
    }
    const record = validateBloodPressurePayload(payload)
    const result = await withPerfLog({
      routeType: 'action',
      route: 'familyRecordBloodPressure',
      step: 'db.records.add'
    }, () => db.collection(collections.records).add({
      data: {
        _openid: writer.ownerOpenId,
        ...memberAudit(writer),
        type: 'bp',
        source: 'family',
        ...record,
        createdAt: db.serverDate()
      }
    }))
    await getDailyStatsService().updateRecordStats(writer.ownerOpenId, 'bp', record, 1, 'familyRecordBloodPressure')
    return { familyWrite: { allowed: true, ownerOpenId: writer.ownerOpenId }, result }
  }

  async function familyRecordBloodGlucose(openId, payload = {}) {
    const writer = await resolveMemberWriter(openId)
    if (writer.denied) return writer.denied
    if (!canPerformScopeAction(writer.relation.scopes, 'recordBloodGlucose')) {
      return familyWriteDenied('scopeDenied')
    }
    const record = validateBloodGlucosePayload(payload)
    const result = await withPerfLog({
      routeType: 'action',
      route: 'familyRecordBloodGlucose',
      step: 'db.records.add'
    }, () => db.collection(collections.records).add({
      data: {
        _openid: writer.ownerOpenId,
        ...memberAudit(writer),
        type: 'bg',
        source: 'family',
        ...record,
        createdAt: db.serverDate()
      }
    }))
    await getDailyStatsService().updateRecordStats(writer.ownerOpenId, 'bg', record, 1, 'familyRecordBloodGlucose')
    return { familyWrite: { allowed: true, ownerOpenId: writer.ownerOpenId }, result }
  }

  async function familyConfirmMedication(openId, payload = {}) {
    const writer = await resolveMemberWriter(openId)
    if (writer.denied) return writer.denied
    if (!canPerformScopeAction(writer.relation.scopes, 'confirmMedication')) {
      return familyWriteDenied('scopeDenied')
    }
    // 保护他人确认：同 logId+当日 已由 owner 或其他成员创建的确认，禁止代确认覆盖
    const todayStr = getTodayDateValue()
    const logId = getLimitedString(payload.logId, '用药日志ID', 80, true)
    const { data: existing = [] } = await db.collection(collections.medicationConfirmations)
      .where({ _openid: writer.ownerOpenId, logId, confirmDate: todayStr })
      .limit(1)
      .get()
    if (existing.length && existing[0].createdByMemberOpenId !== openId) {
      return familyWriteDenied('foreignRecord')
    }
    const result = await getMedicationService().confirmMedication(writer.ownerOpenId, payload, {
      audit: memberAudit(writer)
    })
    return { familyWrite: { allowed: true, ownerOpenId: writer.ownerOpenId }, result }
  }

  async function familyRevokeProxyConfirmation(openId, payload = {}) {
    const writer = await resolveMemberWriter(openId)
    if (writer.denied) return writer.denied
    if (!canPerformScopeAction(writer.relation.scopes, 'revokeMedicationConfirmation')) {
      return familyWriteDenied('scopeDenied')
    }
    const logId = getLimitedString(payload.logId, '用药日志ID', 80, true)
    const todayStr = getTodayDateValue()
    // 仅本人本次代确认（createdByMemberOpenId=当前成员）可撤销
    const { data: existing = [] } = await db.collection(collections.medicationConfirmations)
      .where({
        _openid: writer.ownerOpenId,
        logId,
        confirmDate: todayStr,
        createdByMemberOpenId: openId
      })
      .limit(1)
      .get()
    if (!existing.length) return familyWriteDenied('notFound')
    await withPerfLog({
      routeType: 'action',
      route: 'familyRevokeProxyConfirmation',
      step: 'db.medicationConfirmations.remove'
    }, () => db.collection(collections.medicationConfirmations).doc(existing[0]._id).remove())
    return { familyWrite: { allowed: true }, removed: 1 }
  }

  // ============ A6：电话提醒（decisions #4/#12） ============
  // 号码存放于 owner 的 family_auth 单文档 contactPhone 字段；
  // 家属侧只回传脱敏号（homeFamily），完整号码仅在拨号 action 按需返回；
  // remind=false / 撤销 / 未配置时接口立即不再返回号码。
  // 日志与错误信息不输出完整号码（withPerfLog 仅记录静态 step 名）。

  async function getOwnerContactPhone(ownerOpenId) {
    const { data } = await db.collection(collections.familyAuth)
      .where({ _openid: ownerOpenId })
      .limit(1)
      .get()
    const raw = data[0] && data[0].contactPhone
    // 非法/陈旧格式一律按未配置处理（不产出半掩码、不回传可疑号码）
    return maskContactPhone(raw) ? raw.trim() : ''
  }

  async function setFamilyContactPhone(openId, payload = {}) {
    // 先校验后写入：非法号码抛错时零写入；错误文案固定，不回显输入
    const contactPhone = normalizeContactPhone(payload ? payload.contactPhone : null)
    if (contactPhone === null) {
      throw new Error('请提供提醒电话；清空请提交空字符串')
    }
    const { data: existing = [] } = await withPerfLog({
      routeType: 'action',
      route: 'setFamilyContactPhone',
      step: 'db.familyAuth.current'
    }, () => db.collection(collections.familyAuth)
      .where({ _openid: openId })
      .limit(1)
      .get())

    if (existing.length) {
      await db.collection(collections.familyAuth).doc(existing[0]._id).update({
        data: { contactPhone, updatedAt: db.serverDate() }
      })
    } else {
      // 纯电话配置文档：无 inviteCode/memberOpenId，家庭页不据此生成预览卡
      await db.collection(collections.familyAuth).add({
        data: {
          _openid: openId,
          contactPhone,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
    }
    return { updated: true, contactPhoneMasked: maskContactPhone(contactPhone) }
  }

  async function familyGetReminderPhone(openId) {
    // 复用 A4 写者解析：active 成员关系是取号前提（撤销/无绑定/owner 一律拒绝）
    const writer = await resolveMemberWriter(openId)
    if (writer.denied) {
      return { phoneDenied: writer.denied.familyWrite }
    }
    if (!canCallReminderPhone(writer.relation.scopes)) {
      return { phoneDenied: { allowed: false, reason: 'remindDenied' } }
    }
    const phone = await getOwnerContactPhone(writer.ownerOpenId)
    if (!phone) {
      return { phoneDenied: { allowed: false, reason: 'notConfigured' } }
    }
    return { phone, masked: maskContactPhone(phone) }
  }

  return {
    createFamilyInvite,
    familyConfirmMedication,
    familyGetReminderPhone,
    familyRecordBloodGlucose,
    familyRecordBloodPressure,
    familyRevokeProxyConfirmation,
    getFamilyAuthData,
    getFamilyData,
    getFamilyInviteData,
    getFamilyJoinData,
    getFamilyMedHistoryData,
    getFamilyMedListData,
    getFamilyRecordDetailData,
    getFamilyRecordListData,
    getFamilyTrendData,
    getHomeFamilyData,
    joinFamilyByInvite,
    resolveFamilyView,
    revokeFamilyMember,
    setFamilyContactPhone,
    updateFamilyAuth
  }
}

module.exports = {
  createFamilyService,
  minimalScopes
}
