/**
 * 共享模块直接测试（A0-2 后）。
 * payload-helpers 与用药校验用例为 B3 既有覆盖（行为未变，原样保留）；
 * family-policy 组按三级权限新契约迁移，不复制业务算法，预期值字面填写。
 */

const {
  CHINA_TIME_OFFSET_MS,
  getTodayDateValue,
  buildLogId,
  getRecordStatus,
  assertPayloadObject,
  getLimitedString,
  getRequiredNumber,
  getOptionalNumber,
  isValidTime,
  getEnumValue,
  createAssertOwnedDocument
} = require('../../cloudfunctions/healthApi/payload-helpers')
const {
  validateMedicationPlanPayload,
  validateMedicationConfirmationPayload
} = require('../../cloudfunctions/healthApi/payload-validation')
const {
  getDefaultFamilyMember,
  FAMILY_RELATIONS_V2,
  getFamilyRelationV2,
  getDefaultInviteScopesV2,
  getDefaultInviteNoticeRulesV2,
  normalizeFamilyScopesV2,
  normalizeNoticeRulesV2,
  canViewScope,
  canShowPhoneReminder,
  getScopeTextV2,
  normalizeFamilyAuthPayloadV2,
  normalizeFamilyInvitePayloadV2,
  validateInviteCodePayload,
  createProfileDisplayName,
  createFamilyAccessContext
} = require('../../cloudfunctions/healthApi/family-policy')

const COLLECTIONS = {
  records: 'health_records',
  familyAuth: 'family_auth',
  familyMembers: 'family_members',
  profiles: 'profiles'
}

/**
 * 最小数据库替身：按实际用法模拟 where/orderBy/limit/get，
 * 只对测试实际依赖的字段做过滤，不模拟未使用的云端能力。
 * @param {Object} stores 按集合名给出文档数组。
 */
function createMockDb(stores = {}) {
  return {
    collection(name) {
      let query = {}
      const chain = {
        where(cond) { query = cond; return chain },
        orderBy() { return chain },
        limit() { return chain },
        get() {
          const rows = stores[name] || []
          let data = rows
          if (name === COLLECTIONS.familyMembers) {
            data = rows.filter(d => d.memberOpenId === query.memberOpenId && d.status === query.status)
          } else if (name === COLLECTIONS.familyAuth) {
            data = rows.filter(d => d._openid === query._openid)
          } else if (name === COLLECTIONS.records || name === COLLECTIONS.profiles) {
            data = rows.filter(d =>
              Object.entries(query).every(([k, v]) => d[k] === v))
          }
          return Promise.resolve({ data: JSON.parse(JSON.stringify(data)) })
        }
      }
      return chain
    }
  }
}

describe('payload-helpers · 北京时间日期函数（跨日边界，固定系统时间）', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('UTC 16:30（北京次日 00:30）取北京日期，发生跨日', () => {
    jest.setSystemTime(new Date('2026-09-21T16:30:00.000Z'))
    expect(getTodayDateValue()).toBe('2026-09-22')
  })

  it('UTC 15:59:59（北京当天 23:59:59）仍为北京当天', () => {
    jest.setSystemTime(new Date('2026-09-21T15:59:59.000Z'))
    expect(getTodayDateValue()).toBe('2026-09-21')
  })

  it('UTC 16:00:00 整（北京次日 00:00）取次日', () => {
    jest.setSystemTime(new Date('2026-09-22T16:00:00.000Z'))
    expect(getTodayDateValue()).toBe('2026-09-23')
  })

  it('年初边界：UTC 上一年 12-31T16:00 取北京 1-1，月份补零', () => {
    jest.setSystemTime(new Date('2025-12-31T16:00:00.000Z'))
    expect(getTodayDateValue()).toBe('2026-01-01')
  })

  it('偏移常量为 8 小时毫秒数', () => {
    expect(CHINA_TIME_OFFSET_MS).toBe(8 * 60 * 60 * 1000)
  })
})

describe('payload-helpers · 纯断言与格式化', () => {
  it('buildLogId 去掉时间中的冒号', () => {
    expect(buildLogId('plan-1', '07:00')).toBe('log-plan-1-0700')
  })

  it('getRecordStatus：warn 返回建议复测，其余返回正常', () => {
    expect(getRecordStatus('warn')).toBe('建议复测')
    expect(getRecordStatus('')).toBe('正常')
    expect(getRecordStatus('high')).toBe('正常')
  })

  it('assertPayloadObject：接受普通对象，拒绝空值/数组/原始值', () => {
    expect(assertPayloadObject({ a: 1 }, '测试')).toEqual({ a: 1 })
    expect(() => assertPayloadObject(null, '测试')).toThrow('测试参数不能为空')
    expect(() => assertPayloadObject([], '测试')).toThrow('测试参数不能为空')
    expect(() => assertPayloadObject(undefined, '测试')).toThrow('测试参数不能为空')
  })

  it('getLimitedString：trim 空白；超长抛错；必填为空抛错；非字符串返回空串', () => {
    expect(getLimitedString('  文本 ', '名称', 10)).toBe('文本')
    expect(() => getLimitedString('123456', '名称', 5)).toThrow('名称不能超过 5 个字')
    expect(getLimitedString('12345', '名称', 5)).toBe('12345')
    expect(() => getLimitedString('', '名称', 5, true)).toThrow('名称不能为空')
    expect(getLimitedString(123, '名称', 5)).toBe('')
  })

  it('getRequiredNumber：数值转换与范围边界；非法/越界抛错', () => {
    expect(getRequiredNumber({ v: 50 }, 'v', '值', 50, 260)).toBe(50)
    expect(getRequiredNumber({ v: 260 }, 'v', '值', 50, 260)).toBe(260)
    expect(getRequiredNumber({ v: '12.5' }, 'v', '值', 0, 100)).toBe(12.5)
    expect(() => getRequiredNumber({ v: 49 }, 'v', '值', 50, 260)).toThrow('值范围应为 50-260')
    expect(() => getRequiredNumber({ v: 261 }, 'v', '值', 50, 260)).toThrow('值范围应为 50-260')
    expect(() => getRequiredNumber({ v: 'abc' }, 'v', '值', 0, 10)).toThrow('值必须是数字')
  })

  it('getOptionalNumber：空值返回 null，有值走范围校验', () => {
    expect(getOptionalNumber({ v: undefined }, 'v', '值', 0, 10)).toBeNull()
    expect(getOptionalNumber({ v: null }, 'v', '值', 0, 10)).toBeNull()
    expect(getOptionalNumber({ v: '' }, 'v', '值', 0, 10)).toBeNull()
    expect(getOptionalNumber({ v: 8 }, 'v', '值', 0, 10)).toBe(8)
    expect(() => getOptionalNumber({ v: 11 }, 'v', '值', 0, 10)).toThrow('值范围应为 0-10')
  })

  it('isValidTime：HH:mm 合法边界；24:00/格式错非法', () => {
    expect(isValidTime('00:00')).toBe(true)
    expect(isValidTime('23:59')).toBe(true)
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('7:00')).toBe(false)
    expect(isValidTime('0700')).toBe(false)
  })

  it('getEnumValue：白名单内通过，之外抛错', () => {
    expect(getEnumValue('taken', ['taken', 'skipped'], '状态')).toBe('taken')
    expect(() => getEnumValue('nope', ['taken'], '状态')).toThrow('状态不合法')
  })
})

describe('payload-validation · 用药计划与确认校验（B3 既有，行为未变）', () => {
  it('用药计划：合法入参归一化（times 去重、subscribe 布尔、startDate 默认今天）', () => {
    const result = validateMedicationPlanPayload({
      name: ' 降压药 ',
      dosage: '1片',
      times: ['07:00', '07:00', '21:00'],
      subscribe: 1
    })
    expect(result).toEqual({
      id: '',
      name: '降压药',
      dosage: '1片',
      times: ['07:00', '21:00'],
      subscribe: true,
      startDate: '今天',
      endDate: ''
    })
  })

  it('用药计划：名称必填；times 至少一个且不超过 8 个；时间格式校验', () => {
    expect(() => validateMedicationPlanPayload({ name: '', times: ['07:00'] }))
      .toThrow('药品名称不能为空')
    expect(() => validateMedicationPlanPayload({ name: '药', times: [] }))
      .toThrow('请至少选择一个提醒时间')
    expect(() => validateMedicationPlanPayload({ name: '药', times: Array(9).fill('07:00') }))
      .toThrow('提醒时间不能超过 8 个')
    expect(() => validateMedicationPlanPayload({ name: '药', times: ['7点'] }))
      .toThrow('提醒时间格式不正确：7点')
  })

  it('用药计划：endDate 格式校验，合法 endDate 保留', () => {
    expect(() => validateMedicationPlanPayload({ name: '药', times: ['07:00'], endDate: '2026/01/01' }))
      .toThrow('结束日期格式不正确，应为 YYYY-MM-DD')
    expect(validateMedicationPlanPayload({ name: '药', times: ['07:00'], endDate: '2026-01-01' }).endDate)
      .toBe('2026-01-01')
  })

  it('用药确认：合法 taken，缺省状态文案为已服', () => {
    const result = validateMedicationConfirmationPayload({
      logId: 'log-1-0700', time: '07:00', name: '降压药', status: 'taken'
    })
    expect(result).toEqual({
      logId: 'log-1-0700',
      time: '07:00',
      name: '降压药',
      dosage: '',
      status: 'taken',
      statusText: '已服'
    })
  })

  it('用药确认：skipped/snoozed 默认文案；自定义文案保留', () => {
    expect(validateMedicationConfirmationPayload({
      logId: 'l', time: '21:00', name: '药', status: 'skipped'
    }).statusText).toBe('已跳过')
    expect(validateMedicationConfirmationPayload({
      logId: 'l', time: '21:00', name: '药', status: 'snoozed'
    }).statusText).toBe('稍后提醒')
    expect(validateMedicationConfirmationPayload({
      logId: 'l', time: '21:00', name: '药', status: 'taken', statusText: ' 已服用 '
    }).statusText).toBe('已服用')
  })

  it('用药确认：非法 status 抛错；logId/time/name 必填', () => {
    expect(() => validateMedicationConfirmationPayload({
      logId: 'l', time: '21:00', name: '药', status: 'done'
    })).toThrow('用药确认状态不合法')
    expect(() => validateMedicationConfirmationPayload({ time: '21:00', name: '药', status: 'taken' }))
      .toThrow('用药日志ID不能为空')
    expect(() => validateMedicationConfirmationPayload({ logId: 'l', name: '药', status: 'taken' }))
      .toThrow('用药时间不能为空')
    expect(() => validateMedicationConfirmationPayload({ logId: 'l', time: '21:00', status: 'taken' }))
      .toThrow('药品名称不能为空')
  })
})

describe('family-policy · 关系目录与默认成员（新契约）', () => {
  it('默认成员五字段', () => {
    expect(getDefaultFamilyMember()).toEqual({
      name: '家属',
      relation: '家属',
      role: '主要照护人',
      status: '已授权',
      desc: '可协助查看记录、用药确认和周报。权限变更后立即生效。'
    })
  })

  it('关系目录恰好 8 项，键序固定', () => {
    expect(FAMILY_RELATIONS_V2.map(r => r.key)).toEqual([
      'daughter', 'son', 'spouse', 'granddaughter',
      'grandson', 'sibling', 'caregiver', 'other'
    ])
  })

  it('getFamilyRelationV2 命中返回；未知返回 null', () => {
    expect(getFamilyRelationV2('caregiver')).toEqual({ key: 'caregiver', label: '护工', meta: '协助管理' })
    expect(getFamilyRelationV2('nope')).toBeNull()
  })

  it('邀请默认 scopes：四块 read/remind 开、write 关', () => {
    expect(getDefaultInviteScopesV2().map(s => [s.read, s.write, s.remind]))
      .toEqual([[true, false, true], [true, false, true], [true, false, true], [true, false, true]])
  })

  it('邀请默认 noticeRules：漏服开、连续未记录关、周报开', () => {
    expect(getDefaultInviteNoticeRulesV2()).toEqual({ missedMedicine: true, missingRecord: false, weeklyReport: true })
  })
})

describe('family-policy · 三级权限归一化与动作判断（新契约）', () => {
  it('normalizeFamilyScopesV2：缺字段默认 false；旧 enabled 忽略', () => {
    const result = normalizeFamilyScopesV2([
      { key: 'bloodPressure', enabled: true },
      { key: 'bloodGlucose' },
      { key: 'medicine' },
      { key: 'report' }
    ])
    expect(result.every(s => s.read === false && s.write === false && s.remind === false)).toBe(true)
  })

  it('非布尔、未知/重复 key、report.write 被拒绝', () => {
    expect(() => normalizeFamilyScopesV2([{ key: 'bloodPressure', read: 'true' }])).toThrow('布尔')
    expect(() => normalizeFamilyScopesV2([{ key: 'unknown' }])).toThrow('未知')
    expect(() => normalizeFamilyScopesV2([
      { key: 'medicine', read: true }, { key: 'medicine', read: false }
    ])).toThrow('重复')
    expect(() => normalizeFamilyScopesV2([{ key: 'report', write: true }])).toThrow('周报')
  })

  it('normalizeNoticeRulesV2：缺失 false；数组（旧页面形态）拒绝', () => {
    expect(normalizeNoticeRulesV2()).toEqual({ missedMedicine: false, missingRecord: false, weeklyReport: false })
    expect(() => normalizeNoticeRulesV2([])).toThrow('格式')
  })

  it('canViewScope / canShowPhoneReminder：read 看数据、remind 出按钮', () => {
    const scopes = normalizeFamilyScopesV2([
      { key: 'medicine', read: false, remind: true }
    ])
    expect(canViewScope(scopes, 'medicine')).toBe(false)
    expect(canShowPhoneReminder(scopes, 'medicine')).toBe(true)
  })

  it('getScopeTextV2：按 read 标题连接', () => {
    const scopes = normalizeFamilyScopesV2([
      { key: 'bloodPressure', read: true },
      { key: 'bloodGlucose', read: false }
    ])
    expect(getScopeTextV2(scopes)).toBe('血压记录')
    expect(getScopeTextV2(normalizeFamilyScopesV2([{ key: 'report' }]))).toBe('暂未授权')
  })

  it('normalizeFamilyInvitePayloadV2：缺失 scopes 拒绝；空数组四块全关；未知关系拒绝', () => {
    expect(() => normalizeFamilyInvitePayloadV2()).toThrow('授权范围')
    const invite = normalizeFamilyInvitePayloadV2({ scopes: [] })
    expect(invite.relation.key).toBe('daughter')
    expect(invite.member.status).toBe('待加入')
    expect(invite.scopes.every(s => s.read === false)).toBe(true)
    expect(() => normalizeFamilyInvitePayloadV2({ selectedRelation: 'nope' })).toThrow('关系')
  })

  it('normalizeFamilyAuthPayloadV2：缺省全最小授权；noticeRules 对象', () => {
    const data = normalizeFamilyAuthPayloadV2()
    expect(data.scopes.every(s => !s.read && !s.write)).toBe(true)
    expect(data.noticeRules).toEqual({ missedMedicine: false, missingRecord: false, weeklyReport: false })
  })

  it('validateInviteCodePayload：对象+必填', () => {
    expect(validateInviteCodePayload({ inviteCode: 'KXJ1' })).toBe('KXJ1')
    expect(() => validateInviteCodePayload({})).toThrow('邀请码不能为空')
  })
})

describe('db 工厂 · 归属校验（本人/非本人/不存在/空ID）', () => {
  it('文档属于本人：返回文档', async () => {
    const db = createMockDb({ [COLLECTIONS.records]: [
      { _id: 'r-1', _openid: 'user-1' }
    ] })
    const assertOwned = createAssertOwnedDocument(db)
    await expect(assertOwned(COLLECTIONS.records, 'user-1', 'r-1', '健康记录'))
      .resolves.toEqual({ _id: 'r-1', _openid: 'user-1' })
  })

  it('文档属于他人：查不到，抛无权操作', async () => {
    const db = createMockDb({ [COLLECTIONS.records]: [
      { _id: 'r-1', _openid: 'other-user' }
    ] })
    const assertOwned = createAssertOwnedDocument(db)
    await expect(assertOwned(COLLECTIONS.records, 'user-1', 'r-1', '健康记录'))
      .rejects.toThrow('健康记录不存在或无权操作')
  })

  it('文档不存在：抛同样错误；空 ID 先拦截', async () => {
    const db = createMockDb({ [COLLECTIONS.records]: [] })
    const assertOwned = createAssertOwnedDocument(db)
    await expect(assertOwned(COLLECTIONS.records, 'user-1', 'missing', '健康记录'))
      .rejects.toThrow('健康记录不存在或无权操作')
    await expect(assertOwned(COLLECTIONS.records, 'user-1', '', '健康记录'))
      .rejects.toThrow('健康记录ID不能为空')
  })
})

describe('db 工厂 · 名称查询与访问上下文（新契约）', () => {
  it('createProfileDisplayName：命中返回 name；无档案回落家人', async () => {
    const withProfile = createMockDb({ [COLLECTIONS.profiles]: [{ _openid: 'o-1', name: '王阿姨' }] })
    const empty = createMockDb({ [COLLECTIONS.profiles]: [] })
    await expect(createProfileDisplayName({ db: withProfile, collections: COLLECTIONS })('o-1'))
      .resolves.toBe('王阿姨')
    await expect(createProfileDisplayName({ db: empty, collections: COLLECTIONS })('o-1'))
      .resolves.toBe('家人')
  })

  it('有效成员关系：member 模式', async () => {
    const db = createMockDb({
      [COLLECTIONS.familyMembers]: [
        { _id: 'rel-1', ownerOpenId: 'owner-1', memberOpenId: 'm-1', status: 'active' }
      ]
    })
    const context = await createFamilyAccessContext({ db, collections: COLLECTIONS })('m-1')
    expect(context.mode).toBe('member')
    expect(context.ownerOpenId).toBe('owner-1')
  })

  it('ownerPreview：无关系但有本人有效 family_auth，scopes 与 noticeRules 归一化', async () => {
    const db = createMockDb({
      [COLLECTIONS.familyMembers]: [],
      [COLLECTIONS.familyAuth]: [{
        _id: 'auth-1',
        _openid: 'owner-1',
        member: { name: '女儿' },
        memberName: '女儿',
        scopes: [{ key: 'bloodPressure', read: true, remind: true }],
        noticeRules: { missedMedicine: true },
        status: 'active'
      }]
    })
    const context = await createFamilyAccessContext({ db, collections: COLLECTIONS })('owner-1')
    expect(context.mode).toBe('ownerPreview')
    expect(context.relation.scopes[0]).toMatchObject({ key: 'bloodPressure', read: true })
    expect(context.relation.noticeRules).toEqual({ missedMedicine: true, missingRecord: false, weeklyReport: false })
  })

  it('无关系无授权、或授权已撤销：null', async () => {
    const empty = createMockDb({ [COLLECTIONS.familyMembers]: [], [COLLECTIONS.familyAuth]: [] })
    await expect(createFamilyAccessContext({ db: empty, collections: COLLECTIONS })('x')).resolves.toBeNull()
    const revoked = createMockDb({
      [COLLECTIONS.familyMembers]: [],
      [COLLECTIONS.familyAuth]: [{ _openid: 'owner-1', status: 'revoked' }]
    })
    await expect(createFamilyAccessContext({ db: revoked, collections: COLLECTIONS })('owner-1')).resolves.toBeNull()
  })
})
