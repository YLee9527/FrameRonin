# 确定性加工

视频抽帧入口使用正式 video 文档和受控工作台：上传或直接打开已保存文档，设置时间/FPS/最多帧数，数字或拖拽裁切，再提取和选帧。video.capture 使用原生解码和 Worker 裁切/PNG/ZIP，保留原帧时间、小数和重叠裁边，读取当前任务已校验的正式项目副本；video.frameTools 负责去重标记、抠图/遮罩、原帧归档及图集/描边。两者要求宿主能力，不通过 CLI/通用提案直接调用，不能用 video.extract 替代整套行为。原生编解码器不支持时明确拒绝，不静默换解码器改变颜色或帧。

video.frameTools 的 select 模式用于跳过抠图，连续 PNG ZIP 保留所选原字节。选帧采样按当前选中列表的一基位置执行；图集 PNG 画布取整，索引保留原小数排版。当前参数与已生成结果独立，修改后须再次执行才应用；描边归零及撤销只切换已有结果。正式保存、另存、重开、冲突和迟到保护已接入。离开编辑页后正式任务继续，后续必要分析仍执行，最终结果留在项目面板；临时预览/取色/画笔可取消。更多真实格式、联合内存与完整可访问性仍见待完成清单。

查询 `scripts/frameronin.py operations` 获取当前操作、参数范围、输入类型、输出和处理方式。不要猜操作名，不用 ImageGen 代替裁剪、缩放、补帧或格式转换。

任务 JSON：

```json
{"operation":"image.resize","inputs":["已导入的版本 UUID"],"parameters":{"width":64,"height":64,"filter":"nearest"}}
```

先 `preview --project <project> --file <task.json>`，再根据用户已授权的加工要求 `submit`。`wait --task <id> --timeout 60` 最多等待一分钟；长任务继续查 `status`。成功结果是素材版本 ID 数组，用 `version` 取正式路径并查看产物。进度、日志或文件存在不代表任务成功。`cancel --task <id>` 先递增执行代次并标记取消，再停止所属进程组；迟到登记被拒绝。

内存预算是物理内存四分之一、最高 2 GiB；预估包含解码、输入副本、中间数组、模型、编码和输出，运行时监控进程族峰值。超限明确失败，不静默缩小素材。8192 RGBA 裁剪、翻转、最近邻缩放保持原尺寸语义；PerfectPixel 保留原算法最大边长 2048 预缩放并报告尺寸。全局 FFT、调色和光流不得擅自改成独立分块。

大量帧优先 PNG ZIP 流式输出，核对帧顺序与索引时长。GIF 全局调色板会占用额外内存；在启动前预算不足时换 PNG ZIP，需说明原因。成熟抠图使用 rembg/U2Net，首次模型准备必须完成后再验收。

交互式像素还原、双背景、透明边缘、网格、光流和散图工具由 [工作台](workbench.md) 承载，沿用原算法。对最终文件比较解码像素、透明度、尺寸、帧数、时长及索引；编码文件字节不同并不一定代表像素不同。

独立抠图的 `image.matteTool` 保留色度键、白底 WebGL、双背景、修复和贴边侵蚀，必须从工作台启动宿主 Worker；CLI 或通用提案不能直接执行。双背景仅接受按黑、白顺序选择的同尺寸版本，自动去水印失败会报错。工作台保存 image-matte 正式文档及已有结果；修复从原抠图结果计算，贴边侵蚀始终从修复版本重算，归零直接切回修复结果。`image.matte` 的 rembg 模型处理是另一操作，不用它代替原算法。

`sequence.opticalFlow` 直接复用原 OpenCV.js 双向 Farneback、平滑、位移限制与融合算法，在受控 Node 进程执行。参数为 alpha、nearestNeighbor、bidirectional、quality（fast/balanced/high）、smoothFlow、maxMotionRelative、frontendBytes；2–500 张同尺寸帧输出 2N−1 PNG 帧和报告。每帧对完整处理，不独立分块。16×512 固定样本的 31 帧通过浏览器与后台严格 RGBA 对照。工作台补帧页支持取消；离开页面后任务继续，在项目面板读取正式结果。

本地取消返回 processStopConfirmed 和 cancelElapsedSeconds，并保存任务 cancellation.json；此确认只涵盖本地受控进程。身份或停止权限无法核验时，结果先失效，再报告 CANCEL_* 错误，不伪造停止成功。AI 服务端状态仍需核对宿主调用。

`audio.compress` 接收按顺序选定的音频版本及 bitrate（32–320 kbps），产生各 MP3、ZIP 和对应报告。同名文件以序号区分，核对声道、时长、码率与采样率。当前本地 FFmpeg/libmp3lame 保留支持的输入采样率；旧浏览器 Lame.js 使用 AudioContext 的设备采样率，编码字节及延迟不要求完全一致。不要把该差异称为严格像素式复刻。

GIF 工作台使用原浏览器兼容模式：`gif.split` 的 `renderer=browser` 复用 gifuct 和原透明块/处置逻辑，返回每张 PNG、按顺序 ZIP 与含时长的报告。支持 1–1000 帧，PNG 不会被当作 GIF 接受。默认 `renderer=pillow` 使用 Pillow 合成，二者处置语义分开记录。

`sequence.gif` 的 `renderer=browser` 保留 gifenc 逐帧调色板及原透明度阈值，`sizePolicy=first` 按第一帧尺寸缩放其他输入，与原界面一致；默认 `sizePolicy=reject` 拒绝尺寸混用。兼容模式仅支持原来的无限循环 `loop=0`，不会静默忽略其他值。Pillow 默认仍使用同尺寸输入与全局调色板。工作台先核对保留素材预算，通过统一任务取消、版本登记和迟到结果检查；离开工具页后在项目面板查结果。超出预览预算的正式结果继续保留。

`video.watermark` 使用原完整时序检测与 OpenCV 修复，最小尺寸 120×60；不把全局采样改为独立分块。采样和前端文件超过预算时拒绝。工作台支持取消、后台继续、MP4 预览及下载，原音轨以流复制保留。固定合成样本的输出与原实现相同，但小字仍可留下亮色残影；算法一致性不能代替真实素材质量检查。未检测到水印时明确失败，不登记伪成功输出。

像素工具使用 `image.pixelate`、`image.mergeNearby`、`image.palette16`、`image.perfectPixel` 和 `image.pixellise`。先查注册表范围；需要局部处理时提供完整 regionX/Y/Width/Height 矩形。PerfectPixel 最大边长 2048、Pixellise 原全局网格和放大上限保留；其他预算限制明确拒绝，不擅自改成分块或额外缩小。结果附处理尺寸及参数报告，工作台也显示实际尺寸。14 组固定对照通过，不代表任意半透明或所有格式都已验证。

RoninPro 三项独立操作：`image.customScale` 保留目标尺寸、比例、最近邻硬边缘，以及 FFFF/FFFB/FBFB/FBFF/C0C0/C0BE/BEBE/BEC0 八个固定缩放、三种抠图、裁边组合；`sequence.unifySize` 保留最大宽高的透明补边和水平/垂直九种整数对齐；`image.findDuplicates` 按 1–64 行列切分，保留余数分配和同尺寸精确 RGBA 分组，输出顺序 PNG 与从 0 开始的分组报告。后者原入口不是帧复制；帧复制在 Rseprite 和蓝图行列复制操作中。

普通缩放的 `pixelated=false` 必须在工作台执行：原浏览器滤波由专用 Canvas Worker 承载，使用 `renderer=browser-worker`。预览返回 `requiresWorkbench=true`；CLI 和通用提案执行明确拒绝直接提交，不用近似的原生滤波代替。Skill 应打开自定义缩放工具设置参数并执行。八个固定预设始终采用原硬边缘参数。Worker 不可用或连接丢失会失败，不能自动重做。离开工具页后当前 Worker 和队列继续；关闭整个浏览器会失去心跳并失败，不能承诺关闭浏览器后继续。

这三项的加工结果、输入与参数均可保存为正式文档；自定义缩放另保留精细绘制 PNG。统一撤销/重做复用已有版本，不重新加工。所有参数与输入改变都使当前视图不再接受旧任务结果；原件仍保留，已成功结果在项目中可查。其他加工入口与完整联合资源验收继续按仓库对照表执行。

常规图片 `image.normal` 提供 apply、mattePreview、extendBottom、rpgMaker、allActions、ancientCostume 六种原配方，输出 PNG 和参数报告。执行前查询参数与预算。工作台在可取消 Canvas Worker 中保留原平滑缩放与解码行为；CLI 原生模式仅接受无 ICC 的 PNG，且 apply 必须硬边缩放。需要宿主模式时使用工作台，不自动改用近似滤镜或解码器。底部扩展读取上一主结果，按三行复制翻转，扩展高度为其高度的三分之一取整；一键配方固定尺寸不受常规参数影响。

网格扩图/缩图 `image.expandShrink` 按 N×M 每格中心裁切或透明补边，保留原小数坐标及默认滤波，不缩放每格。使用工作台“扩图与缩图”执行；CLI 预览能核对参数与预算，但直接提交返回 WORKBENCH_REQUIRED。输入静态 PNG/JPEG/WebP ≤20 MiB，行列 1–64、格宽高 1–512；输出目标尺寸及完整预算超限时明确拒绝。AI 创意扩图按 ImageGen 参考执行。

零散切图使用工作台 RoninPro → 零散切图。`image.scatterDetect` 保留自动/Alpha/色键、四连通及合框；`image.scatterExport` 按审阅后的画框、顺序和名称输出 PNG/JPEG/WebP ZIP，两者都需要宿主 Worker。输入静态 PNG/JPEG/WebP ≤20 MiB，最多 4096 框；重名、越界、超预算或不支持的实际编码明确失败。不要用固定网格切片代替本入口，也不要通过 CLI 提交没有浏览器执行端的任务。

自定义切片的 `image.customSlicePlan`、`image.customSlice`、`image.customCompose` 已接入工作台、统一取消和正式文档。三者需要浏览器执行端，不能通过 CLI 或通用提案直接提交。保留 L7、行带错位、单行折线、区域裁切及带镜像的重排，不以普通规则切片代替。最多 4096 格；四向补边各 0–149px，包含原八种尺寸预设和向上扩展。完整参数、资源预算及格式范围以注册表及仓库 API 文档为准。

图片右下角可见水印使用工作台的 `image.visibleWatermark`，支持 auto/48/96，保留原逆 Alpha 和独立入口的 96px 强度。静态 PNG/JPEG/WebP 最大 20 MiB，受完整预算和原尺寸限制；结果保存为正式 PNG 与报告。此模式需要宿主 Worker，CLI/通用提案直接执行拒绝。原图经重压缩或缩放后可能有残留，应检查实际素材；不可见水印不在该工具范围内。

精灵表按行 GIF 使用工作台的 `image.spriteGifs`，严格布局为 columns、rows、唯一 order、framesPerRow、duration，输出有序 GIF ZIP 与报告。保留原每行最大尺寸左上补透明、独立调色板和 GIF 10ms 时长舍入。原网格切分使用 `image.customSlice`，行列最大 64、总帧数最大 4096；每行 GIF 最多 128 帧、时长 20–500ms、ZIP 最大 128 MiB。静态 PNG/JPEG/WebP 最大 20 MiB，仍受完整工作集预算约束；必须保留宿主浏览器执行端，不使用近似的后端编码替代。

AdvancedPixel 已接入受控光流、比例网格拆分和图集/ZIP 导出，支持正式文档、统一历史、取消与离开后继续。JPEG/WebP 和有方向 PNG 先由 image.flowNormalize 宿主 Worker 转成正式规范 PNG，避免原生解码的颜色/方向差异；普通无方向 PNG 可直接加工。源图 ≤20 MiB、边长 ≤30000，受控中间 PNG 沿用 128 MiB 输出上限，完整工作集仍须符合预算。直接对非规范图调用 flowSplit/opticalFlow/flowExport 会明确拒绝，使用工作台先归一，不静默换解码器。
