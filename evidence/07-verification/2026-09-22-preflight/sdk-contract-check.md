# SDK 契约核对结果（对照实际部署的 wx-server-sdk 2.6.3 封装层）

- 方法：读取 `cloudfunctions/healthApi/node_modules/wx-server-sdk/index.js`（webpack 打包源码）与内置 `@cloudbase/database/dist/commonjs/*` 的实际实现；不凭记忆或通用 Mongo 文档下结论。
- 原则修正：CloudBase 平台行为的**首要来源是 CloudBase/微信官方文档与实际 SDK 源码**；MongoDB 手册只作方案模式参考（此前 rate-limit-plan.md §2 已把两者分列，本文档给出最终判定）。

## 1. where().update() 返回值：`stats.updated`（代码正确，方案文档表述需澄清）

两层封装，返回形不同：

| 层 | 位置 | 返回 |
|---|---|---|
| 内层 @cloudbase/database Query.update | `@cloudbase/database/dist/commonjs/query.js` L146-L172 | `{ updated: res.data.updated, ... }` |
| **外层 wx-server-sdk Query 包装**（业务代码实际调用层） | `wx-server-sdk/index.js` L1500-L1523 | `resolve({ stats: { updated: updateResult.updated || 0 }, errMsg })` |

结论：业务代码经 `cloud.database()` 拿到的是 wx-server-sdk 的 Database/CollectionReference/Query 包装类，`where().update()` 的对外契约是 **`{stats:{updated}}`**。`reserveFailureSlot` 读 `res.stats.updated` **正确，无需改代码**；rate-limit-plan.md §2 表中"返回 {updated}"引用的是内层 query.js，属封装层差异，以本文档为准（原方案文档保留不改，按留证惯例以本核对记录澄清）。doc 级 `update`（L1327-L1345）同为 `{stats:{updated}}`，A1/A2 代码中 doc().update 的用法一致正确。

## 2. 事务 doc.get 返回结构与 throwOnNotFound 适用性：确认适用

- `wx-server-sdk/index.js` L1270-L1290（DocumentReference.get，普通与事务共用同一实现）：
  - `throwOnNotFound = this.database.config.hasOwnProperty('throwOnNotFound') ? Boolean(...) : true`；
  - 结果为空时：配置为 false → `resolve({ data: null, errMsg: ok })`；默认 true → 抛 `document with _id … does not exist`；
  - 注释明确"in normal doc.get, queryResult.data is array, in transaction, it is object instead"，非空时事务态返回 `data: <对象>`。
- 配置注入路径：`cloud.database(config)` → `new Database(config)`（L1010-L1030，`this.config = config`）→ DocumentReference 经 `this.database.config` 读取。index.js 现改为 `cloud.database({ throwOnNotFound: false })`，**对事务内 doc.get 生效**。
- 业务代码 `anchorRes && anchorRes.data ? anchorRes.data : null` 与上述结构匹配；基础设施异常（网络/权限/事务冲突）不经此分支，直接 reject 上抛。✅

## 3. add 自定义 _id 重复时的错误类型：**本地无法完全确认，签名判别 + fail-closed**

- wx-server-sdk 错误码表（L3125-L3147）：数据库段只有 -502001 请求失败 / -502002 非法命令 / -502003 权限 / -502004 集合上限 / -502005 集合不存在，**无重复键专属码**；
- @cloudbase/database dist 中亦无 E11000/duplicate 常量（grep 核实）；
- collection.add（@cloudbase/database collection.js L26-L45）将 data 原样 EJSON 序列化提交 `database.insertDocument`，自定义 _id 会传给服务端，重复时由服务端（Mongo 语义）拒绝，错误报文预期为服务端透传的 `E11000 duplicate key error …`，经 `returnAsFinalCloudSDKError` 包装后 message 保留原文——**这是基于源码路径的推断，真实报文属云端待验证项**（verification-plan §4 有实测步骤）。

### 由此确认并修复的缺陷（先失败测试后最小修正）

- 缺陷：`reserveFailureSlot` 的 add catch 原先把**任何异常**当重复键冲突进入重试；重试轮耗尽后 `return null` → 基础设施故障（网络/权限）会**伪装成 RATE_LIMITED 频控拒绝**，违背"区分正常成功、失败计数、事务重试、基础设施异常"的要求。
- 失败测试（修复前实测失败，见 followup before 输出）：`a2-followup.test.js`"add 发生非重复键的基础设施异常：原样上抛，不得伪装成频控拒绝"——Mock add 抛 `network timeout`，断言异常原样上抛。
- 最小修正：catch 内仅当报文匹配 `/E11000|duplicate key/i`（Mongo 标准重复键报文）才按冲突重试；其余异常原样上抛。若真实云端重复键报文与签名不符，行为退化为"按基础设施异常上抛"——方向 fail-closed（拒绝服务而非放行/误计频控），不会放宽任何限制。
- 复跑：a2-followup **23/23**；全量 **528/528、22 套件**；regression 退出码 0；lint 43（11e/32w）零新增。

## 4. 原子性依据的最终口径

- **平台行为依据**：CloudBase 文档型数据库即 MongoDB 协议兼容存储，单文档条件更新（filter 带期望值 + `$inc`/`_.inc`）的原子性由单文档写原子性保证；wx-server-sdk 实际暴露 `_.lt/_.inc`（command.js L15/L83）且 `where().update()` 回传命中数（L1500-L1523）——**能力与返回契约均已按实际 SDK 源码核实**。
- MongoDB 手册（write-operations-atomicity）仅作为"乐观锁过滤 + $inc"这一**模式**的参考出处，不单独作为目标平台行为证明；平台级最终确认以 verification-plan §3 的并发压测为准（本地 Mock 不宣称证明并发原子性）。
