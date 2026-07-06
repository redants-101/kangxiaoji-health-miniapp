const {
  normalizeMemberStatus,
  getRelationInitial,
  getRelationMeta,
  getScopeText,
  mapFamilyMember,
  getNoFamilyAccessData,
  enforceHomeFamilyAccess
} = require('../../services/family')
const { readStorage, STORAGE_KEYS, writeStorage } = require('../../services/core')

describe('services/family', () => {
  describe('normalizeMemberStatus', () => {
    it('active/已授权 映射为 已授权', () => {
      expect(normalizeMemberStatus('active')).toBe('已授权')
      expect(normalizeMemberStatus('已授权')).toBe('已授权')
    })

    it('pending/待加入 映射为 待加入', () => {
      expect(normalizeMemberStatus('pending')).toBe('待加入')
      expect(normalizeMemberStatus('待加入')).toBe('待加入')
    })

    it('revoked/已解除 映射为 已解除', () => {
      expect(normalizeMemberStatus('revoked')).toBe('已解除')
      expect(normalizeMemberStatus('已解除')).toBe('已解除')
    })

    it('未知状态原样返回', () => {
      expect(normalizeMemberStatus('unknown')).toBe('unknown')
      expect(normalizeMemberStatus('')).toBe('已授权')
      expect(normalizeMemberStatus(undefined)).toBe('已授权')
    })
  })

  describe('getRelationInitial', () => {
    it('返回关系首字', () => {
      expect(getRelationInitial('女儿')).toBe('女')
      expect(getRelationInitial('儿子')).toBe('儿')
      expect(getRelationInitial('配偶')).toBe('配')
    })

    it('空关系返回 家', () => {
      expect(getRelationInitial('')).toBe('家')
      expect(getRelationInitial(undefined)).toBe('家')
    })
  })

  describe('getRelationMeta', () => {
    it('女儿 → 主要照护人', () => {
      const meta = getRelationMeta('daughter')
      expect(meta.relation).toBe('女儿')
      expect(meta.role).toBe('主要照护人')
    })

    it('儿子 → 紧急联系人', () => {
      const meta = getRelationMeta('son')
      expect(meta.relation).toBe('儿子')
      expect(meta.role).toBe('紧急联系人')
    })

    it('配偶 → 共同管理', () => {
      const meta = getRelationMeta('spouse')
      expect(meta.relation).toBe('配偶')
      expect(meta.role).toBe('共同管理')
    })

    it('未知关系 → 家属/共同管理', () => {
      const meta = getRelationMeta('other')
      expect(meta.relation).toBe('家属')
      expect(meta.role).toBe('共同管理')
    })
  })

  describe('getScopeText', () => {
    it('返回已启用权限的标题', () => {
      const scopes = [
        { title: '血压记录', enabled: true },
        { title: '血糖记录', enabled: true },
        { title: '用药确认', enabled: false }
      ]
      expect(getScopeText(scopes)).toBe('血压记录、血糖记录')
    })

    it('无启用权限返回 fallback', () => {
      const scopes = [
        { title: '血压记录', enabled: false }
      ]
      expect(getScopeText(scopes)).toBe('暂未授权')
    })

    it('非数组返回 fallback', () => {
      expect(getScopeText(null)).toBe('暂未授权')
      expect(getScopeText(undefined)).toBe('暂未授权')
      expect(getScopeText('invalid')).toBe('暂未授权')
    })

    it('空数组返回 fallback', () => {
      expect(getScopeText([])).toBe('暂未授权')
    })
  })

  describe('mapFamilyMember', () => {
    it('映射完整成员数据', () => {
      const member = mapFamilyMember({
        id: 'm-1',
        name: '小红',
        relation: '女儿',
        role: '主要照护人',
        status: 'active',
        scope: '血压记录、血糖记录'
      })

      expect(member.id).toBe('m-1')
      expect(member.name).toBe('小红')
      expect(member.relation).toBe('女儿')
      expect(member.status).toBe('已授权')
      expect(member.scope).toBe('血压记录、血糖记录')
    })

    it('使用 fallback 填充缺失字段', () => {
      const member = mapFamilyMember(
        { id: 'm-1' },
        { name: '默认名', relation: '家属', status: 'active' },
        0
      )
      expect(member.name).toBe('默认名')
      expect(member.relation).toBe('家属')
      expect(member.status).toBe('已授权')
    })

    it('无 id 时使用索引生成', () => {
      const member = mapFamilyMember({}, {}, 2)
      expect(member.id).toBe('member-3')
    })
  })

  describe('enforceHomeFamilyAccess', () => {
    it('无授权数据时返回原始数据', () => {
      if (typeof wx !== 'undefined' && wx.removeStorageSync) {
        wx.removeStorageSync(STORAGE_KEYS.familyAuth)
      }
      const baseData = { member: { name: '测试' }, latestMetrics: [1] }
      const result = enforceHomeFamilyAccess(baseData)
      expect(result.member.name).toBe('测试')
    })

    it('已解除授权时返回无权限数据', () => {
      writeStorage(STORAGE_KEYS.familyAuth, {
        status: 'revoked',
        members: [],
        inviteCode: ''
      })
      const baseData = { member: { name: '测试' }, latestMetrics: [1] }
      const result = enforceHomeFamilyAccess(baseData)
      expect(result.member.scopeText).toBe('暂未授权')
      expect(result.latestMetrics).toEqual([])
    })
  })

  describe('getNoFamilyAccessData', () => {
    it('返回无权限的标准结构', () => {
      const baseData = {
        member: { name: '测试' },
        todayAlert: { title: '原始标题' },
        latestMetrics: [1, 2],
        medicineLogs: [3],
        reportSummary: '原始周报'
      }
      const result = getNoFamilyAccessData(baseData)
      expect(result.member.scopeText).toBe('暂未授权')
      expect(result.todayAlert.title).toBe('暂无授权数据')
      expect(result.latestMetrics).toEqual([])
      expect(result.medicineLogs).toEqual([])
      expect(result.reportSummary).toContain('暂无')
    })
  })
})
