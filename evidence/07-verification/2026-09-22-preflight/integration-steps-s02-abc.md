# S02 有效邀请预览 与 A/B/C 真实账号联调操作步骤（v2，含 A2 显式生成修正；计划，本轮未执行）

> 本轮约束：不创建邀请、不改云端数据、不部署、不上传、不提交、不清理、不进入 A3。
> v2 修正（相对 v1）：① 删除"打开页面即生成"流程（页面已改为显式点击"生成邀请"才提交）；② 删除"覆盖历史测试文档可接受"的默认判断，改为生成前核对、存在未确认用途邀请即停下；③ 编译模式的路径与启动参数分开填写；④ 明确账号 A 生成、账号 B 查看的分工；⑤ 改权剔除验证必须有脱敏测试记录，空健康数据不能证明剔除生效。

## 0. 账号角色与准备

| 账号 | 角色 | 载体 | 准备要求 |
|---|---|---|---|
| A | owner（数据持有老人，**邀请生成方**） | 开发者工具主登录微信 + 真机 | 脱敏昵称；**改权剔除验证前需有≥1 条脱敏测试健康记录**（见 §3 注） |
| B | 家属 1（**邀请查看/加入方**） | 第二微信号（真机预览或工具多账号切换） | 与 A 无既有绑定 |
| C | 家属 2（USED/REVOKED 态观察者） | 第三微信号 | 同 B |

通用前置：云环境 `kangxiaoji-d5gw2k203f0488a9e`（收尾版 + 显式生成页面为本地代码，**页面改动需开发者工具本地编译生效；云函数若未含页面逻辑则无影响——页面逻辑在小程序端，无需重新部署云函数**）；关闭真机调试悬浮条。

## 1. 生成前核对（强制，未过不做任何生成）

1.1 CLI 只读查询 A 名下 family_auth：`find family_auth where _openid=<A>`（经 tcb db nosql execute，只读）。
1.2 判定：
- 无文档 → 可直接生成；
- 有文档且 status=pending/active → **停下**，与用户确认该邀请用途（是否仍在用、可否被新生成作废）；确认后方可继续；
- 有文档且 status=revoked → 可直接生成（旧码已失效）。
1.3 记录核对结果（时间、文档 status、结论）到联调记录，作为生成动作的前置证据。

## 2. S02 有效邀请预览（A 生成、B 查看）

| 步骤 | 操作 | 云端影响 | 预期 |
|---|---|---|---|
| 2.1 | A 开发者工具**添加编译模式**：启动页面=`pages/family-sub/family-invite/index`（单独填"启动页面"字段）；**启动参数=留空**（单独填"启动参数"字段，不填任何 inviteCode）→ 编译 | 仅读 family_auth（页面 onLoad 只读） | 邀请页显示草稿（默认 read+remind 预选）、"生成邀请"按钮、提示"尚未生成邀请…"；**不产生任何写请求**（Network 面板无 createFamilyInvite 调用） |
| 2.2 | A 按需调整关系/权限开关（草稿）→ 点击"**生成邀请**"（首次无旧码，无确认弹窗） | 写 family_auth（A 单文档：新码、pending、三级 scopes、memberOpenId=''） | 页面显示邀请码与"24 小时内有效"提示；复制/分享按钮解禁 |
| 2.3 | CLI 只读核对新码文档：status=pending、expiresAt 未来、scopes 与页面草稿一致 | 只读 | 字段符合收尾版结构 |
| 2.4 | **B** 另建编译模式：启动页面=`pages/family-sub/family-join/index`；启动参数=`inviteCode=<新码>`（路径与参数分开填）→ 编译 | 读 family_auth；频控预留+退还 | 徽标"邀请有效 · 剩余 N 小时"、"可查看内容"仅 read 项、身份卡、"加入家庭"按钮 |
| 2.5 | 截图 `A2-S02-join-pending-YYYY-MM-DD.png` + 同刻 Network 面板 familyJoin 响应 | — | 响应无 inviteError |
| 清理 | 不加入则无需清理；计数文档 count=0 可留（TTL）或按 openId 删除 | — | — |

## 3. 全链路联调（加入→改权→撤销→USED/REVOKED）

| 步骤 | 操作（账号） | 云端写 | 预期 |
|---|---|---|---|
| 3.1 | 复用 §2 新码（或按 §1 核对后重新生成） | — | 码有效 |
| 3.2 | B 勾选边界说明→"加入家庭" | family_members 锚点行 active；family_auth→active+memberOpenId=B | B 进家属首页；**云函数日志核验 openId 注入（P0-1）** |
| 3.3 | **改权剔除验证前置**：确认 A 名下存在≥1 条血压 + 1 条血糖**脱敏测试记录**（如 128/78、6.4 等测试值，无真实个人信息）；若没有→先由 A 在记录页创建（该写入属联调必要数据，记录到联调记录） | 写 records（脱敏值） | B 家属首页可见血压+血糖明细 |
| 3.4 | A 编译 `pages/family-sub/family-auth/index`，启动参数 `id=<B关系行_id>`（关系行 _id 经 CLI 只读查询）→ 关"血糖"查看→保存 | 更新 B 关系行；family_auth 同步 | 保存成功 |
| 3.5 | B 刷新家属首页 + Network 面板 | 只读 | 血糖明细**不在响应中**（有 §3.3 的记录作对照，证明服务端剔除而非"本来就没数据"）；血压仍在 |
| 3.6 | C 用同一码进 join 页（编译参数） | 读；计数+1 | "邀请已被使用"；截图 S06 |
| 3.7 | A 撤销 B | B 关系行 revoked；family_auth revoked+memberOpenId='' | 成功提示 |
| 3.8 | B 刷新家属首页 | 只读 | 未授权空态 |
| 3.9 | C 同码再进 join 页 | 读；计数+1 | **必须**"邀请已撤销"（REVOKED）；截图 S05；出现 USED→不算通过，记录 code 与时序调查 |
| 3.10 | （可选）1:1 与跨家庭拒绝验证 | 同 v1 §2.9/2.10 | 同 v1 |
| 清理 | 撤销绑定；删除本轮计数文档与脱敏测试记录（按 _id/openId 精确）；family_auth 单文档保留 | 仅本轮创建物 | family_members 归 0 或仅 revoked 行 |

> **注（修正⑤）**：空健康数据下"关闭 read 后看不到血糖"无法区分"被剔除"与"本无数据"。§3.3 的脱敏测试记录是改权剔除验证的必要前置；记录值必须为明显测试值并在联调记录中登记，验证后清理。

## 4. 频控截图（S07，最后拍）

同 screenshot-manual.md S07 节；注意 S05/S06 各计 1 次失败，同账号当日累计 <20；S07 用独立账号或最后执行。

## 5. 执行顺序总表

S08✅ → S03a✅ → S03b✅ → S01 → **§1 核对** → S02（§2.1–2.5，A 生成/B 查看）→ S06 → S05 → S04（夹具改 expiresAt，仅测试文档）→ S07。

## 6. 本轮未执行声明

未创建邀请、未写云端、未部署、未上传、未提交、未清理；family_auth 13 条历史文档原状。页面显式生成改动仅存在于本地工作区（12 个页面级测试通过），开发者工具本地编译即可体验，云函数无需因此重新部署。

## 附录 A · §1 前置核对操作细则（只读，不写云端）

代理故障时先：`printf 'registry=https://registry.npmjs.org/\n' > "$TEMP/clean-npmrc"`

**路径 1（无需 openId）**：列出全环境 pending/active 邀请人工判断：

```bash
NPM_CONFIG_USERCONFIG="$(cygpath -w "$TEMP/clean-npmrc")" npx -y -p @cloudbase/cli tcb db nosql execute -e kangxiaoji-d5gw2k203f0488a9e --command '[{"TableName":"family_auth","CommandType":"QUERY","Command":"{\"find\":\"family_auth\",\"filter\":{\"status\":{\"$in\":[\"pending\",\"active\"]}},\"projection\":{\"status\":1,\"inviteCode\":1,\"createdAt\":1,\"memberOpenId\":1},\"limit\":50}"}]' --json
```

- 0 条 → 继续生成；N 条 → 逐条核对 createdAt/码前缀，全部确认为可作废的旧测试数据才可继续；任一条认不出或在用 → 停下确认。

**路径 2（精确到 A）**：A 在开发者工具产生一次只读调用 → `tcb fn log healthApi` 从最新调用输入事件的 userInfo.openId 取 A 的 openId（仅终端查看，不入证据）→ 按 `_openid` 查询 family_auth → 无文档或全 revoked 才继续；存在 pending/active 停下确认用途。

## 附录 B · 家庭页本地开放（2026-09-22，仅本地测试）

- 变更：pages/family/index.wxml 移除 coming-soon 占位、恢复真实内容（成员列表/家属视角/管理权限/解除授权/邀请入口）；pages/family/index.json 移除 coming-soon 注册；components/coming-soon 目录删除（死代码，git 可恢复）。
- **守卫**：本开放仅用于本地/体验版前联调；**上传体验版或正式版前必须复核**——正式开放属 A7（含回滚开关与合规文案复核）。若需临时回退占位：git 恢复上述三处即可。
- 新增可测点按链路：家庭 Tab → 成员列表（getFamilyData）→「管理权限」跳 family-auth（自动带 id，无需 CLI 查 _id）→ 保存改权 →「解除授权」直接触发 §3.7；「邀请家属」跳 family-invite（显式生成）；「家属视角」跳 home-family。
- §3.4 步骤简化：不再需要 CLI 查关系行 _id 与编译参数直达 family-auth，直接点按成员卡「管理权限」即可。
- 验证：全量 Jest 540/540、regression ok；代码质量扫描应不再报"未使用组件"（coming-soon 已无注册）。
