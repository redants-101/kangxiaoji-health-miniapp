/**
 * A2 页面收尾：family-invite 显式生成邀请。
 * 页面级测试：mock utils/api 与 utils/page-factory，捕获 Page 配置后实例化，
 * 断言打开/刷新/编辑零生成请求、显式点击才提交、防重、失败态、脏草稿禁分享。
 */

const mockApi = {
  getFamilyInviteData: jest.fn(),
  createFamilyInvite: jest.fn()
}
const mockFactory = {
  bindAdaptiveResize: jest.fn(),
  unbindAdaptiveResize: jest.fn(),
  goRoute: jest.fn(),
  clearPageLoadState: jest.fn(),
  loadPageData: jest.fn()
}
jest.mock('../../utils/api', () => mockApi)
jest.mock('../../utils/page-factory', () => mockFactory)

let pageConfig = null
global.Page = (cfg) => { pageConfig = cfg; return cfg }
global.wx = {
  setNavigationBarTitle: jest.fn(),
  showToast: jest.fn(),
  setClipboardData: jest.fn((opt) => opt.success && opt.success()),
  showModal: jest.fn((opt) => opt.success && opt.success({ confirm: true }))
}

require('../../pages/family-sub/family-invite/index.js')

const DEFAULT_SCOPES = [
  { key: 'bloodPressure', title: '血压记录', meta: 'm', read: true, write: false, remind: true },
  { key: 'bloodGlucose', title: '血糖记录', meta: 'm', read: true, write: false, remind: true },
  { key: 'medicine', title: '用药确认', meta: 'm', read: true, write: false, remind: true },
  { key: 'report', title: '健康记录周报', meta: 'm', read: true, write: false, remind: true }
]

function makePage() {
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    route: 'pages/family-sub/family-invite/index',
    setData(patch) { Object.assign(this.data, patch) }
  })
  return page
}

beforeEach(() => {
  jest.clearAllMocks()
  mockApi.getFamilyInviteData.mockResolvedValue({
    selectedRelation: 'daughter',
    relations: [{ key: 'daughter', label: '女儿', meta: '主要照护人' }, { key: 'son', label: '儿子', meta: '紧急联系人' }],
    scopes: JSON.parse(JSON.stringify(DEFAULT_SCOPES)),
    invitePreview: { title: '邀请家属查看健康记录', meta: '可查看：血压记录、血糖记录、用药确认、健康记录周报', expire: '24 小时' }
  })
  mockFactory.loadPageData.mockImplementation(async (page, loader) => {
    const data = await loader()
    Object.assign(page.data, data)
    return data
  })
  mockApi.createFamilyInvite.mockImplementation(async (payload) => {
    const readTitles = (payload.scopes || []).filter(s => s.read).map(s => s.title)
    const code = 'KXJGEN000001'
    return {
      inviteCode: code,
      inviteId: code,
      sharePath: `/pages/family-sub/family-join/index?inviteCode=${code}`,
      invitePreview: { title: '王阿姨邀请女儿查看健康记录', meta: `可查看：${readTitles.join('、')}`, expire: '24 小时' }
    }
  })
})

describe('打开与刷新：只读不生成', () => {
  it('onLoad 读取数据且零生成请求', async () => {
    const page = makePage()
    await page.onLoad()
    expect(mockApi.getFamilyInviteData).toHaveBeenCalledTimes(1)
    expect(mockApi.createFamilyInvite).toHaveBeenCalledTimes(0)
  })

  it('reloadPage 零生成请求', async () => {
    const page = makePage()
    await page.onLoad()
    await page.reloadPage()
    expect(mockApi.createFamilyInvite).toHaveBeenCalledTimes(0)
  })
})

describe('编辑配置：只更新草稿不写云端', () => {
  it('selectRelation / toggleScope / selectAllScopes 均零生成请求', async () => {
    const page = makePage()
    await page.onLoad()
    page.selectRelation({ currentTarget: { dataset: { key: 'son' } } })
    page.toggleScope({ currentTarget: { dataset: { key: 'report', field: 'read' } }, detail: { value: false } })
    page.selectAllScopes()
    expect(mockApi.createFamilyInvite).toHaveBeenCalledTimes(0)
    expect(page.data.selectedRelation).toBe('son')
  })
})

describe('显式生成：点击才提交', () => {
  it('点击生成一次：提交草稿并落状态', async () => {
    const page = makePage()
    await page.onLoad()
    await page.generateInvite()
    expect(mockApi.createFamilyInvite).toHaveBeenCalledTimes(1)
    expect(page.data.inviteCode).toBe('KXJGEN000001')
    expect(page.data.draftDirty).toBe(false)
    expect(page.data.sharePath).toContain('KXJGEN000001')
  })

  it('请求在途时重复点击：仅提交一次', async () => {
    const page = makePage()
    await page.onLoad()
    const p1 = page.generateInvite()
    const p2 = page.generateInvite()
    await Promise.all([p1, p2])
    expect(mockApi.createFamilyInvite).toHaveBeenCalledTimes(1)
    expect(page.data.submitting).toBe(false)
  })

  it('已有码时重新生成需确认（说明旧码失效）', async () => {
    const page = makePage()
    await page.onLoad()
    await page.generateInvite()
    global.wx.showModal.mockClear()
    await page.generateInvite()
    expect(global.wx.showModal).toHaveBeenCalledTimes(1)
    const content = global.wx.showModal.mock.calls[0][0].content
    expect(content).toContain('失效')
    expect(mockApi.createFamilyInvite).toHaveBeenCalledTimes(2)
  })
})

describe('失败态：旧码不得冒充新配置生效', () => {
  it('生成失败：submitting 复位、错误提示、无码时不展示生效态', async () => {
    mockApi.createFamilyInvite.mockRejectedValue(new Error('网络异常'))
    const page = makePage()
    await page.onLoad()
    await page.generateInvite()
    expect(page.data.submitting).toBe(false)
    expect(page.data.generateError).toBeTruthy()
    expect(page.data.inviteCode).toBe('')
    expect(page.data.draftDirty).toBe(true)
  })

  it('已有旧码时生成失败：旧码保留但标记脏草稿，禁止复制分享', async () => {
    const page = makePage()
    await page.onLoad()
    await page.generateInvite()
    page.toggleScope({ currentTarget: { dataset: { key: 'report', field: 'read' } }, detail: { value: false } })
    mockApi.createFamilyInvite.mockRejectedValue(new Error('网络异常'))
    await page.generateInvite()
    expect(page.data.inviteCode).toBe('KXJGEN000001') // 旧码仍在
    expect(page.data.draftDirty).toBe(true) // 但草稿≠已生成配置
    global.wx.setClipboardData.mockClear()
    page.copyInvite()
    expect(global.wx.setClipboardData).toHaveBeenCalledTimes(0)
    expect(global.wx.showToast).toHaveBeenCalled()
  })
})

describe('脏草稿：禁止“新文案+旧码”组合', () => {
  it('编辑后复制被拦截并提示重新生成', async () => {
    const page = makePage()
    await page.onLoad()
    await page.generateInvite()
    page.selectRelation({ currentTarget: { dataset: { key: 'son' } } })
    expect(page.data.draftDirty).toBe(true)
    global.wx.setClipboardData.mockClear()
    page.copyInvite()
    expect(global.wx.setClipboardData).toHaveBeenCalledTimes(0)
  })

  it('编辑后分享回退为无码路径（不携带旧码）', async () => {
    const page = makePage()
    await page.onLoad()
    await page.generateInvite()
    page.selectRelation({ currentTarget: { dataset: { key: 'son' } } })
    const share = page.onShareAppMessage()
    expect(share.path).not.toContain('KXJGEN000001')
  })

  it('未生成时分享回退为无码路径', async () => {
    const page = makePage()
    await page.onLoad()
    const share = page.onShareAppMessage()
    expect(share.path).not.toContain('inviteCode=')
  })
})

describe('重新生成成功后：文案、权限与分享链接一致', () => {
  it('改草稿后重新生成：preview/sharePath/code 均对应新配置', async () => {
    const page = makePage()
    await page.onLoad()
    await page.generateInvite()
    page.toggleScope({ currentTarget: { dataset: { key: 'report', field: 'read' } }, detail: { value: false } })
    mockApi.createFamilyInvite.mockImplementation(async (payload) => {
      const readTitles = (payload.scopes || []).filter(s => s.read).map(s => s.title)
      return {
        inviteCode: 'KXJGEN000002',
        inviteId: 'KXJGEN000002',
        sharePath: '/pages/family-sub/family-join/index?inviteCode=KXJGEN000002',
        invitePreview: { title: '王阿姨邀请女儿查看健康记录', meta: `可查看：${readTitles.join('、')}`, expire: '24 小时' }
      }
    })
    await page.generateInvite()
    expect(page.data.inviteCode).toBe('KXJGEN000002')
    expect(page.data.sharePath).toContain('KXJGEN000002')
    expect(page.data.invitePreview.meta).not.toContain('健康记录周报')
    expect(page.data.draftDirty).toBe(false)
    // 一致后复制放行
    global.wx.setClipboardData.mockClear()
    page.copyInvite()
    expect(global.wx.setClipboardData).toHaveBeenCalledTimes(1)
  })
})
