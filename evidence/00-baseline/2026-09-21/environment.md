# 环境与版本基线（2026-09-21）

记录日期：2026-09-21（执行时段 18:23–18:26，UTC+8）
记录方式：只读基线；未修改业务代码、未改测试断言、未运行 `lint:fix`、未更新依赖、未切分支、未提交、未部署、未启动 IDE 自动化。

## 1. 工作目录与 Git

| 项目 | 值 |
| --- | --- |
| 工作目录 | `D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu` |
| 分支 | `feat/family-permission` |
| HEAD | `a751776be194bb0a9d11cf42c27f093ab5109aca` |
| HEAD 提交信息 | `code update`（fuchenggang，2026-08-10 19:16:08 +0800） |
| 执行前已跟踪改动 | 0（无 unstaged / staged 改动） |
| 执行后已跟踪改动 | 0（三项检查未改动任何被跟踪文件） |
| stash | 无 |
| 未跟踪文件（执行前即存在，原样保留） | `docs/家庭Tab开放与三级权限只读分析.md`；`evidence/00-baseline/` 下 4 个历史基线文件 |
| Git 版本 | `git version 2.45.1.windows.1` |

## 2. Node.js / npm（本期固定环境）

本期按要求固定使用豆包会话自带运行时，并在会话内将其目录前置到 `PATH`（仅影响当前进程，未修改系统/用户持久 PATH，未安装或切换任何系统版本）：

| 项目 | 值 |
| --- | --- |
| Node 版本 | `v22.23.2` |
| node 路径 | `C:\Users\123\AppData\Local\DoubaoWork\User Data\sandbox_runtime\bases\c98c5042338ed152c6f10ecd8591889f\node\node.exe` |
| npm 版本 | `10.9.8` |
| npm 路径 | 同目录 `npm.cmd` / `npm.ps1` |
| 执行身份 | `joye\123`（Windows） |

同源校验（证据）：

1. `where.exe node` 第一命中为上述豆包运行时路径，`node -p process.execPath` 输出同路径；
2. 在系统临时目录放置一次性 `package.json`（脚本内执行 `node -p "process.version + ' ' + process.execPath"`），通过 `npm run` 启动的生命周期子进程实际输出：
   `v22.23.2 C:\Users\123\AppData\Local\DoubaoWork\User Data\sandbox_runtime\bases\c98c5042338ed152c6f10ecd8591889f\node\node.exe`；
   证明 npm 启动的检查命令及其 node 子进程与命令行 node 为同一套。探针目录用后即删。
3. `npm test` / `npm run lint` / `npm run regression` 均在该会话 PATH 下经 `npm.cmd` 启动。

机器上同时存在、但本期**未使用**的其他 Node（仅记录，不做优劣判断）：

| 来源 | Node | npm |
| --- | --- | --- |
| 系统安装 `D:\software\nodejs` | v24.16.0 | 11.13.0 |
| nvm 目录 `C:\Users\123\AppData\Roaming\nvm` | v20.16.0（与 2026-08-11 基线一致） | 基线记录 10.8.1 |

## 3. 执行命令与退出码

工作目录均为项目根目录；完整输出见同目录 `test.txt`、`lint.txt`、`regression.txt`。

| 序号 | 命令 | 退出码 | 输出文件 |
| --- | --- | --- | --- |
| 1 | `npm test -- --runInBand` | 1 | `test.txt`（23,688 字节） |
| 2 | `npm run lint` | 1 | `lint.txt`（6,744 字节） |
| 3 | `npm run regression` | 1 | `regression.txt`（382 字节） |

三项命令按顺序执行，失败后继续执行剩余项；退出码为 npm/脚本真实退出码。

## 4. 本期限制

- 仅命令行检查；未做微信开发者工具编译、预览、真机或双账号录屏验证。
- 未读取 `.env.local`、云环境密钥；云函数回归脚本在本地数据处理阶段即抛错退出，**不能**据此判断云端连通性或云函数状态。
- 本期 Node（v22.23.2）与 2026-08-11 基线（v20.16.0）不同，两期结果差异不能直接归因于代码变化或模型升级，详见 `summary.md`。
