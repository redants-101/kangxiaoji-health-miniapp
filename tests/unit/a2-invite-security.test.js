/**
 * A2 邀请安全、错误态与频控测试。
 * 存储替身只模拟存取（含 count），不复制业务判断；
 * 错误码/文案/门限按 decisions #9/#10/#15 与本批契约字面填写。
 * 并发唯一性与频控原子性无法由本地 Mock 证明，列为云端待验证（见 summary）。
 */

const { createFamilyService } = require('../../cloudfunctions/healthApi/family-service')
const policy = require('../../cloudfunctions/healthApi/family-policy')
const helpers = require('../../cloudfunctions/healthApi/payload-helpers')

const COLLECTIONS = {
  records: 'health_records',
  medicationPlans: 'medication_plans',
  medicationConfirmations: 'medication_confirmations',
  familyAuth: 'family_auth',
  familyMembers: 'family_members',
  inviteAttempts: 'family_invite_attempts',
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
    // 存储引擎语义：自定义 _id 允许，重复即拒绝（云端 E11000 的替身）
    const id = data._id || `doc-${this.store.seq++}`
    if (this.store.rows.some(d => d._id === id)) {
      const err = new Error('E11000 duplicate key error')
      err.errCode = -502005
      throw err
    }
    this.store.rows.push({ _id: id, ...clone(data) })
    return { _id: id }
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
    const ids = new Set(this._targets().map(d => d._id))
    const before = this.store.rows.length
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

function createService(db, codes) {
  const queue = Array.isArray(codes) ? [...codes] : null
  let n = 0
  return createFamilyService({
    db,
    _: {
      in: values => ({ __op: 'in', values }),
      lt: value => ({ __op: 'lt', value }),
      gt: value => ({ __op: 'gt', value }),
      inc: value => ({ __op: 'inc', value })
    },
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
    getScopeTextV2: policy.getScopeTextV2,
    normalizeFamilyAuthPayloadV2: policy.normalizeFamilyAuthPayloadV2,
    normalizeFamilyInvitePayloadV2: policy.normalizeFamilyInvitePayloadV2,
    normalizeContactPhone: policy.normalizeContactPhone,
    maskContactPhone: policy.maskContactPhone,
    canCallReminderPhone: policy.canCallReminderPhone,
    validateInviteCodePayload: policy.validateInviteCodePayload,
    getLimitedString: helpers.getLimitedString,
    createInviteCode: queue ? () => queue.shift() : () => `KXJGEN${String(++n).padStart(6, '0')}`
  })
}

const VALID_CODE = 'KXJABCDEFGHI' // KXJ + 9 位

function pendingAuth(overrides = {}) {
  return {
    _id: 'auth-1',
    _openid: 'owner-1',
    ownerOpenId: 'owner-1',
    ownerName: '王阿姨',
    inviteCode: VALID_CODE,
    status: 'pending',
    member: { name: '女儿', relation: '女儿', role: '主要照护人', status: '待加入' },
    memberName: '女儿',
    scopes: [
      { key: 'bloodPressure', title: '血压记录', meta: 'm', read: true, write: false, remind: true },
      { key: 'bloodGlucose', title: '血糖记录', meta: 'm', read: false, write: false, remind: false },
      { key: 'medicine', title: '用药确认', meta: 'm', read: true, write: false, remind: false },
      { key: 'report', title: '健康记录周报', meta: 'm', read: true, write: false, remind: true }
    ],
    noticeRules: { missedMedicine: true, missingRecord: false, weeklyReport: true },
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    ...overrides
  }
}

function attemptRows(db) { return db._stores[COLLECTIONS.inviteAttempts].rows }
function memberRows(db) { return db._stores[COLLECTIONS.familyMembers].rows }
function authRows(db) { return db._stores[COLLECTIONS.familyAuth].rows }
function today() { return helpers.getTodayDateValue() }

// A2 收尾后频控为“每 (openId, 北京日) 单计数文档”口径
function counterValue(db, openId, day) {
  const key = `invite-fail-${openId}-${day || today()}`
  const doc = attemptRows(db).find(d => d._id === key)
  return doc ? doc.count : 0
}

function seedAttempts(db, count, day) {
  const d = day || today()
  attemptRows(db).push({
    _id: `invite-fail-caller-1-${d}`,
    openId: 'caller-1',
    day: d,
    count,
    createdAt: 'SERVER_DATE',
    updatedAt: 'SERVER_DATE'
  })
}

describe('A2 · getFamilyJoinData 错误态与错误码', () => {
  it('缺失 inviteCode：noInvite 说明态，无 inviteError、不计失败', async () => {
    const db = createStoreDb()
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', {})
    expect(data.noInvite).toBe(true)
    expect(data.inviteError).toBeUndefined()
    expect(data.remainHours).toBe(0)
    expect(data.scopes).toEqual([])
    expect(counterValue(db, 'caller-1')).toBe(0)
  })

  it('格式错误：FAMILY_INVITE_INVALID，失败额度计 1，零成员写入', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: 'abc' })
    expect(data.inviteError).toEqual({ code: 'FAMILY_INVITE_INVALID', message: '邀请码无效，请核对后重试' })
    expect(counterValue(db, 'caller-1')).toBe(1)
    expect(memberRows(db)).toHaveLength(0)
  })

  it('不存在：FAMILY_INVITE_NOT_FOUND，额度计 1', async () => {
    const db = createStoreDb({ familyAuth: [] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError.code).toBe('FAMILY_INVITE_NOT_FOUND')
    expect(counterValue(db, 'caller-1')).toBe(1)
  })

  it('expiresAt 缺失：一律无效（decisions #15），不做 24h 兼容', async () => {
    const auth = pendingAuth()
    delete auth.expiresAt
    const db = createStoreDb({ familyAuth: [auth] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError.code).toBe('FAMILY_INVITE_INVALID')
    expect(counterValue(db, 'caller-1')).toBe(1)
  })

  it('已过期：FAMILY_INVITE_EXPIRED', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ expiresAt: new Date(Date.now() - 1000).toISOString() })] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError.code).toBe('FAMILY_INVITE_EXPIRED')
  })

  it('已撤销：FAMILY_INVITE_REVOKED', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ status: 'revoked' })] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError.code).toBe('FAMILY_INVITE_REVOKED')
  })

  it('已被其他成员使用：FAMILY_INVITE_USED', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ status: 'active', memberOpenId: 'other-member' })] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError.code).toBe('FAMILY_INVITE_USED')
  })

  it('正常 pending：无 inviteError，scopes 仅 read 项，remainHours>0，额度退还为 0', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError).toBeUndefined()
    expect(data.remainHours).toBeGreaterThan(0)
    expect(data.scopes.map(s => s.key)).toEqual(['bloodPressure', 'medicine', 'report'])
    expect(counterValue(db, 'caller-1')).toBe(0)
  })

  it('任何失败路径：family_members 零写入、family_auth 不被改为 active', async () => {
    const auth = pendingAuth({ status: 'revoked' })
    const db = createStoreDb({ familyAuth: [auth] })
    const service = createService(db)
    const before = clone(authRows(db))
    await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(memberRows(db)).toHaveLength(0)
    expect(authRows(db)).toEqual(before)
  })
})

describe('A2 · 频控（openId + 北京自然日，额度 20，原子预留）', () => {
  it('第 1 次失败额度计 1；累计到 20 后第 21 次查询被拒且额度不再增长', async () => {
    const db = createStoreDb({ familyAuth: [] })
    const service = createService(db)
    const first = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(first.inviteError.code).toBe('FAMILY_INVITE_NOT_FOUND')
    expect(counterValue(db, 'caller-1')).toBe(1)

    seedAttempts(db, 19) // 预置计数文档为 19（模拟此前累计失败）
    attemptRows(db)[0].count = 19 // 首查已建同 key 文档，直接归一为单文档 19
    attemptRows(db).splice(1) // 移除重复 key 的预置文档，保持“每 (openId, 日) 单文档”不变式
    const twentieth = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(twentieth.inviteError.code).toBe('FAMILY_INVITE_NOT_FOUND')
    expect(counterValue(db, 'caller-1')).toBe(20)

    const twentyFirst = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(twentyFirst.inviteError).toEqual({ code: 'FAMILY_INVITE_RATE_LIMITED', message: '今日尝试次数过多，请明天再试' })
    expect(counterValue(db, 'caller-1')).toBe(20) // 拒绝不占额度
    await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(counterValue(db, 'caller-1')).toBe(20)
  })

  it('自然日切换：昨日额度用尽不影响今日查询（key 内嵌北京日）', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-22T04:00:00.000Z')) // 北京 12:00
    const yesterday = '2026-09-21'
    return (async () => {
      const db = createStoreDb({ familyAuth: [pendingAuth()] })
      seedAttempts(db, 20, yesterday)
      const service = createService(db)
      const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
      expect(data.inviteError).toBeUndefined()
      expect(counterValue(db, 'caller-1', yesterday)).toBe(20) // 昨日文档不动
      expect(counterValue(db, 'caller-1')).toBe(0) // 今日成功后额度退还
      jest.useRealTimers()
    })()
  })

  it('频控计数文档不含邀请码明文，字段为 openId/day/count', async () => {
    const db = createStoreDb({ familyAuth: [] })
    const service = createService(db)
    await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    const rows = attemptRows(db)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(VALID_CODE)
    expect(rows[0]).toEqual({
      _id: `invite-fail-caller-1-${today()}`,
      openId: 'caller-1',
      day: today(),
      count: 1,
      createdAt: 'SERVER_DATE',
      updatedAt: 'SERVER_DATE'
    })
  })

  it('频控按调用者隔离：caller-2 不受 caller-1 的失败影响', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    seedAttempts(db, 20)
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-2', { inviteCode: VALID_CODE })
    expect(data.inviteError).toBeUndefined()
  })
})

describe('A2 · joinFamilyByInvite 错误码与频控防绕过', () => {
  async function expectJoinCode(db, code, expectedCode) {
    const service = createService(db)
    let caught = null
    try {
      await service.joinFamilyByInvite('caller-1', { inviteCode: code })
    } catch (e) { caught = e }
    expect(caught).toBeTruthy()
    expect(caught.code).toBe(expectedCode)
    expect(memberRows(db)).toHaveLength(0)
  }

  it('不存在 → FAMILY_INVITE_NOT_FOUND 且计数', async () => {
    const db = createStoreDb({ familyAuth: [] })
    await expectJoinCode(db, VALID_CODE, 'FAMILY_INVITE_NOT_FOUND')
    expect(attemptRows(db)).toHaveLength(1)
  })

  it('已过期 → FAMILY_INVITE_EXPIRED', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ expiresAt: new Date(Date.now() - 1000).toISOString() })] })
    await expectJoinCode(db, VALID_CODE, 'FAMILY_INVITE_EXPIRED')
  })

  it('已撤销 → FAMILY_INVITE_REVOKED', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ status: 'revoked' })] })
    await expectJoinCode(db, VALID_CODE, 'FAMILY_INVITE_REVOKED')
  })

  it('已被他人使用 → FAMILY_INVITE_USED', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ status: 'active', memberOpenId: 'other' })] })
    await expectJoinCode(db, VALID_CODE, 'FAMILY_INVITE_USED')
  })

  it('expiresAt 缺失 → FAMILY_INVITE_INVALID（不做兼容）', async () => {
    const auth = pendingAuth()
    delete auth.expiresAt
    const db = createStoreDb({ familyAuth: [auth] })
    await expectJoinCode(db, VALID_CODE, 'FAMILY_INVITE_INVALID')
  })

  it('自绑 → FAMILY_INVITE_SELF（既有语义补码，不占失败额度）', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    const service = createService(db)
    await expect(service.joinFamilyByInvite('owner-1', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_INVITE_SELF' })
    expect(counterValue(db, 'owner-1')).toBe(0)
  })

  it('已绑定他人 → FAMILY_MEMBER_BOUND（A1 语义补码）', async () => {
    const db = createStoreDb({
      familyAuth: [pendingAuth({ _openid: 'owner-2', ownerOpenId: 'owner-2' })],
      familyMembers: [{ _id: 'rel-x', ownerOpenId: 'owner-9', memberOpenId: 'caller-1', status: 'active' }]
    })
    const service = createService(db)
    await expect(service.joinFamilyByInvite('caller-1', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_MEMBER_BOUND' })
  })

  it('频控拒绝直接刷 join 接口：RATE_LIMITED，零写入', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    seedAttempts(db, 20)
    const service = createService(db)
    await expect(service.joinFamilyByInvite('caller-1', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_INVITE_RATE_LIMITED' })
    expect(memberRows(db)).toHaveLength(0)
    expect(authRows(db)[0].status).toBe('pending')
  })
})

describe('A2 · createFamilyInvite 唯一性前置检查', () => {
  it('候选码与他人文档冲突时重新生成，落库用新码', async () => {
    const db = createStoreDb({
      profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }],
      familyAuth: [{ _id: 'auth-other', _openid: 'owner-2', inviteCode: 'KXJDUP000001', status: 'pending' }]
    })
    const service = createService(db, ['KXJDUP000001', 'KXJNEW000002'])
    const invite = await service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] })
    expect(invite.inviteCode).toBe('KXJNEW000002')
  })

  it('连续冲突 3 次：抛错且不写入新邀请', async () => {
    const db = createStoreDb({
      profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }],
      familyAuth: [{ _id: 'auth-other', _openid: 'owner-2', inviteCode: 'KXJDUP000001', status: 'pending' }]
    })
    const service = createService(db, ['KXJDUP000001', 'KXJDUP000001', 'KXJDUP000001'])
    await expect(service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] }))
      .rejects.toThrow('冲突')
    expect(authRows(db)).toHaveLength(1) // 只有 owner-2 的文档
  })

  it('重邀必须发新码：候选码命中自己旧文档同样视为冲突（A2 收尾修订）', async () => {
    const db = createStoreDb({ profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db, ['KXJSAME00001', 'KXJSAME00001', 'KXJFRESH0001'])
    const first = await service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] })
    const second = await service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] })
    expect(first.inviteCode).toBe('KXJSAME00001')
    // 旧码不得因属同一 owner 而复用，否则重邀后旧码仍有效（交错攻击面）
    expect(second.inviteCode).toBe('KXJFRESH0001')
    expect(authRows(db)).toHaveLength(1)
    expect(authRows(db)[0].inviteCode).toBe('KXJFRESH0001')
  })
})

describe('A2 · 本地镜像过期校验（decisions #15）', () => {
  const { joinFamilyByInviteLocal, createFamilyInviteLocal } = require('../../services/family')
  const { STORAGE_KEYS, writeStorage } = require('../../services/core')

  function storeInvite(overrides = {}) {
    writeStorage(STORAGE_KEYS.familyAuth, {
      inviteCode: VALID_CODE,
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      members: [],
      ...overrides
    })
  }

  beforeEach(() => {
    writeStorage(STORAGE_KEYS.familyAuth, null)
  })

  it('本地邀请已过期：拒绝且不假成功', () => {
    storeInvite({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect(() => joinFamilyByInviteLocal({ inviteCode: VALID_CODE }, null))
      .toThrow(expect.objectContaining({ code: 'FAMILY_INVITE_EXPIRED' }))
  })

  it('本地邀请缺失 expiresAt：一律无效', () => {
    storeInvite({ expiresAt: undefined })
    expect(() => joinFamilyByInviteLocal({ inviteCode: VALID_CODE }, null))
      .toThrow(expect.objectContaining({ code: 'FAMILY_INVITE_INVALID' }))
  })

  it('邀请码与本地记录不一致：按不存在处理', () => {
    storeInvite()
    expect(() => joinFamilyByInviteLocal({ inviteCode: 'KXJOTHER0001' }, null))
      .toThrow(expect.objectContaining({ code: 'FAMILY_INVITE_NOT_FOUND' }))
  })

  it('有效本地邀请：正常镜像 joined 状态', () => {
    storeInvite()
    const result = joinFamilyByInviteLocal({ inviteCode: VALID_CODE }, null)
    expect(result.status).toBe('active')
  })

  it('createFamilyInviteLocal 镜像写入 expiresAt（供本地过期校验）', () => {
    createFamilyInviteLocal({ selectedRelation: 'daughter', scopes: [] }, { inviteCode: VALID_CODE })
    const stored = require('../../services/family').getStoredFamilyAuth()
    expect(stored.expiresAt).toBeTruthy()
    expect(new Date(stored.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('A2 · 页面消费契约', () => {
  it('normalizeFamilyJoinData 透传 inviteError（页面据 code 渲染状态）', async () => {
    const { normalizeFamilyJoinData } = require('../../services/family')
    const remote = {
      inviteCode: VALID_CODE,
      inviteError: { code: 'FAMILY_INVITE_EXPIRED', message: '邀请已过期，请让家人重新发起' }
    }
    const data = await normalizeFamilyJoinData(remote)
    expect(data.inviteError.code).toBe('FAMILY_INVITE_EXPIRED')
  })
})
