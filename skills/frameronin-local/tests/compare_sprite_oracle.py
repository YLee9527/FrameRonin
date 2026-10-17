"""Compare every sprite PNG and every GIF frame against the frozen original."""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image


def compare(a,b,kind):
    errors=[];shapes=Counter();total_frames=0;encoded=True
    with zipfile.ZipFile(io.BytesIO(a)) as first,zipfile.ZipFile(io.BytesIO(b)) as second:
        names=first.namelist()
        if names!=second.namelist() or len(names)!=len(set(names)):return {'equal':False,'reason':'member-order-or-names'}
        content_a=hashlib.sha256();content_b=hashlib.sha256()
        for i,name in enumerate(names):
            expected=f'frame_{i:03d}.png' if kind=='split' else f'row_{i+1:02d}.gif'
            if name!=expected:raise AssertionError('Original archive name changed')
            x=first.read(name);y=second.read(name);encoded=encoded and x==y
            for digest,data in [(content_a,x),(content_b,y)]:digest.update(name.encode());digest.update(len(data).to_bytes(8,'big'));digest.update(data)
            with Image.open(io.BytesIO(x)) as image,Image.open(io.BytesIO(y)) as actual:
                count=getattr(image,'n_frames',1)
                equal=image.format==actual.format==('PNG' if kind=='split' else 'GIF') and image.size==actual.size and count==getattr(actual,'n_frames',1)
                durations=[]
                if equal:
                    for index in range(count):
                        image.seek(index);actual.seek(index)
                        duration=image.info.get('duration');durations.append(duration)
                        if image.convert('RGBA').tobytes()!=actual.convert('RGBA').tobytes() or duration!=actual.info.get('duration'):equal=False
                    if kind=='gif' and x!=y:equal=False
                if not equal:errors.append(name)
                shapes[(image.width,image.height,count,tuple(sorted(set(durations))))]+=1;total_frames+=count
        return {'equal':not errors,'members':len(names),'decodedFrames':total_frames,'encodedMembersEqual':encoded,'firstName':names[0],'lastName':names[-1],'originalMemberHash':content_a.hexdigest(),'actualMemberHash':content_b.hexdigest(),'shapes':[{'width':w,'height':h,'frames':f,'durations':list(d),'members':n} for (w,h,f,d),n in shapes.items()],'mismatchedMembers':errors[:20]}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];folder=skill/'assets/fixtures/sprite-sheet';frozen=folder/'original';manifest=json.loads((folder/'manifest.json').read_text())
    assert hashlib.sha256((skill.parents[1]/manifest['originalSource']).read_bytes()).hexdigest()==manifest['originalSha256'],'Original source changed'
    for name,sha in manifest['sources'].items():assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==sha,'Fixture changed'
    if args.freeze and frozen.exists():raise SystemExit('The frozen baseline exists; it was not overwritten.')
    rows=[];originals={}
    with zipfile.ZipFile(args.archive) as archive:
        assert len(archive.namelist())==len(set(archive.namelist())),'Duplicate archive members'
        for kind in ['split','gif']:
            assert len({entry['id'] for entry in manifest[kind]})==len(manifest[kind]),'Duplicate sample IDs'
            for entry in manifest[kind]:
                key=entry['id'];a=archive.read(f'{kind}/{key}/original.zip');b=archive.read(f'{kind}/{key}/actual.zip');name=f'{kind}-{key}.zip'
                result=compare(a,b,kind)
                if not args.freeze:result['frozenBaselineEqual']=compare(a,(frozen/name).read_bytes(),kind)['equal']
                originals[name]=a;rows.append({'kind':kind,'sample':key,**result})
    failed=[r['kind']+'/'+r['sample'] for r in rows if not r['equal'] or not r.get('frozenBaselineEqual',True)]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'cases':rows,'failed':failed},indent=2)+'\n')
    if args.freeze and not failed:
        frozen.mkdir()
        for name,data in originals.items():(frozen/name).write_bytes(data)
    print(json.dumps({'cases':len(rows),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
