"""Compare every original/native frame, timestamp and actual UI archive member."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from compare_sheet_prepare_oracle import compare_png

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('original',type=Path);parser.add_argument('actual',type=Path);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];folder=skill/'assets/fixtures/video-capture';frozen=folder/'large-original.zip';fixture=json.loads((folder/'performance.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    assert sha(folder/fixture['source'])==fixture['sourceSha256']
    for name,digest in json.loads((folder/'manifest.json').read_text())['originals'].items():assert sha(skill.parents[1]/name)==digest
    if args.freeze and frozen.exists():raise SystemExit('Existing large native capture baseline preserved.')
    p=fixture['parameters'];timestamps=[];t=p['start']
    while t<p['end'] and len(timestamps)<p['maxFrames']:timestamps.append(t);t+=1/p['fps']
    failures=[];encoded=True
    with zipfile.ZipFile(args.original) as original,zipfile.ZipFile(args.actual) as actual:
        names=[f'frame_{i:03d}.png' for i in range(len(timestamps))]
        assert original.namelist()==names+['capture.json'] and actual.namelist()==['frames/']+[f'frames/frame_{i+1:05d}.png' for i in range(len(names))]
        meta=json.loads(original.read('capture.json'));assert meta['timestamps']==timestamps and meta['width']==meta['info']['width']==fixture['metadata']['width'] and meta['height']==meta['info']['height']==fixture['metadata']['height']
        baseline=None if args.freeze else zipfile.ZipFile(frozen)
        try:
            if baseline:assert json.loads(baseline.read('capture.json'))==meta
            for i,name in enumerate(names):
                data=original.read(name);result=compare_png(data,actual.read(f'frames/frame_{i+1:05d}.png'));encoded=encoded and result['encodedBytesEqual']
                if not result['equal'] or baseline and not compare_png(data,baseline.read(name))['equal']:failures.append(i)
        finally:
            if baseline:baseline.close()
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'originalSha256':sha(args.original),'actualSha256':sha(args.actual),'frames':len(timestamps),'width':meta['width'],'height':meta['height'],'timestampsEqual':True,'encodedPngBytesEqual':encoded,'failedFrames':failures},indent=2)+'\n')
    if args.freeze and not failures:frozen.write_bytes(args.original.read_bytes())
    print(json.dumps({'frames':len(timestamps),'failedFrames':failures,'encodedBytesEqual':encoded,'baselineCreated':args.freeze and not failures}))
    if failures:raise SystemExit(1)

if __name__=='__main__':main()
