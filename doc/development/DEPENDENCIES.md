# 依赖与来源

Python 3.11 运行时依赖及全量解析版本见技能 `requirements.txt`、`requirements.lock.txt`：Pillow、NumPy、OpenCV、rembg、ONNX Runtime、FastAPI、uvicorn、psutil 等。U2Net 模型保留 rembg 官方下载与校验流程，缓存不进 Git。

工作台沿用原 npm 技术栈并移除 Ronin 钱包依赖，锁文件保留。新增后台算法包使用 Node 22、esbuild 0.25.12 与 `@napi-rs/canvas` 0.1.80；后者提供 Node Canvas 运行能力，来源及许可见 [官方仓库](https://github.com/Brooooooklyn/canvas)。需要它是为了复用原 Canvas/TypeScript 算法并将加工交给可取消后台进程。

FFmpeg/ffprobe 由本机提供，doctor 检测可执行路径。Krita、Godot 4 用于互操作验收，尚未安装时不得声称对应软件验证通过。Node 算法运行器禁止远程网络图像，只读取受控输入副本及技能内静态资源。
