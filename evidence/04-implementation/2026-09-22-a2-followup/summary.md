# A2 收尾 · 无邀请码状态、邀请重置竞态与频控一致性 · 摘要

- 日期：2026-09-22（15:37–16:40，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 环境：Node v22.23.2 / npm 10.9.8；既有全部改动保留；未切分支、未提交、未清理、**未部署**（云端 healthApi 仍是 A2 部署版，本批改动待下次部署）、未升级运行时、未开放 Tab。

## 1. 复现（实现前，repro.txt + before.txt）

1. **无邀请码态**：缺码返回 `remainHours:24` + 4 个默认可查看范围，WXML 恒显"邀请有效 · 剩余 24 小时"——把"没有邀请"渲染成了"有效邀请"。
2. **有效期边界**：`expiresAt:'not-a-date'` → `NaN < Date.now()` 为 false → **当作有效放行**（repro.txt 实测）；纯数字字符串时间戳同样放行；刚好到期在毫秒边界可放行。
3. **重邀/加入交错**：事务内按文档 ID 重读但**不核对邀请码**——owner 重邀换码后，持旧码的在途请求仍可按新文档内容完成加入并消耗新邀请；且 generateUniqueInviteCode 允许复用 owner 自己的旧码，重邀后旧码继续有效，放大交错窗口。
4. **频控**："先 count 后 add"两步无原子性，并发可整体越过 20 上限，且探测发生在门限之后。
5. **事务 catch 吞异常**：anchor/auth 的 doc.get 用 `try{...}catch{ null }`——网络/权限/事务冲突异常会被当作"文档不存在"继续写入。

实现前目标测试 **18 失败/4 通过**（before.txt），失败集合与上述问题一一对应。

## 2. 修正内容（最小实现，10 个文件）

### 2.1 无邀请码说明态
- 云端：缺码（undefined/null/空串/纯空白串）返回 `noInvite:true` 说明态——title"尚未获得邀请"、remainHours=0、scopes=[]、无任何有效标志；**非字符串真值按 INVALID 计失败额度**，不冒充缺码。
- 页面：`wx:elif="{{noInvite}}"` 独立说明分支（无徽标/无范围/无加入按钮）；joinFamily 增加 noInvite 守卫；查询返回、页面展示、提交守卫三层一致。
- 本地镜像：无码（payload 与本地记录均无）加入按 NOT_FOUND 拒绝，不假成功。
- 缺码测试已按新契约修正（断言 noInvite 形态 + 零额度），未删除场景。

### 2.2 重邀/加入交错
- 事务内重读邀请文档后**核对 `latestAuth.inviteCode === 提交码`**，不一致按 notFound 拒绝（不创建成员、不消耗新邀请），并继续复核状态/有效期/owner 一致性。
- `generateUniqueInviteCode` 取消"命中自己旧码可复用"豁免——任何现存文档持有候选码都重新生成（最多 3 次后抛冲突）；生成器异常输出（非字符串/格式不符）同样按冲突处理。
- 可控交错测试：事务替身带 `onTxStart` 钩子，在"外层已读旧码 A、事务开始前"注入 owner 重邀换码 B——断言旧码请求被拒、零成员写入、新邀请保持 pending 未被消耗。

### 2.3 事务读取异常语义
- index.js 改为 `cloud.database({ throwOnNotFound: false })`（SDK 文档化配置，来源：wx-server-sdk 2.6.3 打包源码 L1272-L1290、L1015-L1030）：事务内 doc.get 对**确认不存在**返回 `data:null`；网络/权限/冲突异常直接上抛，**删除了吞异常的 try/catch**。
- 副作用核查：全仓仅 daily-stats-service 两处非事务 doc.get，未命中时原本走 catch 回退空统计，改后走 data:null → 同样回退空统计，最终行为不变（仅 perf 日志分类从 error 桶变 ok 桶，更准确）。
- 测试覆盖事务分支控制流：happy path（锚点 set + auth 转 active）、交错拒绝、锚点读取基础设施异常上抛且零写入。本地测试**不宣称**证明云端锁与重试行为。

### 2.4 有效期边界
classifyInviteAuth 统一口径（查询/join/事务内复核共用）：缺失 → INVALID；**不可解析（NaN）→ INVALID**；revoked/used 依序；**`expiry <= now`（含刚好到期）→ EXPIRED**；成功路径 remainHours 必为有限正数（`Math.max(1, ceil)`）。五种形态（缺失/不可解析/刚好到期/已过期/未来）全部有测试，时间用 fake timers 固定。

### 2.5 原子频控（方案先行，rate-limit-plan.md）
- 结构：每 (openId, 北京日) 一条计数文档 `_id='invite-fail-<openId>-<day>'`，字段 `{openId, day, count, createdAt, updatedAt}`，无邀请码明文；日界由 key 保证，TTL 仅物理清理。
- 门限：**先原子预留额度再探测**——`where({_id, count:_.lt(20)}).update({count:_.inc(1)})`（单文档条件更新原子性 + $inc，MongoDB 官方乐观锁模式，来源已记录）；文档不存在则以确定性 _id 创建，add 撞唯一冲突回到条件更新重试一次，两轮未果保守拒绝（fail-closed）。**并发请求不可能全部先通过门限再各自探测**。
- 四类结局：枚举类失败（invalid/notFound/expired/revoked/used）保留额度；成功与幂等重复加入退还；自绑/已绑定退还（非枚举失败）；基础设施异常退还后原样上抛。事务重试发生在同一次预留内，只占 1 额度。
- 查询与 join 共用同一计数文档（防绕过）；**无静默降级分支**——不依赖 runTransaction，云端与本地同一代码路径，Mock 仅实现存储语义（lt/gt/inc/唯一 _id）。
- 原"每次失败一条记录"形态废弃（无生产数据，云端集合当前为空，无迁移）。

## 3. 测试结果（真实退出码）

| # | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 实现前 | 目标测试 a2-followup | 1 | **18 失败/4 通过**（22 总） | `before.txt` |
| 实现后 | 4 个受影响套件（a2-security 30 + a2-followup 22 + a1 23 + a0-integration 18） | **0** | **93/93** | `target-after.txt` |
| B1 护栏 | `npm run regression` | **0** | ok，四组真实执行 | `regression.txt` |
| 全量 | `npm test -- --runInBand` | **0** | **527/527，22 套件全过**（505 + 22 新增） | `full-test.txt` |
| Lint | `npm run lint` | 1 | **11 error/32 warning，零新增**（与 A2 后一致；范围 services/utils/pages/components，cloudfunctions 不在内） | `lint.txt` |

旧测试迁移（契约变更驱动，无删除、无跳过、无放宽）：a2-security 频控断言改计数文档口径、"同码复用不算冲突"反转为"重邀必发新码"；a0-integration 桩码改顺序生成（常量桩与新契约冲突）；a1/a0/回归的 Mock 补 lt/gt/inc 与 _id 唯一（存储语义，非业务判断）。settings 时区台账保留（本轮下午执行全绿）。

补丁：`fix.patch` 以重放全部历史补丁（B1→…→A2）的基线树为基准，10 段；已验证干净应用且与工作区逐字一致。

## 4. 表述修正（原始证据保留，追加修正说明）

- **A1 summary**："加入与重邀交错…可接受态（无越权）"→ 该结论未经充分验证；已实修（事务内码一致性重验 + 重邀必发新码），交错窗口关闭。事务 doc.get 吞异常问题一并修正。
- **A2 summary**："软上限可接受"→ 未经用户确认不应写入；已改原子预留方案。attempts 文档形态、缺码默认页、同码复用豁免三处契约同步修正。

## 5. 本地已证明 vs 测试环境待验证（分开报告）

**本地已证明**：上述全部控制流与判定口径（含事务分支的交错拒绝、异常上抛、预留/退还/日界/隔离、无码态三层一致）。

**测试环境待验证**（部署本批代码后）：
1. 并发预留的真实串行化效果（同 openId 并发 21+ 请求压测，断言恰好 20 个预留成功）；
2. `throwOnNotFound:false` 在真实云端的 data:null 行为与 daily-stats 日志分类变化；
3. 事务锁/冲突重试在抢码与并发加入下的真实时序（A1 遗留项）；
4. add 自定义 _id 撞唯一约束的真实错误形态（本地以 E11000 替身模拟）；
5. TTL 对计数文档的实际清理时点。

## 6. 部署状态与边界

- **本批未部署**：云端 healthApi 仍为 A2 部署版（无 noInvite 态、旧频控形态）。部署前置条件：无新集合/索引（family_invite_attempts 及 TTL、inviteCode 唯一索引均已就绪）；集合当前为空，新旧计数形态无共存冲突。
- 未进入 A3；未做二级页、代录、电话、缓存治理、Tab 开放；lint/日期副本台账未动。
- 联调与截图准备清单见 `test-env-checklist.md`（含每项前提的"待验证"标注）。

## 7. 累计未提交改动

已跟踪修改 18 个（与 A2 后同一集合，本轮修改其中 8 个 + 新增 followup 测试为未跟踪）；新增未跟踪代码 9 个（+ tests/unit/a2-followup.test.js）。config/mcporter.json 等临时物已清理。
