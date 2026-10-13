"""Machine-readable CLI for Codex and the local workbench."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import platform
import shutil
import sys
from .errors import RoninError
from .project import Project, identifier, memory_budget


def json_file(path):
    with Path(path).expanduser().open() as source:
        return json.load(source)


def doctor():
    packages = {}
    for name in ['Pillow', 'numpy', 'opencv-python-headless', 'rembg', 'onnxruntime', 'fastapi', 'psutil']:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    tools = {name: shutil.which(name) for name in ['ffmpeg', 'ffprobe', 'node', 'npm', 'codex', 'godot', 'krita']}
    return {'ready': all(packages.values()) and bool(tools['ffmpeg'] and tools['ffprobe']),
            'python': platform.python_version(), 'architecture': platform.machine(), 'packages': packages,
            'tools': tools, 'memoryBudgetBytes': memory_budget(), 'ai': {
                'provider': 'host-native-imagegen', 'availability': 'checked_by_host_tool_catalog',
                'contextIsolation': 'host_managed', 'authentication': 'codex_managed'}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['doctor', 'init', 'import', 'assets', 'version', 'checkout', 'verify',
        'recover', 'operations', 'preview', 'submit', 'status', 'wait', 'cancel', 'worker', 'ai-begin', 'ai-mark',
        'document-save', 'document-get', 'document-restore', 'serve'])
    parser.add_argument('--project')
    parser.add_argument('--file')
    parser.add_argument('--name', default='FrameRonin')
    parser.add_argument('--language', default='zh')
    parser.add_argument('--asset')
    parser.add_argument('--version')
    parser.add_argument('--task')
    parser.add_argument('--timeout', type=float, default=60)
    parser.add_argument('--sample')
    parser.add_argument('--template', default='free-image')
    parser.add_argument('--prompt')
    parser.add_argument('--references', nargs='*', default=[])
    parser.add_argument('--attempt')
    parser.add_argument('--state')
    parser.add_argument('--document')
    parser.add_argument('--kind')
    parser.add_argument('--revision', type=int, default=0)
    parser.add_argument('--history', type=int)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    try:
        command = args.command
        if command == 'doctor':
            result = doctor()
        elif command == 'operations':
            from .operations import REGISTRY
            result = REGISTRY
        elif command == 'init':
            if not args.project:
                raise RoninError('ARGUMENT_REQUIRED', '--project is required.')
            result = Project.create(args.project, args.name, args.language).manifest
        else:
            if not args.project:
                raise RoninError('ARGUMENT_REQUIRED', '--project is required.')
            project = Project(args.project)
            if command == 'import':
                if not args.file:
                    raise RoninError('ARGUMENT_REQUIRED', '--file is required.')
                result = project.import_file(args.file, args.asset)
            elif command == 'assets':
                result = project.assets()
            elif command == 'version':
                result = project.version(args.version)
            elif command == 'checkout':
                result = project.checkout(args.asset, args.version)
            elif command == 'verify':
                result = project.verify()
            elif command == 'recover':
                from .tasks import recover_tasks
                result = project.recover()
                result['interruptedTasks'] = recover_tasks(project)
            elif command in ['preview', 'submit']:
                from .operations import preview
                from .tasks import submit
                if not args.file:
                    raise RoninError('ARGUMENT_REQUIRED', '--file must name a task JSON file.')
                result = preview(project, json_file(args.file)) if command == 'preview' else submit(project, json_file(args.file))
                if command == 'preview':
                    result.pop('versions', None)
            elif command in ['status', 'wait', 'cancel', 'worker']:
                from .tasks import task, wait, cancel, worker
                if not args.task:
                    raise RoninError('ARGUMENT_REQUIRED', '--task is required.')
                result = {'status': task, 'wait': lambda p, t: wait(p, t, min(args.timeout, 60)),
                          'cancel': cancel, 'worker': worker}[command](project, args.task)
            elif command == 'ai-begin':
                if not args.sample or not args.prompt:
                    raise RoninError('ARGUMENT_REQUIRED', '--sample and --prompt are required.')
                result = project.begin_ai(args.sample, args.template, args.prompt, args.references)
            elif command == 'ai-mark':
                result = project.mark_ai(args.attempt, args.state, args.version, json_file(args.file) if args.file else None)
            elif command == 'document-save':
                if not args.file:
                    raise RoninError('ARGUMENT_REQUIRED', '--file is required.')
                result = project.save_document(args.document or identifier(), args.kind, json_file(args.file), args.revision)
            elif command == 'document-get':
                result = project.document(args.document)
            elif command == 'document-restore':
                result = project.restore_document(args.document, args.history, args.revision)
            elif command == 'serve':
                from .server import serve
                serve(project, args.port)
                return
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False, allow_nan=False))
    except RoninError as error:
        print(json.dumps({'ok': False, 'error': error.record()}, ensure_ascii=False))
        return 2
    except (OSError, ValueError) as error:
        print(json.dumps({'ok': False, 'error': {'code': 'INPUT_INVALID', 'message': str(error)[:1000]}}))
        return 2
    return 0
