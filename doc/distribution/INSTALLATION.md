# 安装与版本交付

技能源目录为 `skills/frameronin-local/`，名称为 `$frameronin-local`；已有远程 `$frameronin` 保留。当前为开发安装，技能目录链接到本仓库；最终独立安装与可搬迁包仍须完成 S4 验收。Skill 不是签名的 macOS .app，桌面签名、公证和窗口验收属于已替换方案。

环境为 Apple Silicon、Python 3.11、Node 22、npm、FFmpeg/ffprobe。先执行 `scripts/setup.py --python python3.11 --workbench --with-model`，再执行 `scripts/frameronin.py doctor`。安装创建私有 Python 环境、固定依赖、工作台和本地算法构建；抠图模型、依赖和构建物保留在忽略目录 `.runtime/`。首次安装需要联网下载依赖及模型，素材加工在本机进行。

项目目录独立于技能安装；更新技能不能覆盖用户项目。分发时仅打包审核过的源码、固定资源、依赖锁和文档，排除认证、模型、缓存、开发日志、验证项目及原归档。新安装必须重新检查环境、固定算法样本和正式项目重开，不能用开发目录成功代替。

使用当前分支本地提交。阶段提交关联真实验收记录；检查点提交保持阶段未完成。推送、公开标签和发布另行授权。变更格式和算法时更新格式说明、对照样本及变更记录。
