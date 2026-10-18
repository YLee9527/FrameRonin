# CLI 与本地 API

`video.capture` 接收一份正式视频版本，参数为 `renderer=browser-worker`、`frontendBytes` 和精确 `layout={sourceWidth,sourceHeight,start,end,fps,maxFrames,crop:{left,top,right,bottom}}`。显示尺寸为 1–30000 整数，起止秒为 0–86400 且 end>start，FPS 为 1–60 有限数，最多 2000 帧。裁边允许有限小数和原版重叠裁边，PNG 画布向下取整并至少 1px；时间戳按原版反复累加间隔。输入 ≤200 MiB，不支持的原生编解码器明确失败，不静默改用 FFmpeg。CLI/通用提案不能直接执行该宿主操作。

宿主在任务 ready 后使用 `GET /api/tasks/{id}/browser/input?generation=N` 读取该任务唯一的已登记视频；不接收客户端路径或素材 ID，逐 MiB 校验内容并复查状态/代次，响应 `Cache-Control: no-store`。其他操作、未 ready、取消或过期代次拒绝。原生媒体元素仅协调解码及异步快照；最多一个可转移帧进入专用 Worker，后者负责裁切、PNG 与 ZIP 编码，不依赖动画回调。任务取消清理解码器、对象 URL 和 Worker，迟到快照关闭而不使用；最终上传仍由后台核对 PNG 成员、尺寸、数量及取消代次后发布 ZIP/报告。

取帧预算为 256 MiB + 视频字节×2 + max(显示像素,真实编码像素)×96 + 编码缓存上限×8 + frontendBytes。缓存上限取 min(128 MiB,帧数×(输出像素×5+输出高度+1024))，同时检查最终 ZIP 和所有 PNG 字节总和。原生显示尺寸与时长在解码后再次核验。实际测试页验证原版对照与正式队列，不代表完整视频编辑器、保存/重开或联合 RSS 已通过。

视频逐帧内核 `video.frameTools` 接收一份连续命名 `frame_000.png` 等的 PNG ZIP，以及 matte 模式可选的第二份画笔 PNG。参数为严格 layout、renderer=browser-worker、frontendBytes；CLI/通用提案不能直接执行。它保留原 ParamsStep 的逐帧算法，尚不能替代视频解码、裁切、选帧和完整工作台验收。

layout 按模式使用精确字段：analyze 只有 mode；select 为 mode/selected；archive 为 mode/selected/kind（extracted 或 matted）；matte 为 mode/selected/background/tolerance/feather/mask；compose 为 mode/width/height/padding/spacing/columns/timestamps/strokeWidth/strokeColor。selected 为升序唯一源索引，最多 2000 帧。色度键容差 1–100、羽化 0–30，边距/间距 0–64、列数 1–64、描边 0–16；有限小数保留。timestamps 与全部输入帧一一对应，范围 0–86400 秒。目标边长 1–30000，最终画布边长取整且不超过 30000；原索引的 sheet_size 保留计算得到的小数值。

analyze 输出 ZIP 中的 analysis.json，保留原稀疏指纹及碰撞语义，仅标记不删除帧。matte 输出连续 PNG 帧 ZIP，使用原 destination-out 遮罩；第二输入必须是静态 PNG ≤20 MiB。archive 保留所选 PNG 原字节及原 frames/frame_00001.png 或 matted_frames/matte_00001.png 命名。compose 输出 sprite.png/index.json ZIP，保留原无放大、居中、小数布局及描边前后两次缩放/边距；索引行按稳定 i 排序，避免原异步载图造成行序不确定。

select 为原“跳过抠图”的连续帧传输：所选原 PNG 按顺序复制为 frame_000.png 等，供后续图集使用。后台逐成员解码，并分块核对与原文件字节相同；即使像素相同，重新编码的替代 PNG 也不能通过。它不烘焙尺寸、画笔或色度键，不替代 archive 的原下载命名。

输入/输出 ZIP 及累计未压缩成员均限制 128 MiB，拒绝未知成员、链接、加密及不支持的压缩格式。导出 ZIP 只接受该模式的精确成员，包括原命名需要的目录项。内存估算为 256 MiB +（输入 ZIP、其 PNG 成员及可选遮罩字节）×12 + 最大单帧/中间帧像素×96 + 输出像素×32 + frontendBytes。PNG、索引、分组和原字节复制逐项校验，最后核对取消代次才发布结果及报告。内核对照和正式队列发布不等于完整视频界面已接入。

独立抠图内核 `image.matteTool` 接收正式图片版本列表，以及 `layout`、`renderer=browser-worker`、`frontendBytes`。`layout` 采用严格的模式参数：chroma 为 mode/keyColor/tolerance/smoothness/spill/erosion；whiteErode 为 mode/tolerance/smoothness/erosion；doubleBg 为 mode/tolerance/edgeContrast；repair 只有 mode；frontier 为 mode/erosion。字段不可混用，未知字段直接拒绝。色度键和白底容差/平滑、抑色范围 5–100，侵蚀 0–100，双背景容差/边缘对比 50–100，保留有限小数及原遍数舍入。

DoubleBg 恰好读取两张同显示尺寸的图片，保留原先的 PNG 归一、自动 48/96 去水印及差分链；其他模式读取一张。输入为静态 PNG/JPEG/WebP ≤20 MiB，repair/frontier 可继续使用 origin 为 image.matteTool 的正式 PNG ≤128 MiB。输出为一张原显示尺寸 PNG 和报告，每边 ≤30000px、文件 ≤128 MiB。完整工作集估算为 256 MiB + 所有输入像素×192 + 所有输入文件字节×12 + frontendBytes，超限不缩小。

白底模式保留原 WebGL 着色器；Worker 核对纹理、视口、绘制缓冲、帧缓冲和上下文状态，不支持时明确失败。JPEG 的 Canvas 解码与 GPU 上传路径分别保持原行为，旋转先展开再交由 WebGL 翻转，避免组合旋转造成单列错误。双背景遮罩加载或解码失败不再静默跳过/近似去水印。独立 ImageMatte 工作台已接入上述任务，支持正式 image-matte 文档、统一历史、有界预览及原像素取色。原生画布拖放和联合资源等验收缺口见专项证据，不能由内核或按钮检查推断全部交互完成。

精灵表输入操作 `image.sheetPreprocess`、`image.sheetPrepare`、`image.sheetFrames` 均要求宿主 `browser-worker`。前两项输入一个正式静态 PNG/JPEG/WebP（≤20 MiB）；Frames 输入受控 PNG 帧 ZIP。独立 SpriteSheetAdjust 与集成 SheetPro 已接入同一受控工作台、正式文档和统一历史。

Prepare 对 origin 为 `image.sheetPreprocess` 的正式 PNG 结果允许使用既有 128 MiB 输出上限，仍核对完整解码/输出预算。上传原图继续限制 20 MiB；不能只凭客户端参数放宽。该例外避免 JPEG/WebP 预处理成 PNG 后编码体积增大而打断合法流程。

Preprocess 的 `layout` 使用原 16 项设置：watermark、cropTop/Bottom/Left/Right、padTop/Right/Bottom/Left、resizeEnabled/W/H/KeepAspect、matteMode/Tolerance/Feather。裁切和补边范围 0–4096、目标尺寸 1–8192、容差 0–441、羽化 0–64；有限小数按原算法四舍五入。顺序为水印、内裁、透明补边、最近邻缩放、左上角取色抠图。无实际变化返回 SHEET_PREPROCESS_NO_EFFECT；调用方应保留原版本，不创建伪加工结果。完整预算核对最大中间图，不能靠最终缩小绕过。

Prepare 的 `layout` 为 `{mode:'whole'|'uniform',columns,rows}` 或 `{mode:'transparent'}`。Whole 保留分配余数和最小 1px 格，列数 1–64、行数 1–4096且总格数≤4096，覆盖透明拆分后自动推导的行数；Uniform 保留固定向下取整格及末端余数丢弃，行列 1–32，零尺寸拒绝。Transparent 沿用全图透明行列分割和底部/水平居中统一尺寸，最多 4096 帧，透明度非零即有内容；空图拒绝。输出连续命名的 PNG ZIP 及尺寸报告。

Frames 的 `layout={order,blank}`，order 是非空唯一源索引数组，blank 为 null 或 `{width,height}`。保留帧必须逐字节复制原 PNG，不能带入偏移或裁边；可在末尾添加全零 RGBA 空白帧，总帧数不超过 4096。接收端逐帧验证尺寸、保留成员的原字节及空白像素；长验证逐帧/分段检查任务取消与代次。全部输出仍经统一完成事务登记。

输入拆分预算包括 256 MiB 余量、源像素×48、源文件字节×8、全部输出像素×16及前端保留量；预处理包括 256 MiB、源像素×16、最大中间像素×192、源文件字节×12及前端保留量。Frames 沿用调整内核的完整 ZIP/解码/输出预算。预算上限、PNG ZIP 及输出 128 MiB、30000px 边长限制仍需同时满足；源解码前先检查，不能静默降采样。

精灵表调整操作 `image.sheetCompose`、`image.sheetGif`、`image.sheetFix` 输入受控、连续命名的 PNG 帧 ZIP，参数为 `layout`、`renderer=browser-worker`、`frontendBytes`。工作台按钮使用正式队列；撤销、重做和重开只复用结果版本。

Compose 的 layout 为 `{columns,rows,frames}`，frames 为 `{sourceIndex,dx,dy,crop:{top,bottom,left,right}}` 的有序数组；保留小数裁边与负数透明扩边，偏移限整数，所有帧共同决定格子尺寸。Gif 另加唯一 selected 集合和 speedScale（0.25–4），只输出选中帧，顺序始终按当前 frames 列表，不按 selected 数组的顺序；共同尺寸仍按全部帧计算；原 100ms 基准、50ms 最小间隔及 GIF 舍入行为保留。Fix 为 `{selected,referenceWidth,referenceHeight,fixes}`，每个 fix 为 `{imgX,imgY,range,data}`，range 为 1–8、data 为精确 RGBA 字节；最后覆盖的修补优先，只改选中帧。

ZIP 最多 4096 帧/128 MiB，输出最多 128 MiB、每边最多 30000px，仍须通过完整工作集预算。输出逐帧核对容器、尺寸、数量与时长，取消代次和统一完成事务继续有效。CLI/通用提案直接执行拒绝；工作台文档保存原件、来源链、帧状态及各结果自己的输入引用。

精灵表按行 GIF 使用 `image.spriteGifs`，输入单个正式静态图片版本，参数 `renderer=browser-worker`、`frontendBytes`、`layout={columns,rows,order,framesPerRow,duration}`。行列 1–64，order 为唯一且有效的原网格索引，最多 4096 帧；每行 1–128 帧，时长 20–500ms。沿用原 gifenc 的 10ms 四舍五入、逐帧调色板、透明度阈值和每行最大尺寸左上对齐。输出按顺序 `row_01.gif` 等组成的 ZIP 和报告；接收端逐帧核对尺寸、数量和时长，随后由统一事务登记。CLI/通用提案不能直接提交需要宿主 Worker 的任务，不能以近似后端编码器代替。

精灵表 PNG 拆分复用 `image.customSlice` 网格模式，保留余数分配和最小 1px 的原算法。GIF 预备帧也使用同一路径；正式 GIF 任务从冻结源图和审阅后的索引切取，不把全部解码帧堆在主线程。两种 ZIP 均限制 128 MiB。预览解包除了中央目录预检，还通过锁定 JSZip 的有界流累计实际解压量，接口缺失或超量直接失败；该检查同样用于自定义切图 ZIP 读取。

CLI 返回 JSON 并保留失败退出状态。`doctor`、`init`、`import`、`assets`、`version`、`checkout`、`verify`、`recover` 管理运行时和项目。`operations`、`preview`、`submit`、`status`、`wait`、`cancel` 管理加工。`ai-begin`、`ai-mark` 记录宿主生成尝试；`document-save/get/restore` 保存文档修订；`serve` 提供工作台。

任务 JSON 字段仅允许 `operation`、`inputs`、`parameters`、可选 `assetId`。输入是正式版本 UUID；参数由操作注册表定义，不允许命令和任意读写路径。执行前重验内容与预算。

HTTP 接口：`GET /api/project`、`POST /api/assets`、`GET /api/versions/{id}` 及 `/content`、`POST /api/tasks/preview`、`POST /api/tasks`、`GET /api/tasks` 及 `/{id}`、`POST /api/tasks/{id}/cancel`、`GET /api/documents` 及 `/{id}`、`POST /api/documents/{id}`、`POST /api/ai/requests`。

`POST /api/tasks/manifest` 接收 `{tasks:[canonical UUID...]}`，按请求顺序返回 id/state/operation/inputs/results；不执行任务，不返回历史参数、事件或路径。最多 8192 个唯一 ID，响应受 min(内存预算/16,16 MiB) 限制，任一 ID 不属于当前项目即失败。用于长编辑来源链，避免重复读取历史文件或仅靠最近 200 项任务列表。

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

像素操作：`image.pixelate(pixelSize=1..128)`、`image.mergeNearby(strength=0..100)`、`image.palette16(method=rgb|lab,dither)`、`image.pixellise(upscale=1..7,numColors=4..256,scaleResult=1..5,transparentBackground)`。四者及 `image.perfectPixel` 共用可选 `regionX/Y/Width/Height` 与 `frontendBytes`；四个区域字段默认 0 表示整图，指定时必须为图内非空整数矩形，不能只提供位置或一条边。

全部计算、输入解码、裁切和编码在受控 Node 任务内完成，正式 PNG 及 JSON 报告进入项目。报告含原尺寸、实际处理尺寸；Pixellise 另含请求/实际网格放大倍数。PerfectPixel 沿用最大边长 2048，Pixellise 沿用 4200 万检测像素上限和原放大倍数限制；额外预算不足直接拒绝，不再静默降低参数。全局网格、调色及误差扩散不独立分块。颜色数组、量化、抖动及完整输出上限分别估算；OpenCV 运行时保留 576 MiB 余量。预览尺寸与真实坐标分开，缩略图不改变任务输入或暂存内容。

编辑包络增加 `kind=pixel`。更新已存在文档时改变类型返回 DOCUMENT_KIND_CHANGED；类型改变应使用新 ID。统一任务客户端额外返回本次核验的 project 身份，结果文件据此复用正式版本缓存；保存或重开不能靠重导入得到新版本。候选恢复只创建未激活的 File 引用，当前文档没有变化后才接受，不提前分配画布或改写当前素材映射。

RoninPro 操作 `image.customScale`、`sequence.unifySize`、`image.findDuplicates` 的参数、范围以注册表为准。八个固定缩放预设沿用原始硬边缘缩放、左上角取色、三种抠图及右/下裁边；统一尺寸不缩放各输入；重复检测按真实单元尺寸分桶后逐像素核对，报告的 groups 使用 0-based 索引。后者支持原来的 64×64 单元，区别于其他序列入口的 1000 帧限制。

自定义缩放及常规图片的 `renderer=browser-worker` 是工作台专用模式，预览额外返回 requiresWorkbench=true 和 original_host_canvas_worker。CLI submit 与通用 proposal-execute 返回 WORKBENCH_REQUIRED，避免提交一个没有浏览器执行端的悬空任务；工作台同源 `/api/tasks` 可调度该模式。其他操作预览的 requiresWorkbench 为 false。注册表默认 native；需要原宿主像素行为的输入或参数未显式选择 Worker 时返回 BROWSER_RENDERER_REQUIRED，不能隐式切换滤波或解码器。

Worker 与后台队列之间通过 `/api/tasks/{id}/browser`（GET 就绪状态）、`/heartbeat` 与 `/failure`（POST，只接收 generation）、`/result`（POST multipart，generation 与 PNG）通信。仍由已有串行队列创建并持有受控后台进程；后者等待浏览器像素，核验结果后调用原统一完成事务。执行代次、当前 running 状态、PNG 真实格式、单帧及审阅尺寸均重验。上传不采用客户端路径或文件名；单次压缩内容最多 min(预算/4,128MiB)，完全写入及解码校验后才以不可覆盖的硬链接交付。取消先使完成代次失效，Worker 立即 terminate；本地进程停止确认仍只涵盖后台所属进程，不能据此推断浏览器或 AI 服务端状态。15 秒心跳丢失明确失败，不自动重试。

`GET /api/tasks/{id}/results` 在 succeeded 后返回按结果顺序的 id、name、metadata，逐版本核验内容，省去逐个获取元数据的请求。客户端核对清单与任务完全一致，整批预算通过后最多并行读取 8 个内容，仍按原顺序返回；读取失败或取消会停止剩余下载。超出预算的任务成功结果保留在项目，前端不先下载部分结果。该接口不返回绝对路径。

`POST /api/versions/manifest` 接受且仅接受 `{versions: UUID[]}`，1–8192 个唯一正式版本 ID。按请求顺序核验内容并返回 id、name、metadata，不返回路径；未知字段、遍历、失效版本、重复 ID 和超预算响应均拒绝，同源写入校验仍适用。工作台对超过 24 个已验证引用使用该接口，避免 4096 帧文档保存时逐个串行请求；较小集合最多八个并行读取，均核对返回 ID 和顺序。

统一尺寸与查重文档分别使用 ronin-unify、ronin-duplicates。恢复及保存核对正式输入/输出/报告与成功任务的绑定，不能将任意文件伪装为加工结果。参数修改、结果撤销或重做只保存文档修订，不重新提交任务。

自定义缩放文档使用 ronin-scale；editedFile 只能引用同尺寸正式图像，原结果与报告继续绑定成功任务。画布编辑使用一次性 Worker 的随机请求 ID、执行代次及 AbortSignal；主线程先使结果失效再 terminate，文件接收再次核对代次和取消。解码先读取最多 1 MiB 的 PNG/JPEG/WebP 头并预估，允许 EXIF 引起的宽高互换，其他尺寸变化拒绝；不支持的头及超限明确失败。估算包括每像素 40 字节、压缩文件双份、保留历史和 96 MiB 运行时余量。

独立精细入口使用 image-fine 文档与相同保存接口，无加工任务或结果报告。源图与编辑 PNG 分别保存版本；恢复预检包含源文件大小/格式和编辑 PNG 的实际显示尺寸。JPEG 使用 Worker ImageDecoder 保留原 HTMLImage 画布颜色，无该解码能力时明确报 FINE_EDITOR_JPEG_DECODER_UNAVAILABLE；PNG/WebP 保留已有解码路径。版本元数据增加 EXIF 方向、显示尺寸和容器格式，原编码尺寸继续保留。

共享精细编辑器不再在主线程做全图连通擦除、选区搬移或 PNG 编码。普通笔尖只读写局部矩形，沿用原像素圆判定；PNG 文件快照用于缩放及独立精细文档的统一撤销。内部像素历史最多 30 步并联合限制 256 MiB；正式文档另有有界文件历史，不能把共享 Worker 验收视为全部编辑器已完成。

`image.normal` 提供原常规图片的六种确定性配方：`apply`（裁切→可选全图色度键→硬边缩放→可选内描边）、`mattePreview`（裁切→全图色度键）、`extendBottom`（三行复制翻转扩展）、`rpgMaker`（水印修复→连通抠图→144×144→扩展）、`allActions`（水印修复→256×256→连通抠图→右/下各裁 4px）、`ancientCostume`（水印修复→256×256→连通抠图→1024×896 重排）。输入一个正式图像版本，输出 PNG 与报告。

参数含 `mode`、`renderer`、四个 `crop*` 非负边距、`width/height`（1–30000）、`keepAspect/pixelated/enableMatte`、`background/strokeColor`（六位十六进制颜色）、`tolerance`（1–100）、`feather`（0–30）、`strokeWidth`（0–20）及 `frontendBytes`。仅裁切阶段使用边距，须保留至少一个像素；其余配方保持原固定顺序和尺寸。完整中间缓冲、源文件及前端保留预算先行估算，输出超过 30000 边长或超预算拒绝。原生路径只接受无 ICC 的实际 PNG，且 apply 必须硬边缩放；JPEG/WebP、带 ICC 的 PNG 和平滑 apply 使用原宿主 Canvas Worker，不能用原生解码或滤镜近似代替。

常规工作台统一使用 browser-worker：源图预览和原图取色也在独立可取消 Worker 完成，主线程只绘制最长边 1024 的预览。裁切、取色及加工仍使用原图坐标与像素；预览尺寸不改变正式输出。JPEG 需要 ImageDecoder，否则明确报 NORMAL_JPEG_DECODER_UNAVAILABLE。源图预检不通过时保留当前文档。

六种配方使用既有任务队列、心跳、执行代次及统一发布；服务端按操作、输入版本和预期尺寸校验实际 PNG。取消先使结果失效并终止 Worker；取消后迟到上传拒绝发布。参数或输入变化后只保留项目结果，不覆盖当前文档；离开工具页后任务继续，关闭浏览器标签会终止其 Worker，失联按任务协议核对。`extendBottom` 实际扩展量为 floor(height/3)，保留原余数行行为；它使用上一张主结果，抠图辅助预览独立保留。普通短图不扩展时，工作台仍输出真实 PNG。

## 网格扩图与缩图

`image.expandShrink` 保留每格中心裁切/透明补边及原 Canvas 小数坐标，不对每格缩放。参数为 `columns/rows`（1–64）、`cellWidth/cellHeight`（1–512）、`renderer=browser-worker` 和 `frontendBytes`；输出一张真实 PNG 与参数报告。输入为已核验的静态 PNG/JPEG/WebP，最大 20 MiB。目标尺寸为列数×格宽、行数×格高；输入/输出边长不超过 30000，并在解码前核对完整内存预算。原算法在源格不足一个像素时输出透明格，此行为保留。

该操作始终需要原宿主 Worker，默认参数也返回 requiresWorkbench=true；CLI 与通用提案执行返回 WORKBENCH_REQUIRED，不创建悬空任务。默认 renderer 在任务接收端按注册表解析，不能仅检查原始 JSON 是否显式包含该字段。JPEG 需要 ImageDecoder；缺少时返回 EXPAND_SHRINK_JPEG_DECODER_UNAVAILABLE，不换解码器。

预算为 256 MiB 运行时余量、源像素×40、目标像素×40、文件字节×8 与前端保留量之和，并由 Worker 再检。服务端验证收到的单帧 PNG 尺寸与原任务一致后，沿用执行代次和统一发布。离开工具页后继续，关闭标签后核对失联；不自动重做。

## 零散识别与切片

`image.scatterDetect` 接收 detect（mode=auto/alpha/colorkey、colorKey、threshold=1–120、mergeGap=0–24、minPixels=1–900000000、minSide=1–30000）、order（row-major/column-major）、frontendBytes。输出原图尺寸及画框 JSON、参数报告。保留原四连通检测、先过滤后传递合框、8px 排序容差；输出最多 4096 框、合并前最多 16384 个合格区域，超限明确拒绝。

`image.scatterExport` 接收审阅后的 layout：`{format,quality,entries:[{box,name}]}`。format 为 png/jpeg/webp，quality 为 0.4–1；box 含唯一 ID、图内 x/y/w/h 与可选 kind/name/row/col。entries 是执行前固定的顺序和最终文件名，避免服务端另写排序算法改变原浏览器的比较器行为。拒绝未知字段、重复 ID、越界、路径分隔符、控制字符、无效 UTF-8、超过 255 UTF-8 字节或 NFC/大小写折叠后重名的文件；不再静默覆盖 ZIP 成员。

两项仅使用 `renderer=browser-worker`，预览返回 requiresWorkbench=true，CLI/通用提案直接执行拒绝。源图为静态 PNG/JPEG/WebP ≤20 MiB；解码和完整算法在一次性 Worker 中，界面仅绘制最长边 1024 的预览。保留原 CPU-readable 源画布及 bitmap 解码路径；本模块强色度边缘 JPEG 的 ImageDecoder/VideoFrame 对照失败，不能沿用其他工具的解码假设。

预算含 256 MiB 余量、源像素×32、文件字节×8、前端保留量和 16384×512 区域余量；导出另加全部裁片像素×16及最大裁片像素×16。输入准备还受共享精细入口的更保守预算约束。收到 JSON 时校验尺寸、字段和画框；收到 ZIP 时核对成员完整顺序/名称、实际图片格式及 floor(w)×floor(h)，拒绝目录、加密、链接与未支持压缩方式，不解压到文件系统。编码总量上限 min(预算/4,128MiB)。

`/browser/result` 仍只接受 generation 和上传内容，不使用客户端路径；先完整校验，再在写入锁中复验执行代次并交付 JSON 或 ZIP。统一完成事务登记结果和报告。取消立即失效并 terminate Worker；前端参数/输入/画框改变后旧结果只留项目。关闭浏览器标签的失联语义与其他宿主 Worker 相同。

## 自定义切片处理内核

以下三个操作现已接入 RoninPro 自定义切片工作台、正式文档与统一历史。三者均为 `renderer=browser-worker`、requiresWorkbench=true，CLI 与通用提案直接执行拒绝，不创建无人提供浏览器结果的任务。保留浏览器标签；工具页内导航后任务继续，关闭标签则按失联规则核对。

`image.customSlicePlan` 接收一个静态 PNG/JPEG/WebP（≤20 MiB），参数为 mode（grid/auto）、columns/rows（1–64）、refine（l7/uniform）、bandPercent（10–50）及 frontendBytes。使用原透明行列检测、整行/列 Alpha 搜索及相同代价时的最近名义切线规则。单行保持均匀竖线，拐点默认为高度一半。返回格式 1 的 JSON、源尺寸、行列、完整边界、零行偏移、bendY/deltaX，以及参数报告。自动检测可超过 64 行或列，但总格数不超过 4096。

`image.customSlice` 接收严格 layout：grid 的 columns/rows；regions 的 `{id,x,y,w,h}[]`；bands 的 colStarts/rowStarts/bandColOffset；或 polyline 的 colStarts/bendY/deltaX。字段按模式精确匹配。保留原余数格、小数区域取整、右/下边缘裁断、多行错位、单行折线的两矩形硬拷贝及拐点为 0 时的多边形裁切。网格比源像素密时保留原最小 1px 格行为。自定义区域起点必须在源图内，拒绝原先可能产生无意义透明 1px 的图外起点；宽高跨越边缘时仍按原算法截到边缘。

输出为按零起始序号命名的 `frame_000.png` 等 ZIP 和报告，最多 4096 帧。ZIP 不增加清单文件，保持原导出结构；报告单独记录每帧尺寸。接收端核对完整成员名、顺序、PNG 格式、单帧及预计尺寸，完全解码后才允许统一发布。

`image.customCompose` 读取一个已导入的切片 ZIP，composition 包含 rows、columns、grid、expandUp/Down/Left/Right。格数最多 4096，每方向补边 0–149；grid 严格为对应矩阵，0 留空，正数为从 1 开始的帧，负数水平镜像。保留最大尺寸格子内的右对齐、垂直居中及整格镜像。输出真实 PNG 和报告，目标边长不超过 30000。149 上限覆盖原 150px 向上扩展预设对 1px 帧的要求；八种预设及向上扩展已经实际验证。

源图/切片预算包含 256 MiB 余量、源像素×40、文件字节×8、前端保留量、全部输出像素×16及最大帧像素×16。合成在 ZIP 膨胀前检查中央目录：最多 128 MiB 压缩文件、min(预算/8,128MiB) 成员编码总量，仅按顺序的 PNG、无目录/链接/加密，支持 STORE/DEFLATE。合成预算另计压缩字节×4、展开 PNG 字节×4、最大帧像素×40、输出像素×32和前端保留量；逐次解码所需帧并关闭，避免把所有帧同时解码。JPEG 直接裁切使用已对照的 ImageDecoder/VideoFrame 路径；不继承散图工具的中间画布解码假设。

源预览最长边 1024，ZIP 预览最多 24 张、每张最长边 128，均在可取消 Worker 中生成；原文件与全部帧用于下载、暂存及加工。L7 展示画布限制 920×640 CSS px、DPR≤2，手动坐标仍对应原图。自动检测与切分是同一次明确操作的两个正式任务；恢复、撤销与重做不启动自动检测。迟到结果只留在项目中，不覆盖新的参数或未结束手势。

旧重排 TXT 是兼容导入，最大 256 KiB；行列归一到 1–64，无效帧编号归零，未知字段和布局外格子显示丢弃提示。无效 JSON 保留当前内容。此兼容规则不放宽严格 AI 提案或加工参数校验。

## 图片可见水印

`image.visibleWatermark` 接收一个静态 PNG/JPEG/WebP（≤20 MiB、边长≤30000），参数为 `sizeMode=auto|48|96`、`renderer=browser-worker` 及 `frontendBytes`，输出同尺寸的真实 PNG 与参数报告。auto 仅在宽高均大于 1024 时选择 96；否则为 48。保留原独立入口的右下位置、内置 48px 遮罩及其 96px 缩放、负起点裁断和逆 Alpha 算法；96 模式使用 0.85 强度，与蓝图中强度为 1 的既有调用分别保留。

解码、像素处理和编码均由可取消宿主 Worker 执行，JPEG 使用已通过原浏览器对照的 ImageDecoder/VideoFrame 路径；不支持时明确失败。内置遮罩无法解码也明确失败，保留旧结果，不静默改用原入口的近似遮罩回退。该故障处理修正与正常算法对照分别记录。仅处理可见水印；算法复刻不代表重压缩/缩放图片的实际残留质量达标。

预算包含 256 MiB 运行时余量、源像素×40、文件字节×8及前端保留量，启动及 Worker 解码前均检查。输出接收重验 PNG、单帧、原显示尺寸、任务状态及执行代次后统一发布。CLI/通用提案执行拒绝，保留浏览器标签；工具页内导航后继续。输入准备将取消信号传入导入请求，已经接受的不可变副本可能保留，但迟到候选不得替换当前文档。
