# FrameRonin Local

在 Codex 中使用内置 ImageGen 创作像素角色、动作和地图素材，使用本地引擎和三语工作台完成媒体加工、蓝图、精灵编辑和资源导出。原仓库源码、资源和文档完整保存于 `reference/`，钱包、NFT、FRAME 不进入新交付模块。

本次交付采用 **Codex Skill + 本地处理引擎 + 可视化工作台**。开发正在进行；原生生成/参考图编辑和项目存储已实测，完整功能及导出互操作仍按清单验收。独立 macOS `.app` 属于已替换的历史方案。

- [技能入口](skills/frameronin-local/SKILL.md)
- [实施基线与阶段](doc/SKILL_IMPLEMENTATION.md)
- [文档导航](doc/README.md)
- [完整功能对照](doc/baseline/FEATURES.md)
- [原始来源与校验](doc/baseline/original-manifest.json)
- [13 个蓝图预设](doc/baseline/presets.json)
- [原生 ImageGen 验证](skills/frameronin-local/assets/fixtures/native-imagegen/receipt.json)
- [原始项目说明](reference/README.md)

## 本地开发

运行环境：Apple Silicon、Python 3.11、Node 22、npm、FFmpeg/ffprobe。技能沿用宿主 Codex 权限与上下文，使用宿主管理的认证；不另外接入代充 API，不打开 Gemini Gems。

```sh
python3 skills/frameronin-local/scripts/setup.py --python python3.11 --workbench --with-model
python3 skills/frameronin-local/scripts/frameronin.py doctor
python3 skills/frameronin-local/scripts/frameronin.py init --project /absolute/path/MyAssets --language zh
python3 skills/frameronin-local/scripts/frameronin.py serve --project /absolute/path/MyAssets
```

工作台地址由命令返回，只在本机开放。生成和加工结果追加素材版本，原件不覆盖。新的技能名为 `$frameronin-local`，已有远程 `frameronin` 技能保留。

## 验证

```sh
npm run test:engine
npm run build:workbench
```

构建、文件解码、真实交互和素材质量分别记录。阶段完成后本地提交，推送与发布另行安排。
