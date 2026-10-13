# 私有运行时与项目

所有路径以本技能目录为基准。运行 `python3 scripts/setup.py --python python3.11 --workbench --with-model` 安装 Python 3.11 私有环境、锁定依赖、npm 工作台和 U2Net 模型。需要 FFmpeg/ffprobe、Node 22、npm；`scripts/frameronin.py doctor` 给出实际检测，不把系统依赖不存在当作成功。依赖和模型落在 `.runtime/`，不修改系统 Python 或 Codex 配置。

命令返回 `{ok,result}` 或 `{ok:false,error:{code,message,details}}`，错误退出 2。示例中的 `<skill>` 和 `<project>` 换为真实绝对路径。可以从任意目录运行脚本。

```sh
python3 <skill>/scripts/frameronin.py init --project <project> --name MyAssets --language zh
python3 <skill>/scripts/frameronin.py import --project <project> --file <selected-image.png>
python3 <skill>/scripts/frameronin.py assets --project <project>
python3 <skill>/scripts/frameronin.py version --project <project> --version <version-id>
python3 <skill>/scripts/frameronin.py verify --project <project>
python3 <skill>/scripts/frameronin.py recover --project <project>
```

项目格式 1：`project.json` 保存项目 ID、格式、名称及语言；`project.sqlite` 保存素材、版本、任务、文档与 AI 尝试；`assets/<asset-id>/<version-id>.<ext>` 保存不可变内容；`.pending/` 保存待登记文件；`tasks/` 保存受控任务日志及中间产物；`exports/` 保存交付。SQLite 只存相对路径。迁移项目目录后仍可打开。

导入只读选定文件，校验源文件稳定性、完整解码及 SHA-256，保存副本。导入新版本加 `--asset <asset-id>`，撤销加工用 `checkout --asset <asset-id> --version <version-id>`；不再生成，不删除导出。项目托管路径拒绝目录遍历和符号链接。

登记采用待完成记录、文件同步、原子重命名和数据库事务。中断后 `recover` 核对待完成记录、已停止任务和孤立文件；孤立文件保留并报告，不自动删除。文件锁序列化写入；文档保存必须携带预期修订号，拒绝过期覆盖。

`document-save --kind rseprite|workflow|map|sequence|image|game --document <id> --revision <current> --file <json>` 保存修订；`document-get` 读取；`document-restore --history <saved-revision> --revision <current>` 把旧内容追加为新修订。
