# A4-0 身份与归属最小实验记录（2026-09-23）

环境：`kangxiaoji-d5gw2k203f0488a9e`；CloudBase CLI 3.8.4 只读/探针调用；探针数据均可精确识别并已删除。

## 1. 实验项与结论

| # | 实验项 | 方法 | 结论 |
|---|---|---|---|
| 1 | B 通过真实微信调用云函数 | 验收期（用户操作手机 B）已完成 join/homeFamily/trend 等真实调用；本轮 CLI 日志窗口为空（`tcb fn log` 返回 No invocation logs），无法取回事件体 | **行为级确认**：B 的多次真实调用返回了 B 视角数据（验收截图/反馈佐证）；日志级复核待下次真实调用后立即取样 |
| 2 | 平台自动写入 `_openid` 观察 | 探针 INSERT 两条可删除文档（feedbacks，content=A4-PROBE-DELETE-ME）：一条显式 `_openid="probe-owner-A"`、一条不写 | 显式值**原样保留**；不写则 `_openid=null` —— **服务端写入不自动注入、不覆盖** _openid |
| 3 | `event.userInfo.openId` 稳定性 | 验收期 family_members 行 memberOpenId（由 join 时 event.userInfo.openId 写入）与 B 后续读请求的主体一致（owner≠member，status=active，掩码比对 ovjd…AU / ovjd…9E） | 行为级稳定；日志级复核待取样 |
| 4 | 代录数据归属 owner A | 设计：业务字段 `ownerOpenId=A` + `createdByMemberOpenId=B` + `createdByRole='member'`；同时显式写 `_openid=ownerOpenId`（探针证明服务端显式写入保留），owner 既有查询（按 _openid）零改造即可见代录记录 | 采用 |
| 5 | 若自动 _openid 只能写 B | 不适用：服务端可显式写任意 _openid（探针证明）；仍按 decisions 4.5 以 ownerOpenId 为归属权威字段，_openid 与其同值 | 采用 |
| 6 | 无法确认则停止 | 未触发：归属机制不依赖未确认项；真实微信侧 _openid 覆盖行为（理论上服务端不覆盖）列入云端待验证（阶段 6 真机代录后由 A 侧查询佐证） | 继续 |

探针清理：`delete feedbacks where content=A4-PROBE-DELETE-ME` → n=2，集合恢复。

## 2. 日志与脱敏

- 本记录与后续证据不输出完整 openId/手机号/邀请码/健康数据；掩码格式 `前4…后2`；
- 探针文档 content 为纯标记串，不含业务数据。

## 3. 对实现的约束（已落实）

- 写路由忽略客户端 `ownerOpenId / createdByMemberOpenId / _openid / memberId`（不入参，测试固化）；
- 先鉴权（resolveMemberWriter：active 关系）→ 再校验（canPerformScopeAction + payload 校验）→ 最后写库；失败零写入；
- 代确认 upsert 复用现有 logId+confirmDate 机制（不发明新字段）；他人（owner 或其他 member）创建的确认禁止代确认覆盖（foreignRecord）；
- 撤销代确认仅本人本次（createdByMemberOpenId=当前成员 + 当日），重复撤销明确 notFound。
