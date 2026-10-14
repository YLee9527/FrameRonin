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
