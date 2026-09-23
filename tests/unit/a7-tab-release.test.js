/**
 * A7 家庭 Tab 正式开放、死页删除与运行时回滚开关（先失败后实现）。
 * 开关口径：远程配置（healthApi key 'appConfig' → familyTabEnabled 布尔）优先；
 * 无远程值时按 envVersion 默认——正式发布(release)=关，体验版(trial)/开发版(develop)=开。
 * 开关只控制 Tab 展示与家庭页数据加载，不构成任何数据授权（授权一律走服务端闸口）。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')

// ─── 1. feature-flags 纯单元 ───

let envVersion = 'trial'
global.wx = Object.assign(global.wx || {}, {
  getAccountInfoSync: jest.fn(() => ({ miniProgram: { envVersion } })),
  setNavigationBarTitle: jest.fn(),
  showToast: jest.fn(),
  showModal: jest.fn((opt) => opt && opt.success && opt.success({ confirm: true })),
  setClipboardData: jest.fn(),
  getStorageSync: jest.fn(() => ''),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn()
})

const featureFlags = require('../../utils/feature-flags')

describe('A7 · 运行时开关（utils/feature-flags）', () => {
  it('端侧默认值：正式发布=关；体验版/开发版=开（明确区分）', () => {
    envVersion = 'release'
    expect(featureFlags.getFamilyTabEnabled(null)).toBe(false)
    envVersion = 'trial'
    expect(featureFlags.getFamilyTabEnabled(null)).toBe(true)
    envVersion = 'develop'
    expect(featureFlags.getFamilyTabEnabled(null)).toBe(true)
  })

  it('远程配置布尔值覆盖端侧默认；非布尔忽略', () => {
    envVersion = 'trial'
    expect(featureFlags.getFamilyTabEnabled({ familyTabEnabled: false })).toBe(false)
    envVersion = 'release'
    expect(featureFlags.getFamilyTabEnabled({ familyTabEnabled: true })).toBe(true)
    expect(featureFlags.getFamilyTabEnabled({ familyTabEnabled: 'yes' })).toBe(false)
    expect(featureFlags.getFamilyTabEnabled({})).toBe(false)
    expect(featureFlags.getFamilyTabEnabled(undefined)).toBe(false)
  })

  it('envVersion 获取异常按 release 处理（保守关闭）', () => {
    global.wx.getAccountInfoSync.mockImplementationOnce(() => { throw new Error('api unavailable') })
    expect(featureFlags.getFamilyTabEnabled(null)).toBe(false)
  })
})

// ─── 2. 家庭页（开关渲染与数据加载） ───

const mockApi = {
  getFamilyData: jest.fn(),
  revokeFamilyMember: jest.fn(),
  getAppConfig: jest.fn()
}
const mockFactory = {
  autoPreCheck: jest.fn(),
  bindAdaptiveResize: jest.fn(),
  unbindAdaptiveResize: jest.fn(),
  goRoute: jest.fn(),
  clearPageLoadState: jest.fn(),
  safeNavigateBack: jest.fn(),
  safeNavigateTo: jest.fn(),
  safeSwitchTab: jest.fn(),
  safeRedirectTo: jest.fn(),
  safeNavigateWithPageCheck: jest.fn(),
  safeRedirectWithPageCheck: jest.fn(),
  loadPageData: jest.fn(),
  redirectRoute: jest.fn(),
  showModal: jest.fn(),
  hasPendingLoad: jest.fn()
}
jest.mock('../../utils/api', () => mockApi)
jest.mock('../../utils/page-factory', () => mockFactory)

const globalData = {}
global.getApp = () => ({ globalData })
const pageConfigs = []
global.Page = (cfg) => { pageConfigs.push(cfg); return cfg }
require('../../pages/family/index.js') // pageConfigs[0]

function makePage(cfg) {
  return Object.assign({}, cfg, {
    data: JSON.parse(JSON.stringify(cfg.data)),
    route: 'pages/family/index',
    setData(patch) { Object.assign(this.data, patch) }
  })
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('A7 · 家庭页开关行为', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    envVersion = 'trial'
    global.wx.getAccountInfoSync.mockImplementation(() => ({ miniProgram: { envVersion } }))
    Object.keys(globalData).forEach(k => delete globalData[k])
    mockApi.getAppConfig.mockResolvedValue(null)
    mockFactory.loadPageData.mockImplementation(async (page, loader) => {
      try {
        const d = await loader()
        Object.assign(page.data, d)
        page.data._loaded = true
        page.data.isLoading = false
        page.data.loadError = ''
        return d
      } catch (err) {
        page.setData({ isLoading: false, loadError: err.message })
        return null
      }
    })
  })

  it('开关打开（体验版默认）：显示真实家庭页并加载成员数据', async () => {
    mockApi.getFamilyData.mockResolvedValue({ members: [{ id: 'M1', name: '女儿', status: '已授权' }], familyCount: 1, authStatus: 'active' })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    await flush()
    expect(page.data.familyTabEnabled).toBe(true)
    expect(mockApi.getFamilyData).toHaveBeenCalled()
    expect(page.data.members.length).toBe(1)
  })

  it('开关关闭（正式版默认）：占位态、不加载家庭数据、isLoading 复位', async () => {
    envVersion = 'release'
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    await flush()
    expect(page.data.familyTabEnabled).toBe(false)
    expect(mockApi.getFamilyData).not.toHaveBeenCalled()
    expect(page.data.isLoading).toBe(false)
  })

  it('远程配置覆盖：正式版远程开 → 打开并加载；体验版远程关 → 回到占位', async () => {
    envVersion = 'release'
    mockApi.getAppConfig.mockResolvedValue({ familyTabEnabled: true })
    mockApi.getFamilyData.mockResolvedValue({ members: [], familyCount: 0 })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    await flush(); await flush()
    expect(page.data.familyTabEnabled).toBe(true)
    expect(mockApi.getFamilyData).toHaveBeenCalled()

    envVersion = 'trial'
    mockApi.getAppConfig.mockResolvedValue({ familyTabEnabled: false })
    const page2 = makePage(pageConfigs[0])
    await page2.onLoad()
    await flush(); await flush()
    expect(page2.data.familyTabEnabled).toBe(false)
  })

  it('远程配置获取失败：回退端侧默认，不阻塞页面', async () => {
    mockApi.getAppConfig.mockRejectedValue(new Error('network'))
    mockApi.getFamilyData.mockResolvedValue({ members: [], familyCount: 0 })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    await flush(); await flush()
    expect(page.data.familyTabEnabled).toBe(true) // trial 默认
    expect(page.data.loadError).toBeFalsy()
  })

  it('加载失败展示错误并可重载', async () => {
    mockApi.getFamilyData.mockRejectedValueOnce(new Error('云端繁忙'))
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    expect(page.data.loadError).toBe('云端繁忙')
    mockApi.getFamilyData.mockResolvedValue({ members: [], familyCount: 0 })
    await page.reloadPage()
    expect(page.data.loadError).toBe('')
    expect(page.data._loaded).toBe(true)
  })

  it('空成员 / pending / active / revoked 状态数据渲染', async () => {
    mockApi.getFamilyData.mockResolvedValue({ members: [], familyCount: 0, authStatus: 'pending' })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    expect(page.data.members).toEqual([])

    mockApi.getFamilyData.mockResolvedValue({
      members: [
        { id: '', bound: false, name: '女儿', status: '待加入' },
        { id: 'M2', bound: true, name: '儿子', status: '已授权' },
        { id: 'M3', bound: true, name: '护工', status: '已解除' }
      ],
      familyCount: 3
    })
    await page.reloadPage()
    expect(page.data.members.map(m => m.status)).toEqual(['待加入', '已授权', '已解除'])
  })

  it('邀请/管理/撤销入口行为（含 A1 预览卡守卫）', async () => {
    mockApi.getFamilyData.mockResolvedValue({ members: [{ id: 'M1', name: '女儿', status: '已授权' }], familyCount: 1 })
    mockApi.revokeFamilyMember.mockResolvedValue({ memberId: 'M1', revoked: true })
    const page = makePage(pageConfigs[0])
    await page.onLoad()

    page.inviteFamily()
    expect(mockFactory.goRoute).toHaveBeenCalledWith('familyInvite')

    page.manageMember({ currentTarget: { dataset: { id: 'M1' } } })
    expect(mockFactory.safeNavigateTo).toHaveBeenCalledWith('/pages/family-sub/family-auth/index?id=M1')

    // 邀请预览卡（无 id）不可撤销
    page.revokeMember({ currentTarget: { dataset: { id: '' } } })
    expect(global.wx.showToast).toHaveBeenCalled()
    expect(global.wx.showModal).not.toHaveBeenCalled()

    global.wx.showToast.mockClear()
    page.revokeMember({ currentTarget: { dataset: { id: 'M1' } } })
    await flush(); await flush()
    expect(mockApi.revokeFamilyMember).toHaveBeenCalledWith({ memberId: 'M1' })
  })

  it('owner 与 member 页面不混淆：家庭页不置 familyView 全局标记、不调家属接口', async () => {
    mockApi.getFamilyData.mockResolvedValue({ members: [], familyCount: 0 })
    const page = makePage(pageConfigs[0])
    await page.onLoad()
    await flush()
    expect(globalData.familyView).toBeUndefined()
    expect(mockApi.getFamilyData).toHaveBeenCalled()
  })
})

// ─── 3. 死页删除与路由一致性（文件系统契约） ───

describe('A7 · 死页删除与路由一致性', () => {
  it('pages/family-sub/index 四文件已删除，app.json 不再注册', () => {
    const dead = ['index.js', 'index.json', 'index.wxml', 'index.wxss']
    dead.forEach((f) => {
      expect(fs.existsSync(path.join(ROOT, 'pages/family-sub', f))).toBe(false)
    })
    const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
    const sub = (appJson.subPackages || appJson.subpackages).find(s => s.root === 'pages/family-sub/')
    expect(sub.pages).not.toContain('index')
    // 其余家属路由注册保持完整（死页删除不影响 invite/join/auth/home-family）
    expect(sub.pages).toEqual(expect.arrayContaining([
      'family-invite/index', 'family-join/index', 'family-join-hint/index', 'family-auth/index', 'home-family/index'
    ]))
  })

  it('全仓无 pages/family-sub/index 入口引用；routes 键完整', () => {
    const routesSrc = fs.readFileSync(path.join(ROOT, 'utils/routes.js'), 'utf8')
    expect(routesSrc).not.toContain('family-sub/index')
    const routes = require('../../utils/routes')
    ;['family', 'familyInvite', 'familyJoin', 'familyJoinHint', 'familyAuth', 'homeFamily'].forEach((k) => {
      expect(typeof routes[k]).toBe('string')
      expect(routes[k].length).toBeGreaterThan(0)
    })
    // tabBar 家庭页注册保持
    const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
    expect(appJson.pages).toContain('pages/family/index')
    expect(appJson.tabBar.list.some(t => t.pagePath === 'pages/family/index')).toBe(true)
  })

  it('回滚开关只作用于家庭 Tab：其他页面不引用 feature-flags', () => {
    const scanDirs = ['pages/home', 'pages/trend', 'pages/me', 'pages/record', 'pages/medication', 'pages/reminder', 'pages/family-sub']
    scanDirs.forEach((dir) => {
      const abs = path.join(ROOT, dir)
      if (!fs.existsSync(abs)) return
      fs.readdirSync(abs, { recursive: true }).forEach((f) => {
        if (!String(f).endsWith('.js')) return
        const src = fs.readFileSync(path.join(abs, String(f)), 'utf8')
        expect(src).not.toContain('feature-flags')
      })
    })
    const familySrc = fs.readFileSync(path.join(ROOT, 'pages/family/index.js'), 'utf8')
    expect(familySrc).toContain('feature-flags')
  })
})
