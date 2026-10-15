# 功能逐项对照

| 操作 | 原入口 | 原实现 | 输入 → 输出 | 验收状态 |
| --- | --- | --- | --- | --- |
| video.fps | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.range | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.maxFrames | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.crop | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.background | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.sheet | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.png | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.zip | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.index | 视频抽帧 | reference/frontend/src/components/ParamsStep.tsx | video + parameters → PNG frames/sheet/ZIP/index | 待逐项验收 |
| video.detect | 视频水印 | reference/frontend/src/components/SeedanceWatermarkRemover.tsx | video → clean MP4 | 固定角标视频对照原检测/修复实现通过；小于 120×60 及资源超限预先拒绝，真实品牌水印质量待验收 |
| video.remove | 视频水印 | reference/frontend/src/components/SeedanceWatermarkRemover.tsx | video → clean MP4 | 后台修复及工作台真实取消/离开后运行通过，固定输出视频与原实现严格相同；小字样本保留原残影，质量不记为通过 |
| video.mp4 | 视频水印 | reference/frontend/src/components/SeedanceWatermarkRemover.tsx | video → clean MP4 | 正式 MP4 下载与版本字节一致，24 帧与原输出严格 RGB 相同，原 AAC 解码 PCM 相同，工作台完整播放通过 |
| sequence.gif-split | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 原浏览器四种处置帧严格像素对照、工作台正式 PNG/ZIP 与下载通过；完整格式及大帧预览待验收 |
| sequence.gif-compose | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 原浏览器混合尺寸三帧 GIF 字节对照、实际 1000×256×256 GIF 全帧像素/时长/透明度、取消及输入变化保护通过 |
| sequence.sort | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 3/4 帧及 1000 帧跨页键盘排序、焦点跟随、撤销恢复和正式文档保存通过；完整拖拽/删除组合待验收 |
| sequence.duration | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 1000 帧全局 100ms GIF 下载及全部时长通过；100→101→100ms 键盘撤销重做、迟到结果保护和保存通过 |
| sequence.merge | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 规则/透明拆分、裁切扩边合成及三种拼接的 14 个原浏览器输出通过固定标准；工作台合成/超级拆分及下载通过，完整参数组合待验收 |
| sequence.dedupe | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 待逐项验收 |
| sequence.optical-flow | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | 后台与 RoninPro 工作台固定样本通过；GIF 入口交互待验收 |
| sequence.png-zip | GIF与帧 | reference/frontend/src/components/GifFrameConverter.tsx | GIF/PNG frames → GIF/PNG ZIP/sheet | GIF 拆帧 ZIP 实际下载及四帧像素/顺序通过；其他序列 ZIP 入口待验收 |
| image.crop | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 待逐项验收 |
| image.resize | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 待逐项验收 |
| image.stroke | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 待逐项验收 |
| image.paint | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 待逐项验收 |
| image.erase | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 待逐项验收 |
| image.flip | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 待逐项验收 |
| image.transparent-repair | 图片常规 | reference/frontend/src/components/ImageResizeStroke.tsx | image → PNG | 待逐项验收 |
| fine.image.paint | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineProcess.tsx | image → PNG | 待逐项验收 |
| fine.image.erase | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineProcess.tsx | image → PNG | 待逐项验收 |
| fine.image.crop | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineProcess.tsx | image → PNG | 待逐项验收 |
| image.grid | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineProcess.tsx | image → PNG | 待逐项验收 |
| image.palette | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineProcess.tsx | image → PNG | 待逐项验收 |
| image.alpha | 图片精细 | reference/frontend/src/components/ImageResizeStroke/ImageFineProcess.tsx | image → PNG | 待逐项验收 |
| image.perfect-pixel | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 后台/工作台固定样本、真实选区与 8192→2048 尺寸通过；像素文档保存/重开/撤销/冲突/迟到读取通过，更多采样待验收 |
| image.pixelate | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 1/4/8 像素块原对照及工作台下载通过，像素文档参数重开/统一撤销通过；更多格式待验收 |
| image.merge-colors | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 三种强度严格原像素对照与工作台下载通过；文档合色 60 重开、统一撤销与保存冲突通过 |
| image.palette16 | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | RGB/Lab × 抖动四组原对照、工作台下载/取消/保护通过；文档 RGB/关闭抖动重开及撤销通过，大图超预算拒绝 |
| image.pixellise | 像素还原 | reference/frontend/src/components/ImagePixelate.tsx | image → PNG | 原全局网格两组、工作台下载/后台继续通过；网格参数及结果正式文档/统一撤销通过，联合内存与更多输入待验收 |
| image.expand | 扩展收缩 | reference/frontend/src/components/ImageExpandShrink.tsx | image → PNG | 待逐项验收 |
| image.shrink | 扩展收缩 | reference/frontend/src/components/ImageExpandShrink.tsx | image → PNG | 待逐项验收 |
| image.rembg | AI抠图 | reference/frontend/src/components/ImageMatte.tsx | image → transparent PNG | 待逐项验收 |
| sequence.slice | 精灵表 | reference/frontend/src/components/SpriteSheetTool.tsx | image/frames → PNG/ZIP | 待逐项验收 |
| sequence.compose | 精灵表 | reference/frontend/src/components/SpriteSheetTool.tsx | image/frames → PNG/ZIP | 待逐项验收 |
| image.grid-adjust | 精灵表调整 | reference/frontend/src/components/SpriteSheetAdjust.tsx | sprite sheet → PNG | 待逐项验收 |
| 精灵表调整.image.resize | 精灵表调整 | reference/frontend/src/components/SpriteSheetAdjust.tsx | sprite sheet → PNG | 待逐项验收 |
| image.preview | 精灵表调整 | reference/frontend/src/components/SpriteSheetAdjust.tsx | sprite sheet → PNG | 待逐项验收 |
| image.watermark-remove | 图片水印 | reference/frontend/src/components/ImageGeminiWatermark.tsx | image → PNG | 待逐项验收 |
| image.scatter-slice | 散图切片 | reference/frontend/src/components/RoninProScatterSlice.tsx | image → PNG ZIP | 待逐项验收 |
| image.custom-slice | 自定义切片 | reference/frontend/src/components/RoninProCustomSlice.tsx | image → PNG ZIP | 待逐项验收 |
| image.seam-preview | 自定义切片 | reference/frontend/src/components/RoninProCustomSlice.tsx | image → PNG ZIP | 待逐项验收 |
| image.resize-hard | 自定义缩放 | reference/frontend/src/components/RoninProCustomScale.tsx | image → PNG | 原算法对照与可取消任务通过；文档/撤销及完整交互待完成 |
| 自定义缩放.image.resize | 自定义缩放 | reference/frontend/src/components/RoninProCustomScale.tsx | image → PNG | 原算法对照与可取消任务通过；文档/撤销及完整交互待完成 |
| audio.wav-to-mp3 | 音频压缩 | reference/frontend/src/components/RoninProAudioCompress.tsx | WAV files → MP3 ZIP | 待逐项验收 |
| audio.batch | 音频压缩 | reference/frontend/src/components/RoninProAudioCompress.tsx | WAV files → MP3 ZIP | 待逐项验收 |
| audio.zip | 音频压缩 | reference/frontend/src/components/RoninProAudioCompress.tsx | WAV files → MP3 ZIP | 待逐项验收 |
| sequence.unify-size | 统一尺寸 | reference/frontend/src/components/RoninProUnifySize.tsx | frames → PNG | 原算法对照与可取消任务通过；文档/撤销及完整交互待完成 |
| sequence.duplicate-grid | 切分后寻找重复帧 | reference/frontend/src/components/RoninProDuplicateFrames.tsx | sprite sheet → PNG cells + duplicate groups | 原算法对照与可取消任务通过；文档/撤销及完整交互待完成 |
| image.preprocess | 单图Pro | reference/frontend/src/components/RoninProSheetPro.tsx | image → PNG | 待逐项验收 |
| image.matte | 单图Pro | reference/frontend/src/components/RoninProSheetPro.tsx | image → PNG | 待逐项验收 |
| image.alpha-repair | 单图Pro | reference/frontend/src/components/RoninProSheetPro.tsx | image → PNG | 待逐项验收 |
| 单图Pro.image.grid | 单图Pro | reference/frontend/src/components/RoninProSheetPro.tsx | image → PNG | 待逐项验收 |
| image.double-background | 高级像素 | reference/frontend/src/components/RoninProAdvancedPixel.tsx | images → transparent PNG | 待逐项验收 |
| 高级像素.image.alpha-repair | 高级像素 | reference/frontend/src/components/RoninProAdvancedPixel.tsx | images → transparent PNG | 待逐项验收 |
| image.frontier-erode | 高级像素 | reference/frontend/src/components/RoninProAdvancedPixel.tsx | images → transparent PNG | 待逐项验收 |
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
| map.psd | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 后台 PSD 对照与取消通过；正式结果在 Krita 打开两层、透明度及独立合成验收通过 |
| map.godot-scene | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 新后台场景在固定可信无脚本 Godot 4.7.2 工程导入及三帧运行通过 |
| map.godot-pack | 地图 | reference/frontend/src/components/MapStitch.tsx | tiles → PNG/PSD/Godot/ZIP | 工作台后台 ZIP/正式版本一致、解包及可信工程导入运行通过 |
| game.topdown | 控制测试 | reference/frontend/src/components/ControlTest.tsx | sprite sheet → playable preview | 待逐项验收 |
| game.arcade | 控制测试 | reference/frontend/src/components/ControlTest.tsx | sprite sheet → playable preview | 待逐项验收 |
| game.controls | 控制测试 | reference/frontend/src/components/ControlTest.tsx | sprite sheet → playable preview | 待逐项验收 |
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
