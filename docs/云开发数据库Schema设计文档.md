# 康小记云开发数据库 Schema 设计文档

本文档用于把当前本地 MVP 的缓存数据整理成微信云开发数据库集合设计，方便后续从 `dataSource: 'local'` 切换到 `dataSource: 'cloud'`。

当前约定：云数据库为空库，不保留旧字段兼容。后续落库字段以本文档为准，前端、`services` 和云函数需要逐步对齐。

## 1. 基础约定

### 1.1 数据边界

康小记只保存健康记录、用药提醒、家属授权、隐私授权和反馈信息。系统不保存诊断、治疗方案、处方决策、急救判断等医疗服务数据。

### 1.2 通用字段

微信云数据库会自动生成 `_id`，云函数新增数据时会自动写入 `_openid`。所有用户私有集合都必须以 `_openid` 作为数据归属边界。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `_id` | `string` | 是 | 云数据库自动生成的文档 ID |
| `_openid` | `string` | 是 | 微信云开发自动注入的当前用户 openid |
| `createdAt` | `Date` | 新增必填 | 创建时间，使用 `db.serverDate()` |
| `updatedAt` | `Date` | 更新必填 | 更新时间，使用 `db.serverDate()` |

### 1.3 时间字段规则

| 场景 | 字段 | 类型 | 说明 |
|---|---|---|---|
| 数据排序和查询 | `createdAt` / `updatedAt` / `actionAt` | `Date` | 用云端时间，便于范围查询和排序 |
| 页面展示 | `measuredAt` / `startDate` / `time` | `string` | 保留用户选择或页面展示文案 |

后续建议逐步增加 `measuredAtTs: Date`，用于血压、血糖按真实测量时间统计，而不是只依赖 `createdAt`。

## 2. 集合总览

| 集合名 | 本地缓存 key | 主要写接口 | 主要读接口 | 数据敏感级别 |
|---|---|---|---|---|
| `profiles` | `user_profile_v1` | `saveProfile`、`clearUserAccount` | `profile`、`home`、`me`、`exportUserData` | 敏感个人信息 |
| `health_records` | `health_records_v1` | `saveBloodPressureRecord`、`saveBloodGlucoseRecord`、`deleteRecord`、`deleteUserData`、`clearUserAccount` | `home`、`recordDetail`、`recordList`、`trend`、`report`、`dataManagement`、`exportUserData` | 敏感个人信息 |
| `health_daily_stats` | 暂无本地缓存 | 自动维护；`rebuildRecordStats`、`deleteUserData`、`clearUserAccount` | `home`、`report`、`exportUserData` | 敏感个人统计信息 |
| `health_record_stats` | 暂无本地缓存 | 自动维护；`rebuildRecordStats`、`deleteUserData`、`clearUserAccount` | `home`、`exportUserData` | 敏感个人统计信息 |
| `medication_plans` | `medication_plans_v1` | `saveMedicationPlan`、`deleteMedicationPlan`、`clearUserAccount` | `medList`、`medEdit`、`medConfirm`、`homeFamily`、`exportUserData` | 敏感个人信息 |
| `medication_confirmations` | `medication_confirmations_v1` | `confirmMedication`、`deleteUserData`、`clearUserAccount` | `medList`、`reminder`、`homeFamily`、`exportUserData` | 敏感个人信息 |
| `family_auth` | `family_auth_v1` | `updateFamilyAuth`、`revokeFamilyMember`、`clearUserAccount` | `family`、`familyAuth`、`homeFamily`、`exportUserData` | 敏感个人信息 |
| `family_members` | 暂无本地缓存 | `createFamilyInvite`、`joinFamilyByInvite`、`revokeFamilyMember`、`clearUserAccount` | `homeFamily`、`family`、`exportUserData` | 敏感个人信息 |
| `reminder_settings` | `reminder_settings_v1` | `saveReminderSettings`、`clearUserAccount` | `reminder`、`reminderSettings`、`exportUserData` | 个人偏好信息 |
| `privacy_settings` | `privacy_settings_v1` | `updatePrivacySettings`、`clearUserAccount` | `privacySettings`、`exportUserData` | 敏感授权记录 |
| `feedbacks` | `feedbacks_v1` | `submitFeedback`、`clearUserAccount` | 后台管理、数据管理统计、`exportUserData` | 普通个人信息 |

## 3. 集合字段设计

### 3.1 `profiles` 用户档案

用途：保存用户基础资料、使用角色和关注项目。一个 `_openid` 理论上只保留一条档案。

当前本地页面提交结构是：

```js
{
  profile: { name, role },
  avatarText,
  roles,
  focusItems
}
```

目标云端落库结构建议扁平化，避免把页面展示配置完整写入数据库。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 用户归属 |
| `name` | `string` | 是 | `妈妈` | 用户称呼，不建议保存真实身份证姓名 |
| `birthYear` | `string` | 否 | `1965` | 出生年份，当前仅作基础资料记录 |
| `role` | `string` | 是 | `self` | 使用角色：`self` 本人使用，`family` 帮家人管理 |
| `avatar` | `string` | 否 | `` | 头像 URL，当前 MVP 可为空 |
| `avatarText` | `string` | 否 | `妈` | 本地头像首字，云端可选 |
| `focusItems` | `Array<Object>` | 否 | 见下方 | 关注项配置 |
| `createdAt` | `Date` | 是 |  | 创建时间 |
| `updatedAt` | `Date` | 是 |  | 更新时间 |

`focusItems` 子结构：

```js
[
  { key: 'bp', title: '血压记录', checked: true },
  { key: 'bg', title: '血糖记录', checked: true },
  { key: 'med', title: '用药提醒', checked: true }
]
```

当前状态：云函数 `saveProfile()` 已把页面提交的 `payload.profile.name / payload.profile.birthYear / payload.profile.role` 归一化为 `profiles.name / profiles.birthYear / profiles.role`，不会把页面展示配置完整落库。

### 3.2 `health_records` 健康记录

用途：保存血压和血糖记录。血压、血糖共用一个集合，通过 `type` 区分。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 记录创建者 |
| `type` | `string` | 是 | `bp` | `bp` 血压，`bg` 血糖 |
| `source` | `string` | 是 | `cloud` | 数据来源：`cloud` / `local` / `device`，云端默认为 `cloud` |
| `systolic` | `number` | 血压必填 | `128` | 收缩压，`type=bp` 时存在 |
| `diastolic` | `number` | 血压必填 | `82` | 舒张压，`type=bp` 时存在 |
| `pulse` | `number|null` | 否 | `72` | 心率，`type=bp` 时可选 |
| `glucose` | `number` | 血糖必填 | `6.1` | 血糖值，`type=bg` 时存在 |
| `tag` | `string` | 否 | `空腹` | 测量场景标签 |
| `level` | `string` | 否 | `warn` | 记录提示等级：空字符串或 `warn` |
| `tip` | `string` | 否 | `建议复测...` | 合规提示文案，不写诊断结论 |
| `note` | `string` | 否 | `饭后散步` | 用户备注 |
| `measuredAt` | `string` | 是 | `今天 07:30` | 页面展示用测量时间 |
| `memberName` | `string` | 否 | `妈妈` | 家属视角展示名称，后续家庭协同时可补充 |
| `createdAt` | `Date` | 是 |  | 创建时间 |

血压示例：

```js
{
  type: 'bp',
  source: 'cloud',
  systolic: 128,
  diastolic: 82,
  pulse: 72,
  tag: '晨起',
  level: '',
  tip: '本次记录在常见范围内，建议继续保持记录。',
  note: '',
  measuredAt: '今天 07:30',
  createdAt: db.serverDate()
}
```

血糖示例：

```js
{
  type: 'bg',
  source: 'cloud',
  glucose: 6.1,
  tag: '空腹',
  level: '',
  tip: '本次记录已保存，建议继续保持记录。',
  note: '',
  measuredAt: '今天 07:30',
  createdAt: db.serverDate()
}
```

不建议落库字段：`title`、`value`、`unit`、`status`、`details`。这些属于展示字段，应该在云函数读接口中根据原始记录生成。

### 3.2.1 `health_daily_stats` 健康记录日统计

用途：按用户和自然日预聚合健康记录数量与均值分子，首页和报告优先读取该集合，避免每次拉取原始记录统计。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 自动 |  | 数据拥有者 |
| `dayKey` | `string` | 是 | `2026-04-26` | 中国时区自然日 |
| `dayStart` | `Date` | 是 |  | 当天 00:00，便于后续范围查询 |
| `recordCount` | `number` | 是 | `3` | 当日健康记录总数 |
| `bpCount` | `number` | 是 | `2` | 当日血压记录数 |
| `bgCount` | `number` | 是 | `1` | 当日血糖记录数 |
| `bpSystolicTotal` | `number` | 是 | `260` | 当日收缩压累计值 |
| `bpDiastolicTotal` | `number` | 是 | `160` | 当日舒张压累计值 |
| `bgGlucoseTotal` | `number` | 是 | `6.2` | 当日血糖累计值 |
| `createdAt` | `Date` | 是 |  | 首次生成时间 |
| `updatedAt` | `Date` | 是 |  | 最近更新时间 |

### 3.2.2 `health_record_stats` 健康记录用户总统计

用途：按用户预聚合健康记录总量，首页展示血压/血糖累计次数时不再对 `health_records` 做 `count()`。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 自动 |  | 数据拥有者 |
| `recordCount` | `number` | 是 | `128` | 健康记录累计总数 |
| `bpCount` | `number` | 是 | `88` | 血压累计记录数 |
| `bgCount` | `number` | 是 | `40` | 血糖累计记录数 |
| `bpSystolicTotal` | `number` | 是 | `10560` | 收缩压累计值 |
| `bpDiastolicTotal` | `number` | 是 | `7040` | 舒张压累计值 |
| `bgGlucoseTotal` | `number` | 是 | `252.4` | 血糖累计值 |
| `createdAt` | `Date` | 是 |  | 首次生成时间 |
| `updatedAt` | `Date` | 是 |  | 最近更新时间 |

### 3.3 `medication_plans` 用药计划

用途：保存长期用药计划和提醒时间。一个用户可以有多条计划。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 计划创建者 |
| `name` | `string` | 是 | `二甲双胍` | 药品名称，由用户手动输入 |
| `dosage` | `string` | 否 | `1片` | 剂量说明，仅记录用户输入，不做用药建议 |
| `times` | `Array<string>` | 是 | `['08:00', '20:00']` | 每日提醒时间 |
| `subscribe` | `boolean` | 是 | `true` | 是否尝试开启微信订阅消息 |
| `startDate` | `string` | 否 | `今天` | 开始日期展示文案 |
| `status` | `string` | 是 | `启用` | 当前代码使用 `启用`，后续可改为 `active` / `paused` |
| `createdAt` | `Date` | 新增必填 |  | 创建时间 |
| `updatedAt` | `Date` | 是 |  | 更新时间 |

示例：

```js
{
  name: '二甲双胍',
  dosage: '1片',
  times: ['08:00', '20:00'],
  subscribe: true,
  startDate: '今天',
  status: '启用',
  createdAt: db.serverDate(),
  updatedAt: db.serverDate()
}
```

注意：编辑时前端传入 `id`，云端实际文档 ID 为 `_id`。云函数已按 `doc(id).update()` 更新。

### 3.4 `medication_confirmations` 用药确认记录

用途：保存每次“已服 / 稍后提醒 / 已跳过”的操作记录。该集合是行为日志，不覆盖原用药计划。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 操作者 |
| `logId` | `string` | 是 | `log-planId-0` | 前端生成的当日用药日志 ID |
| `time` | `string` | 是 | `08:00` | 本次用药时间 |
| `name` | `string` | 是 | `二甲双胍` | 药品名称快照 |
| `dosage` | `string` | 否 | `1片` | 剂量说明快照 |
| `status` | `string` | 是 | `taken` | `taken` 已服，`skipped` 已跳过，`snoozed` 稍后提醒 |
| `statusText` | `string` | 是 | `已服` | 页面展示文案 |
| `createdAt` | `Date` | 是 |  | 创建时间 |
| `actionAt` | `Date` | 是 |  | 用户操作时间 |

后续建议补充字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `planId` | `string` | 关联 `medication_plans._id`，避免只靠 `logId` 字符串解析 |
| `scheduledDate` | `string` | 例如 `2026-04-21`，便于按天统计 |

### 3.5 `family_auth` 家属授权

用途：保存数据拥有者发起的家庭邀请和默认授权范围。真实跨账号查看时，已加入的家属关系保存在 `family_members`。

目标 schema 建议保留前端真实需要的字段。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 授权发起者 |
| `ownerName` | `string` | 否 | `妈妈` | 授权发起者展示称呼，创建邀请时冗余保存，减少家属加入和家属首页回查 `profiles` |
| `member` | `Object` | 否 | 见下方 | 家属展示信息 |
| `memberName` | `string` | 否 | `女儿` | 家属名称，当前云函数家庭页会读取 |
| `inviteCode` | `string` | 否 | `KXJ123` | 邀请码，后续加入家庭时需要唯一约束 |
| `scopes` | `Array<Object>` | 是 | 见下方 | 数据查看范围 |
| `noticeRules` | `Array<Object>` | 否 | 见下方 | 家属提醒规则 |
| `activities` | `Array<Object>` | 否 | 见下方 | 授权活动日志 |
| `status` | `string` | 否 | `active` | `pending` / `active` / `revoked` |
| `createdAt` | `Date` | 新增必填 |  | 创建时间 |
| `updatedAt` | `Date` | 是 |  | 更新时间 |

`member` 子结构：

```js
{
  name: '女儿',
  role: '家属',
  phone: '',
  avatarText: '女'
}
```

`scopes` 子结构：

```js
[
  { key: 'bloodPressure', title: '血压记录', enabled: true },
  { key: 'bloodGlucose', title: '血糖记录', enabled: true },
  { key: 'medicine', title: '用药确认', enabled: true },
  { key: 'report', title: '健康记录周报', enabled: true }
]
```

`noticeRules` 子结构：

```js
[
  { key: 'missedMedicine', title: '用药未确认提醒', enabled: true },
  { key: 'missingRecord', title: '连续未记录提醒', enabled: false },
  { key: 'weeklyReport', title: '周报生成提醒', enabled: true }
]
```

当前状态：云函数 `updateFamilyAuth()` 已完整保存 `member / scopes / noticeRules / activities`，并从 `member.name` 派生 `memberName` 供家庭列表展示；`createFamilyInvite()` 会保存 `ownerName`，供 `getFamilyJoinData()` 和 `joinFamilyByInvite()` 优先复用。

### 3.6 `family_members` 家庭成员关系

用途：保存“数据拥有者”和“家属账号”之间的真实绑定关系。家属账号进入家属首页时，必须先通过当前 openid 查询本集合，拿到被授权人的 `ownerOpenId` 和 `scopes` 后，才能读取被授权人的健康记录。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_member` | 加入家庭的家属账号 openid，云开发自动写入 |
| `ownerOpenId` | `string` | 是 | `o_owner` | 数据拥有者 openid |
| `memberOpenId` | `string` | 是 | `o_member` | 家属账号 openid，显式保存便于查询 |
| `ownerName` | `string` | 否 | `妈妈` | 数据拥有者展示称呼 |
| `member` | `Object` | 否 | 见 `family_auth.member` | 家属展示信息 |
| `memberName` | `string` | 否 | `女儿` | 家属名称 |
| `inviteCode` | `string` | 是 | `KXJABCD12345` | 加入时使用的邀请码 |
| `scopes` | `Array<Object>` | 是 | 见 `family_auth.scopes` | 当前家属可查看范围 |
| `noticeRules` | `Array<Object>` | 否 | 见 `family_auth.noticeRules` | 家属提醒规则 |
| `status` | `string` | 是 | `active` | `active` / `revoked` |
| `joinedAt` | `Date` | 是 |  | 加入时间 |
| `createdAt` | `Date` | 新增必填 |  | 创建时间 |
| `updatedAt` | `Date` | 是 |  | 更新时间 |

当前状态：云函数 `joinFamilyByInvite()` 会根据 `family_auth.inviteCode` 创建或更新 `family_members`，并同步保存 `ownerName`。`getHomeFamilyData()` 已改为优先按 `family_members.memberOpenId === 当前 openid` 查询关系，再按 `ownerOpenId` 和 `scopes` 读取被授权人的记录、用药和周报摘要。

### 3.7 `reminder_settings` 提醒设置

用途：保存提醒开关、提醒时间计划、订阅消息状态和免打扰状态。一个 `_openid` 理论上只保留一条设置。

目标 schema 建议与当前提醒设置页面提交结构一致。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 设置归属 |
| `subscription` | `Object` | 否 | `{ status: '未全部开启' }` | 订阅消息状态展示 |
| `reminders` | `Array<Object>` | 是 | 见下方 | 提醒开关列表 |
| `timePlans` | `Array<Object>` | 否 | 见下方 | 提醒时间计划 |
| `quietMode` | `boolean` | 否 | `true` | 夜间免打扰开关 |
| `createdAt` | `Date` | 新增必填 |  | 创建时间 |
| `updatedAt` | `Date` | 是 |  | 更新时间 |

`reminders` 子结构：

```js
[
  { key: 'medicine', title: '用药提醒', enabled: true, time: '08:00' },
  { key: 'measure', title: '测量提醒', enabled: true, time: '09:00' },
  { key: 'weeklyReport', title: '周报提醒', enabled: true, day: 'Monday', time: '10:00' }
]
```

当前状态：云函数 `saveReminderSettings()` 已完整保存 `subscription / reminders / timePlans / quietMode`。

### 3.8 `privacy_settings` 隐私授权设置

用途：保存隐私授权开关、管理入口和授权日志。一个 `_openid` 理论上只保留一条设置。

当前已对齐，不保留旧版 `settings` 字段。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 设置归属 |
| `permissions` | `Array<Object>` | 是 | 见下方 | 授权项目列表 |
| `links` | `Array<Object>` | 是 | 见下方 | 管理入口列表 |
| `logs` | `Array<Object>` | 是 | 见下方 | 最近授权日志 |
| `createdAt` | `Date` | 新增必填 |  | 创建时间 |
| `updatedAt` | `Date` | 是 |  | 更新时间 |

`permissions` 子结构：

```js
[
  {
    key: 'healthData',
    title: '健康记录处理',
    meta: '用于血压、血糖、用药记录、趋势和周报。',
    enabled: true,
    locked: false
  }
]
```

`links` 子结构：

```js
[
  {
    label: '查看隐私政策',
    meta: '处理目的、信息范围和用户权利',
    route: 'privacyPolicy'
  }
]
```

`logs` 子结构：

```js
[
  {
    id: 'log-privacy',
    title: '同意隐私政策',
    time: '最近',
    meta: '基础授权'
  }
]
```

注意：`permissions` 是唯一授权开关字段，不再写入 `settings`。

### 3.9 `feedbacks` 意见反馈

用途：保存用户提交的问题反馈和联系方式。

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `_openid` | `string` | 是 | `o_xxx` | 提交用户 |
| `type` | `string` | 是 | `bug` | 反馈类型 |
| `content` | `string` | 是 | `页面无法保存` | 反馈内容 |
| `contact` | `string` | 否 | `微信号或手机号` | 联系方式，用户自愿填写 |
| `createdAt` | `Date` | 是 |  | 提交时间 |

后续后台处理可选字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `string` | `pending` / `processing` / `closed` |
| `reply` | `string` | 管理员回复 |
| `handledAt` | `Date` | 处理时间 |

## 4. 建议索引

微信云数据库可以先不建复杂索引，小数据量阶段默认索引可跑通。进入真实试点后，建议按下表补索引。

| 集合 | 索引字段 | 排序 | 用途 |
|---|---|---|---|
| `profiles` | `_openid` | 升序 | 查当前用户档案 |
| `health_records` | `_openid, createdAt` | `_openid` 升序，`createdAt` 降序 | 首页最新记录、历史记录 |
| `health_records` | `_openid, type, createdAt` | `_openid` 升序，`type` 升序，`createdAt` 降序 | 血压/血糖筛选、趋势统计 |
| `health_daily_stats` | `_openid, dayKey` | `_openid` 升序，`dayKey` 降序 | 首页今日统计、近 30 天报告统计 |
| `health_record_stats` | `_openid` | 升序 | 首页血压/血糖累计次数 |
| `medication_plans` | `_openid, updatedAt` | `_openid` 升序，`updatedAt` 降序 | 用药计划列表 |
| `medication_confirmations` | `_openid, actionAt` | `_openid` 升序，`actionAt` 降序 | 最近确认状态 |
| `family_auth` | `_openid` | 升序 | 当前用户授权设置 |
| `family_auth` | `inviteCode` | 升序 | 加入家庭时查询邀请码，后续应保证唯一 |
| `family_members` | `memberOpenId, status, updatedAt` | `memberOpenId` 升序，`status` 升序，`updatedAt` 降序 | 家属账号查可查看家庭 |
| `family_members` | `ownerOpenId, status, updatedAt` | `ownerOpenId` 升序，`status` 升序，`updatedAt` 降序 | 数据拥有者查看已绑定家属 |
| `family_members` | `ownerOpenId, memberOpenId` | 均升序 | 防止同一对账号重复绑定 |
| `reminder_settings` | `_openid` | 升序 | 当前用户提醒设置 |
| `privacy_settings` | `_openid` | 升序 | 当前用户隐私授权设置 |
| `feedbacks` | `_openid, createdAt` | `_openid` 升序，`createdAt` 降序 | 用户反馈历史或数据管理统计 |

## 5. 权限与安全规则建议

健康记录、用药计划、家属授权和隐私授权都属于敏感个人信息。建议生产环境不要让小程序端直接读写数据库，统一通过云函数访问。

### 5.1 数据库权限

推荐策略：

| 阶段 | 数据库权限 | 说明 |
|---|---|---|
| 本地开发 | 仅创建者可读写 | 便于开发者工具调试 |
| 试点和上线 | 所有用户不可读写，仅云函数可读写 | 敏感数据统一走云函数鉴权和字段过滤 |

### 5.2 云函数鉴权规则

所有读写函数必须遵守：

1. 用户私有数据查询必须带 `_openid: openId`。
2. 更新和删除必须确认文档属于当前 `_openid`。
3. 家属查看他人数据必须先校验 `family_members` 绑定关系和授权范围，不能直接读取全量记录。
4. 返回给页面的数据只包含展示所需字段，不返回内部权限字段或无关敏感字段。

当前需要重点复查的云函数逻辑：

| 位置 | 当前风险 | 建议 |
|---|---|---|
| `getHomeFamilyData()` | 已按 `family_members.memberOpenId` 查询家属关系，再按 `ownerOpenId` 和授权范围读取 | 继续保持所有跨账号读取都先校验关系 |
| `saveMedicationPlan(id)` | 已更新前校验 `_openid` 归属 | 继续保留归属校验 |
| `deleteMedicationPlan(planId)` | 已删除前校验 `_openid` 归属 | 继续保留归属校验 |
| `deleteRecord(recordId)` | 已删除前校验 `_openid` 归属 | 继续保留归属校验 |

## 6. 本地缓存到云数据库的字段映射

| 本地缓存 key | 云集合 | 迁移方式 | 注意事项 |
|---|---|---|---|
| `user_profile_v1` | `profiles` | 调用 `saveProfile` | 云函数已归一化 `profile.name`、`profile.role` |
| `health_records_v1` | `health_records` | 按 `type` 分别调用 `saveBloodPressureRecord` / `saveBloodGlucoseRecord` | 本地展示字段不直接落库，需要还原数值字段 |
| `medication_plans_v1` | `medication_plans` | 调用 `saveMedicationPlan` | 本地 `id` 对应云端 `_id`，迁移后需要保存映射 |
| `medication_confirmations_v1` | `medication_confirmations` | 调用 `confirmMedication` | 建议补 `planId` 后再批量迁移 |
| `family_auth_v1` | `family_auth` | 调用 `updateFamilyAuth` | 云函数已支持 `member / noticeRules / activities` |
| 暂无本地缓存 | `family_members` | 调用 `joinFamilyByInvite` | 云端关系表，不建议从本地缓存直接迁移 |
| `reminder_settings_v1` | `reminder_settings` | 调用 `saveReminderSettings` | 云函数已支持 `subscription / timePlans / quietMode` |
| `privacy_settings_v1` | `privacy_settings` | 调用 `updatePrivacySettings` | 当前已对齐 `permissions / links / logs` |
| `feedbacks_v1` | `feedbacks` | 调用 `submitFeedback` | 可按用户确认后迁移，避免重复提交历史反馈 |

## 7. 切云前字段对齐清单

| 项目 | 状态 | 需要处理 |
|---|---|---|
| 隐私设置 `permissions / links / logs` | 已对齐 | 无需兼容旧字段 |
| 健康记录写入 | 基本对齐 | 建议补 `measuredAtTs`，读接口继续生成展示字段 |
| 用药计划写入 | 已对齐 | 更新/删除前已增加 `_openid` 所属校验 |
| 用药确认写入 | 基本对齐 | 建议补 `planId`、`scheduledDate` |
| 基础资料写入 | 已对齐 | 云函数已归一化嵌套 `profile` |
| 家属授权写入 | 已对齐 | 云函数已支持 `member / noticeRules / activities` |
| 家庭成员关系 | 已新增 | 使用 `family_members` 保存 `ownerOpenId / memberOpenId / scopes` |
| 提醒设置写入 | 已对齐 | 云函数已保存 `subscription / timePlans / quietMode` |
| 家属首页读取 | 已对齐 | 当前按 `family_members` 关系读取被授权人的数据 |
| 静态协议类读 key | 已对齐 | `privacy`、`privacyPolicy`、`userAgreement` 等由 `static-pages.js` 提供，后续可按需迁入配置集合 |
| 数据权利闭环 | 已对齐 | `exportUserData`、`deleteUserData`、`clearUserAccount` 已接入云函数和数据管理页 |

## 8. 云函数参数校验

当前云函数已对核心写接口做基础校验，避免明显异常数据进入云数据库。

| action | 校验内容 | 失败提示示例 |
|---|---|---|
| `saveBloodPressureRecord` | 收缩压 60-260、舒张压 40-160、收缩压大于舒张压、心率 30-220 | `收缩压范围应为 60-260` |
| `saveBloodGlucoseRecord` | 血糖值 1.0-33.3，限制场景、提示和备注长度 | `血糖值范围应为 1-33.3` |
| `saveMedicationPlan` | 药品名称必填且不超过 50 字、至少一个提醒时间、时间格式为 `HH:mm`、最多 8 个提醒时间 | `请至少选择一个提醒时间` |
| `confirmMedication` | `logId / time / name` 必填，状态只允许 `taken / skipped / snoozed` | `用药确认状态不合法` |
| `createFamilyInvite` | 至少选择一个授权范围 | `请至少选择一个授权范围` |
| `joinFamilyByInvite` | 邀请码必填、未过期、未被其他家属使用、不能加入自己的邀请 | `邀请已被其他家属使用` |

这些校验只做记录工具的格式和范围保护，不构成诊疗判断。

## 9. 云开发切换步骤

1. 在微信开发者工具中开通云开发。
2. 创建集合：`profiles`、`health_records`、`health_daily_stats`、`health_record_stats`、`medication_plans`、`medication_confirmations`、`family_auth`、`family_members`、`reminder_settings`、`privacy_settings`、`feedbacks`。
3. 按本文档补齐必要索引。
4. 复查云函数字段是否仍与本文档 schema 保持一致。
5. 部署 `cloudfunctions/healthApi`。
6. 把 [utils/api-config.js](D:/CursorWorkspace/xiaochengxu/utils/api-config.js) 的 `dataSource` 改为 `cloud`。
7. 在微信开发者工具逐页验证：基础资料、血压、血糖、用药计划、用药确认、提醒设置、隐私授权、家属授权、反馈。
8. 确认云数据库中每个集合只出现本文档字段，不出现本地展示字段或旧字段。

## 10. 合规字段口径

禁止将以下内容作为自动结论落库：

- `diagnosis` / `诊断`
- `treatment` / `治疗方案`
- `prescription` / `处方`
- `doseDecision` / `补服建议`
- `emergencyDecision` / `急救判断`

允许落库的合规提示字段：

- `level: 'warn'`
- `tip: '建议复测；如持续偏离个人日常水平，请咨询医生。'`
- `statusText: '已服' / '已跳过' / '稍后提醒'`

所有 `tip` 文案应保持记录和提醒口径，不替代医生诊断、治疗或用药决策。
