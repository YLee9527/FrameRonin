# FrameRonin Local Workbench

React/TypeScript 三语素材工具，源码从原项目复制到技能包并移除钱包、NFT 和外部 Gemini 集成。正式项目和受控后台任务由随包 Python 引擎提供。

在仓库根运行 `npm run build:workbench`，随后运行技能 `serve --project <absolute-project>`。直接打开静态 HTML 无法连接项目 API。`reference/` 不参与构建；完整模块验收状态见根 `doc/testing/SKILL_ACCEPTANCE.md`。
