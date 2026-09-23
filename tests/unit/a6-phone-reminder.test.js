/**
 * A6 电话提醒（先失败后实现）。
 * 契约来源：decisions.md #4/#12/4.3（电话提醒替代订阅推送；remind=true 才回传号码；
 * 列表/卡片脱敏；拨号时按需取号；完整号码不入长期缓存与日志；不实现 wx.getPhoneNumber；
 * 不新增订阅消息；不修改 sendDueReminders）。
 * 存储/网络替身只模拟存取与传输；权限规则走真实 family-policy / family-service。
 */

const { createRecordService } = require('../../cloudfunctions/healthApi/record-service')
const { createMedicationService } = require('../../cloudfunctions/healthApi/medication-service')
const { createFamilyService } = require('../../cloudfunctions/healthApi/family-service')
const policy = require('../../cloudfunctions/healthApi/family-policy')
const helpers = require('../../cloudfunctions/healthApi/payload-helpers')

// ─── 服务端存储替身（与 A4/A5 同构） ───

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
  async set({ data }) {
    const existing = this.store.rows.find(d => d._id === this.docId)
    if (existing) { Object.assign(existing, clone(data)); return { _id: this.docId } }
    this.store.rows.push({ _id: this.docId, ...clone(data) })
    return { _id: this.docId }
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

function scopesWithRemind(bp, bg, med, remind) {
  return [
    { key: 'bloodPressure', title: '血压记录', meta: 'm', read: bp.read, write: bp.write, remind },
    { key: 'bloodGlucose', title: '血糖记录', meta: 'm', read: bg.read, write: bg.write, remind },
    { key: 'medicine', title: '用药确认', meta: 'm', read: med.read, write: med.write, remind },
    { key: 'report', title: '健康记录周报', meta: 'm', read: false, write: false, remind }
  ]
}
const RW = { read: true, write: true }
const RO = { read: true, write: false }
const NONE = { read: false, write: false }

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

const PHONE = '13800001234'
const MASKED = '138****1234'

function authDoc(overrides = {}) {
  return {
    _id: 'auth-a', _openid: 'A', ownerOpenId: 'A', ownerName: '王阿姨',
    contactPhone: PHONE, status: 'pending', memberOpenId: '',
    inviteCode: 'KXJTEST00001', expiresAt: '2026-09-24T00:00:00.000Z',
    ...overrides
  }
}
function memberRowB(scopes, overrides = {}) {
  return {
    _id: 'active-B', _openid: 'B', ownerOpenId: 'A', ownerName: '王阿姨',
    memberOpenId: 'B', memberName: '女儿', scopes, status: 'active',
    noticeRules: { missedMedicine: true, missingRecord: false, weeklyReport: false },
    updatedAt: '2026-09-23T01:00:00Z', ...overrides
  }
}

// ─── 1. policy 单元 ───

describe('A6 · family-policy 电话规则', () => {
  it('normalizeContactPhone：合法通过、空串清空、非法拒绝且错误信息不回显号码', () => {
    expect(policy.normalizeContactPhone(PHONE)).toBe(PHONE)
    expect(policy.normalizeContactPhone('')).toBe('')
    expect(policy.normalizeContactPhone(undefined)).toBeNull()
    const badInputs = ['123', '138000012345', '23800001234', 'abcdefghijk', '1380000123a', 13800001234, {}, null]
    badInputs.forEach((bad) => {
      let threw = false
      try { policy.normalizeContactPhone(bad) } catch (err) {
        threw = true
        expect(err.message).not.toContain('13800001234')
        expect(err.message).not.toContain('138000012345')
      }
      if (bad !== null) expect(threw).toBe(true) // null 与 undefined 同义：未提供
    })
  })

  it('maskContactPhone：138****1234；非法输入返回空串', () => {
    expect(policy.maskContactPhone(PHONE)).toBe(MASKED)
    expect(policy.maskContactPhone('')).toBe('')
    expect(policy.maskContactPhone('123')).toBe('')
    expect(policy.maskContactPhone(undefined)).toBe('')
  })

  it('canCallReminderPhone：任一 scope.remind=true 即可；全 false 不可', () => {
    expect(policy.canCallReminderPhone(scopesWithRemind(NONE, NONE, NONE, true))).toBe(true)
    expect(policy.canCallReminderPhone(scopesWithRemind(RO, RO, RO, false))).toBe(false)
    expect(policy.canCallReminderPhone([])).toBe(false)
    expect(policy.canCallReminderPhone(undefined)).toBe(false)
  })
})

// ─── 2. 服务端 ───

describe('A6 · 服务端电话提醒', () => {
  it('owner 设置电话：落 family_auth；owner 授权页回读完整号+脱敏号；家庭页不因纯电话文档造预览卡', async () => {
    const { familyService, db } = build({ familyAuth: [], familyMembers: [], profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }] })
    const res = await familyService.setFamilyContactPhone('A', { contactPhone: PHONE })
    expect(res.updated).toBe(true)
    expect(res.contactPhoneMasked).toBe(MASKED)
    expect(res.contactPhone).toBeUndefined() // 动作响应不回显完整号码
    const stored = db._stores.family_auth.rows
    expect(stored.length).toBe(1)
    expect(stored[0].contactPhone).toBe(PHONE)

    const authData = await familyService.getFamilyAuthData('A')
    expect(authData.contactPhone).toBe(PHONE) // owner 本人可回读完整号（编辑用）
    expect(authData.contactPhoneMasked).toBe(MASKED)

    const familyData = await familyService.getFamilyData('A')
    expect(familyData.familyCount).toBe(0)
    expect(familyData.members).toEqual([])
  })

  it('非法号码：拒绝且零写入；错误信息不含完整输入', async () => {
    const { familyService, db } = build({ familyAuth: [], familyMembers: [] })
    await expect(familyService.setFamilyContactPhone('A', { contactPhone: '138000012345' }))
      .rejects.toThrow(/电话|格式/)
    try {
      await familyService.setFamilyContactPhone('A', { contactPhone: '138000012345' })
    } catch (err) {
      expect(err.message).not.toContain('138000012345')
    }
    expect(db._stores.family_auth.rows.length).toBe(0)
  })

  it('清空电话后：家属端为未配置状态，取号接口 notConfigured', async () => {
    const { familyService } = build({
      familyAuth: [authDoc()],
      familyMembers: [memberRowB(scopesWithRemind(RO, RO, RO, true))],
      records: [], profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    await familyService.setFamilyContactPhone('A', { contactPhone: '' })
    const home = await familyService.getHomeFamilyData('B')
    expect(home.phoneReminder.configured).toBe(false)
    expect(home.phoneReminder.canCall).toBe(false)
    expect(home.phoneReminder.masked).toBe('')
    const dial = await familyService.familyGetReminderPhone('B')
    expect(dial.phoneDenied).toMatchObject({ allowed: false, reason: 'notConfigured' })
    expect(dial.phone).toBeUndefined()
  })

  it('remind=true 家属：homeFamily 只回脱敏号；完整号不出现在任何响应字段', async () => {
    const { familyService } = build({
      familyAuth: [authDoc()],
      familyMembers: [memberRowB(scopesWithRemind(RO, RO, RO, true))],
      records: [{ _id: 'r1', _openid: 'A', type: 'bp', systolic: 128, diastolic: 78, measuredAt: '08:00', tag: '晨起', createdAt: '2026-09-23T00:00:00Z' }],
      profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    const home = await familyService.getHomeFamilyData('B')
    expect(home.phoneReminder).toMatchObject({ remindAllowed: true, canCall: true, configured: true, masked: MASKED })
    expect(JSON.stringify(home)).not.toContain(PHONE)
  })

  it('remind=false 家属：无电话入口，接口不回传号码（脱敏也不给）', async () => {
    const { familyService } = build({
      familyAuth: [authDoc()],
      familyMembers: [memberRowB(scopesWithRemind(RO, RO, RO, false))],
      records: [], profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    const home = await familyService.getHomeFamilyData('B')
    expect(home.phoneReminder).toMatchObject({ remindAllowed: false, canCall: false, masked: '', configured: false })
    expect(JSON.stringify(home)).not.toContain(PHONE)
    expect(JSON.stringify(home)).not.toContain(MASKED)
    const dial = await familyService.familyGetReminderPhone('B')
    expect(dial.phoneDenied).toMatchObject({ allowed: false, reason: 'remindDenied' })
  })

  it('read=false、remind=true：只允许电话提醒——无健康数据、无提醒明细、二级页拒绝', async () => {
    const { familyService } = build({
      familyAuth: [authDoc()],
      familyMembers: [memberRowB(scopesWithRemind(NONE, NONE, NONE, true))],
      records: [{ _id: 'r1', _openid: 'A', type: 'bp', systolic: 128, diastolic: 78, measuredAt: '08:00', tag: '晨起', createdAt: '2026-09-23T00:00:00Z' }],
      profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    const home = await familyService.getHomeFamilyData('B')
    expect(home.readPermissions).toEqual({ bloodPressure: false, bloodGlucose: false, medicine: false, report: false })
    expect(home.latestMetrics).toEqual([])
    expect(home.medicineLogs).toEqual([])
    expect(home.phoneReminder.canCall).toBe(true)
    expect(JSON.stringify(home)).not.toContain('128')
    const list = await familyService.getFamilyRecordListData('B', { familyView: true })
    expect(list.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
    const trend = await familyService.getFamilyTrendData('B', { familyView: true })
    expect(trend.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
    const med = await familyService.getFamilyMedListData('B', { familyView: true })
    expect(med.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
    // 拨号仍可用（remind=true）
    const dial = await familyService.familyGetReminderPhone('B')
    expect(dial.phone).toBe(PHONE)
  })

  it('拨号按需取号：active+remind 返回完整号；撤销后立即不再返回', async () => {
    const { familyService } = build({
      familyAuth: [authDoc()],
      familyMembers: [memberRowB(scopesWithRemind(RO, RO, RO, true))],
      records: [], profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    const dial = await familyService.familyGetReminderPhone('B')
    expect(dial.phone).toBe(PHONE)
    expect(dial.masked).toBe(MASKED)

    await familyService.revokeFamilyMember('A', { memberId: 'active-B' })
    const after = await familyService.familyGetReminderPhone('B')
    expect(after.phoneDenied).toMatchObject({ allowed: false, reason: 'revoked' })
    expect(JSON.stringify(after)).not.toContain(PHONE)
  })

  it('无绑定成员取号：noBinding 拒绝', async () => {
    const { familyService } = build({ familyAuth: [authDoc()], familyMembers: [] })
    const dial = await familyService.familyGetReminderPhone('C')
    expect(dial.phoneDenied).toMatchObject({ allowed: false, reason: 'noBinding' })
  })

  it('member 设置电话只写自己的配置，不能污染所拨号码（owner 文档权威）', async () => {
    const { familyService } = build({
      familyAuth: [authDoc()],
      familyMembers: [memberRowB(scopesWithRemind(RO, RO, RO, true))],
      records: [], profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    await familyService.setFamilyContactPhone('B', { contactPhone: '13900009999' })
    const dial = await familyService.familyGetReminderPhone('B')
    expect(dial.phone).toBe(PHONE) // 仍是 owner A 配置的号码
  })

  it('createFamilyInvite 可携带 contactPhone：合法落库；非法拒绝且零写入', async () => {
    const { familyService, db } = build({ familyAuth: [], familyMembers: [], profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }] })
    await familyService.createFamilyInvite('A', {
      selectedRelation: 'daughter',
      scopes: scopesWithRemind(RO, RO, RO, true),
      contactPhone: PHONE
    })
    expect(db._stores.family_auth.rows[0].contactPhone).toBe(PHONE)

    const before = JSON.stringify(db._stores.family_auth.rows)
    await expect(familyService.createFamilyInvite('A', {
      selectedRelation: 'daughter',
      scopes: scopesWithRemind(RO, RO, RO, true),
      contactPhone: '12345'
    })).rejects.toThrow(/电话|格式/)
    expect(JSON.stringify(db._stores.family_auth.rows)).toBe(before) // 零写入（含邀请码不变化）
  })

  it('不修改 sendDueReminders：无家属推送分支（契约固定）', () => {
    // A6 约束：不新增订阅消息、不修改 sendDueReminders（独立云函数，维持只推 owner 本人）。
    const fs = require('fs')
    const path = require('path')
    const target = path.join(__dirname, '../../cloudfunctions/sendDueReminders/index.js')
    const src = fs.readFileSync(target, 'utf8')
    expect(src).not.toMatch(/familyMembers|memberOpenId|familyGetReminderPhone/)
    // healthApi 内如有引用 sendDueReminders 的文件，同样不得混入家属推送逻辑
    const dir = path.join(__dirname, '../../cloudfunctions/healthApi')
    fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach((f) => {
      const s = fs.readFileSync(path.join(dir, f), 'utf8')
      if (/sendDueReminders/.test(s)) {
        expect(s).not.toMatch(/familyMembers|memberOpenId/)
      }
    })
  })
})

// ─── 3. 客户端服务层 ───

const storageMap = {}
let cloudRouter = null
const actionCalls = []
global.wx = {
  getStorageSync: (k) => (k in storageMap ? storageMap[k] : ''),
  setStorageSync: (k, v) => { storageMap[k] = v },
  removeStorageSync: (k) => { delete storageMap[k] },
  showToast: jest.fn(),
  showModal: jest.fn((opt) => opt && opt.success && opt.success({ confirm: true })),
  makePhoneCall: jest.fn(),
  setNavigationBarTitle: jest.fn(),
  setClipboardData: jest.fn(),
  showActionSheet: jest.fn(),
  cloud: {
    callFunction: jest.fn((opts) => {
      const d = opts.data || {}
      if (d.action) actionCalls.push({ action: d.action, payload: d.payload })
      const result = cloudRouter ? cloudRouter(d) : (d.key ? { ok: true, echo: d.key } : { ok: 1 })
      opts.success({ result })
    })
  }
}
global.getApp = () => ({ globalData: {} })

function freshServices() {
  jest.resetModules()
  let core, family
  jest.isolateModules(() => {
    core = require('../../services/core')
    family = require('../../services/family')
  })
  return { core, family }
}

describe('A6 · 客户端服务层', () => {
  beforeEach(() => {
    Object.keys(storageMap).forEach(k => delete storageMap[k])
    actionCalls.length = 0
    cloudRouter = null
    jest.clearAllMocks()
  })

  it('setFamilyContactPhone 走 action（不入读缓存），成功后家族页失效置脏', async () => {
    const { core, family } = freshServices()
    expect(typeof family.setFamilyContactPhone).toBe('function')
    await family.setFamilyContactPhone({ contactPhone: PHONE })
    expect(actionCalls.some(c => c.action === 'setFamilyContactPhone' && c.payload.contactPhone === PHONE)).toBe(true)
    expect(core.isDirty('homeFamily')).toBe(true)
  })

  it('familyGetReminderPhone 走 action 按需取号；完整号码不写入任何本地存储', async () => {
    cloudRouter = (d) => (d.action === 'familyGetReminderPhone' ? { phone: PHONE, masked: MASKED } : { ok: 1 })
    const { family } = freshServices()
    expect(typeof family.familyGetReminderPhone).toBe('function')
    const res = await family.familyGetReminderPhone()
    expect(res.phone).toBe(PHONE)
    expect(JSON.stringify(storageMap)).not.toContain(PHONE)
    expect(actionCalls.some(c => c.action === 'familyGetReminderPhone')).toBe(true)
  })
})

// ─── 4. 页面层 ───

const mockApi = {
  getHomeFamilyData: jest.fn(),
  getFamilyAuthData: jest.fn(),
  getFamilyInviteData: jest.fn(),
  createFamilyInvite: jest.fn(),
  updateFamilyAuth: jest.fn(),
  revokeFamilyMember: jest.fn(),
  setFamilyContactPhone: jest.fn(),
  familyGetReminderPhone: jest.fn()
}
const mockFactory = {
  autoPreCheck: jest.fn(),
  bindAdaptiveResize: jest.fn(),
  unbindAdaptiveResize: jest.fn(),
  goRoute: jest.fn(),
  clearPageLoadState: jest.fn(),
  safeNavigateBack: jest.fn(),
  safeNavigateTo: jest.fn(),
  loadPageData: jest.fn()
}
jest.mock('../../utils/api', () => mockApi)
jest.mock('../../utils/page-factory', () => mockFactory)
jest.mock('../../services/snooze', () => ({ removeSnoozeReminderByLogId: jest.fn() }))
jest.mock('../../utils/subscribe-prompt', () => ({ promptSubscribeAfterAction: jest.fn(() => Promise.resolve({ ok: false })) }))

const pageConfigs = []
global.Page = (cfg) => { pageConfigs.push(cfg); return cfg }
require('../../pages/family-sub/home-family/index.js')   // pageConfigs[0]
require('../../pages/family-sub/family-auth/index.js')   // pageConfigs[1]
require('../../pages/family-sub/family-invite/index.js') // pageConfigs[2]

function makePage(cfg) {
  return Object.assign({}, cfg, {
    data: JSON.parse(JSON.stringify(cfg.data)),
    route: 'x',
    setData(patch) { Object.assign(this.data, patch) }
  })
}

describe('A6 · 页面电话提醒', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.keys(storageMap).forEach(k => delete storageMap[k])
    mockFactory.loadPageData.mockImplementation(async (page, loader) => {
      const d = await loader()
      Object.assign(page.data, d)
      page.data._loaded = true
      return d
    })
  })

  it('home-family 点击电话提醒：按需取号→makePhoneCall；完整号不进 data/存储', async () => {
    mockApi.getHomeFamilyData.mockResolvedValue({
      member: { name: '王阿姨', scopeText: '血压记录' },
      latestMetrics: [], medicineLogs: [],
      phoneReminder: { remindAllowed: true, canCall: true, configured: true, masked: MASKED }
    })
    mockApi.familyGetReminderPhone.mockResolvedValue({ phone: PHONE, masked: MASKED })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    expect(page.data.phoneReminder.canCall).toBe(true)
    await page.handleCallReminder()
    expect(mockApi.familyGetReminderPhone).toHaveBeenCalled()
    expect(global.wx.makePhoneCall).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: PHONE }))
    expect(JSON.stringify(page.data)).not.toContain(PHONE)
    expect(JSON.stringify(storageMap)).not.toContain(PHONE)
  })

  it('home-family 取号被拒（revoked）：不拨号、显式提示、记录 phoneError', async () => {
    mockApi.getHomeFamilyData.mockResolvedValue({ member: {}, latestMetrics: [], medicineLogs: [], phoneReminder: { remindAllowed: true, canCall: true, configured: true, masked: MASKED } })
    mockApi.familyGetReminderPhone.mockResolvedValue({ phoneDenied: { allowed: false, reason: 'revoked' } })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    await page.handleCallReminder()
    expect(global.wx.makePhoneCall).not.toHaveBeenCalled()
    expect(page.data.phoneError).toBe('revoked')
    expect(global.wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'none' }))
  })

  it('makePhoneCall 失败：明确提示未拨出，不假设成功', async () => {
    mockApi.getHomeFamilyData.mockResolvedValue({ member: {}, latestMetrics: [], medicineLogs: [], phoneReminder: { remindAllowed: true, canCall: true, configured: true, masked: MASKED } })
    mockApi.familyGetReminderPhone.mockResolvedValue({ phone: PHONE })
    let callOpts = null
    global.wx.makePhoneCall.mockImplementation((opts) => { callOpts = opts })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    global.wx.showToast.mockClear()
    await page.handleCallReminder()
    expect(callOpts).toBeTruthy()
    callOpts.fail({ errMsg: 'makePhoneCall:fail cancel' })
    const toasted = global.wx.showToast.mock.calls.map(c => c[0].title).join('|')
    expect(toasted).toContain('拨号未接通')
    expect(toasted).not.toContain('已拨出')
  })

  it('read=false+remind=true：home-family 数据无健康明细、无写入口、有电话入口', async () => {
    mockApi.getHomeFamilyData.mockResolvedValue({
      member: { name: '王阿姨', scopeText: '暂未授权' },
      latestMetrics: [], medicineLogs: [], reportSummary: '暂未授权查看周报。',
      readPermissions: { bloodPressure: false, bloodGlucose: false, medicine: false, report: false },
      writePermissions: { bloodPressure: false, bloodGlucose: false, medicine: false, report: false },
      phoneReminder: { remindAllowed: true, canCall: true, configured: true, masked: MASKED }
    })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    expect(page.data.readPermissions.bloodPressure).toBe(false)
    expect(page.data.phoneReminder.canCall).toBe(true)
    expect(page.data.latestMetrics).toEqual([])
    expect(page.data.writePermissions.medicine).toBe(false)
  })

  it('family-auth：加载回显电话；保存合法号走接口；非法号客户端拦截不出网', async () => {
    mockApi.getFamilyAuthData.mockResolvedValue({
      eyebrow: '授权管理', memberId: 'M1',
      member: { name: '女儿', relation: '女儿', role: '主要照护人', status: '已授权' },
      scopes: scopesWithRemind(RO, RO, RO, true),
      noticeRules: { missedMedicine: true, missingRecord: false, weeklyReport: false },
      activities: [],
      contactPhone: PHONE, contactPhoneMasked: MASKED
    })
    mockApi.setFamilyContactPhone.mockResolvedValue({ updated: true, contactPhoneMasked: '139****9999' })
    const page = makePage(pageConfigs[1])
    await page.onLoad({ id: 'M1' })
    expect(page.data.contactPhone).toBe(PHONE)
    expect(page.data.contactPhoneMasked).toBe(MASKED)

    // 非法号：客户端拦截，不调接口
    page.setData({ contactPhoneInput: '12345' })
    await page.saveContactPhone()
    expect(mockApi.setFamilyContactPhone).not.toHaveBeenCalled()
    expect(page.data.contactPhoneError).toBeTruthy()

    // 合法号：调接口保存
    page.setData({ contactPhoneInput: '13900009999' })
    await page.saveContactPhone()
    expect(mockApi.setFamilyContactPhone).toHaveBeenCalledWith({ contactPhone: '13900009999' })

    // 清空
    await page.clearContactPhone()
    expect(mockApi.setFamilyContactPhone).toHaveBeenLastCalledWith({ contactPhone: '' })
  })

  it('family-invite：未勾选电话授权时携带号码生成被拦截；勾选后号码随邀请提交', async () => {
    mockApi.getFamilyInviteData.mockResolvedValue({
      selectedRelation: 'daughter',
      relations: [{ key: 'daughter', label: '女儿', meta: '主要照护人' }],
      scopes: scopesWithRemind(RO, RO, RO, true),
      invitePreview: { title: 't', meta: 'm', expire: '24 小时' }
    })
    mockApi.createFamilyInvite.mockResolvedValue({ inviteCode: 'KXJTEST00001', inviteId: 'KXJTEST00001', sharePath: '/p', invitePreview: {} })
    const page = makePage(pageConfigs[2])
    await page.onLoad()

    page.setData({ contactPhoneInput: PHONE, phoneAgreed: false })
    await page.generateInvite()
    expect(mockApi.createFamilyInvite).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalled()

    global.wx.showToast.mockClear()
    page.setData({ phoneAgreed: true })
    await page.generateInvite()
    expect(mockApi.createFamilyInvite).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: PHONE }))
  })
})
