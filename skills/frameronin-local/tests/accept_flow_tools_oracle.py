"""Execute the optical-flow grid/export operations against frozen browser output."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

from compare_sheet_prepare_oracle import compare_png

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / 'scripts'))
from frameronin_engine.project import Project
from frameronin_engine.tasks import submit, wait


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--freeze', action='store_true')
    args = parser.parse_args()
    fixture = SKILL / 'assets/fixtures/flow-tools'
    manifest = json.loads((fixture / 'manifest.json').read_text())
    frozen = fixture / 'original'
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    for name, expected in manifest['sources'].items():
        assert digest(fixture / name) == expected
    for name, expected in manifest['originals'].items():
        assert digest(SKILL.parents[1] / name) == expected
    if args.freeze and frozen.exists():
        raise SystemExit('Existing flow-tools original baseline preserved.')
    project = Project.create(args.project, 'FrameRonin flow grid/export acceptance')
    imported = {name: project.import_file(fixture / name)['id'] for name in manifest['sources']}
    records, baseline = [], {}
    with zipfile.ZipFile(args.archive) as archive:
        assert len(archive.namelist()) == len(set(archive.namelist()))
        assert sum(info.file_size for info in archive.infolist()) <= 256*1024**2
        for sample in manifest['cases']:
            created = submit(project, {'operation': sample['operation'],
                'inputs': [imported[name] for name in sample['inputs']],
                'parameters': sample['parameters']})
            done = wait(project, created['id'], 30)
            assert done['state'] == 'succeeded', done
            original_names = [name for name in archive.namelist()
                              if name.startswith(sample['id'] + '/') and not name.endswith('/')]
            assert len(done['results']) - 1 == len(original_names) > 0
            comparisons = []
            for index, version_id in enumerate(done['results'][:-1]):
                version = project.version(version_id)
                name = f"{sample['id']}/{index}{version['metadata']['extension']}"
                original = archive.read(name)
                actual = Path(version['absolutePath']).read_bytes()
                if name.endswith('.png'):
                    comparison = compare_png(original, actual)
                else:
                    members = []
                    with zipfile.ZipFile(io.BytesIO(original)) as a, zipfile.ZipFile(io.BytesIO(actual)) as b:
                        assert a.namelist() == b.namelist()
                        for member in a.namelist():
                            members.append({'member': member, **compare_png(a.read(member), b.read(member))})
                    comparison = {'equal': all(v['equal'] for v in members), 'members': members}
                if not args.freeze:
                    assert (frozen / name).read_bytes() == original
                baseline[name] = original
                comparisons.append({'file': name, **comparison})
            report = json.loads(Path(project.version(done['results'][-1])['absolutePath']).read_text())
            records.append({'sample': sample['id'], 'operation': sample['operation'],
                'taskId': created['id'], 'results': done['results'], 'report': report,
                'comparisons': comparisons, 'equal': all(v['equal'] for v in comparisons)})
    verification = project.verify()
    assert verification['valid']
    failures = [r['sample'] for r in records if not r['equal']]
    if args.freeze and not failures:
        for name, data in baseline.items():
            path = frozen / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    result = {'projectId': project.manifest['id'], 'archiveSha256': digest(args.archive),
        'cases': records, 'failed': failures, 'verification': {'valid': True,
        'database': verification['database'], 'versions': len(verification['versions']),
        'tasks': len(records)}, 'baselineCreated': args.freeze and not failures}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'cases': len(records), 'failed': failures, 'verification': result['verification']}))
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
