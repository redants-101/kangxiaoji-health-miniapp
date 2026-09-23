/**
 * A1 多成员隔离与精准授权测试。
 * 存储替身只模拟数据库存取（含 doc 级 update/remove），不复制业务判断；
 * 事务/锁/重试能力 Mock 不具备，并发原子性属云端待验证项（见 summary），
 * 本文件验证的是判定逻辑与写入范围：谁被拒、谁被写、写了什么。
 * 预期值按 decisions.md 第 2 项与 4.2 节字面填写。
 */

const { createFamilyService } = require('../../cloudfunctions/healthApi/family-service')
const { createSettingsDataService } = require('../../cloudfunctions/healthApi/settings-data-service')
const policy = require('../../cloudfunctions/healthApi/family-policy')
const helpers = require('../../cloudfunctions/healthApi/payload-helpers')

const COLLECTIONS = {
  records: 'health_records',
  medicationPlans: 'medication_plans',
  medicationConfirmations: 'medication_confirmations',
  familyAuth: 'family_auth',
  familyMembers: 'family_members',
  inviteAttempts: 'family_invite_attempts',
  reminderSettings: 'reminder_settings',
  privacySettings: 'privacy_settings',
  feedbacks: 'feedbacks',
  dailyStats: 'health_daily_stats',
  recordStats: 'health_record_stats',
  profiles: 'profiles'
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

class StoreQuery {
  constructor(store, query = {}) {
    this.store = store
    this.query = query
    this.orderField = ''
    this.orderDir = 'asc'
    this.max = Infinity
    this.docId = ''
    this.hasDocId = false
  }
  where(cond) { return new StoreQuery(this.store, cond) }
  orderBy(field, dir) { const q = new StoreQuery(this.store, this.query); q.orderField = field; q.orderDir = dir; return q }
  limit(size) { const q = new StoreQuery(this.store, this.query); q.orderField = this.orderField; q.orderDir = this.orderDir; q.max = size; q.docId = this.docId; q.hasDocId = this.hasDocId; return q }
  skip() { return this }
  doc(id) { const q = new StoreQuery(this.store, this.query); q.docId = id; q.hasDocId = true; q.orderField = this.orderField; q.orderDir = this.orderDir; q.max = this.max; return q }
  field() { return this }
  _targets() {
    if (this.hasDocId) return this.store.rows.filter(d => d._id === this.docId)
    return this.store.rows.filter(d => Object.entries(this.query).every(([k, v]) => {
      if (v && v.__op === 'in') return v.values.includes(d[k])
      if (v && v.__op === 'lt') return typeof d[k] === 'number' && d[k] < v.value
      if (v && v.__op === 'gt') return typeof d[k] === 'number' && d[k] > v.value
      return d[k] === v
    }))
  }
  async get() {
    let rows = this._targets().map(clone)
    if (this.orderField) {
      rows.sort((a, b) => {
        const x = a[this.orderField], y = b[this.orderField]
        if (x === y) return 0
        return this.orderDir === 'desc' ? (x < y ? 1 : -1) : (x > y ? 1 : -1)
      })
    }
    return { data: this.max === Infinity ? rows : rows.slice(0, this.max) }
  }
  async count() { return { total: this._targets().length } }
  async add({ data }) {
    const _id = data._id || `doc-${this.store.seq++}`
    if (this.store.rows.some(d => d._id === _id)) {
      const err = new Error('E11000 duplicate key error')
      err.errCode = -502005
      throw err
    }
    this.store.rows.push({ _id, ...clone(data) })
    return { _id }
  }
  async update({ data }) {
    const targets = this._targets()
    targets.forEach((d) => {
      Object.entries(data).forEach(([k, v]) => {
        if (v && v.__op === 'inc') d[k] = (typeof d[k] === 'number' ? d[k] : 0) + v.value
        else d[k] = clone(v)
      })
    })
    return { stats: { updated: targets.length } }
  }
  async remove() {
    const before = this.store.rows.length
    const ids = new Set(this._targets().map(d => d._id))
    this.store.rows = this.store.rows.filter(d => !ids.has(d._id))
    return { stats: { removed: before - this.store.rows.length } }
  }
}

function createStoreDb(initial = {}) {
  const stores = {}
  Object.keys(COLLECTIONS).forEach((alias) => {
    const name = COLLECTIONS[alias]
    stores[name] = { rows: Array.isArray(initial[alias]) ? clone(initial[alias]) : [], seq: 1 }
  })
  return {
    collection(name) {
      if (!stores[name]) stores[name] = { rows: [], seq: 1 }
      return new StoreQuery(stores[name])
    },
    serverDate() { return 'SERVER_DATE' },
    _stores: stores
  }
}

const commands = {
  in: values => ({ __op: 'in', values }),
  lt: value => ({ __op: 'lt', value }),
  gt: value => ({ __op: 'gt', value }),
  inc: value => ({ __op: 'inc', value })
}

function createService(db, inviteSeq = { n: 0 }) {
  return createFamilyService({
    db,
    _: commands,
    collections: COLLECTIONS,
    withPerfLog: (meta, fn) => fn(),
    getProfileDisplayName: policy.createProfileDisplayName({ db, collections: COLLECTIONS }),
    getFamilyAccessContext: policy.createFamilyAccessContext({ db, collections: COLLECTIONS }),
    getRecordStatus: helpers.getRecordStatus,
    getDefaultFamilyMember: policy.getDefaultFamilyMember,
    getFamilyRelationV2: policy.getFamilyRelationV2,
    getDefaultInviteScopesV2: policy.getDefaultInviteScopesV2,
    getDefaultInviteNoticeRulesV2: policy.getDefaultInviteNoticeRulesV2,
    normalizeFamilyScopesV2: policy.normalizeFamilyScopesV2,
    normalizeNoticeRulesV2: policy.normalizeNoticeRulesV2,
    canViewScope: policy.canViewScope,
    canPerformScopeAction: policy.canPerformScopeAction,
    normalizeContactPhone: policy.normalizeContactPhone,
    maskContactPhone: policy.maskContactPhone,
    canCallReminderPhone: policy.canCallReminderPhone,
    getScopeTextV2: policy.getScopeTextV2,
    normalizeFamilyAuthPayloadV2: policy.normalizeFamilyAuthPayloadV2,
    normalizeFamilyInvitePayloadV2: policy.normalizeFamilyInvitePayloadV2,
    validateInviteCodePayload: policy.validateInviteCodePayload,
    getLimitedString: helpers.getLimitedString,
    createInviteCode: () => `KXJINV${String(++inviteSeq.n).padStart(6, '0')}`
  })
}

function createSettings(db) {
  return createSettingsDataService({
    db,
    collections: COLLECTIONS,
    getDefaultReminderSettings: () => ({ subscription: {}, reminders: [], timePlans: [], quietMode: true }),
    normalizeReminderSettingsPayload: payload => payload,
    statsService: { async getRecordStats() { return { recordCount: 0 } } },
    withPerfLog: (meta, fn) => fn()
  })
}

function bpOnlyScopes() {
  return [
    { key: 'bloodPressure', read: true, remind: false },
    { key: 'bloodGlucose', read: false },
    { key: 'medicine', read: false },
    { key: 'report', read: false }
  ]
}

function fullScopes() {
  return [
    { key: 'bloodPressure', read: true, write: false, remind: true },
    { key: 'bloodGlucose', read: true, write: false, remind: true },
    { key: 'medicine', read: true, write: false, remind: true },
    { key: 'report', read: true, write: false, remind: true }
  ]
}

function memberRows(db) { return db._stores[COLLECTIONS.familyMembers].rows }
function authRows(db) { return db._stores[COLLECTIONS.familyAuth].rows }

// 场景搭建：O1 邀请并由 M1、M2 先后加入（中间 O1 重新邀请生成新码）
async function seedTwoMembers(db) {
  const service = createService(db)
  const inv1 = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
  await service.joinFamilyByInvite('member-1', { inviteCode: inv1.inviteCode })
  const inv2 = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
  await service.joinFamilyByInvite('member-2', { inviteCode: inv2.inviteCode })
  return service
}

describe('A1 · 一位老人关联多位家属', () => {
  it('O1 先后绑定 M1、M2：两行 active 关系互不影响', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    await seedTwoMembers(db)
    const rows = memberRows(db).filter(r => r.status === 'active')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.memberOpenId).sort()).toEqual(['member-1', 'member-2'])
    expect(rows.every(r => r.ownerOpenId === 'owner-1')).toBe(true)
  })
})

describe('A1 · 重新邀请：清空绑定但不动已有成员', () => {
  it('重邀后 family_auth memberOpenId 清空、status=pending，M1 关系行原样保留', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const inv1 = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    await service.joinFamilyByInvite('member-1', { inviteCode: inv1.inviteCode })
    const m1Before = clone(memberRows(db)[0])

    const inv2 = await service.createFamilyInvite('owner-1', { scopes: bpOnlyScopes() })
    const auth = authRows(db)[0]
    expect(auth.memberOpenId).toBe('')
    expect(auth.status).toBe('pending')
    expect(auth.inviteCode).toBe(inv2.inviteCode)
    // 已有成员的权限、状态、提醒规则不被重邀触碰
    expect(memberRows(db)[0]).toEqual(m1Before)
  })
})

describe('A1 · 精准改权', () => {
  it('修改 M1 后：M2 权限与无关待加入邀请保持不变', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = await seedTwoMembers(db)
    // 再发起一次待加入邀请（family_auth 变为 pending、memberOpenId 清空）
    const pending = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    const authBefore = clone(authRows(db)[0])
    const m2Row = memberRows(db).find(r => r.memberOpenId === 'member-2')
    const m2Before = clone(m2Row)
    const m1Row = memberRows(db).find(r => r.memberOpenId === 'member-1')

    await service.updateFamilyAuth('owner-1', {
      memberId: m1Row._id,
      member: { name: '王阿姨' },
      scopes: bpOnlyScopes(),
      noticeRules: { missedMedicine: false, missingRecord: false, weeklyReport: false },
      activities: []
    })

    const m1After = memberRows(db).find(r => r.memberOpenId === 'member-1')
    expect(m1After.scopes.find(s => s.key === 'bloodPressure').read).toBe(true)
    expect(m1After.scopes.find(s => s.key === 'medicine').read).toBe(false)
    // M2 不受影响
    expect(memberRows(db).find(r => r.memberOpenId === 'member-2')).toEqual(m2Before)
    // 待加入邀请配置不被成员改权覆盖
    expect(authRows(db)[0]).toEqual(authBefore)
    expect(pending.inviteCode).toBeTruthy()
  })

  it.each([
    ['缺失', undefined],
    ['伪造', 'not-exist-id'],
    ['空字符串', '   ']
  ])('memberId %s：拒绝且 family_auth 与 family_members 零写入', async (_label, memberId) => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = await seedTwoMembers(db)
    const membersBefore = clone(memberRows(db))
    const authBefore = clone(authRows(db))

    await expect(service.updateFamilyAuth('owner-1', {
      memberId,
      scopes: bpOnlyScopes()
    })).rejects.toThrow()

    expect(memberRows(db)).toEqual(membersBefore)
    expect(authRows(db)).toEqual(authBefore)
  })

  it('其他 owner 的 memberId：拒绝且零写入', async () => {
    const db = createStoreDb({
      profiles: [
        { _openid: 'owner-1', name: '王阿姨' },
        { _openid: 'owner-2', name: '李叔叔' }
      ]
    })
    const service = createService(db)
    // owner-2 有自己的成员 M9
    const inv = await service.createFamilyInvite('owner-2', { scopes: fullScopes() })
    await service.joinFamilyByInvite('member-9', { inviteCode: inv.inviteCode })
    const m9Row = memberRows(db).find(r => r.memberOpenId === 'member-9')
    // owner-1 有自己的成员 M1
    const inv1 = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    await service.joinFamilyByInvite('member-1', { inviteCode: inv1.inviteCode })

    const membersBefore = clone(memberRows(db))
    const authBefore = clone(authRows(db))

    await expect(service.updateFamilyAuth('owner-1', {
      memberId: m9Row._id,
      scopes: bpOnlyScopes()
    })).rejects.toThrow('家属关系不存在或无权操作')

    expect(memberRows(db)).toEqual(membersBefore)
    expect(authRows(db)).toEqual(authBefore)
  })

  it('getFamilyAuthData 预览分支不得回填 family_auth id 充当 memberId', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    const data = await service.getFamilyAuthData('owner-1', {})
    expect(data.memberId).toBe('')
  })

  it('getFamilyData 预览卡不得携带 family_auth id 作为成员 id', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    const data = await service.getFamilyData('owner-1')
    expect(data.members[0].isOwner).toBe(true)
    expect(data.members[0].id).toBe('')
  })
})

describe('A1 · 精准撤销', () => {
  it('撤销 M1 后：M1 新请求被拒（空数据），M2 新请求仍允许', async () => {
    const db = createStoreDb({
      profiles: [{ _openid: 'owner-1', name: '王阿姨' }],
      records: [
        { _id: 'r-bp', _openid: 'owner-1', type: 'bp', systolic: 128, diastolic: 78, measuredAt: '今天 08:00', tag: '晨起', level: '', createdAt: '2026-09-22T08:00:00' }
      ],
      medicationPlans: [
        { _id: 'plan-1', _openid: 'owner-1', name: '降压药', dosage: '1片', times: ['07:00'], status: '启用', updatedAt: '2026-09-22T07:00:00' }
      ]
    })
    const service = await seedTwoMembers(db)
    const m1Row = memberRows(db).find(r => r.memberOpenId === 'member-1')

    await service.revokeFamilyMember('owner-1', { memberId: m1Row._id })

    expect(memberRows(db).find(r => r.memberOpenId === 'member-1').status).toBe('revoked')
    expect(memberRows(db).find(r => r.memberOpenId === 'member-2').status).toBe('active')

    const homeM1 = await service.getHomeFamilyData('member-1')
    expect(homeM1.member.scopeText).toBe('暂未授权')
    expect(homeM1.latestMetrics).toEqual([])
    expect(homeM1.medicineLogs).toEqual([])

    const homeM2 = await service.getHomeFamilyData('member-2')
    expect(homeM2.member.name).toBe('王阿姨')
    expect(homeM2.latestMetrics.length).toBeGreaterThan(0)
  })

  it('重复撤销：幂等返回且零写入，不触碰无关邀请与其他成员', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = await seedTwoMembers(db)
    const m1Row = memberRows(db).find(r => r.memberOpenId === 'member-1')
    await service.revokeFamilyMember('owner-1', { memberId: m1Row._id })
    // 撤销后 owner 重新邀请第三人（pending 配置与 M1 无关）
    await service.createFamilyInvite('owner-1', { scopes: fullScopes() })

    const membersBefore = clone(memberRows(db))
    const authBefore = clone(authRows(db))
    const second = await service.revokeFamilyMember('owner-1', { memberId: m1Row._id })

    expect(second.status).toBe('revoked')
    expect(memberRows(db)).toEqual(membersBefore)
    expect(authRows(db)).toEqual(authBefore)
  })

  it('撤销要求 memberId：缺失时拒绝且不清 family_auth', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = await seedTwoMembers(db)
    const membersBefore = clone(memberRows(db))
    const authBefore = clone(authRows(db))

    await expect(service.revokeFamilyMember('owner-1', {})).rejects.toThrow()

    expect(memberRows(db)).toEqual(membersBefore)
    expect(authRows(db)).toEqual(authBefore)
  })

  it('撤销只重置确实绑定该成员的 family_auth，不动他人绑定', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = await seedTwoMembers(db)
    // 当前 auth 绑定 M2；撤销 M1 不得重置该邀请配置
    const authBefore = clone(authRows(db)[0])
    const m1Row = memberRows(db).find(r => r.memberOpenId === 'member-1')
    await service.revokeFamilyMember('owner-1', { memberId: m1Row._id })
    expect(authRows(db)[0]).toEqual(authBefore)
  })
})

describe('A1 · 加入家庭：1:1、幂等与自绑', () => {
  it('已绑定 O1 的成员加入 O2 被拒，零新行、O2 邀请保持 pending', async () => {
    const db = createStoreDb({
      profiles: [
        { _openid: 'owner-1', name: '王阿姨' },
        { _openid: 'owner-2', name: '李叔叔' }
      ]
    })
    const s1 = createService(db)
    const inv1 = await s1.createFamilyInvite('owner-1', { scopes: fullScopes() })
    await s1.joinFamilyByInvite('member-1', { inviteCode: inv1.inviteCode })
    const inv2 = await s1.createFamilyInvite('owner-2', { scopes: fullScopes() })

    const membersBefore = clone(memberRows(db))
    await expect(s1.joinFamilyByInvite('member-1', { inviteCode: inv2.inviteCode }))
      .rejects.toThrow('你已绑定一位家人')

    expect(memberRows(db)).toEqual(membersBefore)
    const o2Auth = authRows(db).find(a => a._openid === 'owner-2')
    expect(o2Auth.status).toBe('pending')
  })

  it('同 owner 重复加入：幂等，不增行、不重置已调整权限', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const inv = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    const first = await service.joinFamilyByInvite('member-1', { inviteCode: inv.inviteCode })

    // owner 调整 M1 权限（只留血压）
    const m1Row = memberRows(db).find(r => r.memberOpenId === 'member-1')
    await service.updateFamilyAuth('owner-1', {
      memberId: m1Row._id,
      scopes: bpOnlyScopes(),
      noticeRules: { missedMedicine: false, missingRecord: false, weeklyReport: false }
    })
    const adjusted = clone(memberRows(db).find(r => r.memberOpenId === 'member-1'))
    const rowCount = memberRows(db).length

    // M1 用同一邀请码重复加入（重试/重复点击）
    const again = await service.joinFamilyByInvite('member-1', { inviteCode: inv.inviteCode })
    expect(again.status).toBe('active')
    expect(memberRows(db)).toHaveLength(rowCount)
    expect(memberRows(db).find(r => r.memberOpenId === 'member-1')).toEqual(adjusted)
    expect(first.ownerOpenId).toBe('owner-1')
  })

  it('拒绝本人自绑定', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const inv = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    await expect(service.joinFamilyByInvite('owner-1', { inviteCode: inv.inviteCode }))
      .rejects.toThrow('不能加入自己创建的家庭邀请')
    expect(memberRows(db)).toHaveLength(0)
  })

  it('同一邀请码顺序竞争：先到者绑定，后到者被拒（并发原子性属云端待验证）', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const inv = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    await service.joinFamilyByInvite('member-1', { inviteCode: inv.inviteCode })
    await expect(service.joinFamilyByInvite('member-2', { inviteCode: inv.inviteCode }))
      .rejects.toThrow('邀请已被其他家属使用')
    expect(memberRows(db).filter(r => r.status === 'active')).toHaveLength(1)
  })

  it('被撤销的成员可重新加入（新邀请），锚点复活为新关系', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const inv1 = await service.createFamilyInvite('owner-1', { scopes: fullScopes() })
    await service.joinFamilyByInvite('member-1', { inviteCode: inv1.inviteCode })
    const m1Row = memberRows(db).find(r => r.memberOpenId === 'member-1')
    await service.revokeFamilyMember('owner-1', { memberId: m1Row._id })

    const inv2 = await service.createFamilyInvite('owner-1', { scopes: bpOnlyScopes() })
    const rejoin = await service.joinFamilyByInvite('member-1', { inviteCode: inv2.inviteCode })
    expect(rejoin.status).toBe('active')
    const active = memberRows(db).filter(r => r.memberOpenId === 'member-1' && r.status === 'active')
    expect(active).toHaveLength(1)
    expect(active[0].scopes.find(s => s.key === 'bloodGlucose').read).toBe(false)
  })
})

describe('A1 · 注销关联清理', () => {
  it('家属 M1 注销：只删本人关系行，M2 与 O1 数据不受影响', async () => {
    const db = createStoreDb({
      profiles: [
        { _id: 'p-owner', _openid: 'owner-1', name: '王阿姨' },
        { _id: 'p-m1', _openid: 'member-1', name: '小李' }
      ],
      records: [{ _id: 'r-1', _openid: 'owner-1', type: 'bp', systolic: 120, diastolic: 80 }]
    })
    const service = await seedTwoMembers(db)
    const settings = createSettings(db)

    await settings.clearUserAccount('member-1', { confirm: true })

    expect(memberRows(db).some(r => r.memberOpenId === 'member-1')).toBe(false)
    const m2 = memberRows(db).find(r => r.memberOpenId === 'member-2')
    expect(m2.status).toBe('active')
    // O1 的记录与档案不受影响
    expect(db._stores[COLLECTIONS.records].rows).toHaveLength(1)
    expect(db._stores[COLLECTIONS.profiles].rows.find(p => p._openid === 'owner-1')).toBeTruthy()
    expect(service).toBeTruthy()
  })

  it('注销者是当前绑定成员时，才重置对应 family_auth；绑定他人则不动', async () => {
    const db = createStoreDb({
      profiles: [
        { _id: 'p-owner', _openid: 'owner-1', name: '王阿姨' },
        { _id: 'p-m1', _openid: 'member-1', name: '小李' }
      ]
    })
    await seedTwoMembers(db)
    const settings = createSettings(db)
    // 当前 auth 绑定 member-2；注销 member-1 不得重置
    const authBefore = clone(authRows(db)[0])
    await settings.clearUserAccount('member-1', { confirm: true })
    expect(authRows(db)[0]).toEqual(authBefore)

    // 注销当前绑定者 member-2 → 对应 family_auth 被重置
    await settings.clearUserAccount('member-2', { confirm: true })
    const auth = authRows(db)[0]
    expect(auth.status).toBe('revoked')
    expect(auth.memberOpenId).toBe('')
  })
})

describe('A1 · 客户端镜像：memberId 精确更新，无假成功', () => {
  const {
    updateFamilyAuthLocal,
    revokeFamilyMemberLocal,
    getStoredFamilyAuth
  } = require('../../services/family')
  const { STORAGE_KEYS, writeStorage } = require('../../services/core')

  beforeEach(() => {
    writeStorage(STORAGE_KEYS.familyAuth, {
      currentMemberId: 'rel-1',
      members: [
        { id: 'rel-1', name: '小李', relation: '女儿', status: '已授权', scope: '血压记录' },
        { id: 'rel-2', name: '小张', relation: '儿子', status: '已授权', scope: '血糖记录' }
      ],
      status: 'active'
    })
  })

  it('无 memberId 的改权结果：不镜像、不造卡，返回远端结果', () => {
    const remoteResult = { stats: { updated: 1 } }
    const result = updateFamilyAuthLocal({ scopes: bpOnlyScopes() }, remoteResult)
    expect(result).toEqual(remoteResult)
    const stored = getStoredFamilyAuth()
    expect(stored.members).toHaveLength(2)
    expect(stored.members[0].id).toBe('rel-1')
  })

  it('带 memberId 的改权：只更新对应成员卡', () => {
    updateFamilyAuthLocal({
      memberId: 'rel-2',
      member: { name: '小张', relation: '儿子', role: '紧急联系人', status: 'active' },
      scopes: [
        { key: 'bloodPressure', title: '血压记录', read: true },
        { key: 'bloodGlucose', title: '血糖记录', read: false }
      ]
    }, { stats: { updated: 1 } })
    const stored = getStoredFamilyAuth()
    expect(stored.members.find(m => m.id === 'rel-2').scope).toBe('血压记录')
    expect(stored.members.find(m => m.id === 'rel-1').scope).toBe('血压记录')
  })

  it('撤销镜像：只移除目标成员', () => {
    revokeFamilyMemberLocal({ memberId: 'rel-1' })
    const stored = getStoredFamilyAuth()
    expect(stored.members.map(m => m.id)).toEqual(['rel-2'])
  })
})
