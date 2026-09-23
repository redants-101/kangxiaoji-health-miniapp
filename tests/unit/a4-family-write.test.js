/**
 * A4 家属代录写入闭环测试（先失败后实现）。
 * 存储替身模拟存取；权限判定调用 family-policy（canPerformScopeAction），不在测试中复制规则。
 */

const { createRecordService } = require('../../cloudfunctions/healthApi/record-service')
const { createMedicationService } = require('../../cloudfunctions/healthApi/medication-service')
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

function scopesOf(bp, bg, med) {
  return [
    { key: 'bloodPressure', title: '血压记录', meta: 'm', read: bp.read, write: bp.write, remind: false },
    { key: 'bloodGlucose', title: '血糖记录', meta: 'm', read: bg.read, write: bg.write, remind: false },
    { key: 'medicine', title: '用药确认', meta: 'm', read: med.read, write: med.write, remind: false },
    { key: 'report', title: '健康记录周报', meta: 'm', read: false, write: false, remind: false }
  ]
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

function memberRow(scopes, overrides = {}) {
  return {
    _id: 'active-member-b', _openid: 'B', ownerOpenId: 'A', ownerName: '王阿姨',
    memberOpenId: 'B', scopes, status: 'active', ...overrides
  }
}

const RW = { read: true, write: true }
const RO = { read: true, write: false }
const WO = { read: false, write: true }
const NONE = { read: false, write: false }

describe('A4 · 身份与关系', () => {
  it('B 为 A 的 active 家属且 bp read+write：代录成功并带审计字段', async () => {
    const { db, familyService } = build({ familyMembers: [memberRow(scopesOf(RW, NONE, NONE))] })
    const res = await familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 })
    expect(res.familyWrite.allowed).toBe(true)
    const rec = db._stores[COLLECTIONS.records].rows[0]
    expect(rec.ownerOpenId).toBe('A')
    expect(rec.createdByMemberOpenId).toBe('B')
    expect(rec.createdByRole).toBe('member')
    expect(rec._openid).toBe('A')
    expect(rec.type).toBe('bp')
    expect(rec.systolic).toBe(128)
  })

  it('无关系 / revoked / 跨 owner 伪造：拒绝且零写入', async () => {
    const noRel = build({})
    await expect(noRel.familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 }))
      .resolves.toMatchObject({ familyWrite: { allowed: false, reason: 'noBinding' } })
    expect(noRel.db._stores[COLLECTIONS.records].rows).toHaveLength(0)

    const revoked = build({ familyMembers: [memberRow(scopesOf(RW, NONE, NONE), { status: 'revoked' })] })
    await expect(revoked.familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 }))
      .resolves.toMatchObject({ familyWrite: { allowed: false, reason: 'revoked' } })
    expect(revoked.db._stores[COLLECTIONS.records].rows).toHaveLength(0)

    const cross = build({ familyMembers: [memberRow(scopesOf(RW, NONE, NONE))] })
    const res = await cross.familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78, ownerOpenId: 'O2' })
    expect(res.familyWrite.allowed).toBe(true)
    expect(cross.db._stores[COLLECTIONS.records].rows[0].ownerOpenId).toBe('A') // 伪造 ownerOpenId 被忽略
  })

  it('payload 伪造审计字段被忽略', async () => {
    const { db, familyService } = build({ familyMembers: [memberRow(scopesOf(RW, NONE, NONE))] })
    await familyService.familyRecordBloodPressure('B', {
      systolic: 128, diastolic: 78,
      ownerOpenId: 'X', createdByMemberOpenId: 'Y', createdByRole: 'owner', _openid: 'Z'
    })
    const rec = db._stores[COLLECTIONS.records].rows[0]
    expect(rec.ownerOpenId).toBe('A')
    expect(rec.createdByMemberOpenId).toBe('B')
    expect(rec.createdByRole).toBe('member')
    expect(rec._openid).toBe('A')
  })

  it('owner 自己不走家属代录路由（行为不变由 owner 路由承担）', async () => {
    const { familyService } = build({ familyMembers: [memberRow(scopesOf(RW, NONE, NONE))] })
    const res = await familyService.familyRecordBloodPressure('A', { systolic: 128, diastolic: 78 })
    expect(res.familyWrite.allowed).toBe(false)
  })

  it('owner 查询能看到代录记录（按 ownerOpenId 归属）', async () => {
    const { db, recordService, familyService } = build({ familyMembers: [memberRow(scopesOf(RW, RW, NONE))] })
    await familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 })
    await familyService.familyRecordBloodGlucose('B', { glucose: 6.4 })
    const list = await recordService.getRecordListData('A', {})
    expect(list.records.map(r => r.type).sort()).toEqual(['bg', 'bp'])
  })

  it('revoked 后新写入立即拒绝', async () => {
    const { db, familyService } = build({ familyMembers: [memberRow(scopesOf(RW, NONE, NONE))] })
    db._stores[COLLECTIONS.familyMembers].rows[0].status = 'revoked'
    const res = await familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 })
    expect(res.familyWrite.allowed).toBe(false)
    expect(db._stores[COLLECTIONS.records].rows).toHaveLength(0)
  })
})

describe('A4 · 权限矩阵', () => {
  it('bp read+write 允许；read-only / write-only / remind-only 拒绝', async () => {
    const ok = build({ familyMembers: [memberRow(scopesOf(RW, NONE, NONE))] })
    expect((await ok.familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 })).familyWrite.allowed).toBe(true)

    const ro = build({ familyMembers: [memberRow(scopesOf(RO, NONE, NONE))] })
    expect((await ro.familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 })).familyWrite.reason).toBe('scopeDenied')

    const wo = build({ familyMembers: [memberRow(scopesOf(WO, NONE, NONE))] })
    expect((await wo.familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 })).familyWrite.reason).toBe('scopeDenied')

    const remindOnly = build({ familyMembers: [memberRow([{ key: 'bloodPressure', title: 't', meta: 'm', read: false, write: false, remind: true }, { key: 'bloodGlucose', title: 't', meta: 'm', read: false, write: false, remind: false }, { key: 'medicine', title: 't', meta: 'm', read: false, write: false, remind: false }, { key: 'report', title: 't', meta: 'm', read: false, write: false, remind: false }])] })
    expect((await remindOnly.familyService.familyRecordBloodPressure('B', { systolic: 128, diastolic: 78 })).familyWrite.reason).toBe('scopeDenied')
  })

  it('bg read+write 允许血糖代录', async () => {
    const { db, familyService } = build({ familyMembers: [memberRow(scopesOf(NONE, RW, NONE))] })
    const res = await familyService.familyRecordBloodGlucose('B', { glucose: 6.4 })
    expect(res.familyWrite.allowed).toBe(true)
    expect(db._stores[COLLECTIONS.records].rows[0].type).toBe('bg')
  })

  it('medicine read+write 允许已服/跳过代确认', async () => {
    const { db, familyService } = build({
      familyMembers: [memberRow(scopesOf(NONE, NONE, RW))],
      medicationPlans: [{ _id: 'plan-1', _openid: 'A', name: '降压药', dosage: '1片', times: ['07:00'], status: '启用' }]
    })
    const taken = await familyService.familyConfirmMedication('B', { logId: 'log-plan-1-0700', time: '07:00', name: '降压药', dosage: '1片', status: 'taken' })
    expect(taken.familyWrite.allowed).toBe(true)
    const skipped = await familyService.familyConfirmMedication('B', { logId: 'log-plan-1-0700', time: '07:00', name: '降压药', dosage: '1片', status: 'skipped' })
    expect(skipped.familyWrite.allowed).toBe(true)
    const docs = db._stores[COLLECTIONS.medicationConfirmations].rows
    expect(docs).toHaveLength(1) // upsert：重复提交不产生重复文档
    expect(docs[0].status).toBe('skipped')
    expect(docs[0].createdByMemberOpenId).toBe('B')
    expect(docs[0]._openid).toBe('A')
  })

  it('read-only / write-only medicine 拒绝代确认', async () => {
    const ro = build({ familyMembers: [memberRow(scopesOf(NONE, NONE, RO))] })
    expect((await ro.familyService.familyConfirmMedication('B', { logId: 'l', time: '07:00', name: '药', status: 'taken' })).familyWrite.reason).toBe('scopeDenied')
    const wo = build({ familyMembers: [memberRow(scopesOf(NONE, NONE, WO))] })
    expect((await wo.familyService.familyConfirmMedication('B', { logId: 'l', time: '07:00', name: '药', status: 'taken' })).familyWrite.reason).toBe('scopeDenied')
  })

  it('report write、计划管理、记录删除：无家属写路由', async () => {
    const { familyService } = build({ familyMembers: [memberRow(scopesOf(RW, RW, RW))] })
    expect(typeof familyService.familySaveMedicationPlan).toBe('undefined')
    expect(typeof familyService.familyDeleteMedicationPlan).toBe('undefined')
    expect(typeof familyService.familyDeleteRecord).toBe('undefined')
    expect(typeof familyService.familyRecordReport).toBe('undefined')
  })
})

describe('A4 · 代确认撤销', () => {
  const seedConfirm = (extra = {}) => ({
    familyMembers: [memberRow(scopesOf(NONE, NONE, RW))],
    medicationConfirmations: [{
      _id: 'conf-1', _openid: 'A', ownerOpenId: 'A', logId: 'log-plan-1-0700',
      confirmDate: helpers.getTodayDateValue(), status: 'taken', statusText: '已服',
      createdByMemberOpenId: 'B', createdByRole: 'member', ...extra
    }]
  })

  it('B 可撤销自己本次代确认', async () => {
    const { db, familyService } = build(seedConfirm())
    const res = await familyService.familyRevokeProxyConfirmation('B', { logId: 'log-plan-1-0700' })
    expect(res.familyWrite.allowed).toBe(true)
    expect(db._stores[COLLECTIONS.medicationConfirmations].rows).toHaveLength(0)
  })

  it('B 不能撤销 owner 创建的确认', async () => {
    const { db, familyService } = build(seedConfirm({ createdByMemberOpenId: undefined, createdByRole: undefined }))
    const res = await familyService.familyRevokeProxyConfirmation('B', { logId: 'log-plan-1-0700' })
    expect(res.familyWrite.allowed).toBe(false)
    expect(db._stores[COLLECTIONS.medicationConfirmations].rows).toHaveLength(1)
  })

  it('B 不能撤销其他 member 的确认', async () => {
    const { db, familyService } = build(seedConfirm({ createdByMemberOpenId: 'B2' }))
    const res = await familyService.familyRevokeProxyConfirmation('B', { logId: 'log-plan-1-0700' })
    expect(res.familyWrite.allowed).toBe(false)
    expect(db._stores[COLLECTIONS.medicationConfirmations].rows).toHaveLength(1)
  })

  it('重复撤销：第二次明确拒绝且不异常', async () => {
    const { db, familyService } = build(seedConfirm())
    await familyService.familyRevokeProxyConfirmation('B', { logId: 'log-plan-1-0700' })
    const second = await familyService.familyRevokeProxyConfirmation('B', { logId: 'log-plan-1-0700' })
    expect(second.familyWrite.allowed).toBe(false)
    expect(second.familyWrite.reason).toBe('notFound')
  })
})

describe('A4 · homeFamily 写权限下发', () => {
  it('homeFamily 响应携带 writePermissions（read+write 才为 true）', async () => {
    const { familyService } = build({
      familyMembers: [memberRow(scopesOf(RW, RO, RW))],
      profiles: [{ _id: 'p', _openid: 'A', name: '王阿姨' }]
    })
    const data = await familyService.getHomeFamilyData('B')
    expect(data.writePermissions).toEqual({
      bloodPressure: true, bloodGlucose: false, medicine: true, report: false
    })
  })
})

// ─── 页面级 ───
const mockApi = {
  getMedListData: jest.fn(),
  getRecordBpData: jest.fn(() => Promise.resolve({})),
  getRecordBgData: jest.fn(() => Promise.resolve({})),
  familyConfirmMedication: jest.fn(),
  familyRevokeProxyConfirmation: jest.fn(),
  familyRecordBloodPressure: jest.fn(),
  familyRecordBloodGlucose: jest.fn(),
  getRecordDetailData: jest.fn(),
  deleteRecord: jest.fn(),
  saveBloodPressureRecord: jest.fn(),
  saveBloodGlucoseRecord: jest.fn()
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
global.Page = (cfg) => { pageConfigs.push(cfg); return cfg }
global.wx = {
  setNavigationBarTitle: jest.fn(),
  showToast: jest.fn(),
  showModal: jest.fn((opt) => opt.success && opt.success({ confirm: true })),
  setClipboardData: jest.fn(),
  showActionSheet: jest.fn()
}
global.getApp = () => ({ globalData: {} })
const pageConfigs = []
require('../../pages/medication/med-list/index.js')
require('../../pages/record/record-bp/index.js')
require('../../pages/record/record-bg/index.js')

function makePage(cfg) {
  return Object.assign({}, cfg, {
    data: JSON.parse(JSON.stringify(cfg.data)),
    route: 'x',
    setData(patch) { Object.assign(this.data, patch) }
  })
}

describe('A4 · 页面家属态写入口', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFactory.loadPageData.mockImplementation(async (page, loader) => {
      const d = await loader()
      Object.assign(page.data, d)
      page.data._loaded = true
      return d
    })
  })

  it('med-list 家属态：medicine write 时显示代确认入口；计划增删改入口仍隐藏', async () => {
    mockApi.getMedListData.mockResolvedValue({
      todayCards: [{ id: 'plan-1', name: '降压药', logs: [{ id: 'log-1', time: '07:00', status: 'pending' }], pendingIndex: 0 }],
      confirmations: [],
      familyView: { allowed: true, readOnly: true, writePermissions: { medicine: true } }
    })
    const page = makePage(pageConfigs[0])
    await page.onLoad({ familyView: '1' })
    expect(page.data.isFamilyView).toBe(true)
    expect(page.data.familyCanConfirm).toBe(true)
    // 代确认走家属路由
    page.handleConfirmTap({ currentTarget: { dataset: { planId: 'plan-1', logId: 'log-1' } } })
    expect(mockApi.familyConfirmMedication).toHaveBeenCalled()
    expect(mockFactory.goRoute).not.toHaveBeenCalled() // 不跳 owner 确认页
    // 计划编辑入口守卫仍生效
    page.editPlan({ currentTarget: { dataset: { id: 'plan-1' } } })
    expect(mockFactory.safeNavigateTo).not.toHaveBeenCalled()
  })

  it('med-list 家属态 medicine 只读：代确认入口不开放', async () => {
    mockApi.getMedListData.mockResolvedValue({
      todayCards: [{ id: 'plan-1', name: '降压药', logs: [{ id: 'log-1', time: '07:00', status: 'pending' }], pendingIndex: 0 }],
      confirmations: [],
      familyView: { allowed: true, readOnly: true, writePermissions: { medicine: false } }
    })
    const page = makePage(pageConfigs[0])
    await page.onLoad({ familyView: '1' })
    expect(page.data.familyCanConfirm).toBe(false)
    page.handleConfirmTap({ currentTarget: { dataset: { planId: 'plan-1', logId: 'log-1' } } })
    expect(mockApi.familyConfirmMedication).not.toHaveBeenCalled()
  })

  it('record-bp 家属态：提交走家属代录路由；云端拒绝不本地假成功', async () => {
    mockApi.familyRecordBloodPressure.mockResolvedValue({ familyWrite: { allowed: false, reason: 'scopeDenied' } })
    const page = makePage(pageConfigs[1])
    await page.onLoad({ familyView: '1' })
    expect(page.data.isFamilyView).toBe(true)
    page.setData({ form: { systolic: '128', diastolic: '78', pulse: '', note: '' }, selectedTag: '晨起', measuredAt: '08:00' })
    await page.handleSave()
    expect(mockApi.familyRecordBloodPressure).toHaveBeenCalled()
    expect(mockApi.saveBloodPressureRecord).not.toHaveBeenCalled()
    expect(page.data.submitError).toBe('scopeDenied')
  })

  it('record-bg 家属态：提交走家属代录路由；云端拒绝不本地假成功', async () => {
    mockApi.familyRecordBloodGlucose.mockResolvedValue({ familyWrite: { allowed: false, reason: 'scopeDenied' } })
    const page = makePage(pageConfigs[2])
    await page.onLoad({ familyView: '1' })
    expect(page.data.isFamilyView).toBe(true)
    page.setData({ form: { glucose: '6.4', note: '' }, selectedMealTag: '空腹', measuredAt: '08:00' })
    await page.handleSave()
    expect(mockApi.familyRecordBloodGlucose).toHaveBeenCalled()
    expect(mockApi.saveBloodGlucoseRecord).not.toHaveBeenCalled()
    expect(page.data.submitError).toBe('scopeDenied')
  })
})
