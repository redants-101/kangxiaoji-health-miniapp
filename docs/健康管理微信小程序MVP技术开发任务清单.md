# 健康管理微信小程序 MVP 技术开发任务清单

版本：V1.0  
编制日期：2026-04-17  
关联文档：[健康管理微信小程序MVP产品需求文档.md](./健康管理微信小程序MVP产品需求文档.md)

## 1. 技术方案总览

### 1.1 推荐技术栈

| 层级 | 技术选择 | MVP 说明 |
| --- | --- | --- |
| 小程序端 | 微信原生小程序 + TypeScript | 优先贴合微信登录、订阅消息、审核和隐私能力 |
| UI | 原生组件 + 自定义适老化组件 | 大字录入、固定底部按钮、简化表单 |
| 图表 | ECharts for 微信小程序或轻量 Canvas 图表 | 只做 7/30/90 天趋势 |
| 后端 | 微信云开发云函数或云托管 Node.js | 小团队快速上线 |
| 数据库 | 微信云数据库；如自建则 MySQL/PostgreSQL | MVP 优先云数据库 |
| 任务调度 | 云函数定时触发器 | 生成提醒、周报 |
| 消息 | 小程序订阅消息 | 需要用户授权，必须有提醒中心兜底 |
| 文件存储 | 暂不使用或仅存头像/反馈截图 | MVP 不做 OCR 和病历图片 |
| 数据分析 | 自建埋点表或微信数据助手 | 不上传健康明细值 |

### 1.2 架构边界

MVP 不接入蓝牙、OCR、AI、电话外呼、在线问诊、支付、药品销售、机构后台。系统只保存用户主动输入的健康记录、用药提醒和家庭授权关系。

### 1.3 目录建议

```text
miniprogram/
  app.ts
  app.json
  app.wxss
  pages/
    onboarding/
    home/
    record-bp/
    record-bg/
    record-detail/
    record-list/
    medication/
    medication-confirm/
    trend/
    family/
    family-invite/
    report/
    reminder-center/
    settings/
  components/
    big-number-input/
    metric-card/
    empty-state/
    consent-panel/
    trend-chart/
    reminder-item/
  services/
    api.ts
    auth.ts
    record.ts
    medication.ts
    family.ts
    reminder.ts
    report.ts
  utils/
    validators.ts
    format.ts
    thresholds.ts
    constants.ts
cloudfunctions/
  login/
  records/
  medications/
  family/
  reminders/
  reports/
  privacy/
  analytics/
```

## 2. 数据模型

### 2.1 集合/表清单

| 集合 | 说明 | MVP 必需 |
| --- | --- | --- |
| user_profiles | 用户基础资料和角色 | 是 |
| family_groups | 家庭组 | 是 |
| family_members | 家庭成员和授权范围 | 是 |
| health_records | 血压/血糖记录 | 是 |
| medication_plans | 用药计划 | 是 |
| medication_logs | 服药确认记录 | 是 |
| reminders | 提醒任务和状态 | 是 |
| weekly_reports | 周报快照 | P1 |
| consent_logs | 隐私同意和家属授权日志 | 是 |
| analytics_events | 脱敏埋点 | P1 |
| feedback | 用户反馈 | P1 |

### 2.2 user_profiles

```ts
type UserProfile = {
  _id: string
  openid: string
  role: 'self' | 'family'
  displayName: string
  birthYear?: number
  focusItems: Array<'blood_pressure' | 'blood_glucose' | 'medication'>
  privacyConsentVersion: string
  privacyConsentedAt: number
  status: 'active' | 'deleted'
  createdAt: number
  updatedAt: number
}
```

索引：

- openid 唯一索引。
- status 普通索引。

### 2.3 family_groups

```ts
type FamilyGroup = {
  _id: string
  ownerUserId: string
  name: string
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}
```

索引：

- ownerUserId。

### 2.4 family_members

```ts
type FamilyMember = {
  _id: string
  groupId: string
  userId: string
  memberRole: 'owner' | 'viewer'
  scopes: Array<'records' | 'medications' | 'reports' | 'reminders'>
  status: 'active' | 'revoked' | 'pending'
  invitedBy: string
  joinedAt?: number
  revokedAt?: number
  createdAt: number
  updatedAt: number
}
```

索引：

- groupId + status。
- userId + status。

### 2.5 health_records

```ts
type BloodPressureValue = {
  systolic: number
  diastolic: number
  pulse?: number
}

type BloodGlucoseValue = {
  glucose: number
  mealTag: 'fasting' | 'before_meal' | 'after_meal' | 'bedtime' | 'other'
}

type HealthRecord = {
  _id: string
  userId: string
  type: 'blood_pressure' | 'blood_glucose'
  value: BloodPressureValue | BloodGlucoseValue
  unit: 'mmHg' | 'mmol/L'
  measuredAt: number
  sceneTags: string[]
  note?: string
  source: 'manual'
  abnormalLevel: 'none' | 'low' | 'high' | 'very_high'
  abnormalTip?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}
```

索引：

- userId + type + measuredAt。
- userId + deletedAt。

### 2.6 medication_plans

```ts
type MedicationPlan = {
  _id: string
  userId: string
  drugName: string
  dosageText?: string
  times: string[]
  daysOfWeek?: number[]
  startDate: string
  endDate?: string
  note?: string
  status: 'active' | 'paused' | 'deleted'
  createdAt: number
  updatedAt: number
}
```

说明：

- drugName 和 dosageText 均为用户自填。
- 不维护药品知识库。
- 不生成药量、相互作用或补服建议。

### 2.7 medication_logs

```ts
type MedicationLog = {
  _id: string
  planId: string
  userId: string
  scheduledAt: number
  status: 'pending' | 'taken' | 'skipped' | 'snoozed' | 'expired'
  confirmedAt?: number
  note?: string
  createdAt: number
  updatedAt: number
}
```

索引：

- userId + scheduledAt。
- planId + scheduledAt。
- status + scheduledAt。

### 2.8 reminders

```ts
type Reminder = {
  _id: string
  userId: string
  relatedType: 'medication' | 'measurement' | 'weekly_report'
  relatedId?: string
  title: string
  content: string
  remindAt: number
  status: 'pending' | 'sent' | 'failed' | 'read' | 'done'
  subscribeTemplateId?: string
  sendResult?: string
  createdAt: number
  updatedAt: number
}
```

### 2.9 consent_logs

```ts
type ConsentLog = {
  _id: string
  userId: string
  action:
    | 'privacy_accept'
    | 'privacy_revoke'
    | 'family_invite'
    | 'family_join'
    | 'family_revoke'
    | 'account_delete'
  scope?: string[]
  version?: string
  targetUserId?: string
  createdAt: number
}
```

## 3. API/云函数清单

### 3.1 认证与用户

| 接口 | 方法 | 说明 | 优先级 |
| --- | --- | --- | --- |
| login | POST | 使用微信登录态换取用户资料 | P0 |
| getProfile | GET | 获取当前用户资料 | P0 |
| updateProfile | POST | 更新称呼、角色、关注项 | P0 |
| acceptPrivacy | POST | 记录隐私同意版本 | P0 |
| deleteAccount | POST | 注销账号或匿名化 | P0 |

### 3.2 健康记录

| 接口 | 方法 | 说明 | 优先级 |
| --- | --- | --- | --- |
| createHealthRecord | POST | 新增血压/血糖记录 | P0 |
| listHealthRecords | GET | 按类型和时间范围查询 | P0 |
| getHealthRecord | GET | 查询单条记录 | P0 |
| updateHealthRecord | POST | 编辑本人记录 | P0 |
| deleteHealthRecord | POST | 软删除本人记录 | P0 |
| getTrendSummary | GET | 查询趋势页数据 | P0 |

权限要求：

- 本人可增删改查自己的记录。
- 家属只可读取授权范围内记录。
- 删除使用软删除，趋势和列表默认过滤 deletedAt。

### 3.3 用药

| 接口 | 方法 | 说明 | 优先级 |
| --- | --- | --- | --- |
| createMedicationPlan | POST | 新增用药计划 | P0 |
| listMedicationPlans | GET | 查询当前用药计划 | P0 |
| updateMedicationPlan | POST | 修改计划 | P0 |
| deleteMedicationPlan | POST | 删除计划 | P0 |
| listMedicationLogs | GET | 查询服药确认记录 | P0 |
| confirmMedication | POST | 已服/跳过/稍后 | P0 |

权限要求：

- MVP 默认只有本人能创建和确认。
- 家属只读，不可代确认。

### 3.4 家庭

| 接口 | 方法 | 说明 | 优先级 |
| --- | --- | --- | --- |
| createFamilyGroup | POST | 创建家庭组 | P0 |
| createFamilyInvite | POST | 生成邀请 token | P0 |
| getFamilyInvite | GET | 查看邀请信息 | P0 |
| joinFamily | POST | 家属加入 | P0 |
| listFamilyMembers | GET | 成员列表 | P0 |
| revokeFamilyMember | POST | 解绑家属 | P0 |
| getFamilyDashboard | GET | 家属首页摘要 | P0 |

权限要求：

- 只有 owner 可邀请和解绑。
- 邀请 token 24 小时过期。
- joinFamily 必须写 consent_logs。

### 3.5 提醒与周报

| 接口 | 方法 | 说明 | 优先级 |
| --- | --- | --- | --- |
| requestSubscribeConfig | GET | 获取订阅模板配置 | P1 |
| listReminders | GET | 提醒中心列表 | P1 |
| markReminderRead | POST | 标记已读 | P1 |
| generateDailyMedicationLogs | CRON | 生成当天服药待确认记录 | P0 |
| sendDueReminders | CRON | 发送到期订阅消息 | P1 |
| generateWeeklyReports | CRON | 生成周报 | P1 |
| getWeeklyReport | GET | 查询周报 | P1 |

## 4. 阈值与校验规则

### 4.1 血压

```ts
const BLOOD_PRESSURE_LIMITS = {
  systolic: { min: 60, max: 260 },
  diastolic: { min: 40, max: 160 },
  pulse: { min: 30, max: 220 },
}
```

异常等级：

- very_high：收缩压 >= 180 或舒张压 >= 120。
- high：收缩压 >= 140 或舒张压 >= 90。
- low：收缩压 < 90 或舒张压 < 60。
- none：其他。

### 4.2 血糖

```ts
const BLOOD_GLUCOSE_LIMITS = {
  min: 1.0,
  max: 33.3,
}
```

异常等级：

- low：血糖 < 3.9。
- high：空腹 >= 7.0，餐后 >= 11.1。
- none：其他。

说明：以上仅用于记录提醒和复测提示，不用于诊断。

## 5. 开发任务拆分

### 5.1 项目初始化

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| SETUP-001 | 创建微信原生小程序项目，启用 TypeScript | P0 | 0.5 天 |
| SETUP-002 | 配置云开发环境和云函数目录 | P0 | 0.5 天 |
| SETUP-003 | 建立全局样式、颜色、字号、按钮规范 | P0 | 0.5 天 |
| SETUP-004 | 建立 API service 封装和错误处理 | P0 | 1 天 |
| SETUP-005 | 建立常量、阈值、格式化工具 | P0 | 0.5 天 |

交付标准：

- 小程序可在微信开发者工具中启动。
- 云函数可本地调试或上传调用。
- 所有页面使用统一错误提示组件。

### 5.2 用户与隐私

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| AUTH-001 | 实现微信登录云函数 | P0 | 1 天 |
| AUTH-002 | 实现用户资料集合和 get/update 接口 | P0 | 1 天 |
| AUTH-003 | 实现首次进入、隐私确认、角色选择页面 | P0 | 1.5 天 |
| AUTH-004 | 实现隐私同意日志 consent_logs | P0 | 0.5 天 |
| AUTH-005 | 实现账号注销/数据删除接口 | P0 | 1 天 |

交付标准：

- 未同意隐私指引不能进入健康数据录入。
- 登录后能恢复用户角色和关注项。
- 注销后用户无法继续访问历史数据。

### 5.3 首页

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| HOME-001 | 实现被照护人首页布局 | P0 | 1 天 |
| HOME-002 | 实现家属首页布局 | P0 | 1 天 |
| HOME-003 | 接入最新记录、今日待办、快捷入口数据 | P0 | 1 天 |
| HOME-004 | 实现空状态和新手引导 | P0 | 0.5 天 |

交付标准：

- 首页首屏可进入记血压、记血糖、用药、趋势、家庭。
- 无数据时不展示空图表或错误数据。

### 5.4 健康记录

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| RECORD-001 | 实现 health_records 数据集合和索引 | P0 | 0.5 天 |
| RECORD-002 | 实现健康记录 CRUD 云函数 | P0 | 2 天 |
| RECORD-003 | 实现血压大字录入页 | P0 | 1.5 天 |
| RECORD-004 | 实现血糖大字录入页 | P0 | 1.5 天 |
| RECORD-005 | 实现校验规则和异常提示生成 | P0 | 1 天 |
| RECORD-006 | 实现记录详情页 | P0 | 1 天 |
| RECORD-007 | 实现记录列表页和筛选 | P0 | 1 天 |
| RECORD-008 | 实现编辑和删除记录 | P0 | 1 天 |

交付标准：

- 血压必须校验收缩压大于舒张压。
- 血糖必须保留 1 位小数。
- 异常提示不出现诊断、治疗、处方、补服等词。

### 5.5 用药提醒

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| MED-001 | 实现 medication_plans 数据集合和接口 | P0 | 1.5 天 |
| MED-002 | 实现 medication_logs 数据集合和接口 | P0 | 1.5 天 |
| MED-003 | 实现用药计划列表和编辑页 | P0 | 2 天 |
| MED-004 | 实现每日服药待确认记录生成任务 | P0 | 1 天 |
| MED-005 | 实现服药确认页 | P0 | 1 天 |
| MED-006 | 实现跳过/稍后状态逻辑 | P0 | 0.5 天 |
| MED-007 | 接入订阅消息授权入口 | P1 | 1 天 |
| MED-008 | 实现到期提醒发送任务 | P1 | 1.5 天 |

交付标准：

- 删除用药计划不删除历史 medication_logs。
- “跳过”不显示补服建议。
- 订阅消息失败后提醒中心仍显示。

### 5.6 家庭协同

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| FAMILY-001 | 实现 family_groups 和 family_members 集合 | P0 | 0.5 天 |
| FAMILY-002 | 实现家庭组创建接口 | P0 | 0.5 天 |
| FAMILY-003 | 实现邀请 token 生成、过期和校验 | P0 | 1 天 |
| FAMILY-004 | 实现家庭页成员列表 | P0 | 1 天 |
| FAMILY-005 | 实现家属加入确认页 | P0 | 1 天 |
| FAMILY-006 | 实现解绑家属和授权日志 | P0 | 1 天 |
| FAMILY-007 | 实现家属只读权限中间件 | P0 | 1.5 天 |
| FAMILY-008 | 实现家属首页摘要接口 | P0 | 1 天 |

交付标准：

- 家属无授权不能读取记录。
- 解绑后接口立即拒绝家属访问。
- 所有授权和解绑动作写入 consent_logs。

### 5.7 趋势与图表

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| TREND-001 | 选型并接入图表组件 | P0 | 1 天 |
| TREND-002 | 实现 getTrendSummary 接口 | P0 | 1 天 |
| TREND-003 | 实现血压趋势页 | P0 | 1 天 |
| TREND-004 | 实现血糖趋势页 | P0 | 1 天 |
| TREND-005 | 实现用药确认趋势/统计 | P0 | 1 天 |
| TREND-006 | 实现 7/30/90 天切换 | P0 | 0.5 天 |

交付标准：

- 数据少于 2 条时展示空状态和记录引导。
- 图表不展示诊断结论。

### 5.8 周报

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| REPORT-001 | 实现 weekly_reports 集合 | P1 | 0.5 天 |
| REPORT-002 | 实现周报生成云函数 | P1 | 1.5 天 |
| REPORT-003 | 实现周报页面 | P1 | 1 天 |
| REPORT-004 | 实现周报提醒记录 | P1 | 0.5 天 |

交付标准：

- 周报只总结记录次数、异常记录次数、服药确认情况。
- 周报包含免责声明。
- 无数据时不生成趋势判断。

### 5.9 提醒中心

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| REMINDER-001 | 实现 reminders 集合和接口 | P1 | 1 天 |
| REMINDER-002 | 实现提醒中心页面 | P1 | 1 天 |
| REMINDER-003 | 实现已读/完成状态 | P1 | 0.5 天 |
| REMINDER-004 | 实现提醒开关设置 | P1 | 0.5 天 |

交付标准：

- 即使订阅消息未授权，提醒中心也有待办记录。
- 提醒可按今天、近 7 天、已完成分组。

### 5.10 设置、反馈和帮助

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| SETTINGS-001 | 实现设置页 | P0 | 0.5 天 |
| SETTINGS-002 | 实现隐私指引入口 | P0 | 0.5 天 |
| SETTINGS-003 | 实现授权管理入口 | P0 | 0.5 天 |
| SETTINGS-004 | 实现意见反馈 | P1 | 0.5 天 |
| SETTINGS-005 | 实现帮助中心和免责声明 | P1 | 0.5 天 |

### 5.11 埋点与运营指标

| ID | 任务 | 优先级 | 估时 |
| --- | --- | --- | --- |
| DATA-001 | 实现 analytics_events 脱敏埋点集合 | P1 | 0.5 天 |
| DATA-002 | 接入用户完成引导埋点 | P1 | 0.5 天 |
| DATA-003 | 接入记录、用药、家属、趋势、周报埋点 | P1 | 1 天 |
| DATA-004 | 输出基础指标查询脚本或后台查询说明 | P1 | 0.5 天 |

限制：

- 不上报具体血压血糖值。
- 不上报药品名称。
- 不上报备注内容。

## 6. 测试任务清单

### 6.1 单元测试

| ID | 测试对象 | 用例 |
| --- | --- | --- |
| TEST-UNIT-001 | 血压校验 | 范围校验、收缩压大于舒张压、异常等级 |
| TEST-UNIT-002 | 血糖校验 | 范围校验、空腹/餐后异常等级 |
| TEST-UNIT-003 | 权限判断 | 本人、家属授权、解绑后拒绝 |
| TEST-UNIT-004 | 周报生成 | 无数据、少量数据、完整一周数据 |
| TEST-UNIT-005 | 敏感词检查 | 异常提示和周报不得出现禁用词 |

### 6.2 集成测试

| ID | 场景 | 验收 |
| --- | --- | --- |
| TEST-INT-001 | 首次进入 | 隐私确认后完成角色选择 |
| TEST-INT-002 | 血压记录 | 新增、查看、编辑、删除 |
| TEST-INT-003 | 血糖记录 | 新增、查看、编辑、删除 |
| TEST-INT-004 | 用药计划 | 创建计划、生成待确认、确认已服 |
| TEST-INT-005 | 跳过用药 | 显示保守提示，不出现补服建议 |
| TEST-INT-006 | 家属邀请 | 生成邀请、加入、查看授权数据 |
| TEST-INT-007 | 家属解绑 | 解绑后无法访问新数据 |
| TEST-INT-008 | 趋势页 | 7/30/90 天切换和空状态 |
| TEST-INT-009 | 提醒中心 | 订阅消息失败仍有提醒记录 |
| TEST-INT-010 | 注销账号 | 注销后不能登录访问历史数据 |

### 6.3 真机测试

至少覆盖：

- iPhone 微信最新版。
- Android 微信最新版。
- 一台低端 Android 机。
- 老人常用大字体系统设置。
- 弱网环境。

重点检查：

- 大字录入是否遮挡。
- 数字键盘是否易用。
- 首页首屏是否能看到核心入口。
- 图表是否能在小屏手机上阅读。
- 家属邀请分享链路是否顺畅。

## 7. 发布前检查

### 7.1 合规检查

- 所有页面不出现“诊断”“治疗方案”“处方”“补服建议”“疗效”等高风险表达。
- 异常提示统一使用“建议复测”“咨询医生”“及时就医”。
- 隐私指引覆盖健康记录、家属共享、订阅消息、云服务。
- 家属授权有明确确认和撤销入口。
- 数据删除和账号注销可用。

### 7.2 技术检查

- 云函数接口全部做鉴权。
- 家属读接口全部校验 family_members 授权。
- 生产日志不打印健康记录明细。
- 软删除数据默认不返回。
- 定时任务失败有重试或错误记录。
- 订阅消息模板 ID 可配置。

### 7.3 产品检查

- P0 页面全部可访问。
- 新用户 4 步内进入首页。
- 30 秒内可完成一次健康记录。
- 无数据空状态完整。
- 家属端没有编辑入口。
- 周报和趋势不生成诊断结论。

## 8. 版本排期建议

### Sprint 1：基础框架与记录闭环，约 1-2 周

- 项目初始化。
- 登录、隐私确认、角色选择。
- 首页。
- 血压/血糖记录 CRUD。
- 记录详情和列表。

### Sprint 2：用药与家庭协同，约 1-2 周

- 用药计划和确认。
- 每日待确认生成。
- 家庭组、邀请、加入、解绑。
- 家属只读权限。

### Sprint 3：趋势、提醒和周报，约 1-2 周

- 趋势图。
- 提醒中心。
- 订阅消息。
- 周报生成和展示。
- 设置、反馈、帮助中心。

### Sprint 4：测试、审核和内测，约 1 周

- 单元测试和集成测试。
- 真机适老化检查。
- 隐私指引与小程序提审资料。
- 10 个真实家庭内测。
- 修复上线阻塞问题。

## 9. 后续版本预留

MVP 完成并验证留存后，再考虑：

- OCR 读数识别。
- 数据导出 PDF/图片。
- 家庭订阅支付。
- 1-2 款蓝牙设备适配。
- 社区/药店试点后台。
- AI 周报，但只做记录总结和科普解释。

继续后置：

- 在线问诊。
- 处方和药品销售。
- 药物相互作用自动判断。
- 漏服补服建议。
- 红色紧急预警和电话外呼。

