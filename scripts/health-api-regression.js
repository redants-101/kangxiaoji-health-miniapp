const assert = require('assert')
const { createPerfLogger, normalizePerfInfo, PERF_LOG_PREFIX } = require('../cloudfunctions/healthApi/perf')
const { createMedicationService } = require('../cloudfunctions/healthApi/medication-service')
const { createFamilyService } = require('../cloudfunctions/healthApi/family-service')
const { createSettingsDataService } = require('../cloudfunctions/healthApi/settings-data-service')
const {
  getTodayDateValue,
  getRecordStatus,
  getLimitedString,
  createAssertOwnedDocument
} = require('../cloudfunctions/healthApi/payload-helpers')
const {
  validateMedicationPlanPayload,
  validateMedicationConfirmationPayload
} = require('../cloudfunctions/healthApi/payload-validation')
const {
  getDefaultFamilyMember,
  getFamilyRelationV2,
  getDefaultInviteScopesV2,
  getDefaultInviteNoticeRulesV2,
  normalizeFamilyScopesV2,
  normalizeNoticeRulesV2,
  canViewScope,
  getScopeTextV2,
  normalizeFamilyAuthPayloadV2,
  normalizeFamilyInvitePayloadV2,
  canPerformScopeAction,
  normalizeContactPhone,
  maskContactPhone,
  canCallReminderPhone,
  validateInviteCodePayload,
  createProfileDisplayName,
  createFamilyAccessContext
} = require('../cloudfunctions/healthApi/family-policy')

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

class MockCollectionQuery {
  constructor(db, name, query = {}) {
    this.db = db
    this.name = name
    this.query = query
    this.projection = null
    this.order = null
    this.limitSize = null
    this.docId = ''
  }

  where(query) {
    return new MockCollectionQuery(this.db, this.name, query)
  }

  field(projection) {
    this.projection = projection
    return this
  }

  orderBy(field, direction) {
    this.order = { field, direction }
    return this
  }

  limit(size) {
    this.limitSize = size
    return this
  }

  doc(id) {
    const next = new MockCollectionQuery(this.db, this.name, this.query)
    next.docId = id
    return next
  }

  add({ data }) {
    const id = `mock-${this.name}-${this.db.sequence++}`
    const doc = {
      _id: id,
      _openid: data._openid || this.db.currentOpenId,
      ...clone(data)
    }
    if (!doc._openid) delete doc._openid
    this.db.data[this.name].push(doc)
    return Promise.resolve({ _id: id })
  }

  update({ data }) {
    const docs = this.docId
      ? this.db.data[this.name].filter(item => item._id === this.docId)
      : this.db.data[this.name].filter(item => this.db.matches(item, this.query))
    docs.forEach((doc) => {
      Object.entries(data).forEach(([key, value]) => {
        if (value && value.__op === 'inc') {
          doc[key] = (typeof doc[key] === 'number' ? doc[key] : 0) + value.value
        } else {
          doc[key] = clone(value)
        }
      })
    })
    return Promise.resolve({ stats: { updated: docs.length } })
  }

  remove() {
    const before = this.db.data[this.name].length
    this.db.data[this.name] = this.db.data[this.name].filter(item => item._id !== this.docId)
    return Promise.resolve({ stats: { removed: before - this.db.data[this.name].length } })
  }

  get() {
    let docs = this.db.data[this.name]
      .filter(item => this.db.matches(item, this.query))
      .map(item => clone(item))

    if (this.order) {
      const { field, direction } = this.order
      docs.sort((a, b) => {
        const left = a[field] || ''
        const right = b[field] || ''
        if (left === right) return 0
        return direction === 'desc'
          ? (left < right ? 1 : -1)
          : (left > right ? 1 : -1)
      })
    }

    if (Number.isFinite(this.limitSize)) {
      docs = docs.slice(0, this.limitSize)
    }

    if (this.projection) {
      docs = docs.map(doc => {
        const projected = {}
        Object.keys(this.projection).forEach(key => {
          if (this.projection[key] && Object.prototype.hasOwnProperty.call(doc, key)) {
            projected[key] = doc[key]
          }
        })
        if (doc._id) projected._id = doc._id
        if (doc._openid) projected._openid = doc._openid
        return projected
      })
    }

    return Promise.resolve({ data: docs })
  }

  count() {
    const total = this.db.data[this.name].filter(item => this.db.matches(item, this.query)).length
    return Promise.resolve({ total })
  }
}

class MockDb {
  constructor(data = {}) {
    this.data = {}
    Object.values(COLLECTIONS).forEach(name => {
      this.data[name] = clone(data[name] || [])
    })
    this.sequence = 1
    this.currentOpenId = ''
  }

  collection(name) {
    if (!this.data[name]) this.data[name] = []
    return new MockCollectionQuery(this, name)
  }

  serverDate() {
    return 'SERVER_DATE'
  }

  matches(doc, query) {
    return Object.entries(query || {}).every(([key, expected]) => {
      if (expected && expected.__op === 'in') {
        return expected.values.includes(doc[key])
      }
      if (expected && expected.__op === 'lt') {
        return typeof doc[key] === 'number' && doc[key] < expected.value
      }
      if (expected && expected.__op === 'gt') {
        return typeof doc[key] === 'number' && doc[key] > expected.value
      }
      return doc[key] === expected
    })
  }
}

function createHarness(data = {}) {
  const db = new MockDb(data)
  const logs = []
  const logger = {
    log(prefix, payload) {
      logs.push({ prefix, payload: typeof payload === 'string' ? JSON.parse(payload) : payload })
    }
  }
  const { withPerfLog } = createPerfLogger(logger)
  return { db, logs, withPerfLog }
}

async function testPerfSchema() {
  const info = normalizePerfInfo({
    routeType: 'key',
    route: 'home',
    step: 'db.records.latest',
    durationMs: '12',
    count: '3'
  })
  assert.strictEqual(PERF_LOG_PREFIX, '[healthApi:perf:v1]')
  assert.strictEqual(info.schemaVersion, 1)
  assert.strictEqual(info.event, 'healthApi.perf')
  assert.strictEqual(info.durationMs, 12)
  assert.strictEqual(info.count, 3)
  assert.strictEqual(info.ok, true)
}

async function testMedicationService() {
  const { db, logs, withPerfLog } = createHarness({
    [COLLECTIONS.medicationPlans]: [
      {
        _id: 'plan-1',
        _openid: 'user-1',
        name: '降压药',
        dosage: '1片',
        times: ['07:00', '21:00'],
        status: '启用',
        updatedAt: '2026-04-26'
      }
    ],
    [COLLECTIONS.medicationConfirmations]: [
      {
        _id: 'confirm-1',
        _openid: 'user-1',
        logId: 'log-plan-1-0',
        status: 'taken',
        statusText: '已服',
        confirmDate: getTodayDateValue(),
        actionAt: '2026-04-27T07:10:00'
      }
    ]
  })
  db.currentOpenId = 'user-1'

  const service = createMedicationService({
    db,
    collections: COLLECTIONS,
    assertOwnedDocument: createAssertOwnedDocument(db),
    validateMedicationPlanPayload,
    validateMedicationConfirmationPayload,
    withPerfLog
  })

  const list = await service.getMedListData('user-1')
  // 返回结构已由扁平 todayLogs 演进为 todayCards（按计划分组，内含 logs）+ confirmations（已确认流水）
  assert.ok(Array.isArray(list.todayCards))
  assert.strictEqual(list.todayCards[0].logs[0].statusText, '已服')
  assert.strictEqual(list.confirmations[0].statusText, '已服')
  assert.strictEqual(list.plans[0].schedule, '每天 07:00, 21:00')

  const saveResult = await service.saveMedicationPlan('user-1', {
    name: '维生素D',
    dosage: '1粒',
    times: ['08:00']
  })
  assert.ok(saveResult._id)

  await service.confirmMedication('user-1', {
    logId: 'log-plan-1-1',
    time: '21:00',
    name: '降压药',
    dosage: '1片',
    status: 'taken'
  })

  assert.ok(logs.some(item => item.prefix === PERF_LOG_PREFIX && item.payload.route === 'medList'))
  assert.ok(logs.some(item => item.payload.route === 'saveMedicationPlan'))
  assert.ok(logs.some(item => item.payload.route === 'confirmMedication'))
}

async function testFamilyService() {
  const { db, logs, withPerfLog } = createHarness({
    [COLLECTIONS.profiles]: [
      { _id: 'profile-owner', _openid: 'owner-1', name: '王阿姨' }
    ],
    [COLLECTIONS.records]: [
      {
        _id: 'record-bp',
        _openid: 'owner-1',
        type: 'bp',
        systolic: 128,
        diastolic: 78,
        measuredAt: '今天 08:00',
        tag: '晨起',
        level: '',
        createdAt: '2026-04-27T08:00:00'
      }
    ],
    [COLLECTIONS.medicationPlans]: [
      {
        _id: 'plan-family',
        _openid: 'owner-1',
        name: '降压药',
        dosage: '1片',
        times: ['07:00'],
        status: '启用',
        updatedAt: '2026-04-27T07:00:00'
      }
    ],
    [COLLECTIONS.medicationConfirmations]: [
      { _id: 'confirm-family', _openid: 'owner-1', status: 'taken' }
    ]
  })
  db.currentOpenId = 'owner-1'

  // 计数包装：仅用于断言 joinFamilyByInvite 复用 ownerName；查询本身走真实工厂。
  let profileLookupCount = 0
  const lookupProfileDisplayName = createProfileDisplayName({ db, collections: COLLECTIONS })
  async function getProfileDisplayName(openId) {
    profileLookupCount += 1
    return lookupProfileDisplayName(openId)
  }
  const getFamilyAccessContext = createFamilyAccessContext({ db, collections: COLLECTIONS })

  const service = createFamilyService({
    db,
    _: {
      in: values => ({ __op: 'in', values }),
      lt: value => ({ __op: 'lt', value }),
      gt: value => ({ __op: 'gt', value }),
      inc: value => ({ __op: 'inc', value })
    },
    collections: COLLECTIONS,
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
    getScopeTextV2,
    normalizeFamilyAuthPayloadV2,
    normalizeFamilyInvitePayloadV2,
    canPerformScopeAction,
    normalizeContactPhone,
    maskContactPhone,
    canCallReminderPhone,
    validateInviteCodePayload,
    getLimitedString,
    // 确定性测试替身：固定邀请码以便断言；不是业务逻辑的复制。
    createInviteCode: () => 'KXJREGRESS01',
    getDailyStatsService: () => ({ async updateRecordStats() { return { updated: 0 } }, async getHomeStats() { return { dailyStats: {}, recordStats: {} } } })
  })

  // 显式提交授权：血压/血糖/用药/周报 read 全开（与后续 homeFamily 断言对应）
  const invite = await service.createFamilyInvite('owner-1', {
    scopes: [
      { key: 'bloodPressure', read: true, remind: true },
      { key: 'bloodGlucose', read: true, remind: true },
      { key: 'medicine', read: true, remind: true },
      { key: 'report', read: true, remind: true }
    ]
  })
  assert.strictEqual(invite.inviteCode, 'KXJREGRESS01')
  assert.strictEqual(db.data[COLLECTIONS.familyAuth][0].ownerName, '王阿姨')

  db.currentOpenId = 'member-1'
  profileLookupCount = 0
  const joinResult = await service.joinFamilyByInvite('member-1', { inviteCode: 'KXJREGRESS01' })
  assert.strictEqual(joinResult.status, 'active')
  assert.strictEqual(profileLookupCount, 0, 'joinFamilyByInvite 应复用 family_auth.ownerName，避免再次查询 profiles')

  const homeFamily = await service.getHomeFamilyData('member-1')
  assert.strictEqual(homeFamily.member.name, '王阿姨')
  assert.strictEqual(homeFamily.latestMetrics[0].label, '血压')
  assert.strictEqual(homeFamily.medicineLogs[0].name, '降压药')

  assert.ok(logs.some(item => item.payload.route === 'createFamilyInvite'))
  assert.ok(logs.some(item => item.payload.route === 'joinFamilyByInvite'))
  assert.ok(logs.some(item => item.payload.route === 'homeFamily'))
}

async function testSettingsDataService() {
  const { db, logs, withPerfLog } = createHarness({
    [COLLECTIONS.records]: [
      { _id: 'record-export', _openid: 'user-1', type: 'bp', systolic: 120, diastolic: 80 }
    ],
    [COLLECTIONS.familyMembers]: [
      { _id: 'family-owned', ownerOpenId: 'user-1', memberOpenId: 'member-1', status: 'active' },
      { _id: 'family-joined', ownerOpenId: 'owner-2', memberOpenId: 'user-1', status: 'active' }
    ],
    [COLLECTIONS.familyAuth]: [
      { _id: 'auth-joined', _openid: 'owner-2', memberOpenId: 'user-1', status: 'active' }
    ],
    [COLLECTIONS.dailyStats]: [
      { _id: 'daily-1', _openid: 'user-1', recordCount: 1 }
    ],
    [COLLECTIONS.recordStats]: [
      { _id: 'stat-1', _openid: 'user-1', recordCount: 1 }
    ]
  })
  db.currentOpenId = 'user-1'
  const service = createSettingsDataService({
    db,
    collections: COLLECTIONS,
    getDefaultReminderSettings: () => ({
      subscription: { status: '未全部开启', meta: '待授权' },
      reminders: [{ key: 'medicine', title: '用药提醒', enabled: true }],
      timePlans: [],
      quietMode: true
    }),
    normalizeReminderSettingsPayload: payload => ({
      subscription: payload.subscription || { status: '已开启', meta: '正常' },
      reminders: payload.reminders || [],
      timePlans: payload.timePlans || [],
      quietMode: payload.quietMode !== false
    }),
    statsService: {
      async getRecordStats() {
        return { recordCount: 7 }
      }
    },
    withPerfLog
  })

  await service.saveReminderSettings('user-1', {
    reminders: [{ key: 'measure', title: '测量提醒', enabled: false }]
  })
  const reminderSettings = await service.getReminderSettingsData('user-1')
  assert.strictEqual(reminderSettings.reminders[0].key, 'measure')

  await service.updatePrivacySettings('user-1', {
    permissions: [{ key: 'healthData', enabled: true }],
    links: [],
    logs: []
  })
  const privacy = await service.getPrivacySettingsData('user-1')
  assert.strictEqual(privacy.permissions[0].key, 'healthData')

  await service.submitFeedback('user-1', {
    type: 'function',
    content: '希望优化报告',
    contact: 'test@example.com'
  })
  const dataManagement = await service.getDataManagementData('user-1')
  assert.strictEqual(dataManagement.summary[0].value, '7条')
  assert.strictEqual(dataManagement.summary[2].value, '2位')
  assert.strictEqual(dataManagement.summary[3].value, '1条')

  const exportData = await service.exportUserData('user-1')
  assert.ok(exportData.exportText.includes('康小记个人数据导出'))
  assert.strictEqual(exportData.data.healthRecords[0]._id, 'record-export')
  assert.strictEqual(exportData.data.familyMembers.length, 2)

  const deleteResult = await service.deleteUserData('user-1', { scope: 'health' })
  assert.strictEqual(deleteResult.deleted.records, 1)
  assert.strictEqual(db.data[COLLECTIONS.records].length, 0)
  assert.strictEqual(db.data[COLLECTIONS.dailyStats].length, 0)

  const clearResult = await service.clearUserAccount('user-1', { confirm: true })
  assert.strictEqual(clearResult.cleared, true)
  assert.strictEqual(db.data[COLLECTIONS.familyMembers].length, 0)
  assert.strictEqual(db.data[COLLECTIONS.familyAuth][0].status, 'revoked')

  assert.ok(logs.some(item => item.payload.route === 'saveReminderSettings'))
  assert.ok(logs.some(item => item.payload.route === 'updatePrivacySettings'))
  assert.ok(logs.some(item => item.payload.route === 'dataManagement'))
  assert.ok(logs.some(item => item.payload.route === 'exportUserData'))
  assert.ok(logs.some(item => item.payload.route === 'clearUserAccount'))
}

async function main() {
  await testPerfSchema()
  await testMedicationService()
  await testFamilyService()
  await testSettingsDataService()
  console.log('health-api-regression: ok')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
