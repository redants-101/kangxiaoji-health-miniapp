/**
 * A3 二级页面家属只读权限闭环。
 * 服务端闸口测试：family-service 家属视图方法 + record-service allowedTypes；
 * 页面守卫测试：med-list / record-detail 在 familyView 下禁用写入口。
 * 不用空数据代替权限验证：拒绝响应必须带 familyView.allowed=false + reason。
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
  profiles: 'profiles'
}

function clone(v) { return JSON.parse(JSON.stringify(v)) }

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
  _matches(doc) {
    return Object.entries(this.query).every(([k, v]) => {
      if (v && v.__op === 'in') return v.values.includes(doc[k])
      if (v && v.__op === 'lt') return typeof doc[k] === 'number' || typeof doc[k] === 'string' ? doc[k] < v.value : false
      if (v && v.__op === 'gt') return typeof doc[k] === 'number' || typeof doc[k] === 'string' ? doc[k] > v.value : false
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
    return this.store.rows.filter(d => this._matches(d))
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

function rangeOp(op, v) {
  const m = { __op: 'range' }
  m[op] = v
  m.and = (other) => { m[op === 'gte' ? 'lte' : 'gte'] = other.value; return m }
  return m
}

const commands = {
  in: values => ({ __op: 'in', values }),
  lt: v => ({ __op: 'lt', value: v }),
  gt: v => ({ __op: 'gt', value: v }),
  gte: v => rangeOp('gte', v),
  lte: v => rangeOp('lte', v),
  inc: v => ({ __op: 'inc', value: v })
}

function scopesOf(bp, bg, med) {
  return [
    { key: 'bloodPressure', title: '血压记录', meta: 'm', read: bp, write: false, remind: false },
    { key: 'bloodGlucose', title: '血糖记录', meta: 'm', read: bg, write: false, remind: false },
    { key: 'medicine', title: '用药确认', meta: 'm', read: med, write: false, remind: false },
    { key: 'report', title: '健康记录周报', meta: 'm', read: false, write: false, remind: false }
  ]
}

function buildServices(seed) {
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
    getDailyStatsService: () => ({ async updateRecordStats() { return { updated: 0 } }, async getHomeStats() { return { dailyStats: {}, recordStats: {} } } })
  })
  return { db, recordService, medicationService, familyService }
}

const SEED = {
  records: [
    { _id: 'r-bp', _openid: 'owner-1', type: 'bp', systolic: 128, diastolic: 78, measuredAt: '今天 08:00', tag: '晨起', level: '', createdAt: '2026-09-23T08:00:00' },
    { _id: 'r-bg', _openid: 'owner-1', type: 'bg', glucose: 6.4, measuredAt: '今天 09:00', tag: '餐后', level: '', createdAt: '2026-09-23T09:00:00' },
    { _id: 'r-victim', _openid: 'victim-1', type: 'bp', systolic: 99, diastolic: 60, measuredAt: '今天 07:00', tag: '晨起', level: '', createdAt: '2026-09-23T07:00:00' }
  ],
  medicationPlans: [
    { _id: 'plan-1', _openid: 'owner-1', name: '降压药', dosage: '1片', times: ['07:00'], status: '启用', updatedAt: '2026-09-23T07:00:00' }
  ],
  medicationConfirmations: [],
  familyMembers: [
    { _id: 'active-member-1', _openid: 'member-1', ownerOpenId: 'owner-1', ownerName: '王阿姨', memberOpenId: 'member-1', scopes: scopesOf(true, false, true), status: 'active' },
    { _id: 'active-member-3', _openid: 'member-3', ownerOpenId: 'owner-1', ownerName: '王阿姨', memberOpenId: 'member-3', scopes: scopesOf(true, true, false), status: 'active' },
    { _id: 'revoked-member-2', _openid: 'member-2', ownerOpenId: 'owner-1', ownerName: '王阿姨', memberOpenId: 'member-2', scopes: scopesOf(true, true, true), status: 'revoked' }
  ]
}

describe('A3 · 家属视图闸口：read 决定数据可见性', () => {
  it('recordList：read=true 的块返回 owner 数据，read=false 的块被服务端剔除', async () => {
    const { familyService } = buildServices(SEED)
    const data = await familyService.getFamilyRecordListData('member-1', { familyView: true })
    expect(data.familyView).toMatchObject({ allowed: true, readOnly: true })
    const types = data.records.map(r => r.type)
    expect(types).toContain('bp')
    expect(types).not.toContain('bg') // bg read=false，服务端剔除而非页面隐藏
  })

  it('recordList：请求 read=false 的块（参数切换）被拒绝', async () => {
    const { familyService } = buildServices(SEED)
    const data = await familyService.getFamilyRecordListData('member-1', { familyView: true, type: 'bg' })
    expect(data.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
    expect(data.records).toBeUndefined()
  })

  it('trend：bpBg 需血压+血糖双 read；缺其一拒绝', async () => {
    const { familyService } = buildServices(SEED)
    const denied = await familyService.getFamilyTrendData('member-1', { familyView: true })
    expect(denied.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
  })

  it('trend：medication 指标按 medicine.read 放行', async () => {
    const { familyService } = buildServices(SEED)
    const data = await familyService.getFamilyTrendData('member-1', { familyView: true, metric: 'medication' })
    expect(data.familyView).toMatchObject({ allowed: true, readOnly: true })
  })

  it('trend：medicine read=false 的成员请求 medication 被拒绝', async () => {
    const { familyService } = buildServices(SEED)
    const data = await familyService.getFamilyTrendData('member-3', { familyView: true, metric: 'medication' })
    expect(data.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
  })

  it('medList/medHistory：medicine read=true 返回 owner 数据；read=false 拒绝', async () => {
    const { familyService } = buildServices(SEED)
    const list = await familyService.getFamilyMedListData('member-1', { familyView: true })
    expect(list.familyView).toMatchObject({ allowed: true, readOnly: true })
    expect(list.plans.length).toBeGreaterThan(0)
    const history = await familyService.getFamilyMedHistoryData('member-1', { familyView: true })
    expect(history.familyView).toMatchObject({ allowed: true, readOnly: true })
    const deniedList = await familyService.getFamilyMedListData('member-3', { familyView: true })
    expect(deniedList.familyView).toMatchObject({ allowed: false, reason: 'scopeDenied' })
  })
})

describe('A3 · 身份与数据主体：参数不能切换 owner', () => {
  it('payload 携带 ownerOpenId 被忽略，数据主体仍为绑定 owner', async () => {
    const { familyService } = buildServices(SEED)
    const data = await familyService.getFamilyRecordListData('member-1', { familyView: true, ownerOpenId: 'victim-1' })
    expect(data.familyView.allowed).toBe(true)
    const ids = data.records.map(r => r.id || r._id)
    expect(ids).not.toContain('r-victim')
    expect(data.records.some(r => (r.type === 'bp'))).toBe(true)
  })

  it('无绑定成员：denied noBinding；已撤销成员：denied revoked', async () => {
    const { familyService } = buildServices(SEED)
    const noBinding = await familyService.getFamilyRecordListData('member-9', { familyView: true })
    expect(noBinding.familyView).toMatchObject({ allowed: false, reason: 'noBinding' })
    const revoked = await familyService.getFamilyRecordListData('member-2', { familyView: true })
    expect(revoked.familyView).toMatchObject({ allowed: false, reason: 'revoked' })
  })

  it('owner 本人带 familyView：按 self 处理，行为与原路由一致', async () => {
    const { familyService, recordService } = buildServices(SEED)
    const data = await familyService.getFamilyRecordListData('owner-1', { familyView: true })
    const normal = await recordService.getRecordListData('owner-1', {})
    expect(data.records.length).toBe(normal.records.length)
    expect(data.familyView).toBeUndefined()
  })

  it('空数据不等于权限验证：owner 无记录时 allowed=true 且列表为空，与 denied 形态可区分', async () => {
    const seed = clone(SEED)
    seed.records = []
    const { familyService } = buildServices(seed)
    const data = await familyService.getFamilyRecordListData('member-3', { familyView: true })
    expect(data.familyView).toMatchObject({ allowed: true, readOnly: true })
    expect(data.records).toEqual([])
    const denied = await familyService.getFamilyRecordListData('member-9', { familyView: true })
    expect(denied.familyView.allowed).toBe(false)
    expect(denied.records).toBeUndefined()
  })
})

describe('A3 · record-service allowedTypes 服务端过滤', () => {
  it('allowedTypes 限制查询类型，filter 参数不能越权', async () => {
    const { recordService } = buildServices(SEED)
    const data = await recordService.getRecordListData('owner-1', {}, { allowedTypes: ['bp'] })
    expect(data.records.map(r => r.type)).toEqual(['bp'])
  })
})

// ─── 页面守卫（familyView 下写入口禁用） ───
const mockApi = {
  getMedListData: jest.fn(),
  getTrendData: jest.fn(),
  deleteMedicationPlan: jest.fn(),
  toggleMedicationPlanStatus: jest.fn(),
  revokeMedicationConfirmation: jest.fn(),
  confirmMedication: jest.fn(),
  getRecordDetailData: jest.fn(),
  deleteRecord: jest.fn()
}
const mockFactory = {
  autoPreCheck: jest.fn(),
  bindAdaptiveResize: jest.fn(),
  unbindAdaptiveResize: jest.fn(),
  goRoute: jest.fn(),
  clearPageLoadState: jest.fn(),
  safeNavigateBack: jest.fn(),
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
require('../../pages/record/record-detail/index.js')
require('../../pages/trend/index.js')

function makePage(cfg) {
  return Object.assign({}, cfg, {
    data: JSON.parse(JSON.stringify(cfg.data)),
    route: 'x',
    setData(patch) { Object.assign(this.data, patch) }
  })
}

describe('A3 · 页面只读守卫', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFactory.loadPageData.mockImplementation(async (page, loader) => {
      const d = await loader()
      Object.assign(page.data, d)
      page.data._loaded = true
      return d
    })
    mockApi.getMedListData.mockResolvedValue({ plans: [], confirmations: [], familyView: { allowed: true, readOnly: true } })
    mockApi.getRecordDetailData.mockResolvedValue({ record: { id: 'r-bp', type: 'bp' }, details: [], familyView: { allowed: true, readOnly: true } })
  })

  it('med-list familyView：editPlan/goMedEdit/确认/撤销 均被守卫拦截', async () => {
    const page = makePage(pageConfigs[0])
    await page.onLoad({ familyView: '1' })
    expect(page.data.isFamilyView).toBe(true)
    page.editPlan({ currentTarget: { dataset: { planId: 'plan-1' } } })
    page.goMedEdit()
    page.handleConfirmTap({ currentTarget: { dataset: { planId: 'plan-1', logId: 'log-1' } } })
    page.handleRevokeConfirmation({ currentTarget: { dataset: { logId: 'log-1' } } })
    expect(mockFactory.goRoute).not.toHaveBeenCalled()
    expect(mockApi.confirmMedication).not.toHaveBeenCalled()
    expect(mockApi.revokeMedicationConfirmation).not.toHaveBeenCalled()
    expect(mockApi.toggleMedicationPlanStatus).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalled()
  })

  it('med-list 非 familyView：编辑入口正常可用', async () => {
    const page = makePage(pageConfigs[0])
    await page.onLoad({})
    page.goMedEdit()
    expect(mockFactory.goRoute).toHaveBeenCalled()
  })

  it('record-detail familyView：删除入口被守卫拦截', async () => {
    const page = makePage(pageConfigs[1])
    await page.onLoad({ id: 'r-bp', familyView: '1' })
    expect(page.data.isFamilyView).toBe(true)
    page.handleDelete()
    expect(mockApi.deleteRecord).not.toHaveBeenCalled()
  })
})

describe('A3 · trend tabBar 切换重判家属上下文', () => {
  it('onShow 检测到全局家属标记后以 familyView 重载', async () => {
    const page = makePage(pageConfigs[2])
    mockApi.getTrendData.mockResolvedValue({ records: [], familyView: { allowed: true, readOnly: true } })
    await page.onLoad({})
    expect(page.data.isFamilyView).toBe(false)
    global.getApp = () => ({ globalData: { familyView: true } })
    page.onShow()
    expect(page.data.isFamilyView).toBe(true)
    const calls = mockApi.getTrendData.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[calls.length - 1][2]).toBeTruthy()
    global.getApp = () => ({ globalData: {} })
  })
})
