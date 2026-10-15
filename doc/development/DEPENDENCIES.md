# 依赖与来源

Python 3.11 运行时依赖及全量解析版本见技能 `requirements.txt`、`requirements.lock.txt`：Pillow、NumPy、OpenCV、rembg、ONNX Runtime、FastAPI、uvicorn、psutil 等。U2Net 模型保留 rembg 官方下载与校验流程，缓存不进 Git。

工作台沿用原 npm 技术栈并移除 Ronin 钱包依赖，锁文件保留。新增后台算法包使用 Node 22、esbuild 0.25.12 与 `@napi-rs/canvas` 0.1.80；后者提供 Node Canvas 运行能力，来源及许可见 [官方仓库](https://github.com/Brooooooklyn/canvas)。需要它是为了复用原 Canvas/TypeScript 算法并将加工交给可取消后台进程。

FFmpeg/ffprobe 由本机提供，doctor 检测可执行路径。Krita、Godot 4 用于互操作验收，尚未安装时不得声称对应软件验证通过。Node 算法运行器禁止远程网络图像，只读取受控输入副本及技能内静态资源。

2026-10-14 工作台依赖在原有版本范围内更新锁文件，npm audit 返回零漏洞。Vite 为 7.3.7；未迁移包管理器或主版本。Godot 4.7.2 已在可信场景工程完成导入与无脚本运行。Krita 5.3.4.1 完成独立两层样本原生检查；新地图 PSD 的原生复验仍受锁屏阻断，两项证据分开记录。

像素工具复用原 PerfectPixel、Pixellise 网格/颜色处理和原 ImagePixelate 的像素块、Lab 与十六色实现，没有新增依赖。image-q 继续使用工作台已有锁版本。Node 入口的所有 OpenCV 导入均经私有加载器，避免把浏览器 UMD 的 fs 动态 require 带入 ESM。测试页从冻结 reference 生成独立对照模块，原实现及固定样本校验值见 `assets/fixtures/pixel/manifest.json`；生产运行器不导入 reference。
