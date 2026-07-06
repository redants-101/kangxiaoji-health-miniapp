const assert = require('assert')
const { createPerfLogger, normalizePerfInfo, PERF_LOG_PREFIX } = require('../cloudfunctions/healthApi/perf')
const { createMedicationService } = require('../cloudfunctions/healthApi/medication-service')
const { createFamilyService } = require('../cloudfunctions/healthApi/family-service')
const { createSettingsDataService } = require('../cloudfunctions/healthApi/settings-data-service')

const COLLECTIONS = {
  records: 'health_records',
  medicationPlans: 'medication_plans',
  medicationConfirmations: 'medication_confirmations',
  familyAuth: 'family_auth',
  familyMembers: 'family_members',
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
    docs.forEach(doc => Object.assign(doc, clone(data)))
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

function createDefaults() {
  const familyScopes = [
    { key: 'bloodPressure', title: '血压记录', enabled: true },
    { key: 'bloodGlucose', title: '血糖记录', enabled: true },
    { key: 'medicine', title: '用药确认', enabled: true },
    { key: 'report', title: '健康记录周报', enabled: true }
  ]

  return {
    getDefaultFamilyMember() {
      return { name: '家属', relation: '家属', role: '主要照护人', status: '已授权' }
    },
    getDefaultFamilyScopes() {
      return clone(familyScopes)
    },
    getDefaultNoticeRules() {
      return [{ key: 'missedMedicine', title: '用药未确认提醒', enabled: true }]
    },
    getDefaultInviteRelations() {
      return [{ key: 'daughter', label: '女儿', meta: '主要照护人' }]
    },
    getScopeText(auth) {
      const scopes = Array.isArray(auth.scopes) ? auth.scopes : []
      const enabledTitles = scopes.filter(scope => scope.enabled).map(scope => scope.title)
      return enabledTitles.length ? enabledTitles.join('、') : '暂未授权'
    },
    isRelationScopeEnabled(relation, keys) {
      const scopes = Array.isArray(relation.scopes) ? relation.scopes : []
      return scopes.some(scope => keys.includes(scope.key) && scope.enabled)
    }
  }
}

function getLimitedString(value, label, maxLength, required = false) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) throw new Error(`${label}不能为空`)
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字`)
  return text
}

function validateMedicationPlanPayload(payload) {
  return {
    id: payload.id || '',
    name: getLimitedString(payload.name, '药品名称', 50, true),
    dosage: getLimitedString(payload.dosage, '剂量说明', 80),
    times: payload.times,
    subscribe: !!payload.subscribe,
    startDate: payload.startDate || '今天'
  }
}

function validateMedicationConfirmationPayload(payload) {
  return {
    logId: getLimitedString(payload.logId, '用药日志ID', 80, true),
    time: getLimitedString(payload.time, '用药时间', 20, true),
    name: getLimitedString(payload.name, '药品名称', 50, true),
    dosage: getLimitedString(payload.dosage, '剂量说明', 80),
    status: payload.status,
    statusText: payload.statusText || '已服'
  }
}

async function assertOwnedDocument(db, collection, openId, documentId, label) {
  const { data } = await db.collection(collection)
    .where({ _id: documentId, _openid: openId })
    .limit(1)
    .get()
  if (!data.length) throw new Error(`${label}不存在或无权操作`)
  return data[0]
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
        actionAt: '2026-04-27T07:10:00'
      }
    ]
  })
  db.currentOpenId = 'user-1'

  const service = createMedicationService({
    db,
    collections: COLLECTIONS,
    assertOwnedDocument: (...args) => assertOwnedDocument(db, ...args),
    validateMedicationPlanPayload,
    validateMedicationConfirmationPayload,
    withPerfLog
  })

  const list = await service.getMedListData('user-1')
  assert.strictEqual(list.todayLogs[0].statusText, '已服')
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
        updatedAt: '2026-04-27T07:00:00'
      }
    ],
    [COLLECTIONS.medicationConfirmations]: [
      { _id: 'confirm-family', _openid: 'owner-1', status: 'taken' }
    ]
  })
  db.currentOpenId = 'owner-1'

  const defaults = createDefaults()
  let profileLookupCount = 0
  async function getProfileDisplayName(openId) {
    profileLookupCount += 1
    const { data } = await db.collection(COLLECTIONS.profiles).where({ _openid: openId }).limit(1).get()
    return data[0]?.name || '家人'
  }

  async function getFamilyAccessContext(openId) {
    const { data: relations } = await db.collection(COLLECTIONS.familyMembers)
      .where({ memberOpenId: openId, status: 'active' })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get()
    if (!relations.length) return null
    return {
      ownerOpenId: relations[0].ownerOpenId,
      relation: relations[0]
    }
  }

  const service = createFamilyService({
    db,
    _: { in: values => ({ __op: 'in', values }) },
    collections: COLLECTIONS,
    withPerfLog,
    getProfileDisplayName,
    getFamilyAccessContext,
    isRelationScopeEnabled: defaults.isRelationScopeEnabled,
    getScopeText: defaults.getScopeText,
    getRecordStatus: level => level === 'warn' ? '建议复测' : '正常',
    getDefaultFamilyMember: defaults.getDefaultFamilyMember,
    getDefaultFamilyScopes: defaults.getDefaultFamilyScopes,
    getDefaultNoticeRules: defaults.getDefaultNoticeRules,
    getDefaultInviteRelations: defaults.getDefaultInviteRelations,
    normalizeFamilyAuthPayload: payload => ({
      member: payload.member || defaults.getDefaultFamilyMember(),
      memberName: payload.memberName || payload.member?.name || '',
      inviteCode: payload.inviteCode || '',
      scopes: payload.scopes || defaults.getDefaultFamilyScopes(),
      noticeRules: payload.noticeRules || defaults.getDefaultNoticeRules(),
      activities: payload.activities || [],
      status: payload.status || 'active'
    }),
    normalizeFamilyInvitePayload: () => ({
      relation: { key: 'daughter', label: '女儿', meta: '主要照护人' },
      scopes: defaults.getDefaultFamilyScopes(),
      member: {
        ...defaults.getDefaultFamilyMember(),
        name: '女儿',
        relation: '女儿',
        role: '主要照护人',
        status: '待加入'
      }
    }),
    validateInviteCodePayload: payload => payload.inviteCode,
    getLimitedString,
    createInviteCode: () => 'INVITE001'
  })

  const invite = await service.createFamilyInvite('owner-1', {})
  assert.strictEqual(invite.inviteCode, 'INVITE001')
  assert.strictEqual(db.data[COLLECTIONS.familyAuth][0].ownerName, '王阿姨')

  db.currentOpenId = 'member-1'
  profileLookupCount = 0
  const joinResult = await service.joinFamilyByInvite('member-1', { inviteCode: 'INVITE001' })
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
