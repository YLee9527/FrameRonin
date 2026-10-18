"""Compare original standalone matte pixels, real Workers and frozen baselines."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from compare_sheet_prepare_oracle import compare_png

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];folder=skill/'assets/fixtures/matte-tool';manifest=json.loads((folder/'manifest.json').read_text());frozen=folder/'original'
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    for name,digest in manifest['originals'].items():assert sha(skill.parents[1]/name)==digest,'Original code changed'
    for name,digest in manifest['sources'].items():assert sha(folder/name)==digest,'Fixture changed'
    assert len({case['id'] for case in manifest['cases']})==len(manifest['cases'])
    if args.freeze and frozen.exists():raise SystemExit('Frozen original corpus already exists and was preserved.')
    records=[];originals={}
    with zipfile.ZipFile(args.archive) as archive:
        assert len(archive.namelist())==len(set(archive.namelist()))
        for case in manifest['cases']:
            name=case['id'];a=archive.read(f'{name}/original.png');b=archive.read(f'{name}/actual.png');result=compare_png(a,b)
            if not args.freeze:result['frozenBaselineEqual']=compare_png(a,(frozen/(name+'.png')).read_bytes())['equal']
            records.append({'sample':name,'mode':case['layout']['mode'],'originalSha256':hashlib.sha256(a).hexdigest(),'workerSha256':hashlib.sha256(b).hexdigest(),**result});originals[name]=a
    failed=[r['sample'] for r in records if not r['equal'] or not r.get('frozenBaselineEqual',True)]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':sha(args.archive),'cases':records,'failed':failed},ensure_ascii=False,indent=2)+'\n')
    if args.freeze and not failed:
        frozen.mkdir()
        for name,data in originals.items():(frozen/(name+'.png')).write_bytes(data)
    print(json.dumps({'cases':len(records),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)

if __name__=='__main__':main()
