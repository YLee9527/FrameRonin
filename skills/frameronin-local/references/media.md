# 确定性加工

查询 `scripts/frameronin.py operations` 获取当前操作、参数范围、输入类型、输出和处理方式。不要猜操作名，不用 ImageGen 代替裁剪、缩放、补帧或格式转换。

任务 JSON：

```json
{"operation":"image.resize","inputs":["已导入的版本 UUID"],"parameters":{"width":64,"height":64,"filter":"nearest"}}
```

先 `preview --project <project> --file <task.json>`，再根据用户已授权的加工要求 `submit`。`wait --task <id> --timeout 60` 最多等待一分钟；长任务继续查 `status`。成功结果是素材版本 ID 数组，用 `version` 取正式路径并查看产物。进度、日志或文件存在不代表任务成功。`cancel --task <id>` 先递增执行代次并标记取消，再停止所属进程组；迟到登记被拒绝。

内存预算是物理内存四分之一、最高 2 GiB；预估包含解码、输入副本、中间数组、模型、编码和输出，运行时监控进程族峰值。超限明确失败，不静默缩小素材。8192 RGBA 裁剪、翻转、最近邻缩放保持原尺寸语义；PerfectPixel 保留原算法最大边长 2048 预缩放并报告尺寸。全局 FFT、调色和光流不得擅自改成独立分块。

大量帧优先 PNG ZIP 流式输出，核对帧顺序与索引时长。GIF 全局调色板会占用额外内存；在启动前预算不足时换 PNG ZIP，需说明原因。成熟抠图使用 rembg/U2Net，首次模型准备必须完成后再验收。

交互式像素还原、双背景、透明边缘、网格、光流和散图工具由 [工作台](workbench.md) 承载，沿用原算法。对最终文件比较解码像素、透明度、尺寸、帧数、时长及索引；编码文件字节不同并不一定代表像素不同。

`sequence.opticalFlow` 直接复用原 OpenCV.js 双向 Farneback、平滑、位移限制与融合算法，在受控 Node 进程执行。参数为 alpha、nearestNeighbor、bidirectional、quality（fast/balanced/high）、smoothFlow、maxMotionRelative；2–500 张同尺寸帧输出 2N−1 PNG 帧和报告。每帧对完整处理，不独立分块。16×512 固定样本的 31 帧通过浏览器与后台严格 RGBA 对照。工作台补帧页支持取消；离开页面后任务继续，在项目面板读取正式结果。

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

自定义切片的 `image.customSlicePlan`、`image.customSlice`、`image.customCompose` 内核已通过原浏览器对照，原界面接入与专用文档仍在迁移。三者都需要浏览器执行端，不能通过 CLI 或通用提案直接提交；当前原入口尚不能视为完成了统一取消和保存验收。完整参数以注册表及仓库 API 文档为准，勿以普通规则切片替代 L7、行带错位、单行折线和带镜像的重排。
