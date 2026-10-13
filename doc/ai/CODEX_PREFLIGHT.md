# Codex 前置验证记录

日期：2026-10-13。环境：Apple Silicon、macOS 27.0.1、Codex CLI 0.154.0、Node.js 22。**状态：未通过完整前置验证，禁止整体归档与进入后续实施阶段。**

## 已实现和已验证

新增独立验证工具、固定应用指令、进程级配置覆盖、App Server RPC、本地 HTTP/WebSocket 请求捕获、上下文与工具白名单检查、文件访问限制候选、协议快照和脱敏记录。没有增加 npm 依赖，没有更改旧应用代码。

工具的 16 项测试全部通过，包含未知基础指令、混入私有文本、额外上下文、替换或遗漏参考图、额外工具、初始化空输入误判、原生握手模拟、MCP 覆盖键、目录遍历、逃逸符号链接、通用进程文件限制、审批拒绝及未知请求终止。所有 `.mjs` 语法检查及协议文件长度、SHA-256 核对通过。

| 检查 | 实际结果 | 证据边界 |
| --- | --- | --- |
| 本机版本与协议 | 0.154.0；保存标准与实验协议，包含 imageGeneration 相关通知及结果字段 | 协议存在不代表账号调用成功 |
| 提案请求 | 工具列表为空；基础指令与固定文件一致；任务文本和选定内联图存在；未出现测试指令/技能标记或额外上下文 | 仅本地捕获，不是实际模型返回的提案 |
| 原生生成请求 | 工具列表只有 `image_gen.imagegen`；捕获初始化后带任务与选定图的请求，基础指令一致，未发现额外上下文 | 原生请求路由仍指向本机模拟端点，没有生成图片 |
| 指令发现 | 配置开关单独使用仍可注入全局用户指令；候选屏蔽规则覆盖原路径及符号链接真实路径后，捕获不再包含这些内容 | 不是所有模型、提供方、模式和未来版本的普遍保证 |
| 通用文件访问 | 受控 `/bin/cat` 可读选定测试文件，无法读取外部测试文件；提案输出区写入被拒绝 | 不是 ImageGen 实际读取范围验收 |
| 严格 Codex 文件限制 | CLI 在 `prompt_debug` 阶段退出，代码 1，权限错误；未启动到模型请求 | 文件访问门禁未通过 |
| 严格 App Server 初始化 | 跳过调试命令后，真实 App Server 仍在 `initialize` 失败，stderr 分类为权限错误 | 阻塞不限于调试命令 |
| 实验性空环境 | 观察到额外 `skills` 工具，白名单拒绝 | 该配置模式不能用于生产会话 |

原生 WebSocket 首包是工具和基础指令初始化，`input` 为空。工具只凭首包不能判定上下文隔离通过。捕获器模拟本机初始化确认，读取下一条包含任务的请求，并对基础指令、上下文、图片及工具重新检查；模拟服务器没有真实 AI 输出。

## 阻塞与调查结论

文件限制候选在 Codex 启动阶段失败。仅扩大系统临时目录访问没有解决；诊断中同时放开整个用户 Codex 存储区的读写后可以启动。这说明候选缺少运行时访问项，**尚未定位出经验证的最小集合**。不能据此宣称 CLI 不支持 ImageGen，也不能将整个存储区设为生产白名单。

启动目录枚举和 macOS 文本编码配置有访问记录，已纳入候选；仍未解决启动失败。候选中的系统与 Codex 运行时例外也尚未完成 ImageGen 实际读取范围证明。模型工具参数、委托执行和参考图路径的完整边界仍需验证。

调查中修正过 MCP 覆盖路径的验证工具错误：0.154.0 不将这里使用的带引号路径视为原键，导致新建不完整条目并报 transport 错误。修正后的工具用经过校验的普通键，遇到无法安全表达的名称阻断。这个已修复错误不作为当前文件隔离阻塞的证据。

## 未执行的必要检查

- 真实 ImageGen 生成、参考图编辑、解码和落盘；服务端取消请求及最终状态、线程/轮次/产物核对、断线与重连。
- 真实 ImageGen 的未选素材、目录遍历、符号链接读取负向测试，以及完整工具执行权限检查。
- 合成记忆标记测试、所有上下文来源及运行时元数据的全面白名单证明；现有已捕获样本仅提供局部证据。
- 素材质量、任何桌面应用构建或安装、Finder 独立媒体运行时、macOS 14、Krita/Godot 互操作。

当前所有模式均不得作为通过完整验收的 AI 适配器使用。AI 质量重试上限和未知状态先核对规则仍以 [验收规范](../testing/ACCEPTANCE.md) 为准。

## 复现与证据

命令与限制见 [工具说明](../../tools/codex-preflight/README.md)。本地捕获退出码 0 仅代表该次请求检查通过，报告的 `milestonePassed` 始终为 false；严格模式失败保留退出码 1。报告不存原始上下文、认证头、图片字节、配置值或完整 stderr。

| 文件 | 检查 |
| --- | --- |
| [提案捕获](evidence/0.154.0/proposal-local-capture.json) | 局部请求检查通过 |
| [原生生成捕获](evidence/0.154.0/generation-local-capture.json) | 局部请求检查通过，非真实生成 |
| [严格文件限制](evidence/0.154.0/strict-filesystem-blocked.json) | 启动失败 |
| [严格 App Server 初始化](evidence/0.154.0/strict-app-server-blocked.json) | 初始化失败 |
| [空环境负向样本](evidence/0.154.0/empty-environments-rejected.json) | 额外工具拒绝 |
| [未屏蔽全局指令负向样本](evidence/0.154.0/config-only-context-rejected.json) | 额外上下文拒绝 |
| [协议及校验清单](../../tools/codex-preflight/protocol/0.154.0/manifest.json) | 标准及实验协议文件摘要 |
| [工具检查汇总](evidence/0.154.0/tool-validation.json) | 16 项测试、语法与协议检查；非应用验收 |

证据只记录脱敏元数据；具体检查点提交由 `git log -- doc/ai tools/codex-preflight` 关联。原始代码基点与各阶段状态见 [里程碑记录](../management/MILESTONES.md)。

## 官方依据

配置字段和权限能力的公开依据为 [配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[配置 schema](https://learn.chatgpt.com/docs/config-schema.json)、[权限说明](https://learn.chatgpt.com/docs/permissions)、[App Server](https://learn.chatgpt.com/docs/app-server) 和 [ImageGen](https://learn.chatgpt.com/docs/image-generation)。文档说明能力与配置意图；上表的本机结果才是此次实际验证证据。
