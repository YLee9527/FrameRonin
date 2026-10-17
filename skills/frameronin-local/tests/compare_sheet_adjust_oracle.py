"""Compare original adjustment outputs and freeze only a fully passing corpus."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image
from compare_sprite_oracle import compare as compare_frames


def compare(a,b,action):
    if action=='fix':return compare_frames(a,b,'split')
    mismatches=[]
    with Image.open(io.BytesIO(a)) as first,Image.open(io.BytesIO(b)) as second:
        count=getattr(first,'n_frames',1)
        if first.format!=second.format or first.size!=second.size or count!=getattr(second,'n_frames',1):return {'equal':False,'reason':'format-dimensions-or-count'}
        durations=[]
        for frame in range(count):
            first.seek(frame);second.seek(frame);duration=first.info.get('duration');durations.append(duration)
            if first.convert('RGBA').tobytes()!=second.convert('RGBA').tobytes() or duration!=second.info.get('duration'):mismatches.append(frame)
        encoded=a==b
        return {'equal':not mismatches and (action!='gif' or encoded),'width':first.width,'height':first.height,'frames':count,'durationMs':sorted(set(durations)),'encodedBytesEqual':encoded,'mismatchedFrames':mismatches}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];folder=skill/'assets/fixtures/sheet-adjust';frozen=folder/'original';manifest=json.loads((folder/'manifest.json').read_text())
    assert hashlib.sha256((skill.parents[1]/manifest['originalSource']).read_bytes()).hexdigest()==manifest['originalSha256'],'Original source changed'
    for name,sha in manifest['sources'].items():assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==sha,'Fixture changed'
    assert len({r['id'] for r in manifest['cases']})==len(manifest['cases']),'Duplicate sample IDs'
    if args.freeze and frozen.exists():raise SystemExit('Frozen original outputs already exist and were preserved.')
    rows=[];originals={}
    with zipfile.ZipFile(args.archive) as archive:
        assert len(archive.namelist())==len(set(archive.namelist())),'Duplicate archive members'
        for entry in manifest['cases']:
            key=entry['id'];action=entry['action'];ext='png' if action=='compose' else 'gif' if action=='gif' else 'zip'
            a=archive.read(f'{key}/original.{ext}');b=archive.read(f'{key}/actual.{ext}');name=f'{key}.{ext}';result=compare(a,b,action)
            if not args.freeze:result['frozenBaselineEqual']=compare(a,(frozen/name).read_bytes(),action)['equal']
            originals[name]=a;rows.append({'sample':key,'action':action,'originalSha256':hashlib.sha256(a).hexdigest(),'actualSha256':hashlib.sha256(b).hexdigest(),**result})
    failed=[r['sample'] for r in rows if not r['equal'] or not r.get('frozenBaselineEqual',True)]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'cases':rows,'failed':failed},indent=2)+'\n')
    if args.freeze and not failed:
        frozen.mkdir()
        for name,data in originals.items():(frozen/name).write_bytes(data)
    print(json.dumps({'cases':len(rows),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
