# CLI 与本地 API

CLI 返回 JSON 并保留失败退出状态。`doctor`、`init`、`import`、`assets`、`version`、`checkout`、`verify`、`recover` 管理运行时和项目。`operations`、`preview`、`submit`、`status`、`wait`、`cancel` 管理加工。`ai-begin`、`ai-mark` 记录宿主生成尝试；`document-save/get/restore` 保存文档修订；`serve` 提供工作台。

任务 JSON 字段仅允许 `operation`、`inputs`、`parameters`、可选 `assetId`。输入是正式版本 UUID；参数由操作注册表定义，不允许命令和任意读写路径。执行前重验内容与预算。

HTTP 接口：`GET /api/project`、`POST /api/assets`、`GET /api/versions/{id}` 及 `/content`、`POST /api/tasks/preview`、`POST /api/tasks`、`GET /api/tasks` 及 `/{id}`、`POST /api/tasks/{id}/cancel`、`GET /api/documents` 及 `/{id}`、`POST /api/documents/{id}`、`POST /api/ai/requests`。

工作台兼容媒体入口为 `/api/jobs`、`/api/watermark`、`/api/matte`，均转为本地正式任务。写入需同源 Origin 和 `X-FrameRonin-Local: 1`；不启用跨域许可。接口错误包含稳定 code 与可理解说明，失败不登记成功版本。
