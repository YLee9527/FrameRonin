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

## 工作台任务客户端

GET /api/project/context 提供 memoryBudgetBytes；客户端缺少有效预算时拒绝导入或启动任务。创建 queued 任务的响应只提供 ID、状态和 preview；客户端从 0 开始进度，再读取完整任务事件。结果预览同时估算压缩数据、解码及前端副本，只使用任务预算的四分之一；超限保持正式结果，改由项目结果链接下载。

audio.compress 输出各 MP3、ZIP 和 audio-report.json，文件名带输入序号，报告对应输入版本。音频素材 metadata 增加 sampleRate、channels；版本响应增加素材 name。输入支持的采样率随本地编码保留，区别于旧 AudioContext 的设备采样率。

地图操作：`map.export` 接受已选图片版本、`format=png|psd|godot`、`layout` 和 `frontendBytes`；`map.template` 使用相同布局及 `target={x,y,w,h}`。layout 包含源文件名、真实源尺寸、水平/垂直重叠比例和有序 layers；每层为 `{inputIndex,key,tile,feather}`。首层必须是输入 0 的中心原图，每个输入恰好引用一次，拒绝未知字段、错误索引、无效坐标、羽化、源尺寸或文件名。没有任意路径、命令或脚本参数。

资源预估覆盖前端保留的图像/历史、副本、所有原生解码、单层中间数据、PSD 通道/ZIP 缓冲和完整合成。PNG/PSD/模板及每个单层最多 30000px/边；Godot 包不分配整幅合成画布，范围可超过该值。超预算在启动前拒绝。任务结果由现有统一完成事务登记，取消代次检查同样适用；报告保存格式和完整布局。Godot 仅使用原可信场景导出器，不自动运行 AI 新脚本。

GIF 两种实现通过 `renderer=pillow|browser` 明确选择。`gif.split` 接受单帧或多帧 GIF（输入类型 animation|image、扩展名 .gif 且实际容器为 GIF），1–1000 帧；浏览器兼容模式输出逐帧 PNG、ZIP、含 durationMs/disposalType 的原算法报告。`sequence.gif` 增加 `sizePolicy=reject|first` 与 `frontendBytes`；first 仅允许 browser，输出第一帧尺寸，保留原默认平滑和逐帧调色板。browser 只允许 loop=0，其他循环值报错；Pillow 默认仍拒绝混合尺寸。

GIF 预估加入所有前端保留素材、解码帧、中间表面和编码缓存。浏览器解码器再次核对 GIF 图块尺寸和总缓冲预算，拒绝超限后不开始解压。后台 GIF 与其他任务使用同一取消/完成接口；已取消的任务不下载或登记迟到成功结果。前端输入在执行中改变时，结果留在项目内，不能覆盖新选择。

序列操作新增 `sequence.combine`（columns、cropTop/Bottom/Left/Right）、`sequence.stitch`（direction=vertical|horizontal|overlay）、`image.sliceBrowser`（rows/columns）、`image.superSlice`、`image.blank`，均接收正式输入与 frontendBytes。规则拆分沿用原浏览器向下取整单元、舍弃末端余数；区别于原 Pillow 网格操作。透明拆分按全图透明行列检测，最多 1000 区域，在统一尺寸输出前核对动态缓冲预算。

`GET /api/project/context` 提供项目身份、操作注册表和预算，省去导入/重开时反复读取整个素材库。原 `/api/project` 继续用于素材面板。任务客户端输入导入额外返回版本元数据，可在导入过程中提供缩略图；调用方仍核对正式版本，不能使用任意路径。

序列工作台按页展示最多一行或 24 张缩略图，原始文件仍用于任务、下载和暂存。预计完整动画解码超过预算的八分之一时明确显示静态缩略图；完整 GIF 不降采样。保存导入通知必须先于共享元数据缓存更新，避免首批缩略图漏刷新。1000 帧 256×256 RGBA 样本已实际导出并逐帧核对；该结果不替代整个应用进程族的内存峰值验收。

`video.watermark` 增加 `frontendBytes`，计入前端保留文件。原检测器保留 60 个完整时序采样，采样、stack、方差及视频缓冲进入预算；小于 120×60 的输入在启动前以 WATERMARK_DIMENSION_LIMIT 拒绝，避免原角落区域计算失败。修复临时 PNG 位于所属任务输出目录，正常完成后清理；取消遗留文件仍由任务拥有，不作为正式结果。工作台使用统一任务客户端、0–100% 进度、确认取消和本地视频预览；旧兼容路由保留。
