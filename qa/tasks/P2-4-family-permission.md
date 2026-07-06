## 任务：P2-4 家庭权限粒度细化

- 级别：P2
- 影响范围：`services/family.js`、`pages/family-sub/family-invite/index.js`、`pages/family-sub/family-auth/index.js`
- 功能点：
  1. 扩展家庭关系类型：增加"孙女/孙子""兄弟姐妹""护工"等
  2. 邀请码增加有效期管理（24小时过期）
  3. 将 scopes 从 `enabled/disabled` 扩展为 `{read, write, remind}` 三级权限
  4. 权限校验：家属页仅展示有 read 权限的数据，代为记录需 write 权限
- 技术难点：
  1. 三级权限需在所有数据读取和写入点增加校验，改动面广
  2. 已有邀请码无有效期字段，需兼容处理
  3. 权限变更需实时生效，缓存需及时失效
- 验收标准：
  1. `relationMap` 包含至少 7 种关系类型
  2. 邀请码创建时记录 `expiresAt`，加入时校验有效期
  3. scopes 数据结构支持 `{ key, title, read, write, remind }` 格式
  4. 家属页仅展示有 read 权限的数据
  5. 代为记录操作需 write 权限，无权限时按钮禁用
  6. 已有邀请码（无 expiresAt）视为永不过期
- 回归风险：
  - 权限粒度细化可能导致现有家属看到的数据减少
  - 邀请码有效期校验可能影响正在进行中的邀请流程
  - 旧版 scopes 数据（仅 enabled/disabled）需兼容处理
- 关联任务：P0-1 云函数身份验证（权限校验依赖身份验证基础）
