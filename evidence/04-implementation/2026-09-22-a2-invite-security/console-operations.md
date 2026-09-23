# CloudBase 控制台事项执行记录（A2 部署前置条件 · 已完成）

- 执行日期：2026-09-22（15:00–15:20，UTC+8）
- 环境：`kangxiaoji-d5gw2k203f0488a9e`（个人版，Normal，账号下唯一环境，与 cloudbaserc.json 一致）
- 通道：用户授权 `tcb login`（浏览器设备码 QGRE-9QP9，登录成功）→ CloudBase CLI 3.8.4（npx 临时运行，未全局安装）
- 代理说明：本机 npm 用户级 .npmrc 配置了已停用的代理 127.0.0.1:7897，本轮全部命令经临时干净 npmrc（NPM_CONFIG_USERCONFIG）绕过，**未修改用户 ~/.npmrc**
- 注：`tcb permission` 命令族在 CLI 3.8.4 已退役（转向网关 OPA 策略），数据库 ACL 经 `tcb api tcb DescribeDatabaseACL / ModifyDatabaseACL` 完成；集合/索引经 `tcb db nosql execute`（MgoCommandParam COMMAND 通道）

## 1. 创建集合 family_invite_attempts ✅

- 命令：`{"create":"family_invite_attempts"}` → ok:1.0
- 验证：listIndexes 返回 `_id_` 与新建 TTL 索引（见 2），集合存在。

## 2. createdAt TTL 索引（24h）✅

- 命令：`createIndexes` → `{key:{createdAt:1}, name:"createdAt_ttl", expireAfterSeconds:86400}`
- 验证（listIndexes 实际返回）：

```json
{"name":"createdAt_ttl","key":{"createdAt":1},"expireAfterSeconds":86400}
```

- 口径说明：A2 代码写入的 `createdAt` 为 `db.serverDate()`（Date 类型），满足 TTL 生效前提；同时代码侧频控按 `day`（北京日期串）过滤，TTL 只负责物理清理，两者独立生效。

## 3. family_auth.inviteCode sparse 唯一索引 ✅（含一次数据清理）

执行过程（如实记录）：

1. 前置检查：`listIndexes` 显示已有**非唯一**索引 `inviteCode_idx`；全表 13 条文档，inviteCode 无重复值。
2. 直接建 `inviteCode_unique` 报 **IndexOptionsConflict**（同键模式已有不同选项索引）→ 先 `dropIndexes: inviteCode_idx`。
3. 重建时报 **DuplicateKey：dup key { inviteCode: "" }** —— 2 条遗留文档（`41d75f40…`、`e20fd67f…`，status=active、无 memberOpenId、无邀请码，系旧 updateFamilyAuth "无 auth 则 add" 分支的历史产物）携带**空字符串** inviteCode；sparse 只排除字段缺失/null，不排除空串。
4. 数据清理：对这 2 条文档执行 `$unset inviteCode`（nModified=2）。语义依据：A1 后"无当前邀请"即字段缺省；decisions #7 确认线上无真实家庭数据，此为测试残留清理，未删除文档本身、未改 status。
5. 重建成功。最终索引状态（listIndexes 实际返回）：

```json
{"name":"_id_","key":{"_id":1}}
{"name":"_openid_1","key":{"_openid":1}}
{"name":"familyId","key":{"familyId":1}}
{"name":"inviteCode_unique","key":{"inviteCode":1},"unique":true,"sparse":true}
```

- 影响面说明：唯一索引生效后，云端并发产生重复邀请码的写入会被数据库直接拒绝（E11000）——这正是 A2 代码"生成前查重（前置检查）+ 唯一索引（最终保障）"设计要闭合的窗口。createFamilyInvite 冲突重试上限 3 次，极端并发下会以"邀请码生成冲突，请稍后重试"返回，属预期降级。

## 4. 安全规则核查与收敛 ✅

| 集合 | 变更前 AclTag | 变更后 AclTag | 操作 |
|---|---|---|---|
| family_auth | ADMINONLY | ADMINONLY | 无需变更（已是仅云函数读写） |
| family_invite_attempts | PRIVATE（新集合默认） | **ADMINONLY** | ModifyDatabaseACL 收敛（PRIVATE 允许创建者客户端读写，不符合"仅云函数读写"口径） |
| family_members（顺带核查） | ADMINONLY | ADMINONLY | 无需变更 |

- 验证：DescribeDatabaseACL 复查 family_invite_attempts 返回 `AclTag: "ADMINONLY"`。
- 兼容性：小程序端无任何直连数据库代码（本轮 grep 复核 services/utils/pages 无 wx.cloud.database 调用），全部经 healthApi 云函数（管理端权限，不受 ACL 限制），收敛无副作用。

## 5. 遗留与边界

- 本轮**未**部署云函数：A2 代码（频控写入 family_invite_attempts、错误码等）仍只在本地，云端 healthApi 仍是旧版本——集合与索引已就绪，等待后续批次统一部署（部署属独立操作，本批未获部署指令）。
- 未验证真实并发下唯一索引拒绝路径（需部署后测试环境实测，见 A2 summary 云端待验证清单）。
- 临时文件 `.cloudbase-check.json`、`config/mcporter.json`（MCP 路径因 Windows ACL 报错未走通，改用 CLI）已删除；`~/.config/.cloudbase/auth.json` 中为本轮登录产生的新凭据。

## 6. 控制台复核入口（供用户人工核对）

- 文档数据库：https://tcb.cloud.tencent.com/dev?envId=kangxiaoji-d5gw2k203f0488a9e#/db/doc
- family_auth 集合（索引/权限页签）：https://tcb.cloud.tencent.com/dev?envId=kangxiaoji-d5gw2k203f0488a9e#/db/doc/collection/family_auth
- family_invite_attempts 集合：https://tcb.cloud.tencent.com/dev?envId=kangxiaoji-d5gw2k203f0488a9e#/db/doc/collection/family_invite_attempts
