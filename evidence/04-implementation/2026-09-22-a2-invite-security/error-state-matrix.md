# A2 错误码与页面状态矩阵

- 契约单点定义：`cloudfunctions/healthApi/family-policy.js`（FAMILY_INVITE_ERRORS）
- 页面消费：`pages/family-sub/family-join/index.js` INVITE_ERROR_TITLES（字面量码，小程序包不引用云端目录）
- 传输：查询（key familyJoin）经返回体 `inviteError:{code,message}`；动作（joinFamilyByInvite）经 main 错误出口 `{errMsg, errCode}` → `services/core.js buildCloudError` 附着 `error.code`

| # | 触发条件 | code | 查询页状态（wxml 分支） | 动作（join）行为 | 计频控 | 截图 |
|---|---|---|---|---|---|---|
| 1 | 加载中 | — | `isLoading` 面板"正在加载加入信息" | — | 否 | A2-S01 |
| 2 | 有效 pending 邀请 | 无 inviteError | 正常预览（标题/剩余小时/可加入范围/身份） | 成功 → active → 跳家属首页 | 否 | A2-S02 |
| 3 | 格式非 `KXJ[0-9A-Z]{9}` | FAMILY_INVITE_INVALID | "邀请码无效" + 文案 | 抛错（toast + 刷新为错误态） | **是** | A2-S03 |
| 4 | 格式正确但不存在 | FAMILY_INVITE_NOT_FOUND | "邀请不存在" | 抛错 | **是** | A2-S03（同态展示）|
| 5 | expiresAt 缺失（#15 一律无效） | FAMILY_INVITE_INVALID | "邀请码无效" | 抛错 | **是** | 待测试环境触发（现网新码必带 expiresAt）|
| 6 | 已过 expiresAt | FAMILY_INVITE_EXPIRED | "邀请已过期" | 抛错 | **是** | A2-S04 |
| 7 | status=revoked | FAMILY_INVITE_REVOKED | "邀请已撤销" | 抛错 | **是** | A2-S05 |
| 8 | status=active 且 memberOpenId=他人 | FAMILY_INVITE_USED | "邀请已被使用" | 抛错 | **是** | A2-S06 |
| 9 | 当日失败 ≥20（北京日界） | FAMILY_INVITE_RATE_LIMITED | "尝试过于频繁" | 抛错（防绕过查询口直接刷 join） | 拒绝不计数 | A2-S07 |
| 10 | 加入自己创建的邀请 | FAMILY_INVITE_SELF | （查询态不判 self，预览可看）| 抛错 | 否 | 不在清单 |
| 11 | 已绑定另一位老人（A1） | FAMILY_MEMBER_BOUND | （查询态不判 bound） | 抛错 | 否 | 不在清单 |
| 12 | 网络失败 / 云函数异常 | —（loadError） | "加入信息加载失败" + 重新加载按钮 | toast err.message | 否 | 不在清单（既有能力）|

补充口径：

- 频控计数键 = 调用者 openId + 北京自然日（`getTodayDateValue()`）；attempts 文档字段仅 `openId/day/reason/createdAt`，**无邀请码明文**；TTL 24h 索引属控制台部署条件。
- 判定顺序：频控 → 格式 → 存在性 → expiresAt 缺失 → revoked → used → expired。
- 所有失败路径：family_members 零写入、family_auth 不会变 active（测试固化）。
- 页面对 inviteError 态禁止提交"加入家庭"（joinFamily 守卫 + 按钮仍受 agreed 约束）。
