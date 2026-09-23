/**
 * A2 收尾：无邀请码状态、重邀/加入交错、有效期边界、原子频控。
 * 存储替身模拟存储引擎语义（条件匹配 lt/gt、$inc、_id 唯一、事务 doc 级读写），
 * 不复制任何业务判断；真实并发交错与云端锁行为属测试环境待验证（见 summary）。
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

const commands = {
  in: values => ({ __op: 'in', values }),
  lt: value => ({ __op: 'lt', value }),
  gt: value => ({ __op: 'gt', value }),
  inc: value => ({ __op: 'inc', value })
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
  _matches(doc) {
    return Object.entries(this.query).every(([k, v]) => {
      if (v && v.__op === 'in') return v.values.includes(doc[k])
      if (v && v.__op === 'lt') return typeof doc[k] === 'number' && doc[k] < v.value
      if (v && v.__op === 'gt') return typeof doc[k] === 'number' && doc[k] > v.value
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
    return { data: this.max === Infinity ? rows : rows.slice(0, this.max) }
  }
  async count() { return { total: this._targets().length } }
  async add({ data }) {
    // 存储引擎语义：_id 唯一，重复即拒绝（云端 E11000 的替身）
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

function createStoreDb(initial = {}, options = {}) {
  const stores = {}
  Object.keys(COLLECTIONS).forEach((alias) => {
    const name = COLLECTIONS[alias]
    stores[name] = { rows: Array.isArray(initial[alias]) ? clone(initial[alias]) : [], seq: 1 }
  })
  const db = {
    collection(name) {
      if (!stores[name]) stores[name] = { rows: [], seq: 1 }
      return new StoreQuery(stores[name])
    },
    serverDate() { return 'SERVER_DATE' },
    _stores: stores
  }
  if (options.withTransaction) {
    // 事务替身：仅提供 doc 级 get/set/update 的存储语义；无锁、无重试（并发性质属云端待验证）。
    // onTxStart 钩子用于构造“外层已读旧码、事务开始前 owner 重邀”的可控交错。
    db.runTransaction = async (fn) => {
      if (options.onTxStart) await options.onTxStart(db)
      return fn({
        collection(name) {
          return {
            doc(id) {
              return {
                async get() {
                  const rows = stores[name].rows.filter(d => d._id === id)
                  return { data: rows.length ? clone(rows[0]) : null }
                },
                async set({ data }) {
                  const rows = stores[name].rows
                  const idx = rows.findIndex(d => d._id === id)
                  const doc = { _id: id, ...clone(data) }
                  if (idx >= 0) rows[idx] = doc
                  else rows.push(doc)
                  return { updated: idx >= 0 ? 1 : 0, created: idx >= 0 ? 0 : 1 }
                },
                async update({ data }) {
                  const rows = stores[name].rows.filter(d => d._id === id)
                  rows.forEach((d) => {
                    Object.entries(data).forEach(([k, v]) => {
                      if (v && v.__op === 'inc') d[k] = (typeof d[k] === 'number' ? d[k] : 0) + v.value
                      else d[k] = clone(v)
                    })
                  })
                  return { stats: { updated: rows.length } }
                }
              }
            }
          }
        }
      })
    }
  }
  if (options.getThrows) {
    // 基础设施异常注入：事务内指定集合 doc.get 抛错
    const originalCollection = db.collection.bind(db)
    db.collection = function (name) {
      const q = originalCollection(name)
      return q
    }
    db._injectGetError = options.getThrows
  }
  return db
}

function createService(db, inviteCodes) {
  const queue = Array.isArray(inviteCodes) ? [...inviteCodes] : null
  let n = 0
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

const VALID_CODE = 'KXJABCDEFGHI'

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
    memberOpenId: '',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    ...overrides
  }
}

function counterRows(db) { return db._stores[COLLECTIONS.inviteAttempts].rows }
function counterValue(db, openId, day) {
  const key = `invite-fail-${openId}-${day || helpers.getTodayDateValue()}`
  const doc = counterRows(db).find(d => d._id === key)
  return doc ? doc.count : 0
}
function memberRows(db) { return db._stores[COLLECTIONS.familyMembers].rows }
function authRows(db) { return db._stores[COLLECTIONS.familyAuth].rows }

function seedCounter(db, openId, count, day) {
  const d = day || helpers.getTodayDateValue()
  counterRows(db).push({
    _id: `invite-fail-${openId}-${d}`,
    openId,
    day: d,
    count,
    createdAt: 'SERVER_DATE',
    updatedAt: 'SERVER_DATE'
  })
}

describe('A2 收尾 · 无邀请码说明态', () => {
  it('缺码：noInvite 说明态——无有效期、无可查看范围、无有效标志、不计数', async () => {
    const db = createStoreDb()
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', {})
    expect(data.noInvite).toBe(true)
    expect(data.inviteError).toBeUndefined()
    expect(data.remainHours).toBe(0)
    expect(data.scopes).toEqual([])
    expect(data.inviteTitle).toBe('尚未获得邀请')
    expect(counterRows(db)).toHaveLength(0)
  })

  it('空串与纯空白串同缺码处理，不计数', async () => {
    const db = createStoreDb()
    const service = createService(db)
    for (const code of ['', '   ']) {
      const data = await service.getFamilyJoinData('caller-1', { inviteCode: code })
      expect(data.noInvite).toBe(true)
    }
    expect(counterRows(db)).toHaveLength(0)
  })

  it.each([
    ['数字', 123],
    ['对象', { inviteCode: 'x' }],
    ['布尔', true],
    ['数组', ['KXJABCDEFGHI']]
  ])('非字符串输入（%s）按 INVALID 计数，不冒充缺码', async (_label, code) => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: code })
    expect(data.noInvite).toBeUndefined()
    expect(data.inviteError.code).toBe('FAMILY_INVITE_INVALID')
    expect(counterValue(db, 'caller-1')).toBe(1)
  })

  it('本地镜像：无邀请码加入不假成功', () => {
    const { joinFamilyByInviteLocal } = require('../../services/family')
    const { STORAGE_KEYS, writeStorage } = require('../../services/core')
    writeStorage(STORAGE_KEYS.familyAuth, { members: [], status: 'pending' })
    expect(() => joinFamilyByInviteLocal({ inviteCode: '' }, null))
      .toThrow(expect.objectContaining({ code: 'FAMILY_INVITE_NOT_FOUND' }))
    writeStorage(STORAGE_KEYS.familyAuth, null)
  })
})

describe('A2 收尾 · 有效期边界', () => {
  it('expiresAt 不可解析：查询与加入均按 INVALID 拒绝，不产生 NaN 剩余时间', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ expiresAt: 'not-a-date' })] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError.code).toBe('FAMILY_INVITE_INVALID')
    expect(Number.isNaN(data.remainHours)).toBe(false)
    await expect(service.joinFamilyByInvite('caller-2', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_INVITE_INVALID' })
    expect(memberRows(db)).toHaveLength(0)
  })

  it('刚好到期（expiresAt == now）：按已过期拒绝', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-22T06:00:00.000Z'))
    return (async () => {
      const db = createStoreDb({
        familyAuth: [pendingAuth({ expiresAt: new Date('2026-09-22T06:00:00.000Z').toISOString() })]
      })
      const service = createService(db)
      const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
      expect(data.inviteError.code).toBe('FAMILY_INVITE_EXPIRED')
      jest.useRealTimers()
    })()
  })

  it('未来有效期：正常预览，remainHours 为有限正数', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth({ expiresAt: new Date(Date.now() + 90 * 60 * 1000).toISOString() })] })
    const service = createService(db)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError).toBeUndefined()
    expect(Number.isFinite(data.remainHours)).toBe(true)
    expect(data.remainHours).toBe(2) // 90 分钟 → ceil 2 小时
  })
})

describe('A2 收尾 · 重邀/加入交错（事务分支控制流）', () => {
  it('事务路径 happy path：锚点文档创建、邀请转 active', async () => {
    const db = createStoreDb({
      profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }],
      familyAuth: [pendingAuth()]
    }, { withTransaction: true })
    const service = createService(db)
    const result = await service.joinFamilyByInvite('member-1', { inviteCode: VALID_CODE })
    expect(result.status).toBe('active')
    const anchor = memberRows(db).find(r => r._id === 'active-member-1')
    expect(anchor).toBeTruthy()
    expect(anchor.ownerOpenId).toBe('owner-1')
    expect(authRows(db)[0].status).toBe('active')
    expect(authRows(db)[0].memberOpenId).toBe('member-1')
  })

  it('交错：外层读到旧码 A，事务开始前 owner 重邀换码 B——旧码请求被拒，新邀请不被消耗', async () => {
    const NEW_CODE = 'KXJNEWCODE01'
    const db = createStoreDb({
      profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }],
      familyAuth: [pendingAuth()]
    }, {
      withTransaction: true,
      // 可控交错：事务开始前，owner 用新码 B 覆盖了同一 family_auth 文档
      onTxStart: async (d) => {
        const auth = d._stores[COLLECTIONS.familyAuth].rows[0]
        auth.inviteCode = NEW_CODE
        auth.status = 'pending'
        auth.memberOpenId = ''
        auth.scopes = [{ key: 'bloodPressure', title: '血压记录', meta: 'm', read: true, write: false, remind: false }]
      }
    })
    const service = createService(db)
    await expect(service.joinFamilyByInvite('member-1', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_INVITE_NOT_FOUND' })
    // 不创建成员、不消耗新邀请
    expect(memberRows(db)).toHaveLength(0)
    const auth = authRows(db)[0]
    expect(auth.inviteCode).toBe(NEW_CODE)
    expect(auth.status).toBe('pending')
    expect(auth.memberOpenId).toBe('')
    // 旧码失败计入频控额度
    expect(counterValue(db, 'member-1')).toBe(1)
  })

  it('事务内锚点读取发生基础设施异常：原样上抛，零写入（不吞异常继续写）', async () => {
    const db = createStoreDb({
      profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }],
      familyAuth: [pendingAuth()]
    }, { withTransaction: true })
    // 注入：事务内 familyMembers doc.get 抛网络异常
    const originalCollection = db.collection.bind(db)
    db.collection = function (name) {
      const q = originalCollection(name)
      return q
    }
    db.runTransaction = async (fn) => fn({
      collection(name) {
        return {
          doc() {
            return {
              async get() {
                if (name === COLLECTIONS.familyMembers) throw new Error('network unavailable')
                return { data: null }
              },
              async set() { throw new Error('不应写入') },
              async update() { throw new Error('不应写入') }
            }
          }
        }
      }
    })
    const service = createService(db)
    await expect(service.joinFamilyByInvite('member-1', { inviteCode: VALID_CODE }))
      .rejects.toThrow('network unavailable')
    expect(memberRows(db)).toHaveLength(0)
    expect(authRows(db)[0].status).toBe('pending')
    // 基础设施异常不计入失败额度
    expect(counterValue(db, 'member-1')).toBe(0)
  })
})

describe('A2 收尾 · 原子频控（预留-核销-退还）', () => {
  it('失败累计到计数文档：第 20 次失败后额度用尽，第 21 次拒绝且不再探测', async () => {
    const db = createStoreDb({ familyAuth: [] })
    const service = createService(db)
    seedCounter(db, 'caller-1', 19)
    const twentieth = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(twentieth.inviteError.code).toBe('FAMILY_INVITE_NOT_FOUND')
    expect(counterValue(db, 'caller-1')).toBe(20)

    const twentyFirst = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(twentyFirst.inviteError.code).toBe('FAMILY_INVITE_RATE_LIMITED')
    expect(counterValue(db, 'caller-1')).toBe(20) // 拒绝不计数
  })

  it('计数文档为每 (openId, 北京日) 单文档，含 day 键，不含邀请码明文', async () => {
    const db = createStoreDb({ familyAuth: [] })
    const service = createService(db)
    await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    const rows = counterRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]._id).toBe(`invite-fail-caller-1-${helpers.getTodayDateValue()}`)
    expect(rows[0]).toMatchObject({ openId: 'caller-1', day: helpers.getTodayDateValue(), count: 2 })
    expect(JSON.stringify(rows)).not.toContain(VALID_CODE)
  })

  it('成功查询退还额度：失败 19 次后一次成功，计数回到 19', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    const service = createService(db)
    seedCounter(db, 'caller-1', 19)
    const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
    expect(data.inviteError).toBeUndefined()
    expect(counterValue(db, 'caller-1')).toBe(19)
  })

  it('自绑/已绑定他人属业务拒绝但非枚举失败：退还额度', async () => {
    const db = createStoreDb({
      profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }],
      familyAuth: [pendingAuth()],
      familyMembers: [{ _id: 'rel-x', ownerOpenId: 'owner-9', memberOpenId: 'member-1', status: 'active' }]
    })
    const service = createService(db)
    await expect(service.joinFamilyByInvite('owner-1', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_INVITE_SELF' })
    expect(counterValue(db, 'owner-1')).toBe(0)
    await expect(service.joinFamilyByInvite('member-1', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_MEMBER_BOUND' })
    expect(counterValue(db, 'member-1')).toBe(0)
  })

  it('join 与查询共用额度：查询失败 20 次后 join 直接被拒', async () => {
    const db = createStoreDb({ familyAuth: [pendingAuth()] })
    const service = createService(db)
    seedCounter(db, 'caller-1', 20)
    await expect(service.joinFamilyByInvite('caller-1', { inviteCode: VALID_CODE }))
      .rejects.toMatchObject({ code: 'FAMILY_INVITE_RATE_LIMITED' })
    expect(memberRows(db)).toHaveLength(0)
    expect(authRows(db)[0].status).toBe('pending')
  })

  it('自然日切换：昨日计数满额不影响今日（key 内嵌北京日）', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-22T04:00:00.000Z')) // 北京 12:00
    return (async () => {
      const db = createStoreDb({ familyAuth: [pendingAuth()] })
      seedCounter(db, 'caller-1', 20, '2026-09-21')
      const service = createService(db)
      const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
      expect(data.inviteError).toBeUndefined()
      jest.useRealTimers()
    })()
  })

  it('并发建计数文档冲突（add 撞 _id）：重试条件更新后正常计 1', async () => {
    const db = createStoreDb({ familyAuth: [] })
    // 注入：第一次 add 前先把文档“被并发请求”建出来
    const store = db._stores[COLLECTIONS.inviteAttempts]
    const originalAdd = StoreQuery.prototype.add
    let injected = false
    StoreQuery.prototype.add = async function (arg) {
      if (!injected && this.store === store) {
        injected = true
        store.rows.push({
          _id: arg.data._id, openId: arg.data.openId, day: arg.data.day,
          count: 0, createdAt: 'SERVER_DATE', updatedAt: 'SERVER_DATE'
        })
      }
      return originalAdd.call(this, arg)
    }
    try {
      const service = createService(db)
      const data = await service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE })
      expect(data.inviteError.code).toBe('FAMILY_INVITE_NOT_FOUND')
      expect(counterValue(db, 'caller-1')).toBe(1)
    } finally {
      StoreQuery.prototype.add = originalAdd
    }
  })

  it('add 发生非重复键的基础设施异常：原样上抛，不得伪装成频控拒绝', async () => {
    const db = createStoreDb({ familyAuth: [] })
    const store = db._stores[COLLECTIONS.inviteAttempts]
    const originalAdd = StoreQuery.prototype.add
    StoreQuery.prototype.add = async function (arg) {
      if (this.store === store) {
        throw new Error('network timeout') // 非重复键的基础设施异常
      }
      return originalAdd.call(this, arg)
    }
    try {
      const service = createService(db)
      await expect(service.getFamilyJoinData('caller-1', { inviteCode: VALID_CODE }))
        .rejects.toThrow('network timeout')
    } finally {
      StoreQuery.prototype.add = originalAdd
    }
  })
})

describe('A2 收尾 · 重邀必须发新码', () => {
  it('候选码与 owner 自己当前码相同：不复用，重新生成', async () => {
    const db = createStoreDb({ profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db, ['KXJSAME00001', 'KXJSAME00001', 'KXJFRESH0001'])
    const first = await service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] })
    const second = await service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] })
    expect(first.inviteCode).toBe('KXJSAME00001')
    expect(second.inviteCode).toBe('KXJFRESH0001')
    expect(second.inviteCode).not.toBe(first.inviteCode)
  })

  it('连续 3 次候选码均被占用（含自己旧码）：抛冲突且零写入', async () => {
    const db = createStoreDb({ profiles: [{ _id: 'p-1', _openid: 'owner-1', name: '王阿姨' }] })
    const service = createService(db, ['KXJSAME00001', 'KXJSAME00001', 'KXJSAME00001'])
    await service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] })
    await expect(service.createFamilyInvite('owner-1', { scopes: [{ key: 'bloodPressure', read: true }] }))
      .rejects.toThrow('冲突')
    expect(authRows(db)).toHaveLength(1)
    expect(authRows(db)[0].inviteCode).toBe('KXJSAME00001') // 旧邀请未被破坏
  })
})
