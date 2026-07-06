const DEFAULT_PAGE_DATA = {
  home: {
    eyebrow: '',
    title: '今天',
    todayTasks: [
      { id: 'task-med-default', title: '用药提醒', meta: '添加用药计划后显示', actionText: '添加', route: 'medEdit' },
      { id: 'task-bp-1', title: '测量血压', meta: '晨起 · 空腹', actionText: '记录', route: 'recordBp' },
      { id: 'task-bg-1', title: '测量血糖', meta: '餐后 · 2小时', actionText: '记录', route: 'recordBg' }
    ],
    quickActions: [
      { icon: '血压', iconSrc: '/assets/icons/icon-bp.png', title: '记血压', route: 'recordBp' },
      { icon: '血糖', iconSrc: '/assets/icons/icon-bg.png', title: '记血糖', route: 'recordBg' },
      { icon: '用药', iconSrc: '/assets/icons/icon-medication.png', title: '用药', route: 'medList' }
    ],
    latestMetrics: [],
    weeklyOverview: [],
    weeklyEmptyHint: '',
    noticeText: '康小记仅用于记录和提醒，不构成诊断、治疗或处方建议。'
  },
  homeFamily: { member: { name: '', scopeText: '' }, todayAlert: { title: '', meta: '' }, latestMetrics: [], medicineLogs: [], reportSummary: '' },
  family: { familyCount: 0, members: [] },
  recordBp: {
    form: { systolic: '', diastolic: '', pulse: '', note: '' },
    errors: {},
    tags: ['晨起', '睡前', '运动后', '其他'],
    selectedTag: '晨起',
    measuredAt: '',
    summaryTip: '',
    summaryLevel: ''
  },
  recordBg: {
    form: { glucose: '', note: '' },
    errors: {},
    mealTags: ['空腹', '餐前', '餐后', '睡前', '其他'],
    selectedMealTag: '空腹',
    measuredAt: '',
    summaryTip: '',
    summaryLevel: ''
  },
  recordDetail: {
    record: null,
    details: []
  },
  recordList: {
    activeFilter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'bp', label: '血压' },
      { key: 'bg', label: '血糖' }
    ],
    summary: [],
    records: [],
    visibleRecords: []
  },
  medList: { todayCards: [], plans: [], confirmations: [] },
  medEdit: { form: { name: '', dosage: '', subscribe: true, startDate: '' }, times: [{ value: '07:00', label: '早餐', enabled: false }, { value: '12:00', label: '午餐', enabled: false }, { value: '18:00', label: '晚餐', enabled: false }, { value: '21:00', label: '睡前', enabled: false }] },
  medConfirm: { medication: { time: '', name: '', dosage: '' }, lastAction: '', lastActionLevel: '' },
  medHistory: { dateGroups: [], summary: { totalRecords: 0, takenCount: 0, skippedCount: 0 } },
  trend: {
    summaries: {},
    metricOptions: [
      { key: 'bpBg', label: '血压血糖' },
      { key: 'medication', label: '用药' }
    ],
    rangeOptions: [
      { key: '7d', label: '7天' },
      { key: '30d', label: '30天' },
      { key: '90d', label: '90天' }
    ],
    activeMetric: 'bpBg',
    activeRange: '7d',
    currentSummary: {},
    records: [],
    period: '本周',
    subtitle: '暂无记录',
    summary: [],
    focusItems: [],
    summaryMetrics: null,
    emptyHint: '',
    chartBars: [],
    chartA11yLabel: '',
    chartSeries: {}
  },
  reminder: {
    activeTab: 'today',
    tabs: [
      { key: 'today', label: '今天' },
      { key: 'upcoming', label: '即将到来' },
      { key: 'completed', label: '已完成' }
    ],
    tasks: [
      { id: 'task-weekly-report', tab: 'today', time: '周一', title: '查看本周健康趋势', meta: '回顾本周血压、血糖和用药趋势', route: 'trend', status: 'pending', statusText: '查看' }
    ],
    visibleTasks: []
  },
  reminderSettings: {
    subscription: { status: '', meta: '' },
    reminders: [],
    timePlans: [],
    quietMode: false
  },
  me: {
    profile: { name: '', role: '', desc: '', tags: [] },
    stats: [],
    settingGroups: [
      {
        title: '常用设置',
        items: [
          { label: '提醒设置', meta: '用药、测量和周报提醒', iconSrc: '/assets/icons/icon-reminder.png', route: 'reminderSettings' },
          { label: '基础资料', meta: '称呼、出生年份和关注项', iconSrc: '/assets/icons/icon-profile.png', route: 'profile' }
        ]
      },
      {
        title: '数据与隐私',
        items: [
          { label: '数据管理', meta: '管理健康数据，支持导出和清理', iconSrc: '/assets/icons/icon-export.png', route: 'data' },
          { label: '隐私政策', meta: '个人信息收集和使用说明', iconSrc: '/assets/icons/icon-privacy.png', route: 'privacyPolicy' },
          { label: '用户服务协议', meta: '服务边界、使用规则和免责声明', iconSrc: '/assets/icons/icon-privacy.png', route: 'userAgreement' },
          { label: '隐私与授权', meta: '授权范围查看和撤销', iconSrc: '/assets/icons/icon-privacy.png', route: 'privacySettings' }
        ]
      },
      {
        title: '帮助与反馈',
        items: [
          { label: '帮助中心', meta: '常见问题和操作指引', iconSrc: '/assets/icons/icon-help.png', route: 'help' },
          { label: '意见反馈', meta: '描述问题或建议', iconSrc: '/assets/icons/icon-feedback.png', route: 'feedback' }
        ]
      }
    ]
  },
  privacy: { agreed: false, scopes: [] },
  privacyDetail: { sections: [] },
  privacyPolicy: { updatedAt: '', effectiveAt: '', summary: '', sections: [] },
  userAgreement: { updatedAt: '', effectiveAt: '', summary: '', sections: [] },
  privacySettings: {
    permissions: [],
    links: [],
    logs: []
  },
  dataManagement: { summary: [], dataScopes: [], exportOptions: [] },
  help: { activeFaq: '', quickLinks: [], faqs: [] },
  feedback: { activeType: 'function', contentLength: 0, types: [{ value: 'function', label: '功能建议' }, { value: 'bug', label: '问题反馈' }, { value: 'other', label: '其他' }], form: { content: '', contact: '' } },
  profile: { profile: { name: '', birthYear: '', role: '' }, avatarText: '', roles: [], focusItems: [] },
  familyInvite: { selectedRelation: '', relations: [], scopes: [], invitePreview: { title: '', meta: '', expire: '' } },
  familyJoin: { inviteTitle: '', inviteSubtitle: '', remainHours: 24, agreed: false, identity: { initial: '', title: '', meta: '' }, scopes: [] },
  familyAuth: { member: { name: '', relation: '', role: '', status: '', desc: '' }, scopes: [], noticeRules: [], activities: [] },
  familyJoinHint: { steps: [] },
  role: { selectedRole: 'self', roles: [] }
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function deepMerge(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    return clone(baseValue)
  }

  if (Array.isArray(overrideValue)) {
    return clone(overrideValue)
  }

  if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
    return clone(overrideValue)
  }

  const result = clone(baseValue) || {}
  Object.keys(overrideValue).forEach((key) => {
    result[key] = deepMerge(baseValue ? baseValue[key] : undefined, overrideValue[key])
  })
  return result
}

function withMockPageData(key, remoteData, transform) {
  const baseData = clone(DEFAULT_PAGE_DATA[key] || {})
  if (typeof transform === 'function') {
    return transform(baseData, remoteData || {})
  }
  return deepMerge(baseData, remoteData || {})
}

function mergeArrayItemDefaults(baseItems, overrideItems, identityKey) {
  if (!Array.isArray(overrideItems)) return clone(baseItems || [])
  if (!Array.isArray(baseItems) || !identityKey) return clone(overrideItems)

  const defaultsByKey = baseItems.reduce((result, item) => {
    if (item && item[identityKey] !== undefined) {
      result[item[identityKey]] = item
    }
    return result
  }, {})

  return overrideItems.map((item) => {
    if (!item || item[identityKey] === undefined) return clone(item)
    return deepMerge(defaultsByKey[item[identityKey]], item)
  })
}

module.exports = {
  clone,
  deepMerge,
  mergeArrayItemDefaults,
  withMockPageData,
  DEFAULT_PAGE_DATA
}
