# 来源冻结与归档

原始提交为 `4472253`，完整 SHA、384 个文件的原路径、大小、SHA-256、分类和归档去向见 `original-manifest.json`。归档前逐个比较工作区与冻结内容；迁移后逐个复核校验值。

378 个原源码、资源和文档保持内部结构迁入根 `reference/`。Git 历史保留在根目录。复用代码复制到 `skills/frameronin-local/`，新包不直接导入归档；归档不参与新工作台构建与打包。

六个 `backend/outputs/<job-id>/clean.mp4` 是已跟踪运行产物，没有正式对照样本声明或源码引用。保留在本地 `.frameronin-local-archive/backend/outputs/`，从新源码归档排除；记录原路径、去向与 SHA-256，不删除原件。实际原生生成样本另外保存于技能的 `assets/fixtures/native-imagegen/`，固定输入与可验证输出。

根 `.gitignore` 排除私有运行时、模型、依赖、构建缓存、临时工作及用户项目。已有用户未提交的 pnpm 文件保留在根，不纳入本次提交；本项目沿用 npm。
