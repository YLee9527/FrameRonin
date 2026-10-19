"""Compare bounded video previews and exact original brush-mask operations."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile
from compare_sheet_prepare_oracle import compare_png

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];fixture=skill/'assets/fixtures/video-frames';manifest=json.loads((fixture/'manifest.json').read_text());cases=json.loads((fixture/'assets.json').read_text())['cases'];frozen=fixture/'assets-original'
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    for path,digest in manifest['sources'].items():assert sha(fixture/path)==digest
    for path,digest in manifest['originals'].items():assert sha(skill.parents[1]/path)==digest
    if args.freeze and frozen.exists():raise SystemExit('Existing video preview/brush baseline preserved.')
    rows=[];originals={}
    with zipfile.ZipFile(args.archive) as archive:
        names=archive.namelist();assert len(names)==len(set(names)) and sum(e.file_size for e in archive.infolist())<=256*1024**2
        for case in cases:
            name=case['id'];assert re.fullmatch(r'[a-z0-9-]+',name)
            a=json.loads(archive.read(name+'/original.json'));b=json.loads(archive.read(name+'/actual.json'));members=[]
            for path in names:
                if not path.startswith(name+'/original-'):continue
                suffix=path[len(name+'/original-'):];assert re.fullmatch(r'(file|preview)_\d+\.(png|json)',suffix)
                original=archive.read(path);actual=archive.read(name+'/actual-'+suffix)
                result=compare_png(original,actual) if suffix.endswith('.png') else {'equal':json.loads(original)==json.loads(actual),'encodedBytesEqual':original==actual}
                if not args.freeze:
                    baseline=(frozen/name/suffix).read_bytes()
                    result['frozenBaselineEqual']=compare_png(original,baseline)['equal'] if suffix.endswith('.png') else json.loads(original)==json.loads(baseline)
                originals[name+'/'+suffix]=original;members.append({'member':suffix,**result})
            expected_files=1 if case['action']=='brush' else 2 if case['action']=='sheet' else 0
            expected_previews=len(case['indices']) if case['action']=='frames' else 1 if case['action'] in ['matte','sheet'] else 0
            assert a['fileCount']==expected_files and a['previewCount']==expected_previews and len(members)==expected_files+expected_previews
            metadata_equal=a==b
            if not args.freeze:metadata_equal=metadata_equal and a==json.loads((frozen/name/'metadata.json').read_text())
            originals[name+'/metadata.json']=json.dumps(a,indent=2).encode()
            rows.append({'sample':name,'action':case['action'],'metadataEqual':metadata_equal,'metadata':a,'members':members,'equal':metadata_equal and all(r['equal'] and r.get('frozenBaselineEqual',True) for r in members)})
    failed=[r['sample'] for r in rows if not r['equal']]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':sha(args.archive),'fixtureSha256':sha(fixture/'assets.json'),'cases':rows,'failed':failed},ensure_ascii=False,indent=2)+'\n')
    if args.freeze and not failed:
        for name,data in originals.items():
            path=frozen/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    print(json.dumps({'cases':len(rows),'pngs':sum(m['member'].endswith('.png') for r in rows for m in r['members']),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)

if __name__=='__main__':main()
