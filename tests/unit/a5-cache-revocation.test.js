/**
 * A5 撤销实时生效与缓存治理（先失败后实现）。
 *
 * 口径（详见本批 data-flow-review.md）：
 * - 家族敏感读（family 域 key 或 payload.familyView=true）：零缓存、每次回源、失败绝不旧数据回填；
 * - owner 本人读：保持 60s 内存 TTL；网络性失败可回退过期缓存，但服务端显式拒绝（带 errCode）绝不回填；
 * - 动作成功：全局清读缓存（现状 fail-safe 保留）+ 家族事件对七个页面键精准失效并置脏标记；
 * - 本地镜像只做离线回显与 fail-closed 收窄，不作为授权依据。
 *
 * 存储/网络替身只模拟存取与传输；权限与撤销规则走真实 family-policy / family-service，不复制规则。
 */

const { createRecordService } = require('../../cloudfunctions/healthApi/record-service')
const { createMedicationService } = require('../../cloudfunctions/healthApi/medication-service')
const { createFamilyService } = require('../../cloudfunctions/healthApi/family-service')
const policy = require('../../cloudfunctions/healthApi/family-policy')
const helpers = require('../../cloudfunctions/healthApi/payload-helpers')

// ─── wx / 云调用替身 ───

function setupWx(router) {
  const storage = {}
  const calls = { keys: {}, actions: {} }
  global.wx = {
    getStorageSync: (k) => (k in storage ? storage[k] : ''),
    setStorageSync: (k, v) => { storage[k] = v },
    removeStorageSync: (k) => { delete storage[k] },
    showToast: jest.fn(),
    showModal: jest.fn(),
    setNavigationBarTitle: jest.fn(),
    cloud: {
      callFunction: jest.fn((opts) => {
        const d = opts.data || {}
        const isKey = d.key !== undefined
        const bucket = isKey ? calls.keys : calls.actions
        const name = isKey ? d.key : d.action
        bucket[name] = (bucket[name] || 0) + 1
        const result = router ? router(d) : (isKey ? { ok: true, echo: d.key } : { ok: 1 })
        opts.success({ result })
      })
    }
  }
  return { storage, calls }
}

function makeEnv(router) {
  jest.resetModules()
  const env = setupWx(router)
  let core, family, dataRights
  jest.isolateModules(() => {
    core = require('../../services/core')
    family = require('../../services/family')
    dataRights = require('../../services/data-rights')
  })
  return { core, family, dataRights, storage: env.storage, calls: env.calls }
}

const FAMILY_PAGE_KEYS = ['homeFamily', 'family', 'trend', 'recordList', 'recordDetail', 'medList', 'medHistory']

// ─── 服务端存储替身（与 A4 测试同构；仅模拟存取） ───

const COLLECTIONS = {
  records: 'health_records',
  medicationPlans: 'medication_plans',
  medicationConfirmations: 'medication_confirmations',
  familyAuth: 'family_auth',
  familyMembers: 'family_members',
  inviteAttempts: 'family_invite_attempts',
  dailyStats: 'health_daily_stats',
  recordStats: 'health_record_stats',
  profiles: 'profiles'
}

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)) }

class StoreQuery {
  constructor(store, query = {}) {
    this.store = store; this.query = query
    this.orderField = ''; this.orderDir = 'asc'; this.max = Infinity; this.skipN = 0
    this.docId = ''; this.hasDocId = false
  }
  where(c) { return new StoreQuery(this.store, c) }
  orderBy(f, d) { const q = new StoreQuery(this.store, this.query); q.orderField = f; q.orderDir = d; q.max = this.max; q.skipN = this.skipN; q.docId = this.docId; q.hasDocId = this.hasDocId; return q }
  limit(n) { const q = new StoreQuery(this.store, this.query); q.orderField = this.orderField; q.orderDir = this.orderDir; q.max = n; q.skipN = this.skipN; q.docId = this.docId; q.hasDocId = this.hasDocId; return q }
  skip(n) { const q = new StoreQuery(this.store, this.query); q.orderField = this.orderField; q.orderDir = this.orderDir; q.max = this.max; q.skipN = n; q.docId = this.docId; q.hasDocId = this.hasDocId; return q }
  doc(id) { const q = new StoreQuery(this.store, this.query); q.docId = id; q.hasDocId = true; q.max = this.max; q.skipN = this.skipN; return q }
  field() { return this }
  _matchOne(doc, q) {
    return Object.entries(q).every(([k, v]) => {
      if (v && v.__op === 'in') return v.values.includes(doc[k])
      if (v && v.__op === 'lt') return doc[k] !== undefined && doc[k] < v.value
      if (v && v.__op === 'gt') return doc[k] !== undefined && doc[k] > v.value
      if (v && v.__op === 'or') return v.clauses.some(c => this._matchOne(doc, c))
      if (v && v.__op === 'range') {
        const val = doc[k]
        if (val === undefined) return false
        if (v.gte !== undefined && !(val >= v.gte)) return false
        if (v.lte !== undefined && !(val <= v.lte)) return false
        return true
      }
      return doc[k] === v
    })
  }
  _targets() {
    if (this.hasDocId) return this.store.rows.filter(d => d._id === this.docId)
    return this.store.rows.filter(d => this._matchOne(d, this.query))
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
    if (this.skipN) rows = rows.slice(this.skipN)
    return { data: this.max === Infinity ? rows : rows.slice(0, this.max) }
  }
  async count() { return { total: this._targets().length } }
  async add({ data }) {
    const _id = data._id || `doc-${this.store.seq++}`
    if (this.store.rows.some(d => d._id === _id)) { const e = new Error('E11000 duplicate key error'); e.errCode = -502005; throw e }
    this.store.rows.push({ _id, ...clone(data) })
    return { _id }
  }
  async update({ data }) {
    const t = this._targets()
    t.forEach((d) => {
      Object.entries(data).forEach(([k, v]) => {
        if (v && v.__op === 'inc') d[k] = (typeof d[k] === 'number' ? d[k] : 0) + v.value
        else d[k] = clone(v)
      })
    })
    return { stats: { updated: t.length } }
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
  Object.keys(COLLECTIONS).forEach((a) => { stores[COLLECTIONS[a]] = { rows: Array.isArray(initial[a]) ? clone(initial[a]) : [], seq: 1 } })
  return {
    collection(n) { if (!stores[n]) stores[n] = { rows: [], seq: 1 }; return new StoreQuery(stores[n]) },
    serverDate() { return 'SERVER_DATE' },
    _stores: stores
  }
}

function rangeOp(op, v) { const m = { __op: 'range' }; m[op] = v; m.and = (o) => { m[op === 'gte' ? 'lte' : 'gte'] = o.value; return m }; return m }
const commands = {
  in: values => ({ __op: 'in', values }),
  lt: v => ({ __op: 'lt', value: v }),
  gt: v => ({ __op: 'gt', value: v }),
  gte: v => rangeOp('gte', v),
  lte: v => rangeOp('lte', v),
  or: clauses => ({ __op: 'or', clauses }),
  inc: v => ({ __op: 'inc', value: v })
}

function build(seed = {}) {
  const db = createStoreDb(seed)
  const withPerfLog = (m, fn) => fn()
  const recordService = createRecordService({ db, _: commands, collections: COLLECTIONS, getRecordStatus: helpers.getRecordStatus, withPerfLog })
  const medicationService = createMedicationService({
    db, _: commands, collections: COLLECTIONS,
    assertOwnedDocument: async (coll, openId, id, label) => {
      const { data } = await db.collection(coll).where({ _id: id, _openid: openId }).limit(1).get()
      if (!data.length) throw new Error(`${label}不存在或无权操作`)
      return data[0]
    },
    validateMedicationPlanPayload: p => p,
    validateMedicationConfirmationPayload: p => p,
    withPerfLog
  })
  const familyService = createFamilyService({
    db, _: commands, collections: COLLECTIONS, withPerfLog,
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
    createInviteCode: () => 'KXJTEST00001',
    getRecordService: () => recordService,
    getMedicationService: () => medicationService,
    getDailyStatsService: () => ({
      async updateRecordStats() { return { updated: 0 } },
      async getHomeStats() { return { dailyStats: {}, recordStats: {} } }
    })
  })
  return { db, recordService, medicationService, familyService }
}

function scopesOf(bp, bg, med) {
  return [
    { key: 'bloodPressure', title: '血压记录', meta: 'm', read: bp.read, write: bp.write, remind: false },
    { key: 'bloodGlucose', title: '血糖记录', meta: 'm', read: bg.read, write: bg.write, remind: false },
    { key: 'medicine', title: '用药确认', meta: 'm', read: med.read, write: med.write, remind: false },
    { key: 'report', title: '健康记录周报', meta: 'm', read: false, write: false, remind: false }
  ]
}
const RW = { read: true, write: true }
const RO = { read: true, write: false }

// ─── 测试 ───

describe('A5 · 云读缓存策略（services/core）', () => {
  it('家族敏感读键每次回源不缓存；owner 读键 TTL 内复用', async () => {
    const env = makeEnv()
    await env.core.resolveMockData('homeFamily')
    await env.core.resolveMockData('homeFamily')
    expect(env.calls.keys.homeFamily).toBe(2)
    await env.core.resolveMockData('family')
    await env.core.resolveMockData('family')
    expect(env.calls.keys.family).toBe(2)
    await env.core.resolveMockData('home')
    await env.core.resolveMockData('home')
    expect(env.calls.keys.home).toBe(1)
  })

  it('familyView 载荷读取不落缓存；同键 owner 读取保持缓存', async () => {
    const env = makeEnv()
    await env.core.resolveMockData('recordList', { familyView: true })
    await env.core.resolveMockData('recordList', { familyView: true })
    expect(env.calls.keys.recordList).toBe(2)
    await env.core.resolveMockData('recordList')
    await env.core.resolveMockData('recordList')
    expect(env.calls.keys.recordList).toBe(3)
  })

  it('TTL 过期+云端失败：家族读不旧缓存回填（抛错），owner 读网络性失败可回退', async () => {
    let failMode = false
    const env = makeEnv((d) => {
      if (failMode) return { errMsg: 'busy' }
      return d.key ? { ok: true, echo: d.key } : { ok: 1 }
    })
    const t0 = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => t0)
    try {
      await env.core.resolveMockData('homeFamily')
      await env.core.resolveMockData('home')
      nowSpy.mockImplementation(() => t0 + 61000)
      failMode = true
      await expect(env.core.resolveMockData('homeFamily')).rejects.toThrow('busy')
      const stale = await env.core.resolveMockData('home')
      expect(stale).toEqual({ ok: true, echo: 'home' })
      expect(env.calls.keys.home).toBe(2) // 过期后确实回源过（失败→回退）
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('服务端显式拒绝（errCode）对 owner 键也不回填旧缓存', async () => {
    let failMode = false
    const env = makeEnv((d) => {
      if (failMode) return { errMsg: 'no permission', errCode: 'DENIED' }
      return d.key ? { ok: true, echo: d.key } : { ok: 1 }
    })
    const t0 = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => t0)
    try {
      await env.core.resolveMockData('home')
      nowSpy.mockImplementation(() => t0 + 61000)
      failMode = true
      await expect(env.core.resolveMockData('home')).rejects.toMatchObject({ code: 'DENIED' })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('action 成功后全局清读缓存（现状 fail-safe 保留）', async () => {
    const env = makeEnv()
    await env.core.resolveMockData('home')
    await env.core.resolveRemote('saveProfile', {}, () => ({}))
    await env.core.resolveMockData('home')
    expect(env.calls.keys.home).toBe(2)
  })
})

describe('A5 · 家族缓存精准失效（services/family）', () => {
  it('invalidateFamilyCaches：清七个家族页面键并置脏；不波及 home/me', async () => {
    const env = makeEnv()
    const ownerCached = ['recordList', 'recordDetail', 'trend', 'medList', 'medHistory']
    for (const k of [...ownerCached, 'home', 'me']) await env.core.resolveMockData(k)
    expect(typeof env.family.invalidateFamilyCaches).toBe('function')
    env.family.invalidateFamilyCaches()
    for (const k of [...ownerCached, 'homeFamily', 'family']) await env.core.resolveMockData(k)
    for (const k of ownerCached) expect(env.calls.keys[k]).toBe(2)
    expect(env.calls.keys.home).toBe(1)
    expect(env.calls.keys.me).toBe(1)
    for (const p of FAMILY_PAGE_KEYS) expect(env.core.isDirty(p)).toBe(true)
  })

  it('撤销成功后：镜像精确移除 M1 保留 M2；家族页缓存失效并置脏', async () => {
    const env = makeEnv()
    env.storage.family_auth_v1 = {
      status: 'active',
      currentMemberId: 'M1',
      members: [
        { id: 'M1', name: '女儿', bound: true, relation: '女儿', status: '已授权' },
        { id: 'M2', name: '儿子', bound: true, relation: '儿子', status: '已授权' }
      ]
    }
    await env.core.resolveMockData('recordList')
    await env.family.revokeFamilyMember({ memberId: 'M1' })
    const mirror = env.storage.family_auth_v1
    expect(mirror.members.map(m => m.id)).toEqual(['M2'])
    expect(mirror.currentMemberId).toBe('M2')
    expect(env.core.isDirty('homeFamily')).toBe(true)
    expect(env.core.isDirty('trend')).toBe(true)
    await env.core.resolveMockData('recordList')
    expect(env.calls.keys.recordList).toBe(2)
  })

  it('改权成功后：家族页缓存失效并置脏', async () => {
    const env = makeEnv()
    env.storage.family_auth_v1 = {
      status: 'active',
      currentMemberId: 'M1',
      members: [{ id: 'M1', name: '女儿', bound: true, relation: '女儿', status: '已授权' }]
    }
    await env.core.resolveMockData('medList')
    await env.family.updateFamilyAuth({
      memberId: 'M1',
      scopes: scopesOf(RO, RO, RO),
      noticeRules: { missedMedicine: true, missingRecord: false, weeklyReport: false }
    })
    expect(env.core.isDirty('medList')).toBe(true)
    expect(env.core.isDirty('homeFamily')).toBe(true)
    await env.core.resolveMockData('medList')
    expect(env.calls.keys.medList).toBe(2)
  })

  it('家属代录成功后：七个家族页全部置脏（onShow 重载拉取 owner 新数据）', async () => {
    const env = makeEnv((d) => (d.action === 'familyRecordBloodPressure'
      ? { familyWrite: { allowed: true, ownerOpenId: 'A' } }
      : (d.key ? { ok: true, echo: d.key } : { ok: 1 })))
    await env.family.familyRecordBloodPressure({ systolic: 128, diastolic: 78, measuredAt: '08:00' })
    for (const p of FAMILY_PAGE_KEYS) expect(env.core.isDirty(p)).toBe(true)
  })

  it('加入成功后：B 端镜像置 active 且家族页缓存失效置脏', async () => {
    const env = makeEnv()
    env.storage.family_auth_v1 = {
      inviteCode: 'KXJ123456789',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      status: 'pending'
    }
    await env.family.joinFamilyByInvite({ inviteCode: 'KXJ123456789' })
    expect(env.storage.family_auth_v1.status).toBe('active')
    expect(env.core.isDirty('homeFamily')).toBe(true)
  })

  it('镜像只收窄不放行：active 镜像不能回填服务端未授权数据；revoked 镜像清空数据', () => {
    const env = makeEnv()
    env.storage.family_auth_v1 = { status: 'active', members: [{ id: 'M1', bound: true, name: '女儿' }] }
    const serverEmpty = {
      member: { name: '家属', scopeText: '暂未授权' },
      latestMetrics: [],
      medicineLogs: []
    }
    expect(env.family.enforceHomeFamilyAccess(serverEmpty)).toEqual(serverEmpty)

    env.storage.family_auth_v1 = { status: 'revoked', members: [] }
    const full = { member: { name: '王阿姨' }, latestMetrics: [{ label: '血压' }], medicineLogs: [{ id: 'x' }] }
    const blanked = env.family.enforceHomeFamilyAccess(full)
    expect(blanked.latestMetrics).toEqual([])
    expect(blanked.member.name).toBe('家属')
  })

  it('家属注销：只清本人本地存储与读缓存（服务端连带由 A1 测试覆盖）', async () => {
    const env = makeEnv()
    env.storage.family_auth_v1 = { status: 'active', members: [{ id: 'M1', bound: true }] }
    env.storage.user_profile_v1 = { name: 'B' }
    await env.core.resolveMockData('home')
    await env.dataRights.clearUserAccount({})
    expect(env.core.readStorage('family_auth_v1', null)).toBeNull()
    expect(env.core.readStorage('user_profile_v1', null)).toBeNull()
    await env.core.resolveMockData('home')
    expect(env.calls.keys.home).toBe(2)
  })
})

describe('A5 · 服务端撤销实时生效（family-service，存储替身）', () => {
  it('撤销 M1 后：M1 家族读全拒绝，M2 不受影响，owner 自读不受影响', async () => {
    const { familyService, recordService } = build({
      familyMembers: [
        { _id: 'M1', _openid: 'M1', ownerOpenId: 'A', ownerName: '王阿姨', memberOpenId: 'M1', memberName: '女儿', scopes: scopesOf(RW, RO, RO), status: 'active', updatedAt: '2026-09-23T01:00:00Z' },
        { _id: 'M2', _openid: 'M2', ownerOpenId: 'A', ownerName: '王阿姨', memberOpenId: 'M2', memberName: '儿子', scopes: scopesOf(RO, RO, RO), status: 'active', updatedAt: '2026-09-23T01:00:00Z' }
      ],
      familyAuth: [],
      records: [
        { _id: 'r1', _openid: 'A', type: 'bp', systolic: 128, diastolic: 78, measuredAt: '08:00', tag: '晨起', createdAt: '2026-09-23T00:00:00Z' }
      ],
      profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })

    await familyService.revokeFamilyMember('A', { memberId: 'M1' })

    // M1：家属视图拒绝 + 首页无授权数据（服务端不返回 owner 数据）
    const m1View = await familyService.resolveFamilyView('M1', { familyView: true })
    expect(m1View).toEqual({ mode: 'denied', reason: 'revoked' })
    const m1List = await familyService.getFamilyRecordListData('M1', { familyView: true })
    expect(m1List.familyView).toMatchObject({ allowed: false, reason: 'revoked' })
    const m1Home = await familyService.getHomeFamilyData('M1')
    expect(m1Home.latestMetrics).toEqual([])
    expect(m1Home.member.scopeText).toBe('暂未授权')

    // M2：读取不受 M1 撤销影响
    const m2View = await familyService.resolveFamilyView('M2', { familyView: true })
    expect(m2View.mode).toBe('member')
    const m2Home = await familyService.getHomeFamilyData('M2')
    expect(m2Home.latestMetrics.length).toBe(1)

    // owner A：自读不受影响
    const ownerList = await recordService.getRecordListData('A', {})
    expect(Array.isArray(ownerList.records)).toBe(true)
    expect(ownerList.records.length).toBe(1)
  })

  it('改权（关闭 bloodPressure read）后：下一次读取立即按新 scopes 过滤，无需任何缓存操作', async () => {
    const { familyService } = build({
      familyMembers: [
        { _id: 'M1', _openid: 'M1', ownerOpenId: 'A', ownerName: '王阿姨', memberOpenId: 'M1', memberName: '女儿', scopes: scopesOf(RW, RO, RO), status: 'active', updatedAt: '2026-09-23T01:00:00Z' }
      ],
      familyAuth: [],
      records: [
        { _id: 'r1', _openid: 'A', type: 'bp', systolic: 128, diastolic: 78, measuredAt: '08:00', tag: '晨起', createdAt: '2026-09-23T00:00:00Z' },
        { _id: 'r2', _openid: 'A', type: 'bg', glucose: 6.4, measuredAt: '07:00', tag: '空腹', createdAt: '2026-09-23T00:10:00Z' }
      ],
      profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    const before = await familyService.getFamilyRecordListData('M1', { familyView: true })
    expect(before.records.some(r => r.type === 'bp' || String(r.value).includes('128'))).toBe(true)

    await familyService.updateFamilyAuth('A', {
      memberId: 'M1',
      memberName: '女儿',
      scopes: scopesOf({ read: false, write: false }, RO, RO),
      noticeRules: { missedMedicine: false, missingRecord: false, weeklyReport: false }
    })

    const after = await familyService.getFamilyRecordListData('M1', { familyView: true })
    expect(after.records.every(r => r.type !== 'bp')).toBe(true)
    // 全部 read 关闭 → scopeDenied
    await familyService.updateFamilyAuth('A', {
      memberId: 'M1',
      memberName: '女儿',
      scopes: scopesOf({ read: false, write: false }, { read: false, write: false }, { read: false, write: false }),
      noticeRules: { missedMedicine: false, missingRecord: false, weeklyReport: false }
    })
    const denied = await familyService.getFamilyRecordListData('M1', { familyView: true })
    expect(denied.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
  })
})
