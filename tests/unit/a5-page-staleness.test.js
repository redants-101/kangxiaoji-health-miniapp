/**
 * A5 页面级：撤销/改权后所有家属页面以服务端响应为准渲染；
 * 旧请求晚返回不得覆盖撤销后的新状态（page-factory 用真实实现——被测对象即其 stale 守卫）。
 * api / adaptive / pre-check / route-guard / snooze / subscribe-prompt / chart-adapter 用替身。
 */

const mockApi = {
  getRecordListData: jest.fn(),
  getRecordDetailData: jest.fn(),
  deleteRecord: jest.fn(),
  getMedListData: jest.fn(),
  deleteMedicationPlan: jest.fn(),
  toggleMedicationPlanStatus: jest.fn(),
  revokeMedicationConfirmation: jest.fn(),
  confirmMedication: jest.fn(),
  familyConfirmMedication: jest.fn(),
  familyRevokeProxyConfirmation: jest.fn(),
  getMedHistoryData: jest.fn(),
  getHomeFamilyData: jest.fn(),
  getTrendData: jest.fn()
}
jest.mock('../../utils/api', () => mockApi)
jest.mock('../../utils/adaptive', () => ({
  applyAdaptiveState: jest.fn(),
  bindAdaptiveResize: jest.fn(),
  buildAdaptiveState: () => ({}),
  unbindAdaptiveResize: jest.fn()
}))
jest.mock('../../utils/pre-check', () => ({ autoPreCheck: jest.fn() }))
jest.mock('../../utils/route-guard', () => ({
  safeNavigateTo: jest.fn(),
  safeRedirectTo: jest.fn(),
  safeSwitchTab: jest.fn(),
  safeNavigateWithPageCheck: jest.fn(),
  safeRedirectWithPageCheck: jest.fn(),
  safeNavigateBack: jest.fn()
}))
jest.mock('../../services/snooze', () => ({ removeSnoozeReminderByLogId: jest.fn() }))
jest.mock('../../utils/subscribe-prompt', () => ({ promptSubscribeAfterAction: jest.fn(() => Promise.resolve({ ok: false })) }))
jest.mock('../../utils/chart-adapter', () => ({
  buildTrendChart: jest.fn(() => ({})),
  buildBpBgCharts: jest.fn(() => ({}))
}))

const pageConfigs = []
global.Page = (cfg) => { pageConfigs.push(cfg); return cfg }
const storageMap = {}
global.wx = {
  setNavigationBarTitle: jest.fn(),
  showToast: jest.fn(),
  showModal: jest.fn((opt) => opt.success && opt.success({ confirm: true })),
  setClipboardData: jest.fn(),
  showActionSheet: jest.fn(),
  getStorageSync: (k) => (k in storageMap ? storageMap[k] : ''),
  setStorageSync: (k, v) => { storageMap[k] = v },
  removeStorageSync: (k) => { delete storageMap[k] }
}
global.getApp = () => ({ globalData: {} })

require('../../pages/record/record-list/index.js')      // pageConfigs[0]
require('../../pages/record/record-detail/index.js')    // pageConfigs[1]
require('../../pages/medication/med-list/index.js')     // pageConfigs[2]
require('../../pages/medication/med-history/index.js')  // pageConfigs[3]
require('../../pages/family-sub/home-family/index.js')  // pageConfigs[4]
require('../../pages/trend/index.js')                   // pageConfigs[5]
const { loadPageData } = require('../../utils/page-factory')

function makePage(cfg, route) {
  return Object.assign({}, cfg, {
    data: JSON.parse(JSON.stringify(cfg.data)),
    route,
    setData(patch) { Object.assign(this.data, patch) }
  })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('A5 · 撤销后重开所有家属页面（服务端拒绝即渲染，本地 active 镜像不回填）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 过期的本地 active 镜像：不得成为任何页面的授权依据
    storageMap.family_auth_v1 = {
      status: 'active',
      currentMemberId: 'M1',
      members: [{ id: 'M1', name: '女儿', bound: true, relation: '女儿', status: '已授权' }]
    }
  })

  it('record-list 家属态：revoked 拒绝渲染 familyDenied，records 为空', async () => {
    mockApi.getRecordListData.mockResolvedValue({ familyView: { allowed: false, reason: 'revoked' } })
    const page = makePage(pageConfigs[0], 'pages/record/record-list/index')
    await page.onLoad({ familyView: '1' })
    expect(page.data.isFamilyView).toBe(true)
    expect(page.data.familyDenied).toBe(true)
    expect(page.data.records).toEqual([])
    expect(mockApi.getRecordListData).toHaveBeenCalledWith(true)
  })

  it('record-detail 家属态：read 关闭后 scopeDenied，不泄露 owner 记录字段', async () => {
    mockApi.getRecordDetailData.mockResolvedValue({ familyView: { allowed: false, reason: 'scopeDenied' } })
    const page = makePage(pageConfigs[1], 'pages/record/record-detail/index')
    await page.onLoad({ id: 'r1', familyView: '1' })
    expect(page.data.familyDenied).toBe(true)
    expect(page.data.record).toBeFalsy()
    expect(page.data.details).toEqual([])
  })

  it('med-list 家属态：revoked 拒绝渲染，代确认入口关闭', async () => {
    mockApi.getMedListData.mockResolvedValue({ familyView: { allowed: false, reason: 'revoked' } })
    const page = makePage(pageConfigs[2], 'pages/medication/med-list/index')
    await page.onLoad({ familyView: '1' })
    expect(page.data.familyDenied).toBe(true)
    expect(page.data.familyCanConfirm).toBe(false)
    expect(page.data.todayCards).toBeUndefined()
  })

  it('med-history 家属态：revoked 拒绝渲染 familyDenied', async () => {
    mockApi.getMedHistoryData.mockResolvedValue({ familyView: { allowed: false, reason: 'revoked' } })
    const page = makePage(pageConfigs[3], 'pages/medication/med-history/index')
    page.onLoad({ familyView: '1' })
    await flush()
    expect(page.data.familyDenied).toBe(true)
  })

  it('home-family：服务端未授权空数据渲染，镜像 active 不回填、不下发写入口', async () => {
    mockApi.getHomeFamilyData.mockResolvedValue({
      member: { name: '家属', scopeText: '暂未授权' },
      todayAlert: { title: '暂无授权数据', meta: '授权已解除或尚未完成家庭授权，请重新获得邀请后查看。' },
      latestMetrics: [],
      medicineLogs: [],
      reportSummary: '暂无可查看的周报数据。'
    })
    const page = makePage(pageConfigs[4], 'pages/family-sub/home-family/index')
    await page.onLoad()
    expect(page.data.latestMetrics).toEqual([])
    expect(page.data.member.scopeText).toBe('暂未授权')
    expect(page.data.writePermissions).toBeUndefined()
  })

  it('trend 家属态（全局标记进入）：revoked 拒绝渲染 familyDenied', async () => {
    global.getApp = () => ({ globalData: { familyView: true } })
    try {
      mockApi.getTrendData.mockResolvedValue({ familyView: { allowed: false, reason: 'revoked' }, records: [] })
      const page = makePage(pageConfigs[5], 'pages/trend/index')
      await page.onLoad({})
      expect(page.data.isFamilyView).toBe(true)
      expect(page.data.familyDenied).toBe(true)
    } finally {
      global.getApp = () => ({ globalData: {} })
    }
  })

  it('owner 模式（无 familyView）正常渲染本人数据，不受家族态失效影响', async () => {
    mockApi.getRecordListData.mockResolvedValue({ records: [{ id: 'r1', type: 'bp' }] })
    const page = makePage(pageConfigs[0], 'pages/record/record-list/owner')
    await page.onLoad({})
    expect(page.data.records.length).toBe(1)
    expect(page.data.familyDenied).toBe(false)
    expect(mockApi.getRecordListData).toHaveBeenCalledWith(undefined)
  })
})

describe('A5 · 旧请求晚返回不得覆盖新状态', () => {
  it('同毫秒双加载：先发的旧请求（owner 数据）晚归，不得覆盖已到的拒绝态', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1758567600000)
    try {
      const page = {
        route: 'pages/stale-guard/test',
        data: {},
        setData(patch) { Object.assign(this.data, patch) }
      }
      let releaseFirst, releaseSecond
      const firstGate = new Promise((r) => { releaseFirst = r })
      const secondGate = new Promise((r) => { releaseSecond = r })
      // 旧请求：撤销前发出，携带 owner 数据，晚返回
      const loaderOld = () => firstGate.then(() => ({
        records: [{ id: 'owner-r1' }],
        familyView: { allowed: true }
      }))
      // 新请求：撤销后发出，返回拒绝态
      const loaderNew = () => secondGate.then(() => ({
        familyView: { allowed: false, reason: 'revoked' }
      }))

      const pOld = loadPageData(page, loaderOld)
      const pNew = loadPageData(page, loaderNew)

      // 旧请求先归（新请求仍在途）：不得写入 owner 数据
      releaseFirst()
      await pOld
      expect(page.data.records).toBeUndefined()
      expect(page.data.familyView).toBeUndefined()

      // 新请求归：写入拒绝态
      releaseSecond()
      await pNew
      expect(page.data.familyView).toEqual({ allowed: false, reason: 'revoked' })
      expect(page.data.records).toBeUndefined()
    } finally {
      nowSpy.mockRestore()
    }
  })
})
