# 功能逐项对照

| 操作 | 原入口 | 原实现 | 输入 → 输出 | 验收状态 |
| --- | --- | --- | --- | --- |
| video.fps | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 原生样本 15 项及小数 FPS 对照、实际 60fps/1000 帧工作台通过；更多格式和联合资源继续验收 |
| video.range | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 原时间累加与范围对照、实际原生播放/循环和具名滑块键盘通过；完整可访问性继续验收 |
| video.maxFrames | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 2000 帧上限校验、1000 帧实际选帧/重开/下载和计算中取消通过；高分辨率联合资源继续验收 |
| video.crop | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 整数/小数/重叠裁边原版对照、实际拖拽/键盘/整手势撤销和 58×41 下载通过；更多真实媒体继续验收 |
| video.background | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 原色度键/画笔对照、实际取色/遮罩/抠图与跳过原字节传输通过；真实素材质量继续验收 |
| video.sheet | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 小数排版与 1.5px 描边实际导出严格原版对照、归零/历史复用及迟到保护通过；联合资源继续验收 |
| video.png | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 实际中文名 PNG 下载严格原版像素/字节相同，正式文档保存/重开通过；完整格式继续验收 |
| video.zip | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 实际原帧/抠图/图集 ZIP 对照及 1000 帧 PNG 字节相同；离开后结果项目下载通过 |
| video.index | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 实际索引下载与原版固定配方相同；保留小数尺寸/时间戳、稳定帧索引及文档来源核对 |
| video.detect | 视频水印 | reference/frontend/src/components/SeedanceWatermarkRemover.tsx | video → clean MP4 | 固定角标视频对照原检测/修复实现通过；小于 120×60 及资源超限预先拒绝，真实品牌水印质量待验收 |
| video.remove | 视频水印 | reference/frontend/src/components/SeedanceWatermarkRemover.tsx | video → clean MP4 | 后台修复及工作台真实取消/离开后运行通过，固定输出视频与原实现严格相同；小字样本保留原残影，质量不记为通过 |
| video.mp4 | 视频水印 | reference/frontend/src/components/SeedanceWatermarkRemover.tsx | video → clean MP4 | 正式 MP4 下载与版本字节一致，24 帧与原输出严格 RGB 相同，原 AAC 解码 PCM 相同，工作台完整播放通过 |
| sequence.gif-split | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 原浏览器四种处置帧严格像素对照、工作台正式 PNG/ZIP 与下载通过；完整格式及大帧预览待验收 |
| sequence.gif-compose | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 原浏览器混合尺寸三帧 GIF 字节对照、实际 1000×256×256 GIF 全帧像素/时长/透明度、取消及输入变化保护通过 |
| sequence.sort | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 3/4 帧及 1000 帧跨页键盘排序、焦点跟随、撤销恢复和正式文档保存通过；完整拖拽/删除组合待验收 |
| sequence.duration | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 1000 帧全局 100ms GIF 下载及全部时长通过；100→101→100ms 键盘撤销重做、迟到结果保护和保存通过 |
| sequence.merge | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 规则/透明拆分、裁切扩边合成及三种拼接的 14 个原浏览器输出通过固定标准；工作台合成/超级拆分及下载通过，完整参数组合待验收 |
| sequence.dedupe | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 待逐项验收 |
| sequence.optical-flow | RoninPro → 高级像素处理算法 | reference/frontend/src/components/RoninProAdvancedPixel.tsx; reference/frontend/src/lib/opticalFlowInterpolate.ts; reference/frontend/src/lib/spriteGridDuplicate.ts | static PNG/JPEG/WebP files or one sprite sheet + optical-flow parameters → 2N−1 PNG sequence, ordered PNG ZIP or sprite sheet + reports | 多文件/精灵表原版像素、六种格式/方向、受控加工与导出、正式文档/历史、分页/冷重开、冲突/迟到/取消/导航和三语通过；原生拖放、全阶段取消/联合资源继续验收 |
| sequence.png-zip | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | GIF 拆帧 ZIP 实际下载及四帧像素/顺序通过；其他序列 ZIP 入口待验收 |
| image.crop | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 受控 Worker、29 组原算法对照、正式文档/历史/取消/冲突通过；完整格式与联合内存继续验收 |
| image.resize | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 受控 Worker、29 组原算法对照、正式文档/历史/取消/冲突通过；完整格式与联合内存继续验收 |
| image.stroke | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 受控 Worker、29 组原算法对照、正式文档/历史/取消/冲突通过；完整格式与联合内存继续验收 |
| image.paint | 图片常规转入精细处理 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | image → PNG | 常规结果转入精细画布；绘制/擦除、正式文档、撤销和 PNG 下载已验收 |
| image.erase | 图片常规转入精细处理 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | image → PNG | 常规结果转入精细画布；绘制/擦除、正式文档、撤销和 PNG 下载已验收 |
| image.flip | 图片常规：底部扩展中的复制行水平翻转 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG，按三行重排并扩展 floor(height/3) | 受控 Worker、29 组原算法对照、正式文档/历史/取消/冲突通过；完整格式与联合内存继续验收 |
| image.transparent-repair | 抠图去背：去背景后修复 | reference/frontend/src/components/ImageMatte.tsx; reference/frontend/src/lib/doubleBackgroundMatte.ts | static image / controlled matte PNG → same displayed size PNG + report | 52 项原版内核对照、实际工作台下载/文档/历史/取消/后台链通过；原生画布拖放、真实边缘质量和联合资源待验收 |
| fine.image.paint | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | 静态 PNG/JPEG/WebP；保留原件版本 → 真实 PNG、正式编辑版本与 image-fine 文档 | 正式文档、绘制/撤销/重开/冲突与 22 组对照通过；完整格式/视图交互继续验收 |
| fine.image.erase | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | 静态 PNG/JPEG/WebP；保留原件版本 → 真实 PNG、正式编辑版本与 image-fine 文档 | 正式文档、绘制/撤销/重开/冲突与 22 组对照通过；完整格式/视图交互继续验收 |
| fine.image.crop | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | 静态 PNG/JPEG/WebP；保留原件版本 → 真实 PNG、正式编辑版本与 image-fine 文档 | 正式文档、绘制/撤销/重开/冲突与 22 组对照通过；完整格式/视图交互继续验收 |
| image.grid | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | 静态 PNG/JPEG/WebP；保留原件版本 → 真实 PNG、正式编辑版本与 image-fine 文档 | 正式文档、绘制/撤销/重开/冲突与 22 组对照通过；完整格式/视图交互继续验收 |
| image.palette | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | 静态 PNG/JPEG/WebP；保留原件版本 → 真实 PNG、正式编辑版本与 image-fine 文档 | 正式文档、绘制/撤销/重开/冲突与 22 组对照通过；完整格式/视图交互继续验收 |
| image.alpha | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx | 静态 PNG/JPEG/WebP；保留原件版本 → 真实 PNG、正式编辑版本与 image-fine 文档 | 正式文档、绘制/撤销/重开/冲突与 22 组对照通过；完整格式/视图交互继续验收 |
| image.perfect-pixel | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 后台/工作台固定样本、真实选区与 8192→2048 尺寸通过；像素文档保存/重开/撤销/冲突/迟到读取通过，更多采样待验收 |
| image.pixelate | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 1/4/8 像素块原对照及工作台下载通过，像素文档参数重开/统一撤销通过；更多格式待验收 |
| image.merge-colors | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 三种强度严格原像素对照与工作台下载通过；文档合色 60 重开、统一撤销与保存冲突通过 |
| image.palette16 | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | RGB/Lab × 抖动四组原对照、工作台下载/取消/保护通过；文档 RGB/关闭抖动重开及撤销通过，大图超预算拒绝 |
| image.pixellise | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 原全局网格两组、工作台下载/后台继续通过；网格参数及结果正式文档/统一撤销通过，联合内存与更多输入待验收 |
| image.expand | 扩展收缩 | reference/frontend/src/components/ImageExpandShrink.tsx | image → PNG | 15 组原算法严格对照；受控 Worker、正式文档/历史/下载、取消与迟到保护通过；联合内存及更多取消样本继续验收 |
| image.shrink | 扩展收缩 | reference/frontend/src/components/ImageExpandShrink.tsx | image → PNG | 15 组原算法严格对照；受控 Worker、正式文档/历史/下载、取消与迟到保护通过；联合内存及更多取消样本继续验收 |
| image.rembg | AI抠图 | reference/frontend/src/components/ImageMatte.tsx | image → transparent PNG | 待逐项验收 |
| sequence.slice | 精灵表 | reference/frontend/src/components/SpriteSheetTool.tsx | static PNG/JPEG/WebP + reviewed grid/order → ordered PNG ZIP / GIF rows ZIP + report | 34 项原版严格对照、正式任务/文档/统一历史、4096 帧实导出、取消/迟到/冲突及三语通过；联合内存与完整可访问性待完成 |
| sequence.compose | 精灵表 | reference/frontend/src/components/SpriteSheetTool.tsx | static PNG/JPEG/WebP + reviewed grid/order → ordered PNG ZIP / GIF rows ZIP + report | 34 项原版严格对照、正式任务/文档/统一历史、4096 帧实导出、取消/迟到/冲突及三语通过；联合内存与完整可访问性待完成 |
| image.grid-adjust | 精灵表调整 | reference/frontend/src/components/SpriteSheetAdjust.tsx | static PNG/JPEG/WebP + reviewed preprocessing/grid/frame edits → PNG / selected-frame GIF / raw ordered PNG ZIP + reports | 独立及 Pro 工作台、正式文档/统一历史、4096 帧操作与下载、冲突/迟到/取消/导航及三语通过；联合内存与完整可访问性待完成 |
| 精灵表调整.image.resize | 精灵表调整 | reference/frontend/src/components/SpriteSheetAdjust.tsx | static PNG/JPEG/WebP + reviewed preprocessing/grid/frame edits → PNG / selected-frame GIF / raw ordered PNG ZIP + reports | 独立及 Pro 工作台、正式文档/统一历史、4096 帧操作与下载、冲突/迟到/取消/导航及三语通过；联合内存与完整可访问性待完成 |
| image.preview | 精灵表调整 | reference/frontend/src/components/SpriteSheetAdjust.tsx | static PNG/JPEG/WebP + reviewed preprocessing/grid/frame edits → PNG / selected-frame GIF / raw ordered PNG ZIP + reports | 独立及 Pro 工作台、正式文档/统一历史、4096 帧操作与下载、冲突/迟到/取消/导航及三语通过；联合内存与完整可访问性待完成 |
| image.watermark-remove | 图片水印 | reference/frontend/src/components/ImageGeminiWatermark.tsx | image → same-size PNG and parameter report | strict original pixels, actual auto/96/JPEG downloads, formal document/history, conflict/copy/late protection and cancellation/navigation passed; real watermark residue quality and joint RSS/accessibility remain |
| image.scatter-slice | 散图切片 | reference/frontend/src/components/RoninProScatterSlice.tsx | image → ordered PNG/JPEG/WebP ZIP + detection JSON + reports | original oracle and managed workbench/document checkpoint passed; complete S2/S3/S4 regression pending |
| image.custom-slice | 自定义切片 | reference/frontend/src/components/RoninProCustomSlice.tsx | image → PNG frame ZIP, rearranged PNG, parameter TXT and seam preview | 43 original kernel cases; actual auto/regions/L7/polyline, TXT/presets, documents/history, conflicts/late-result protection, cancel/navigation passed; joint RSS and full accessibility remain |
| image.seam-preview | 自定义切片 | reference/frontend/src/components/RoninProCustomSlice.tsx | image → PNG frame ZIP, rearranged PNG, parameter TXT and seam preview | 43 original kernel cases; actual auto/regions/L7/polyline, TXT/presets, documents/history, conflicts/late-result protection, cancel/navigation passed; joint RSS and full accessibility remain |
| image.resize-hard | 自定义缩放 | reference/frontend/src/components/RoninProCustomScale.tsx | image → PNG | 原算法、受控加工、绘制文档与撤销/取消通过；完整格式/交互及联合内存待完成 |
| 自定义缩放.image.resize | 自定义缩放 | reference/frontend/src/components/RoninProCustomScale.tsx | image → PNG | 原算法、受控加工、绘制文档与撤销/取消通过；完整格式/交互及联合内存待完成 |
| audio.wav-to-mp3 | 音频压缩 | reference/frontend/src/components/RoninProAudioCompress.tsx | WAV files → MP3 ZIP | 待逐项验收 |
| audio.batch | 音频压缩 | reference/frontend/src/components/RoninProAudioCompress.tsx | WAV files → MP3 ZIP | 待逐项验收 |
| audio.zip | 音频压缩 | reference/frontend/src/components/RoninProAudioCompress.tsx | WAV files → MP3 ZIP | 待逐项验收 |
| sequence.unify-size | 统一尺寸 | reference/frontend/src/components/RoninProUnifySize.tsx | frames → PNG | 原算法、受控任务、正式文档与统一撤销通过；联合内存及完整模块回归待完成 |
| sequence.duplicate-grid | 切分后寻找重复帧 | reference/frontend/src/components/RoninProDuplicateFrames.tsx | sprite sheet → PNG cells + zero-based duplicate groups | 原算法、受控任务、正式文档与统一撤销通过；联合内存及完整模块回归待完成 |
| image.preprocess | 单图Pro | reference/frontend/src/components/RoninProSheetPro.tsx | static PNG/JPEG/WebP + reviewed preprocessing/grid/frame edits → PNG / selected-frame GIF / raw ordered PNG ZIP + reports | 独立及 Pro 工作台、正式文档/统一历史、4096 帧操作与下载、冲突/迟到/取消/导航及三语通过；联合内存与完整可访问性待完成 |
| image.matte | 单图Pro | reference/frontend/src/components/RoninProSheetPro.tsx | static PNG/JPEG/WebP + reviewed preprocessing/grid/frame edits → PNG / selected-frame GIF / raw ordered PNG ZIP + reports | 独立及 Pro 工作台、正式文档/统一历史、4096 帧操作与下载、冲突/迟到/取消/导航及三语通过；联合内存与完整可访问性待完成 |
| image.alpha-repair | 单图Pro：统一裁边/透明扩边/预处理羽化；独立透明边缘修复见 image.transparent-repair | reference/frontend/src/components/RoninProSheetPro.tsx | image + crop/padding/preprocessing options → PNG / PNG frame ZIP | 独立及 Pro 工作台、正式文档/统一历史、4096 帧操作与下载、冲突/迟到/取消/导航及三语通过；联合内存与完整可访问性待完成 |
| 单图Pro.image.grid | 单图Pro | reference/frontend/src/components/RoninProSheetPro.tsx | static PNG/JPEG/WebP + reviewed preprocessing/grid/frame edits → PNG / selected-frame GIF / raw ordered PNG ZIP + reports | 独立及 Pro 工作台、正式文档/统一历史、4096 帧操作与下载、冲突/迟到/取消/导航及三语通过；联合内存与完整可访问性待完成 |
| image.double-background | 抠图去背：双背景差分 | reference/frontend/src/components/ImageMatte.tsx; reference/frontend/src/lib/doubleBackgroundMatte.ts | two same-sized static images in black/white order → same displayed size PNG + report | 52 项原版内核对照、实际工作台下载/文档/历史/取消/后台链通过；原生画布拖放、真实边缘质量和联合资源待验收 |
| 高级像素.image.alpha-repair | 抠图去背：去背景后修复 | reference/frontend/src/components/ImageMatte.tsx; reference/frontend/src/lib/doubleBackgroundMatte.ts | static image / controlled matte PNG → same displayed size PNG + report | 52 项原版内核对照、实际工作台下载/文档/历史/取消/后台链通过；原生画布拖放、真实边缘质量和联合资源待验收 |
| image.frontier-erode | 抠图去背：修复后贴边侵蚀 | reference/frontend/src/components/ImageMatte.tsx; reference/frontend/src/lib/doubleBackgroundMatte.ts | static image / controlled matte PNG → same displayed size PNG + report | 52 项原版内核对照、实际工作台下载/文档/历史/取消/后台链通过；原生画布拖放、真实边缘质量和联合资源待验收 |
| workflow.node-edit | 蓝图 | reference/frontend/src/components/RoninProCustomWorkflow.tsx | images/JSON → PNG/JSON | 待逐项验收 |
| workflow.edge-edit | 蓝图 | reference/frontend/src/components/RoninProCustomWorkflow.tsx | images/JSON → PNG/JSON | 待逐项验收 |
| workflow.import-legacy | 蓝图 | reference/frontend/src/components/RoninProCustomWorkflow.tsx | images/JSON → PNG/JSON | 待逐项验收 |
| workflow.export | 蓝图 | reference/frontend/src/components/RoninProCustomWorkflow.tsx | images/JSON → PNG/JSON | 待逐项验收 |
| workflow.13-presets | 蓝图 | reference/frontend/src/components/RoninProCustomWorkflow.tsx | images/JSON → PNG/JSON | 13 预设全部输出严格像素对照通过；编辑器交互待验收 |
| workflow.execute | 蓝图 | reference/frontend/src/components/RoninProCustomWorkflow.tsx | images/JSON → PNG/JSON | 待逐项验收 |
| rseprite.draw | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.erase | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.layers | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.frames-add | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.frames-delete | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.frames-copy | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.frame-duration | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.undo | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| rseprite.redo | Rseprite | reference/frontend/src/components/RoninProRseprite.tsx | sprite frames → editable document; original implementation has no export | 待逐项验收 |
| map.tile-layout | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 4/8/12 邻接、正式布局/视图重开、替换与卸载撤销通过；完整格式及竞态待验收 |
| map.save | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 正式项目与便携 ZIP/旧 JSON 重开、统一撤销、读取超限保留内容通过 |
| map.adjacency | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 左侧透明模板严格像素对照、4/8/12 分割及方向约束通过；全部方向交互待验收 |
| map.feather | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 三组四边羽化 Worker/PNG/PSD 严格像素对照通过；联合实测内存待验收 |
| map.seam-preview | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 64px 羽化预览严格像素相等；隐藏/边框与完整接缝交互待验收 |
| map.psd | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 后台 PSD 对照与取消、正式结果的 Krita 两层/透明度及独立合成验收通过 |
| map.godot-scene | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 新后台场景在固定可信无脚本 Godot 4.7.2 工程导入及三帧运行通过 |
| map.godot-pack | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 工作台后台 ZIP/正式版本一致、解包及可信工程导入运行通过 |
| game.topdown | 控制测试 | reference/frontend/src/components/ControlTest.tsx | selected static character/background/foreground images, audio and obstacle/spawn settings; fixed bundled defaults → interactive original scene + formal project document with immutable selected versions | 俯视/街机原场景、移动/碰撞/动作、图片/音乐、正式文档/历史/冷重开/冲突/迟到、取消重试和三语通过；更广格式/可访问性与联合资源仍待验收 |
| game.arcade | 控制测试 | reference/frontend/src/components/ControlTest.tsx | selected static character/background/foreground images, audio and obstacle/spawn settings; fixed bundled defaults → interactive original scene + formal project document with immutable selected versions | 俯视/街机原场景、移动/碰撞/动作、图片/音乐、正式文档/历史/冷重开/冲突/迟到、取消重试和三语通过；更广格式/可访问性与联合资源仍待验收 |
| game.controls | 控制测试 | reference/frontend/src/components/ControlTest.tsx | selected static character/background/foreground images, audio and obstacle/spawn settings; fixed bundled defaults → interactive original scene + formal project document with immutable selected versions | 俯视/街机原场景、移动/碰撞/动作、图片/音乐、正式文档/历史/冷重开/冲突/迟到、取消重试和三语通过；更广格式/可访问性与联合资源仍待验收 |
| game.map | 无限地图 | reference/frontend/src/components/InfiniteMapPlaceholder.tsx | map tiles/sprites → playable preview | 待逐项验收 |
| game.monsters | 无限地图 | reference/frontend/src/components/InfiniteMapPlaceholder.tsx | map tiles/sprites → playable preview | 待逐项验收 |
| game.movement | 无限地图 | reference/frontend/src/components/InfiniteMapPlaceholder.tsx | map tiles/sprites → playable preview | 待逐项验收 |
| external.assets | 素材源码 | reference/frontend/src/components/AssetsAndSourceShare.tsx | browser navigation → source/assets links | 待逐项验收 |
| external.source | 素材源码 | reference/frontend/src/components/AssetsAndSourceShare.tsx | browser navigation → source/assets links | 待逐项验收 |
| external.godot-code | 素材源码 | reference/frontend/src/components/AssetsAndSourceShare.tsx | browser navigation → source/assets links | 待逐项验收 |
| external.finished-project | 素材源码 | reference/frontend/src/components/AssetsAndSourceShare.tsx | browser navigation → source/assets links | 待逐项验收 |
| node.workflowInputImage | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.geminiWatermarkRemove | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.resize | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.resizeHard | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.crop | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.matteContiguous | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.matteGlobal | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.matteDoubleBackground | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.mattePostRepair | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.alphaFrontierErode | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.padExpand | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.evenSplitStrip | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.evenSplitPerCellEdge | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.mergeStrip | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.simpleStitchVertical | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridDeleteRow | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridDeleteCol | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridExpandRow | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridExpandCol | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridFlipRow | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridFlipCol | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridCopyRow | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.gridCopyCol | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |
| node.customGridRearrange | RoninPro 蓝图节点 | reference/frontend/src/lib/roninProWorkflow.ts | typed image ports → PNG blob | awaiting strict validation and pixel acceptance |

JSON 清单还记录依赖、目标模块、固定样本、限制和证据。原仓库未实现的 Rseprite 导出列入 excluded-roadmap.json，不计入复刻基线。复制源码不代表验收通过。
部分早期条目仍需回填已有模块证据，当前不能按待验收条目数量计算完成百分比；剩余工作见 [待完成清单](../management/REMAINING_WORK.md)。
