# Codex 0.154.0 前置验证工具

这是桌面迁移前的调查工具，**不是生产适配器**。只捕获发往本机回环端点的请求，不调用真实 AI；退出码 `0` 仅表示这一次请求捕获检查通过。`milestonePassed` 始终为 `false`。完整前置验证还包括实际文件访问、生成、编辑、取消、核对与重连。

## 使用

需要 macOS、Node.js 22、带 `tomllib` 的 Python 和已安装的 Codex `0.154.0`。复用 Codex 自身登录，不修改用户配置或复制认证文件。以仓库根目录执行：

```sh
node --test tools/codex-preflight/preflight.test.mjs
node tools/codex-preflight/snapshot.mjs
node tools/codex-preflight/run.mjs --deny-instructions
node tools/codex-preflight/run.mjs --deny-instructions --native-provider
node tools/codex-preflight/run.mjs --deny-instructions --generation --native-provider
node tools/codex-preflight/run.mjs --strong-sandbox
```

`--deny-instructions` 捕获只屏蔽已发现的用户指令文件，**不证明完整文件隔离**。`--native-provider` 使用 Codex 原生路由，目标仍是本机模拟端点；不加此选项时使用临时本机测试提供方，不修改用户设置。`--strong-sandbox` 才尝试进程文件限制；目前启动失败，应保留阻塞。禁止据此绕过门禁发起真实生成。

可用 `FRAMERONIN_CODEX_BINARY` 指定 CLI。版本不符或不能安全禁用 MCP 键时失败。CLI 0.154.0 的覆盖路径不支持这里所需的引号转义语义；名称仅接受字母、数字、下划线、连字符，其他名称拒绝，不猜测拆分或降级。

`--no-environments` 调查实验性空环境行为；已观察到额外 `skills` 工具，该模式未通过。`--inherit-host` 为宿主环境诊断，不能通过隔离验收。`--native-host`、`--skip-prompt-debug` 仅供定位问题，不构成生产配置。

## 产物与边界

- `protocol/0.154.0/`：CLI 导出的标准及实验协议、长度和 SHA-256。
- `run.mjs`：创建受控临时输入与自有 PNG、注入合成项目指令/技能标记、启动 App Server、捕获模型请求，记录摘要和分类。
- `audit.mjs`：检查固定基础指令、任务文本、选定内联图、上下文角色及工具目录；拒绝仅有初始化工具声明的捕获。
- `websocket-capture.mjs`：原生路由的本地握手模拟，取得后续任务请求；模拟响应没有 AI 输出，不代表真实服务器契约或取消验收。
- `sandbox.mjs`：macOS 文件限制候选；需要进一步验证 Codex 运行时，不能作为已通过的生产权限配置。
- `rpc.mjs`：受控子进程与 RPC、审批拒绝、超时和自身进程组清理。

报告只保留长度、摘要、工具声明、布尔检查和安全错误分类；不保存原始模型输入、图片数据、认证头、配置值或 stderr。临时任务位于 `/private/tmp/fr-*`，其 `report.json` 路径由工具返回；协议导出暂存于忽略的 `work/`。不清理用户数据或修改旧源码。

图片入口目前仅检查真实路径与 PNG 签名，生产版本仍需完整解码、内容哈希和素材版本校验。通用文件限制的 `/bin/cat` 测试不能替代 ImageGen 实际读取负向测试；工具进程关闭也不能替代服务端取消与任务状态核对。

详细事实与剩余验证见 [前置验证记录](../../doc/ai/CODEX_PREFLIGHT.md)。
