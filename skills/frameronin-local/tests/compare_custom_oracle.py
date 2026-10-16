"""Compare custom-slice browser output against the original and frozen baseline."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image
from compare_scatter_oracle import compare_zip


def compare(kind,a,b):
    if kind=='plan':return {'equal':json.loads(a)==json.loads(b),'plan':json.loads(a)}
    if kind=='slice':return compare_zip(a,b)
    with Image.open(io.BytesIO(a)) as im,Image.open(io.BytesIO(b)) as jm:
        return {'equal':im.format==jm.format and im.size==jm.size and im.convert('RGBA').tobytes()==jm.convert('RGBA').tobytes(),'dimensions':list(im.size),'encodedBytesEqual':a==b}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--freeze',action='store_true',help='Create a new baseline directory only after all comparisons pass')
    args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];fixtures=skill/'assets/fixtures';folder=fixtures/'custom-slice';frozen=folder/'original'
    manifest=json.loads((folder/'manifest.json').read_text())
    assert hashlib.sha256((skill.parents[1]/manifest['originalSource']).read_bytes()).hexdigest()==manifest['originalSha256'],'Original source changed'
    for name,sha in manifest['sources'].items():assert hashlib.sha256((fixtures/name).read_bytes()).hexdigest()==sha,f'Source fixture changed: {name}'
    if args.freeze and frozen.exists():raise SystemExit('The frozen baseline already exists; it was not overwritten.')
    rows=[];originals={}
    with zipfile.ZipFile(args.archive) as archive:
        for kind in ['plan','slice','compose']:
            suffix={'plan':'json','slice':'zip','compose':'png'}[kind]
            for case in manifest[kind]:
                prefix=f'{kind}/{case["id"]}';name=f'{kind}-{case["id"]}.{suffix}';a=archive.read(f'{prefix}/original.{suffix}');b=archive.read(f'{prefix}/actual.{suffix}')
                result=compare(kind,a,b)
                if not args.freeze:result['frozenBaselineEqual']=compare(kind,a,(frozen/name).read_bytes())['equal']
                originals[name]=a;rows.append({'kind':kind,'id':case['id'],'originalSha256':hashlib.sha256(a).hexdigest(),**result})
    failed=[row['id'] for row in rows if not row['equal'] or not row.get('frozenBaselineEqual',True)]
    if args.freeze and not failed:
        frozen.mkdir()
        for name,data in originals.items():(frozen/name).write_bytes(data)
    args.output.write_text(json.dumps({'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'cases':rows},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
