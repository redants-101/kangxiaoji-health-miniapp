/**
 * A0-2 集成测试：三级权限契约端到端穿过云端 createFamilyService。
 * 存储替身只模拟数据库存取（where/orderBy/limit/projection/add/update），
 * 不包含任何权限判断；授权判定全部来自真实 family-policy 规则。
 * 预期值按已确认契约字面填写。
 */

const { createFamilyService } = require('../../cloudfunctions/healthApi/family-service')

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

// 纯存储替身：行为对齐云数据库查询链的最小子集
class StoreQuery {
  constructor(store, query = {}) {
    this.store = store
    this.query = query
    this.orderField = ''
    this.orderDir = 'asc'
    this.max = Infinity
    this.docId = ''
  }
  where(cond) { return new StoreQuery(this.store, cond) }
  orderBy(field, dir) { const q = new StoreQuery(this.store, this.query); q.orderField = field; q.orderDir = dir; return q }
  limit(size) { const q = new StoreQuery(this.store, this.query); q.orderField = this.orderField; q.orderDir = this.orderDir; q.max = size; q.docId = this.docId; return q }
  doc(id) { const q = new StoreQuery(this.store, this.query); q.docId = id; q.orderField = this.orderField; q.orderDir = this.orderDir; q.max = this.max; return q }
  field() { return this }
  _targets() {
    return this.docId
      ? this.store.rows.filter(d => d._id === this.docId)
      : this.store.rows.filter(d => Object.entries(this.query).every(([k, v]) => {
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
    return { data: rows.slice(0, this.max === Infinity ? undefined : this.max) }
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

let inviteSeq = 0

// 全量装配：与 index.js 中 getFamilyService 使用同一套 family-policy 导出
const policy = require('../../cloudfunctions/healthApi/family-policy')
const helpers = require('../../cloudfunctions/healthApi/payload-helpers')

function createService(db) {
  return createFamilyService({
    db,
    _: commands,
    collections: COLLECTIONS,
    withPerfLog: (meta, fn) => fn(),
    getProfileDisplayName: policy.createProfileDisplayName({ db, collections: COLLECTIONS }),
    getFamilyAccessContext: policy.createFamilyAccessContext({ db, collections: COLLECTIONS }),
    getRecordStatus: helpers.getRecordStatus,
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
    // 顺序桩：A2 收尾后重邀必发新码（候选命中自己旧码也算冲突），常量桩会触发冲突路径
    createInviteCode: () => `KXJTEST${String(++inviteSeq).padStart(5, '0')}`
  })
}

function fullAccessScopes() {
  return [
    { key: 'bloodPressure', read: true, write: false, remind: true },
    { key: 'bloodGlucose', read: true, write: false, remind: true },
    { key: 'medicine', read: true, write: false, remind: true },
    { key: 'report', read: true, write: false, remind: true }
  ]
}

describe('A0-2 集成 · 创建邀请（服务端提交校验，缺失/非法不放权）', () => {
  it.each([
    ['缺失', undefined], ['null', null], ['字符串', 'abc'], ['对象', { key: 'bloodPressure' }]
  ])('scopes %s：服务入口拒绝，不写数据库', async (_label, scopes) => {
    const db = createStoreDb({ profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    await expect(service.createFamilyInvite('owner-1', { scopes })).rejects.toThrow('授权范围')
    expect(db._stores[COLLECTIONS.familyAuth].rows).toHaveLength(0)
  })

  it('scopes=[]：邀请可生成但落库四块 read/write/remind 全部 false，不恢复授权', async () => {
    const db = createStoreDb({ profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const invite = await service.createFamilyInvite('owner-1', { scopes: [] })

    expect(invite.inviteCode).toMatch(/^KXJ/)
    const auth = db._stores[COLLECTIONS.familyAuth].rows[0]
    expect(auth).toMatchObject({ ownerOpenId: 'owner-1', ownerName: '王阿姨', status: 'pending' })
    expect(auth.scopes.every(s => s.read === false && s.write === false && s.remind === false)).toBe(true)
    expect(invite.invitePreview.meta).toBe('暂未选择可查看内容')
  })

  it('部分 scopes：仅提交的块按值归一化，未提交块全部 false（不补开）', async () => {
    const db = createStoreDb({ profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    await service.createFamilyInvite('owner-1', {
      scopes: [{ key: 'bloodPressure', read: true, write: true, remind: false }]
    })
    const auth = db._stores[COLLECTIONS.familyAuth].rows[0]
    expect(auth.scopes.map(s => [s.key, s.read, s.write, s.remind])).toEqual([
      ['bloodPressure', true, true, false],
      ['bloodGlucose', false, false, false],
      ['medicine', false, false, false],
      ['report', false, false, false]
    ])
  })

  it('显式合法的完整授权：按提交值正确保存（write 仅 BP/BG/medicine）', async () => {
    const db = createStoreDb({ profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const invite = await service.createFamilyInvite('owner-1', { scopes: fullAccessScopes() })

    const auth = db._stores[COLLECTIONS.familyAuth].rows[0]
    expect(auth.scopes.map(s => [s.key, s.read, s.remind])).toEqual([
      ['bloodPressure', true, true],
      ['bloodGlucose', true, true],
      ['medicine', true, true],
      ['report', true, true]
    ])
    expect(auth.scopes.every(s => s.write === false)).toBe(true)
    expect(invite.invitePreview.meta).toContain('血压记录')
  })

  it('未知关系在入口被拒绝，不写入', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    await expect(service.createFamilyInvite('owner-1', {
      selectedRelation: 'not-a-relation',
      scopes: fullAccessScopes()
    })).rejects.toThrow('关系')
    expect(db._stores[COLLECTIONS.familyAuth].rows).toHaveLength(0)
  })

  it('report write=true、非布尔、未知/重复 scope 在创建入口被拒绝', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    await expect(service.createFamilyInvite('owner-1', {
      scopes: [{ key: 'report', read: true, write: true }]
    })).rejects.toThrow('周报')
    await expect(service.createFamilyInvite('owner-1', {
      scopes: [{ key: 'bloodPressure', read: 'yes' }]
    })).rejects.toThrow('布尔')
    await expect(service.createFamilyInvite('owner-1', {
      scopes: [
        { key: 'bloodPressure', read: true },
        { key: 'bloodPressure', read: false }
      ]
    })).rejects.toThrow('重复')
  })

  it('8 种关系可往返，提交的关系名称写入邀请成员', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    for (const relationKey of ['daughter', 'son', 'spouse', 'granddaughter', 'grandson', 'sibling', 'caregiver', 'other']) {
      await service.createFamilyInvite('owner-1', {
        selectedRelation: relationKey,
        scopes: fullAccessScopes()
      })
      const auth = db._stores[COLLECTIONS.familyAuth].rows[0]
      expect(auth.member.relation).toBe(policy.getFamilyRelationV2(relationKey).label)
    }
  })
})

describe('A0-2 集成 · 加入家庭', () => {
  it('家属加入：family_members 落三级 scopes 与 noticeRules 对象，family_auth 转 active', async () => {
    const db = createStoreDb({ profiles: [{ _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db)
    const invite = await service.createFamilyInvite('owner-1', { scopes: [
      { key: 'bloodPressure', read: true, write: true, remind: true },
      { key: 'bloodGlucose', read: false, remind: false },
      { key: 'medicine', read: true, remind: false },
      { key: 'report', read: true, remind: true }
    ] })
    const result = await service.joinFamilyByInvite('member-1', { inviteCode: invite.inviteCode })

    expect(result.status).toBe('active')
    const memberRow = db._stores[COLLECTIONS.familyMembers].rows[0]
    expect(memberRow).toMatchObject({ ownerOpenId: 'owner-1', memberOpenId: 'member-1', status: 'active' })
    expect(memberRow.scopes.map(s => [s.key, s.read, s.write])).toEqual([
      ['bloodPressure', true, true],
      ['bloodGlucose', false, false],
      ['medicine', true, false],
      ['report', true, false]
    ])
    expect(memberRow.noticeRules).toEqual({ missedMedicine: true, missingRecord: false, weeklyReport: true })

    const auth = db._stores[COLLECTIONS.familyAuth].rows[0]
    expect(auth.status).toBe('active')
    expect(auth.memberOpenId).toBe('member-1')
  })
})

describe('A0-2 集成 · 家属首页按 read 输出受控明细', () => {
  function buildRows(scopes) {
    const db = createStoreDb({
      familyMembers: [{
        _id: 'rel-1', ownerOpenId: 'owner-1', memberOpenId: 'member-1',
        member: { name: '王阿姨', relation: '女儿', status: '已授权' },
        scopes, noticeRules: { missedMedicine: true, missingRecord: false, weeklyReport: true },
        status: 'active'
      }],
      records: [
        { _id: 'r-bp', _openid: 'owner-1', type: 'bp', systolic: 128, diastolic: 78, measuredAt: '今天 08:00', tag: '晨起', level: '', createdAt: '2026-09-22T08:00:00' },
        { _id: 'r-bg', _openid: 'owner-1', type: 'bg', glucose: 6.4, measuredAt: '今天 09:00', tag: '餐后', level: '', createdAt: '2026-09-22T09:00:00' }
      ],
      medicationPlans: [
        { _id: 'plan-1', _openid: 'owner-1', name: '降压药', dosage: '1片', times: ['07:00'], status: '启用', updatedAt: '2026-09-22T07:00:00' }
      ]
    })
    return createService(db)
  }

  it('仅血压块 read：响应只含血压明细，血糖/用药/周报在服务端即缺失（非页面隐藏）', async () => {
    const service = buildRows([
      { key: 'bloodPressure', read: true, remind: true },
      { key: 'bloodGlucose', read: false, remind: false },
      { key: 'medicine', read: false, remind: false },
      { key: 'report', read: false, remind: false }
    ])
    const home = await service.getHomeFamilyData('member-1')

    expect(home.latestMetrics.map(m => m.label)).toEqual(['血压'])
    expect(home.medicineLogs).toEqual([])
    expect(home.reportSummary).toBe('暂未授权查看周报。')
    expect(home.member.scopeText).toBe('血压记录')
  })

  it('全块 read：血压血糖均输出，用药与周报可见', async () => {
    const service = buildRows(fullAccessScopes())
    const home = await service.getHomeFamilyData('member-1')

    expect(home.latestMetrics.map(m => m.label).sort()).toEqual(['血压', '血糖'])
    expect(home.medicineLogs.length).toBeGreaterThan(0)
    expect(home.reportSummary).not.toBe('暂未授权查看周报。')
  })

  it('血糖块开、血压块关：只输出血糖', async () => {
    const service = buildRows([
      { key: 'bloodPressure', read: false },
      { key: 'bloodGlucose', read: true, remind: true },
      { key: 'medicine', read: false },
      { key: 'report', read: false }
    ])
    const home = await service.getHomeFamilyData('member-1')
    expect(home.latestMetrics.map(m => m.label)).toEqual(['血糖'])
  })
})

describe('A0-2 集成 · 授权保存/回显', () => {
  it('updateFamilyAuth：新 scopes 同步到 family_members，绑定的 family_auth 同步', async () => {
    const db = createStoreDb({
      // A1 同步规则：family_auth 仅当 memberOpenId 确实对应该成员时才同步
      familyAuth: [{ _id: 'auth-1', _openid: 'owner-1', memberOpenId: 'member-1', status: 'active', inviteCode: 'KXJ1' }],
      familyMembers: [{ _id: 'rel-1', _openid: 'member-1', ownerOpenId: 'owner-1', memberOpenId: 'member-1', status: 'active' }]
    })
    const service = createService(db)
    await service.updateFamilyAuth('owner-1', {
      memberId: 'rel-1',
      member: { name: '王阿姨' },
      scopes: [
        { key: 'bloodPressure', read: true, write: true, remind: true },
        { key: 'bloodGlucose', read: true, write: false, remind: false },
        { key: 'medicine', read: true, write: true, remind: false },
        { key: 'report', read: true, write: false, remind: true }
      ],
      noticeRules: { missedMedicine: true, missingRecord: true, weeklyReport: false },
      activities: []
    })

    const auth = db._stores[COLLECTIONS.familyAuth].rows[0]
    expect(auth.scopes[0]).toMatchObject({ read: true, write: true })
    expect(auth.scopes[2]).toMatchObject({ read: true, write: true })
    expect(auth.noticeRules).toEqual({ missedMedicine: true, missingRecord: true, weeklyReport: false })

    const rel = db._stores[COLLECTIONS.familyMembers].rows[0]
    expect(rel.scopes[0].write).toBe(true)
    expect(rel.noticeRules.missingRecord).toBe(true)
  })

  it('updateFamilyAuth 入口拒绝：report.write、未知 key、非布尔、重复 key（A1 后须带有效 memberId）', async () => {
    const db = createStoreDb({
      familyAuth: [{ _id: 'auth-1', _openid: 'owner-1', status: 'active' }],
      familyMembers: [{ _id: 'rel-1', ownerOpenId: 'owner-1', memberOpenId: 'member-1', status: 'active' }]
    })
    const service = createService(db)
    const before = JSON.parse(JSON.stringify(db._stores[COLLECTIONS.familyMembers].rows))
    await expect(service.updateFamilyAuth('owner-1', {
      memberId: 'rel-1',
      scopes: [{ key: 'report', read: true, write: true }]
    })).rejects.toThrow('周报')
    await expect(service.updateFamilyAuth('owner-1', {
      memberId: 'rel-1',
      scopes: [{ key: 'unknown', read: true }]
    })).rejects.toThrow('未知')
    await expect(service.updateFamilyAuth('owner-1', {
      memberId: 'rel-1',
      scopes: [
        { key: 'bloodPressure', read: true },
        { key: 'bloodPressure', read: false }
      ]
    })).rejects.toThrow('重复')
    expect(db._stores[COLLECTIONS.familyMembers].rows).toEqual(before)
  })

  it('getFamilyAuthData：memberId 命中关系行，回显三级 scopes 与 noticeRules', async () => {
    const db = createStoreDb({
      familyMembers: [{
        _id: 'rel-1', ownerOpenId: 'owner-1', memberOpenId: 'member-1',
        member: { name: '王阿姨' }, memberName: '王阿姨',
        scopes: fullAccessScopes(),
        noticeRules: { missedMedicine: false, missingRecord: false, weeklyReport: true },
        activities: [], status: 'active'
      }]
    })
    const service = createService(db)
    const data = await service.getFamilyAuthData('owner-1', { memberId: 'rel-1' })
    expect(data.scopes).toHaveLength(4)
    expect(data.scopes[0]).toMatchObject({ key: 'bloodPressure', read: true })
    expect(data.noticeRules).toEqual({ missedMedicine: false, missingRecord: false, weeklyReport: true })
  })
})

describe('A0-2 集成 · owner 本人功能不被误伤', () => {
  it('getFamilyData：owner 的成员列表正常返回，scope 文案按 read 生成', async () => {
    const db = createStoreDb({
      familyMembers: [{
        _id: 'rel-1', ownerOpenId: 'owner-1', memberOpenId: 'member-1',
        member: { name: '小李', relation: '女儿', role: '主要照护人', status: '已授权' },
        memberName: '小李', scopes: [
          { key: 'bloodPressure', read: true, remind: true },
          { key: 'bloodGlucose', read: false },
          { key: 'medicine', read: false },
          { key: 'report', read: false }
        ], updatedAt: '2026-09-22T08:00:00', status: 'active'
      }]
    })
    const service = createService(db)
    const data = await service.getFamilyData('owner-1')
    expect(data.familyCount).toBe(1)
    expect(data.members[0].name).toBe('小李')
    expect(data.members[0].scope).toBe('血压记录')
  })
})
