## 任务：P0-1 云函数身份验证 + 数据加密

- 级别：P0
- 影响范围：`cloudfunctions/healthApi/*`、`services/core.js`、`services/records.js`、`services/family.js`、`services/medication.js`、`services/data-rights.js`
- 功能点：
  1. 云函数所有写操作通过 `getWXContext()` 获取 openid 并校验数据归属
  2. 本地存储敏感数据（records、familyAuth）写入前做简单混淆
  3. 邀请码生成改用随机算法，增加有效期校验
- 技术难点：
  1. 云函数代码未纳入版本控制，需先获取并审查现有逻辑
  2. 本地数据混淆需兼容现有已存储的明文数据，需做迁移兼容
  3. 邀请码有效期需在邀请创建时嵌入时间戳，加入时校验
- 验收标准：
  1. 云函数写操作（saveBloodPressureRecord、saveBloodGlucoseRecord、confirmMedication、createFamilyInvite、joinFamilyByInvite、updateFamilyAuth、revokeFamilyMember、saveProfile、saveReminderSettings、updatePrivacySettings、submitFeedback、deleteRecord、exportUserData、deleteUserData、clearUserAccount）均校验 openid
  2. 未授权请求返回 `{ errMsg: 'unauthorized' }` 错误码
  3. 本地存储的 records 和 familyAuth 数据为混淆格式，读取时自动解混淆
  4. 已存在的明文数据能正常读取（向后兼容）
  5. 邀请码为16位随机字符串，24小时有效期
  6. 过期邀请码加入时返回友好提示
- 回归风险：
  - 云函数身份验证可能影响本地开发模式（dataSource=local）
  - 数据混淆可能导致旧版本小程序无法读取新格式数据
  - 邀请码格式变更导致已有邀请码失效
- 关联任务：P2-4 家庭权限粒度细化（依赖本任务的身份验证基础）
