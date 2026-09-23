# healthApi 云函数部署记录（A0/A1/A2 代码上云）

- 部署时间：2026-09-22 15:26–15:32（UTC+8）
- 环境：`kangxiaoji-d5gw2k203f0488a9e`；函数：`healthApi`（Event 型，index.main）
- 触发：用户明确指令"把云函数部署下"；仅部署 healthApi，**sendDueReminders 未改动、未部署**
- 通道：CloudBase CLI 3.8.4（npx 临时运行）+ 本会话早前用户浏览器授权登录；临时干净 npmrc 绕过失效代理，未改用户 ~/.npmrc

## 1. 部署前校验（全部通过）

- 12 个云端 js 文件 `node --check` 语法全过；index.js 本地加载冒烟 OK；
- `npm run regression` 退出码 0（B1 四组真实执行）；
- 运行时保持 **Nodejs16.13**（cloudbaserc.json 原配置；Node18 升级属独立 A-1 阶段，未借部署夹带）；内存 256MB、超时 60s 均未变。

## 2. 回滚点（先建后部署）

- 部署前对云端旧代码发布版本快照：**版本 1 `backup-before-a0a1a2-deploy`**（2026-09-22 15:27:16）。
- 回滚方式：`tcb fn config-route healthApi 1 100`（流量全切版本 1），或从版本 1 恢复代码后重新部署 $LATEST。未配置任何路由，当前流量走 $LATEST（新代码）。

## 3. 部署与生效验证

- `tcb fn deploy healthApi --force`：COS 上传，部署成功。
- **新代码生效的判别性冒烟**：CLI invoke 构造 `{key:'familyJoin', payload:{inviteCode:'KXJINVALID0'}, userInfo:{openId:'smoke-test-a2'}}`（格式非法码）：
  - 返回含 `inviteError:{code:'FAMILY_INVITE_INVALID', message:'邀请码无效，请核对后重试'}` —— 该字段旧代码不存在，**确证新代码在云端运行**；
  - 自有 perf 日志仅含 route/step/durationMs，无邀请码、无 openId；
  - family_invite_attempts 实际落库 1 条：`{openId:'smoke-test-a2', day:'2026-09-22', reason:'FAMILY_INVITE_INVALID', createdAt:Date}` —— 字段与 A2 契约一致，**真实云端数据验证了"频控记录不含邀请码明文"**；createdAt 为 Date 类型，TTL 索引可生效；day 为北京日期（15:28 北京时间）。
- 冒烟数据已删除（delete n=1，count 归 0），不留测试残留。

## 4. 如实说明的边界

- SCF 平台调用日志会整体回显 RetMsg（含调用者自己提交的邀请码字段）——平台行为；该码本就是调用者持有的输入，非他人邀请码泄露；自有日志与 attempts 集合均不含码。
- 冒烟为 CLI 直调（自构造 userInfo），**未经过微信小程序端 wx.cloud.callFunction 的真实 openId 注入链路**；P0-1（userInfo.openId 注入可靠性）仍需真机/开发者工具验证。
- A1 事务路径（runTransaction 锚点/抢码冲突）与唯一索引并发拒绝路径**未实测**——需部署后的测试环境并发验证（现已具备条件：代码与索引均已上云）。
- 本轮未部署小程序端代码；前端页面改动（错误态、三开关等）需微信开发者工具上传体验版后才对用户可见。
- 云端 family_auth 仍有 13 条历史测试文档（11 条带码 pending、2 条已清 inviteCode 字段），未清理——是否清库由用户决定，未擅动。

## 5. 控制台入口

- 函数详情：https://tcb.cloud.tencent.com/dev?envId=kangxiaoji-d5gw2k203f0488a9e#/scf/detail?id=healthApi&NameSpace=kangxiaoji-d5gw2k203f0488a9e
- 调用日志：同上"日志"页签，或 `tcb fn log healthApi`
