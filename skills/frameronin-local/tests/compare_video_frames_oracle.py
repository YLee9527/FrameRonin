"""Compare original ParamsStep outputs against real video-frame Workers."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from compare_sheet_prepare_oracle import compare_png

def compared(a,b,mode):
    rows=[]
    with zipfile.ZipFile(io.BytesIO(a)) as original,zipfile.ZipFile(io.BytesIO(b)) as actual:
        names=original.namelist()
        if len(names)!=len(set(names)) or names!=actual.namelist():return {'equal':False,'reason':'member-list','original':names,'actual':actual.namelist()}
        for name in names:
            x=original.read(name);y=actual.read(name)
            if name.endswith('.png'):
                result=compare_png(x,y)
                if mode=='archive':result['equal']=result['equal'] and x==y
            elif name.endswith('.json'):
                x=json.loads(x);y=json.loads(y)
                if name=='index.json':
                    x['frames'].sort(key=lambda r:r['i']);y['frames'].sort(key=lambda r:r['i'])
                result={'equal':x==y}
            else:result={'equal':x==y}
            rows.append({'member':name,**result})
    return {'equal':all(row['equal'] for row in rows),'members':rows}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];folder=skill/'assets/fixtures/video-frames';manifest=json.loads((folder/'manifest.json').read_text());frozen=folder/'original'
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    for name,digest in manifest['originals'].items():assert sha(skill.parents[1]/name)==digest,'Original code changed'
    for name,digest in manifest['sources'].items():assert sha(folder/name)==digest,'Fixture changed'
    if args.freeze and frozen.exists():raise SystemExit('Existing frozen video-frame corpus preserved.')
    rows=[];outputs={}
    with zipfile.ZipFile(args.archive) as archive:
        assert len(archive.namelist())==len(set(archive.namelist()))
        for case in manifest['cases']:
            name=case['id'];a=archive.read(name+'/original.zip');b=archive.read(name+'/actual.zip');row=compared(a,b,case['layout']['mode'])
            if not args.freeze:row['frozenBaselineEqual']=compared(a,(frozen/(name+'.zip')).read_bytes(),case['layout']['mode'])['equal']
            rows.append({'sample':name,'mode':case['layout']['mode'],'originalSha256':hashlib.sha256(a).hexdigest(),'actualSha256':hashlib.sha256(b).hexdigest(),**row});outputs[name]=a
    failed=[row['sample'] for row in rows if not row['equal'] or not row.get('frozenBaselineEqual',True)]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':sha(args.archive),'cases':rows,'failed':failed},ensure_ascii=False,indent=2)+'\n')
    if args.freeze and not failed:
        frozen.mkdir()
        for name,data in outputs.items():(frozen/(name+'.zip')).write_bytes(data)
    print(json.dumps({'cases':len(rows),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)

if __name__=='__main__':main()
