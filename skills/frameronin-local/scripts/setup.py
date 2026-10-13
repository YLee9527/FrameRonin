#!/usr/bin/env python3
"""安装技能私有运行时；不修改系统 Python、Codex 配置或认证。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', default='python3.11')
    parser.add_argument('--with-model', action='store_true', help='下载 rembg U2Net 模型到私有缓存')
    parser.add_argument('--workbench', action='store_true', help='安装并构建随包 npm 工作台')
    parser.add_argument('--local-algorithms', action='store_true', help='安装并构建后台 TypeScript 图像算法')
    args = parser.parse_args()
    binary = shutil.which(args.python)
    if not binary:
        raise SystemExit('Python 3.11 is required. Install it or pass --python with its executable.')
    version = subprocess.check_output([binary, '-c', 'import sys;print("%s.%s"%sys.version_info[:2])'], text=True).strip()
    if version != '3.11':
        raise SystemExit('This runtime is verified with Python 3.11; the selected executable is incompatible.')
    runtime = ROOT / '.runtime'
    runtime.mkdir(exist_ok=True)
    import fcntl
    with (runtime / 'setup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        environment = runtime / 'venv'
        if not (environment / 'bin/python').is_file():
            subprocess.run([binary, '-m', 'venv', str(environment)], check=True)
        python = environment / 'bin/python'
        requirements = ROOT / 'requirements.lock.txt'
        if not requirements.is_file():
            requirements = ROOT / 'requirements.txt'
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(requirements)], check=True)
        if args.with_model:
            env = {**os.environ, 'U2NET_HOME': str(runtime / 'models')}
            subprocess.run([str(python), '-c', 'from rembg import new_session;new_session("u2net")'], env=env, check=True)
        if args.workbench or args.local_algorithms:
            npm = shutil.which('npm')
            if not npm:
                raise SystemExit('npm and Node.js 22 are required for the visual workbench.')
            workbench = ROOT / 'assets/workbench'
            subprocess.run([npm, 'ci'], cwd=workbench, check=True)
            if args.workbench:
                subprocess.run([npm, 'run', 'build'], cwd=workbench, check=True)
            javascript = ROOT / 'scripts/js-runtime'
            subprocess.run([npm, 'ci', '--ignore-scripts'], cwd=javascript, check=True)
            subprocess.run([shutil.which('node'), str(javascript / 'build.mjs')], check=True)
    print(json.dumps({'status': 'ready', 'python': str(python), 'modelRequested': args.with_model,
                      'workbenchRequested': args.workbench}))


if __name__ == '__main__':
    main()
