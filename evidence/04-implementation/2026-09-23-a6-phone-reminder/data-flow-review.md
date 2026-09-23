# A6 数据流审查：电话提醒

契约来源：decisions.md #4（电话提醒替代订阅推送）、#12（展示口径）、4.3（新 A6' 清单）；用户已确认语义：read=false+remind=true 只出电话按钮。

## 1. 号码存储与归属

- 存放：`family_auth` 单文档（owner `_openid`）`contactPhone` 字段——电话属 **owner 的家庭授权配置**，一位 owner 一个号码；不按成员分行（家属看到的是同一个联系号码）。
- 纯电话文档守卫：owner 未发过邀请时 `setFamilyContactPhone` 会创建仅含 contactPhone 的文档（无 inviteCode/memberOpenId/status）；`getFamilyData` 新增守卫 `(!auth.inviteCode && !auth.memberOpenId)` → 不据此生成邀请预览卡；`classifyInviteAuth` 仅按 inviteCode 查询命中，纯电话文档永不进入邀请判定。
- 校验：`normalizeContactPhone`（family-policy 单点）——`undefined/null`→null（未提供，不改动既有）；`''`→清空；`/^1[3-9]\d{9}$/`→原样；其余拒绝。**错误文案固定，不回显输入号码**。

## 2. 写路径（先校验后写入，失败零写入）

| 路由 | 鉴权 | 行为 |
|---|---|---|
| `setFamilyContactPhone`（action，owner） | openId 即文档主人 | upsert family_auth.contactPhone；响应 `{updated:true, contactPhoneMasked}` **不回显完整号** |
| `createFamilyInvite` 携带 contactPhone（可选） | owner | 归一化在**任何写库前**执行（非法→抛错，既有文档零变化，含邀请码）；未提供时不覆盖既有号码 |

成员（B）调用 setFamilyContactPhone 只会写 B 自己的 family_auth 文档；取号接口读的是 **owner 文档**（`writer.ownerOpenId`）→ member 无法污染所拨号码（测试固化）。

## 3. 读路径

| 接口 | 主体 | 回传 |
|---|---|---|
| `getFamilyAuthData`（key，owner 授权页） | owner | `contactPhone`（完整，本人编辑用）+ `contactPhoneMasked` |
| `getHomeFamilyData`（key，家属首页） | member | `phoneReminder{remindAllowed, configured, canCall, masked}` + `readPermissions{4块}`；**remind=false 时 masked=''、configured=false，脱敏号也不回传**；完整号永不出现（测试断言响应 JSON 不含） |
| `familyGetReminderPhone`（**action**，拨号时按需） | member | active 关系（复用 A4 resolveMemberWriter）→ `canCallReminderPhone`（任一 scope.remind=true）→ owner 文档有号 → `{phone, masked}` 仅此一次；拒绝态 `{phoneDenied:{allowed:false, reason}}`，reason ∈ noBinding / revoked / notMember / remindDenied / notConfigured |

action 路由不经 `requestCloudByKey` 读缓存（A5 口径）→ **完整号码不进云读缓存**；前端拿到后仅用于本次 `wx.makePhoneCall`，不 setData、不写 storage（测试断言 data/storage JSON 不含完整号）→ 不进长期本地缓存。

## 4. read=false + remind=true（电话-only 模式）

- homeFamily：`readPermissions` 全 false、latestMetrics/medicineLogs 空、writePermissions 全 false（write 依赖 read）、`phoneReminder.canCall=true`；
- 页面：快捷查看/最新记录/今日用药/本周周报/今日关注各 section 按 readPermissions 门控（wxml wx:if），电话提醒 section 按 remindAllowed 渲染 → 只剩电话入口；
- 二级页：trend/recordList/recordDetail/medList/medHistory 维持 A3 scopeDenied（read 闸口与 remind 无关）——不显示健康数据和提醒明细。

## 5. 前端交互（不假设已拨出、不本地假成功）

- home-family `handleCallReminder`：canCall 守卫 → 取号 → 被拒按 reason 映射文案 toast + `phoneError`；成功 → `wx.makePhoneCall`，其 `fail` 回调显式提示"拨号未接通，请重试或手动拨打"；不预先弹"已拨出"。
- family-auth（owner）：回显完整号供编辑；保存前客户端预检格式（云端仍独立校验）；清空=提交 `''`；以云端响应为准。
- family-invite：电话可选；填写则必须勾选授权说明（未勾选拦截生成）；contactPhone 参与草稿脏检查（生成后改号→draftDirty，须重新生成）；不填不提交该字段（保留既有号码）。

## 6. 日志与隐私纪律

- 服务端：错误文案固定不含号码；withPerfLog 仅静态 step 名；无任何 console 输出号码。
- 客户端：无 console 输出号码；完整号码不落 data/storage/缓存。
- 条款：static-pages 隐私政策（敏感个人信息 + 家庭成员共享）与用户协议（家庭共享规则）各补电话用途条款（脱敏展示、拨号按需获取、系统拨号盘显示完整号属平台行为、可修改/清空、撤销后立即不可获取）。

## 7. 明确不做（本批固定）

- 不实现 `wx.getPhoneNumber`（个人主体不可用）；
- 不新增订阅消息、不修改 `sendDueReminders`（独立云函数零改动；测试扫描 `cloudfunctions/sendDueReminders/index.js` 固定契约：不得出现 familyMembers/memberOpenId）；
- remind 不参与写权限判断（A4 口径不变）。

## 8. 边界

本地测试通过 ≠ 云端验证通过：`wx.makePhoneCall` 真机拨号行为、云函数部署后 setFamilyContactPhone/familyGetReminderPhone 真实响应、真机脱敏展示，均列入部署后双手机验证与人工截图清单（screenshot-list.md）。
