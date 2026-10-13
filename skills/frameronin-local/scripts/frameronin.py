#!/usr/bin/env python3
"""FrameRonin 本地技能入口；自动使用随包私有 Python 环境。"""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENT = ROOT / '.runtime/venv'

if __name__ == '__main__':
    python = ENVIRONMENT / 'bin/python'
    if not python.is_file():
        print(json.dumps({'error': {'code': 'RUNTIME_MISSING',
            'message': 'Run scripts/setup.py with Python 3.11 before using local processing.'}}))
        raise SystemExit(2)
    if Path(sys.prefix).resolve() != ENVIRONMENT.resolve():
        os.execv(str(python), [str(python), str(Path(__file__).resolve()), *sys.argv[1:]])
    os.environ['U2NET_HOME'] = str(ROOT / '.runtime/models')
    from frameronin_engine.cli import main
    raise SystemExit(main())
