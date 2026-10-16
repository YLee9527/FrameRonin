"""Compare a browser-oracle download with both the original and frozen baseline."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image


def detection(data):
    value=json.loads(data)
    for box in value['boxes']:
        box.pop('id')  # Random UUID values have no pixel or ordering semantics.
    return value


def compare_zip(left,right):
    members=[]
    with zipfile.ZipFile(io.BytesIO(left)) as a,zipfile.ZipFile(io.BytesIO(right)) as b:
        if a.namelist()!=b.namelist():return {'equal':False,'error':'ZIP member order or names differ'}
        for name in a.namelist():
            aa,bb=a.read(name),b.read(name)
            with Image.open(io.BytesIO(aa)) as im,Image.open(io.BytesIO(bb)) as jm:
                equal=im.format==jm.format and im.size==jm.size and im.convert('RGBA').tobytes()==jm.convert('RGBA').tobytes()
                members.append({'name':name,'format':im.format,'dimensions':list(im.size),'strictRgbaEqual':equal,'encodedBytesEqual':aa==bb})
    return {'equal':all(item['strictRgbaEqual'] for item in members),'members':members}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1]
    fixtures=skill/'assets/fixtures/scatter'
    manifest=json.loads((fixtures/'manifest.json').read_text())
    assert hashlib.sha256((skill.parents[1]/manifest['originalSource']).read_bytes()).hexdigest()==manifest['originalSha256'],'Original source changed'
    for name,sha in manifest['sources'].items():
        assert hashlib.sha256((fixtures/name).read_bytes()).hexdigest()==sha,f'Source fixture changed: {name}'
    rows=[]
    with zipfile.ZipFile(args.archive) as archive:
        for kind in ['detect','export']:
            suffix='json' if kind=='detect' else 'zip'
            for case in manifest[kind]:
                original=archive.read(f'{kind}/{case["id"]}/original.{suffix}')
                actual=archive.read(f'{kind}/{case["id"]}/actual.{suffix}')
                frozen=(fixtures/'original'/f'{kind}-{case["id"]}.{suffix}').read_bytes()
                if kind=='detect':
                    result={'equal':detection(original)==detection(actual),'frozenBaselineEqual':detection(original)==detection(frozen)}
                else:
                    result=compare_zip(original,actual)
                    result['frozenBaselineEqual']=compare_zip(original,frozen)['equal']
                rows.append({'kind':kind,'id':case['id'],**result})
    report={'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'cases':rows}
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    failed=[row['id'] for row in rows if not row['equal'] or not row['frozenBaselineEqual']]
    print(json.dumps({'cases':len(rows),'failed':failed}))
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
