# 家庭权限二开基线

本目录记录 `feat/family-permission` 分支开始开发前的项目状态。后续每个阶段完成后，应使用相同命令复跑，并将结果与本基线对照。

## 记录范围

- Git 提交、分支和工作区状态
- Node.js/npm 运行环境
- 单元测试、静态检查和云函数回归脚本

## 未覆盖内容

本次仅记录命令行基线，未包含微信开发者工具真机截图。开放家庭 Tab 前，应补充两个测试账号的手工验证录屏，并对健康数据、openid、邀请码和环境配置做脱敏处理。

## 复跑命令

```powershell
npm test -- --runInBand
npm run lint
npm run regression
```

