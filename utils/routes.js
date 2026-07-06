/**
 * 小程序页面路由表。
 * 入参 routeKey 使用这里的键名，统一由 page-factory.goRoute 跳转。
 * 好处：页面里不用硬编码真实路径，后续改目录只改这一处。
 */
const routes = {
  // 主包页面
  home: '/pages/home/index',
  trend: '/pages/trend/index',
  family: '/pages/family/index',
  me: '/pages/me/index',

  // record 分包
  recordBp: '/pages/record/record-bp/index',
  recordBg: '/pages/record/record-bg/index',
  recordDetail: '/pages/record/record-detail/index',
  recordList: '/pages/record/record-list/index',

  // medication 分包
  medList: '/pages/medication/med-list/index',
  medHistory: '/pages/medication/med-history/index',
  medEdit: '/pages/medication/med-edit/index',
  medConfirm: '/pages/medication/med-confirm/index',

  // reminder 分包 (入口页同时作为提醒中心)
  reminder: '/pages/reminder/index',
  reminderSettings: '/pages/reminder/reminder-settings/index',

  // data 分包
  data: '/pages/data/data/index',

  // family-sub 分包
  familyInvite: '/pages/family-sub/family-invite/index',
  familyJoin: '/pages/family-sub/family-join/index',
  familyJoinHint: '/pages/family-sub/family-join-hint/index',
  familyAuth: '/pages/family-sub/family-auth/index',
  homeFamily: '/pages/family-sub/home-family/index',

  // settings 分包
  privacy: '/pages/settings/privacy/index',
  privacyDetail: '/pages/settings/privacy-detail/index',
  privacyPolicy: '/pages/settings/privacy-policy/index',
  userAgreement: '/pages/settings/user-agreement/index',
  role: '/pages/settings/role/index',
  privacySettings: '/pages/settings/privacy-settings/index',
  profile: '/pages/settings/profile/index',
  help: '/pages/settings/help/index',
  feedback: '/pages/settings/feedback/index'
}

module.exports = routes
