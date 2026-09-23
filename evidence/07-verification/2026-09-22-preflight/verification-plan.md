# 部署后可执行验证清单（本轮一律不执行；写入型均标注环境/数据范围/预期/清理）

约定：目标环境 = `kangxiaoji-d5gw2k203f0488a9e`（待 user-confirmations §1 确认）；所有写入型验证只用 `smoke-*` 前缀的测试 openId 或专用测试账号，不触碰真实用户数据；每项验证后执行对应清理。

## 1. CLI 冒烟（只证明"部署版本与接口行为"，不证明微信真实身份注入）

| # | 操作 | 预期 | 数据影响与清理 |
|---|---|---|---|
| 1.1 | `tcb fn invoke healthApi --params '{"key":"familyJoin","payload":{},"userInfo":{"openId":"smoke-preflight"}}'` | 返回 `noInvite:true`、remainHours=0、scopes=[]（收尾版判别特征） | 零写入，无需清理 |
| 1.2 | 同上，payload `{"inviteCode":"KXJ000000000"}`（格式合法不存在） | `inviteError.code=FAMILY_INVITE_NOT_FOUND` | 写 1 条计数文档 `invite-fail-smoke-preflight-<北京日>`；清理：`tcb db nosql execute` DELETE `{"delete":"family_invite_attempts","deletes":[{"q":{"openId":"smoke-preflight"},"limit":0}]}` |
| 1.3 | 同上，payload `{"inviteCode":"abc"}` | `FAMILY_INVITE_INVALID` | 同 1.2 清理 |
| 1.4 | 连发 1.2 共 20 次后再发 1 次 | 第 21 次 `FAMILY_INVITE_RATE_LIMITED`，计数文档 count 停在 20 | 同 1.2 清理 |
| 1.5 | `{"key":"familyJoin","payload":{"inviteCode":123},...}` | INVALID（非字符串不冒充缺码） | 同 1.2 清理 |
| 1.6 | 有效 pending 码查询（用测试账号 A 在部署后新生成的码，避免用历史 13 条） | 无 inviteError、remainHours≥1、scopes 仅 read 项；计数文档 count=0（预留后退还） | 邀请文档保留或按 §3 数据范围处理 |

## 2. 开发者工具/真机 · 真实账号链路（验证微信身份注入 P0-1 + 全链路）

前置：user-confirmations §1/§4 已确认；按 screenshot-manual §0 选定联调方式。

| # | 操作（账号） | 预期 | 数据范围与清理 |
|---|---|---|---|
| 2.1 | 账号 A 打开家庭页→（Tab 未开放：编译模式直达 `pages/family-sub/family-invite/index`）生成邀请 | 邀请码 KXJ+9 位；预览按 read 项 | 写 family_auth（A 的单文档）；验证后 A 重邀或保留 |
| 2.2 | 账号 B 经分享路径/编译参数进入 join 页并加入 | 加入成功→家属首页按授权展示；云函数日志确认 `event.userInfo.openId` 注入为 B 的真实 openId（**P0-1 核验点**，日志不回显完整 openId，比对前缀/长度） | 写 family_members 锚点行 `active-<B>`；清理：A 撤销 B（走 2.4）或 DELETE 该行 |
| 2.3 | A 对 B 改权（关血糖 read）→ B 刷新家属首页 | 血糖明细从**响应**中消失（Network 面板确认非页面隐藏） | 更新 B 关系行；清理：改回或撤销 |
| 2.4 | A 撤销 B → B 刷新家属首页/再进入 join | B 得到未授权空态；同码再查为 REVOKED | 关系行置 revoked；清理：保留（revoked 行不影响 1:1 重加入）或 DELETE |
| 2.5 | B 注销账号（设置-数据管理-清空账号，测试账号） | 仅 B 的关系行被删；A 的数据与邀请不受影响 | 删 B 全部数据；**B 账号不可恢复，仅用一次性测试号** |

## 3. 并发验证（本地 Mock 不能证明的部分；需在目标环境实测）

| # | 场景 | 构造方式 | 预期 | 数据范围与清理 |
|---|---|---|---|---|
| 3.1 | 同账号额度竞争 | 脚本并发 25 个 `familyJoin` 无效码查询（同一 `smoke-conc` openId，`Promise.all` 经 tcb fn invoke 或云函数 URL 化调用） | 计数文档 count 恰为 20；恰 5 个响应 RATE_LIMITED；**无第 21 条失败被记录** | 清理：DELETE `openId=smoke-conc` 计数文档 |
| 3.2 | 同码争抢 | 账号 B、C 同时对同一有效码发起 join（两台真机同时点击，或 CLI 并发 invoke 伪造两个 openId） | 恰 1 人 active；另 1 人 `FAMILY_INVITE_USED`；family_auth.memberOpenId 为成功者；观察云函数日志中事务冲突重试（如有） | 清理：撤销成功者 |
| 3.3 | 同成员并发加入两个家庭 | B 同时对 A、A2 两个 owner 的有效码并发 join | 恰 1 个家庭 active（锚点事务锁）；另 1 个 `FAMILY_MEMBER_BOUND`；family_members 中 B 的 active 行恰 1 条 | 清理：撤销 B |
| 3.4 | 重邀/加入交错 | A 生成码后，B 发起 join 的同时 A 重邀（人工时序或脚本并发） | B 要么按旧码成功（重邀发生在事务重读之后）、要么 NOT_FOUND（重读前被换码）；**不得出现 B 绑定到新码文档**；新邀请保持 pending | 清理：撤销 B（若成功） |

## 4. 异常验证

| # | 场景 | 构造方式 | 预期 | 清理 |
|---|---|---|---|---|
| 4.1 | add 重复键真实报文 | CLI 直接向 family_invite_attempts INSERT 同 _id 文档两次（`smoke-dup` 键） | 第二次报错；**记录完整错误报文**，核对是否匹配 `/E11000|duplicate key/i` 签名；不匹配则按 sdk-contract-check §3 修订签名（fail-closed 方向不变） | DELETE smoke-dup 文档 |
| 4.2 | 额度退还 | 计数 19 后一次成功查询（有效码） | count 回到 19（退还生效） | DELETE 计数文档 |
| 4.3 | 事务失败不留脏数据 | 3.2/3.3 执行后检查 family_members/family_auth | 失败方零写入；无 status 与 memberOpenId 不一致的文档 | 无需（只读核对） |
| 4.4 | TTL 生效 | 4.1/1.2 产生的文档放置 24h+ 后查询 | 文档被 TTL 清除（或标记删除） | 无需 |

> 3.x/4.x 的并发结果如与预期不符：**不回改代码猜测原因**，保留现场（RequestId、日志、文档快照）后按批次流程复现定位。
