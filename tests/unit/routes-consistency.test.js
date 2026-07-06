const routes = require('../../utils/routes')

/**
 * 路由一致性测试：确保合并后没有残留的 report 路由，
 * 所有入口都正确指向 trend。
 */
describe('路由一致性验证（合并后）', () => {
  it('routes 中不包含 report 键', () => {
    expect(routes).not.toHaveProperty('report')
  })

  it('routes 中包含 trend 键', () => {
    expect(routes).toHaveProperty('trend')
    expect(routes.trend).toBe('/pages/trend/index')
  })

  it('trend 路由指向正确的页面路径', () => {
    expect(routes.trend).toContain('pages/trend/index')
  })

  it('所有 TabBar 路由都存在', () => {
    expect(routes).toHaveProperty('home')
    expect(routes).toHaveProperty('trend')
    expect(routes).toHaveProperty('family')
    expect(routes).toHaveProperty('me')
  })

  it('核心子页面路由完整', () => {
    expect(routes).toHaveProperty('recordBp')
    expect(routes).toHaveProperty('recordBg')
    expect(routes).toHaveProperty('recordDetail')
    expect(routes).toHaveProperty('recordList')
    expect(routes).toHaveProperty('medList')
    expect(routes).toHaveProperty('reminder')
  })
})
