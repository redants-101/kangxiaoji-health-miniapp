/**
 * A0-1：三级权限规则直接测试（新契约）。
 * 直接 require 真实实现；预期值按 decisions.md 与用户三项确认字面填写，
 * 不由被测函数生成。本批测试只验证规则函数，不代表已接入生产调用链。
 *
 * 已确认补充语义：
 * - write 动作要求同 scope read+write；
 * - read=false、remind=true 仅出电话提醒按钮，不展示提醒明细；
 * - 提醒明细可见 = scope.read && scope.remind && noticeRules 对应项（合取）。
 */

const {
  FAMILY_RELATIONS_V2,
  getFamilyRelationV2,
  normalizeFamilyScopesV2,
  normalizeNoticeRulesV2,
  canViewScope,
  canShowPhoneReminder,
  canPerformScopeAction,
  canViewReminderInfo
} = require('../../cloudfunctions/healthApi/family-policy')

describe('A0 · 八种家属关系', () => {
  it('恰好 8 项，键名与顺序固定', () => {
    expect(FAMILY_RELATIONS_V2.map(r => r.key)).toEqual([
      'daughter', 'son', 'spouse', 'granddaughter',
      'grandson', 'sibling', 'caregiver', 'other'
    ])
  })

  it('名称与用途按确认文案字面匹配', () => {
    expect(FAMILY_RELATIONS_V2).toEqual([
      { key: 'daughter', label: '女儿', meta: '主要照护人' },
      { key: 'son', label: '儿子', meta: '紧急联系人' },
      { key: 'spouse', label: '配偶', meta: '共同管理' },
      { key: 'granddaughter', label: '孙女', meta: '主要照护人' },
      { key: 'grandson', label: '孙子', meta: '主要照护人' },
      { key: 'sibling', label: '兄弟姐妹', meta: '共同管理' },
      { key: 'caregiver', label: '护工', meta: '协助管理' },
      { key: 'other', label: '家属', meta: '共同管理' }
    ])
  })

  it('getFamilyRelationV2：命中返回；未知 key 返回 null（不静默回退）', () => {
    expect(getFamilyRelationV2('granddaughter').label).toBe('孙女')
    expect(getFamilyRelationV2('not-exist')).toBeNull()
  })
})

describe('A0 · normalizeFamilyScopesV2 · 合法输入', () => {
  it('完整授权归一化为规范四 scope（固定顺序、固定标题与用途）', () => {
    const result = normalizeFamilyScopesV2([
      { key: 'medicine', read: true, write: true, remind: false },
      { key: 'bloodPressure', read: true, write: false, remind: true },
      { key: 'report', read: true, remind: true },
      { key: 'bloodGlucose', read: false, write: false, remind: false }
    ])
    expect(result).toEqual([
      { key: 'bloodPressure', title: '血压记录', meta: '数值、测量时间、场景标签和趋势', read: true, write: false, remind: true },
      { key: 'bloodGlucose', title: '血糖记录', meta: '数值、测量时间、测量场景和趋势', read: false, write: false, remind: false },
      { key: 'medicine', title: '用药确认', meta: '用药计划、确认状态和未确认记录', read: true, write: true, remind: false },
      { key: 'report', title: '健康记录周报', meta: '每周记录汇总和趋势回顾', read: true, write: false, remind: true }
    ])
  })

  it('每项只给 key：read/write/remind 全部缺失默认 false', () => {
    const result = normalizeFamilyScopesV2([
      { key: 'bloodPressure' },
      { key: 'bloodGlucose' },
      { key: 'medicine' },
      { key: 'report' }
    ])
    expect(result.every(s => s.read === false && s.write === false && s.remind === false)).toBe(true)
  })

  it('显式 false 被保留为 false', () => {
    const result = normalizeFamilyScopesV2([
      { key: 'bloodPressure', read: false, write: false, remind: false }
    ])
    expect(result[0]).toMatchObject({ read: false, write: false, remind: false })
  })
})

describe('A0 · normalizeFamilyScopesV2 · 拒绝非法输入', () => {
  it('非数组（undefined/null/对象）抛错', () => {
    expect(() => normalizeFamilyScopesV2(undefined)).toThrow('授权范围')
    expect(() => normalizeFamilyScopesV2(null)).toThrow('授权范围')
    expect(() => normalizeFamilyScopesV2({})).toThrow('授权范围')
  })

  it('未知 scope key 抛错，不落库', () => {
    expect(() => normalizeFamilyScopesV2([{ key: 'unknown', read: true }]))
      .toThrow('未知授权项')
  })

  it('非对象元素、缺 key 元素抛错', () => {
    expect(() => normalizeFamilyScopesV2(['bloodPressure'])).toThrow('授权项')
    expect(() => normalizeFamilyScopesV2([{ read: true }])).toThrow('授权项')
  })

  it('重复 scope key 抛错', () => {
    expect(() => normalizeFamilyScopesV2([
      { key: 'bloodPressure', read: true },
      { key: 'bloodPressure', read: false }
    ])).toThrow('不能重复')
  })

  it.each([
    ['read', 'false'], ['write', 'true'], ['remind', 1],
    ['read', 0], ['write', 'yes'], ['remind', 'TRUE']
  ])('%s 为非布尔值 %p 抛错，不做强制转换', (field, value) => {
    expect(() => normalizeFamilyScopesV2([{ key: 'bloodPressure', [field]: value }]))
      .toThrow('必须是布尔值')
  })

  it('旧字段 enabled=true 不映射任何新权限', () => {
    const result = normalizeFamilyScopesV2([
      { key: 'bloodPressure', enabled: true },
      { key: 'bloodGlucose', enabled: true },
      { key: 'medicine', enabled: true },
      { key: 'report', enabled: true }
    ])
    expect(result.every(s => !s.read && !s.write && !s.remind)).toBe(true)
  })

  it('report 不接受 write=true（周报无代录能力）', () => {
    expect(() => normalizeFamilyScopesV2([{ key: 'report', read: true, write: true }]))
      .toThrow('周报')
  })
})

describe('A0 · 纯函数性质', () => {
  it('不修改输入对象（输入保持原样）', () => {
    const input = [{ key: 'bloodPressure', read: true, custom: 'x' }]
    const snapshot = JSON.parse(JSON.stringify(input))
    normalizeFamilyScopesV2(input)
    expect(input).toEqual(snapshot)
  })

  it('重复调用结果不串扰', () => {
    const first = normalizeFamilyScopesV2([{ key: 'bloodPressure', read: true }])
    const second = normalizeFamilyScopesV2([{ key: 'bloodPressure' }])
    expect(first[0].read).toBe(true)
    expect(second[0].read).toBe(false)
    expect(first).not.toBe(second)
  })
})

describe('A0 · canPerformScopeAction · 允许与禁止', () => {
  function scopes(flags) {
    return normalizeFamilyScopesV2(flags)
  }

  it('血压代录：read+write 同时具备才允许；只 read 或只 write 拒绝', () => {
    const allow = scopes([{ key: 'bloodPressure', read: true, write: true }])
    const readOnly = scopes([{ key: 'bloodPressure', read: true }])
    const writeOnly = scopes([{ key: 'bloodPressure', write: true }])
    expect(canPerformScopeAction(allow, 'recordBloodPressure')).toBe(true)
    expect(canPerformScopeAction(readOnly, 'recordBloodPressure')).toBe(false)
    expect(canPerformScopeAction(writeOnly, 'recordBloodPressure')).toBe(false)
  })

  it('血糖代录：read+write 同时具备才允许', () => {
    const allow = scopes([{ key: 'bloodGlucose', read: true, write: true }])
    expect(canPerformScopeAction(allow, 'recordBloodGlucose')).toBe(true)
    expect(canPerformScopeAction(scopes([{ key: 'bloodGlucose', write: true }]), 'recordBloodGlucose')).toBe(false)
  })

  it('用药代确认与撤销本次代确认：medicine read+write', () => {
    const allow = scopes([{ key: 'medicine', read: true, write: true }])
    expect(canPerformScopeAction(allow, 'confirmMedication')).toBe(true)
    expect(canPerformScopeAction(allow, 'revokeMedicationConfirmation')).toBe(true)
    expect(canPerformScopeAction(scopes([{ key: 'medicine', write: true }]), 'confirmMedication')).toBe(false)
  })

  it('用药计划管理：即使所有 write=true 也拒绝', () => {
    const all = scopes([
      { key: 'bloodPressure', read: true, write: true },
      { key: 'bloodGlucose', read: true, write: true },
      { key: 'medicine', read: true, write: true },
      { key: 'report', read: true }
    ])
    expect(canPerformScopeAction(all, 'createMedicationPlan')).toBe(false)
    expect(canPerformScopeAction(all, 'updateMedicationPlan')).toBe(false)
    expect(canPerformScopeAction(all, 'deleteMedicationPlan')).toBe(false)
  })

  it('健康记录删除：write=true 也不放行', () => {
    const all = scopes([
      { key: 'bloodPressure', read: true, write: true },
      { key: 'bloodGlucose', read: true, write: true }
    ])
    expect(canPerformScopeAction(all, 'deleteBloodPressureRecord')).toBe(false)
    expect(canPerformScopeAction(all, 'deleteBloodGlucoseRecord')).toBe(false)
  })

  it('未知动作一律拒绝（不因任何授权放行）', () => {
    const all = scopes([
      { key: 'bloodPressure', read: true, write: true, remind: true },
      { key: 'bloodGlucose', read: true, write: true, remind: true },
      { key: 'medicine', read: true, write: true, remind: true },
      { key: 'report', read: true, remind: true }
    ])
    expect(canPerformScopeAction(all, 'anythingElse')).toBe(false)
  })

  it('未归一化/缺项输入：拒绝而非抛错', () => {
    expect(canPerformScopeAction([], 'recordBloodPressure')).toBe(false)
    expect(canPerformScopeAction(undefined, 'recordBloodPressure')).toBe(false)
  })
})

describe('A0 · canViewScope / 电话提醒按钮', () => {
  it('canViewScope：仅 read=true 可见', () => {
    const s = normalizeFamilyScopesV2([{ key: 'bloodPressure', read: true, remind: true }])
    expect(canViewScope(s, 'bloodPressure')).toBe(true)
    expect(canViewScope(s, 'medicine')).toBe(false)
  })

  it('read=false、remind=true：电话按钮可显示，但 scope 数据不可见', () => {
    const s = normalizeFamilyScopesV2([{ key: 'medicine', remind: true }])
    expect(canShowPhoneReminder(s, 'medicine')).toBe(true)
    expect(canViewScope(s, 'medicine')).toBe(false)
  })
})

describe('A0 · noticeRules 归一化', () => {
  it('无入参：三项均默认 false', () => {
    expect(normalizeNoticeRulesV2()).toEqual({
      missedMedicine: false,
      missingRecord: false,
      weeklyReport: false
    })
  })

  it('逐项布尔归一化；非布尔抛错；多余键不进入结果', () => {
    expect(normalizeNoticeRulesV2({ missedMedicine: true, weeklyReport: false, extra: true }))
      .toEqual({ missedMedicine: true, missingRecord: false, weeklyReport: false })
    expect(() => normalizeNoticeRulesV2({ missedMedicine: 'true' })).toThrow('必须是布尔值')
  })
})

describe('A0 · canViewReminderInfo · 合取双开关 + read', () => {
  function build(scopeFlags, rules) {
    return {
      scopes: normalizeFamilyScopesV2(scopeFlags),
      rules: normalizeNoticeRulesV2(rules)
    }
  }

  it('漏服提醒：medicine read+remind 且 missedMedicine，三者齐备可见', () => {
    const ok = build(
      [{ key: 'medicine', read: true, remind: true }],
      { missedMedicine: true }
    )
    expect(canViewReminderInfo(ok.scopes, ok.rules, 'missedMedicine')).toBe(true)

    const noRead = build([{ key: 'medicine', remind: true }], { missedMedicine: true })
    expect(canViewReminderInfo(noRead.scopes, noRead.rules, 'missedMedicine')).toBe(false)

    const ruleOff = build(
      [{ key: 'medicine', read: true, remind: true }],
      { missedMedicine: false }
    )
    expect(canViewReminderInfo(ruleOff.scopes, ruleOff.rules, 'missedMedicine')).toBe(false)
  })

  it('连续未记录：血压或血糖块 read+remind，且 missingRecord', () => {
    const bp = build([{ key: 'bloodPressure', read: true, remind: true }], { missingRecord: true })
    const bg = build([{ key: 'bloodGlucose', read: true, remind: true }], { missingRecord: true })
    expect(canViewReminderInfo(bp.scopes, bp.rules, 'missingRecord')).toBe(true)
    expect(canViewReminderInfo(bg.scopes, bg.rules, 'missingRecord')).toBe(true)

    const neither = build([{ key: 'bloodPressure', remind: true }], { missingRecord: true })
    expect(canViewReminderInfo(neither.scopes, neither.rules, 'missingRecord')).toBe(false)
    const ruleOff = build(
      [{ key: 'bloodPressure', read: true, remind: true }],
      { missingRecord: false }
    )
    expect(canViewReminderInfo(ruleOff.scopes, ruleOff.rules, 'missingRecord')).toBe(false)
  })

  it('周报提醒：report read+remind 且 weeklyReport', () => {
    const ok = build([{ key: 'report', read: true, remind: true }], { weeklyReport: true })
    expect(canViewReminderInfo(ok.scopes, ok.rules, 'weeklyReport')).toBe(true)
    const noRead = build([{ key: 'report', remind: true }], { weeklyReport: true })
    expect(canViewReminderInfo(ok.scopes, ok.rules, 'unknown')).toBe(false)
    expect(canViewReminderInfo(noRead.scopes, noRead.rules, 'weeklyReport')).toBe(false)
  })

  it('read=false、remind=true：只能出电话按钮，提醒明细不可见', () => {
    const s = normalizeFamilyScopesV2([{ key: 'medicine', remind: true }])
    const rules = normalizeNoticeRulesV2({ missedMedicine: true })
    expect(canShowPhoneReminder(s, 'medicine')).toBe(true)
    expect(canViewReminderInfo(s, rules, 'missedMedicine')).toBe(false)
  })
})
