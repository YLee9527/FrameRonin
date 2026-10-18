"""Strict native-video frames/metadata comparison and optional managed publication."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from compare_sheet_prepare_oracle import compare_png

def compare_case(a_meta,b_meta,a_zip=None,b_zip=None):
    metadata_equal=a_meta==b_meta
    if a_meta.get('rejected'):return {'equal':metadata_equal,'metadataEqual':metadata_equal,'rejected':True,'mediaCode':a_meta['mediaCode'],'frames':[]}
    if b_meta.get('rejected') or a_zip is None or b_zip is None:return {'equal':False,'metadataEqual':metadata_equal,'reason':'capture-rejected-or-missing','frames':[]}
    frames=[]
    with zipfile.ZipFile(io.BytesIO(a_zip)) as a,zipfile.ZipFile(io.BytesIO(b_zip)) as b:
        expected=[f'frame_{i:03d}.png' for i in range(len(a_meta['timestamps']))]
        if not expected or a.namelist()!=expected or a.namelist()!=b.namelist():return {'equal':False,'metadataEqual':metadata_equal,'reason':'frame-members','frames':[]}
        for name in a.namelist():frames.append({'member':name,**compare_png(a.read(name),b.read(name))})
    return {'equal':metadata_equal and all(f['equal'] for f in frames),'metadataEqual':metadata_equal,'metadata':a_meta,'frames':frames}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--managed',type=Path);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];folder=skill/'assets/fixtures/video-capture';manifest=json.loads((folder/'manifest.json').read_text());frozen=folder/'original'
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    for name,digest in manifest['sources'].items():assert sha(folder/name)==digest,'Video fixture changed'
    for name,digest in manifest['originals'].items():assert sha(skill.parents[1]/name)==digest,'Original video capture source changed'
    if args.freeze and frozen.exists():raise SystemExit('Existing native capture baseline preserved.')
    rows=[];managed=[];originals={}
    with zipfile.ZipFile(args.archive) as archive:
        actual_managed=zipfile.ZipFile(args.managed) if args.managed else None
        try:
            for case in manifest['cases']:
                name=case['id'];a=json.loads(archive.read(name+'/original.json'));b=json.loads(archive.read(name+'/actual.json'));x=None if a.get('rejected') else archive.read(name+'/original.zip');y=None if b.get('rejected') else archive.read(name+'/actual.zip')
                row=compare_case(a,b,x,y)
                if not args.freeze:row['frozenBaselineEqual']=compare_case(a,json.loads((frozen/(name+'.json')).read_text()),x,None if a.get('rejected') else (frozen/(name+'.zip')).read_bytes())['equal']
                rows.append({'sample':name,'source':case['source'],**row});originals[name]=(a,x)
                if actual_managed:
                    m=json.loads(actual_managed.read(name+'/actual.json'));z=None if m.get('rejected') else actual_managed.read(name+'/actual.zip');managed.append({'sample':name,**compare_case(a,m,x,z)})
        finally:
            if actual_managed:actual_managed.close()
    failed=[r['sample'] for r in rows if not r['equal'] or not r.get('frozenBaselineEqual',True)];managed_failed=[r['sample'] for r in managed if not r['equal']]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':sha(args.archive),'managedArchiveSha256':sha(args.managed) if args.managed else None,'cases':rows,'managedCases':managed,'failed':failed,'managedFailed':managed_failed},ensure_ascii=False,indent=2)+'\n')
    if args.freeze and not failed and not managed_failed:
        frozen.mkdir()
        for name,(metadata,frames) in originals.items():
            (frozen/(name+'.json')).write_text(json.dumps(metadata,indent=2)+'\n')
            if frames is not None:(frozen/(name+'.zip')).write_bytes(frames)
    print(json.dumps({'cases':len(rows),'frames':sum(len(r['frames']) for r in rows),'rejected':sum(bool(r.get('rejected')) for r in rows),'failed':failed,'managedCases':len(managed),'managedFailed':managed_failed,'baselineCreated':args.freeze and not failed and not managed_failed}))
    if failed or managed_failed:raise SystemExit(1)

if __name__=='__main__':main()
