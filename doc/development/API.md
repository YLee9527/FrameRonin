# CLI 与本地 API

CLI 返回 JSON 并保留失败退出状态。`doctor`、`init`、`import`、`assets`、`version`、`checkout`、`verify`、`recover` 管理运行时和项目。`operations`、`preview`、`submit`、`status`、`wait`、`cancel` 管理加工。`ai-begin`、`ai-mark` 记录宿主生成尝试；`document-save/get/restore` 保存文档修订；`serve` 提供工作台。

任务 JSON 字段仅允许 `operation`、`inputs`、`parameters`、可选 `assetId`。输入是正式版本 UUID；参数由操作注册表定义，不允许命令和任意读写路径。执行前重验内容与预算。

HTTP 接口：`GET /api/project`、`POST /api/assets`、`GET /api/versions/{id}` 及 `/content`、`POST /api/tasks/preview`、`POST /api/tasks`、`GET /api/tasks` 及 `/{id}`、`POST /api/tasks/{id}/cancel`、`GET /api/documents` 及 `/{id}`、`POST /api/documents/{id}`、`POST /api/ai/requests`。

工作台兼容媒体入口为 `/api/jobs`、`/api/watermark`、`/api/matte`，均转为本地正式任务。写入需同源 Origin 和 `X-FrameRonin-Local: 1`；不启用跨域许可。接口错误包含稳定 code 与可理解说明，失败不登记成功版本。

## 提案修订

`proposal-save --project <项目> --file <任务 JSON> --references <明确选定版本...> [--proposal <id> --revision <预期修订>]` 创建或修订提案。`proposal-get --proposal <id>` 返回预览、输入快照与执行任务。保存不启动任务。`proposal-execute --proposal <id> --revision <已审阅修订>` 再验内容、素材版本及修订，并在任务登记事务中领取该修订；重复执行或素材变更直接报错。

HTTP 对应 `POST /api/proposals`（request、selectedVersions、可选 id/revision）、`GET /api/proposals/{id}`、`POST /api/proposals/{id}/execute`（revision）。AI 提案拒绝 workflow.legacy；历史格式通过独立兼容入口导入。

## AI 结果

`ai-status --attempt <id>` 查看宿主状态与质量。`ai-accept --attempt <id> --file <PNG> --state succeeded|quality_failed --quality <JSON>` 保存经核查产物的副本并统一发布。`ai-mark` 用于 running、unknown、cancel_requested、canceled、failed；不能将任意普通导入版本直接标成 AI 成功。

AI 的本地任务状态与 aiState 分开返回。取消只保证本地结果失效，cancel_requested 需要核对原宿主调用；unknown 接收要求质量记录提供明确核查标记。宿主最终状态不是本地引擎自动证明。

## 文档

文档保存体为 kind、revision、payload，revision 必须是非负整数。资产上传可带已有素材 assetId，追加素材版本。Rseprite 使用该入口保存每个改变的 Cel；重复使用已保存像素引用，文档保存比较修订。复用 API 不绕过路径、内容和取消检查。

## 本地停止确认

取消先使结果和执行代次失效，再停止创建身份可核验的进程族。成功响应额外返回 processStopConfirmed、cancelElapsedSeconds；任务目录保存 cancellation.json，scope 为 local_owned_processes。身份、进程组或停止权限失败记录 CANCEL_* 错误，后续查询仍可看到该原因，重复取消不把失败伪装成确认成功。AI 的 cancel_requested 与服务端最终状态继续分开。
