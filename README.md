# 现场多人卡牌网页示例

这是一个配合线下主持游玩的多人网页项目及制作方法，包含 React、Express、Socket.IO、SQLite、入场审批、座次、有限牌池和逐牌任务。它不是任意规则自动转换器。

## 运行

需要 Node.js >=24。本轮独立安装环境为 macOS arm64、Node.js 26.11.0、npm 11.20.0。

```bash
npm ci
npm run dev
```

访问 http://localhost:5173。首次开发启动产生的随机主持密码只保存在 data/local-host.txt。可用 npm run host:create 创建账号。不同玩家应使用独立设备或浏览器上下文。

## 验证

```bash
npm run check
npm test
npm run art:check
npm run build
npm run test:e2e
npm run test:production
```

浏览器测试要求本机 Chrome；使用隔离数据与5197–5199端口，支付HTTP测试使用5196。运行前确认没有其他程序占用。

## 换成自己的游戏

先阅读 [制作方法](docs/制作方法.md)。牌面和原文在 public/art 与 shared/card-rules.json；类型在 shared/types.ts；规则在 server；页面在 src。新卡规则必须明确确认后实现，不能只换图片。当前有两张未定牌保持禁用。

## 部署边界

此版本不包含支付、赞助、订单或退款功能。shared/legal.ts 中运营主体和邮箱是明确的示例占位值，实际运营前须替换并更新协议版本。数据库、真实账号、原站运维资料未包含。

本候选包未附原 Git 历史。真实手机和公网容量不在已验证范围。代码、文档与自有素材保留权利，禁止商用与再分发，署名 Rekk0。这是源码可见项目，并非开源许可，见 [LICENSE](LICENSE)。第三方依赖保持各自原许可。

不包含系统TTS生成的两段语音；下头使用文字及可选振动，揭牌仅保留原有Web Audio合成提示音。

完整检查：`npm run verify`。详细结果见 [发布验收记录](docs/发布验收记录.md)。
