"""Strict original preprocessing, splitting, frame ZIP and rejection comparison."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
import numpy as np
from PIL import Image
from compare_sprite_oracle import compare as compare_frames


def compare_png(a,b):
    with Image.open(io.BytesIO(a)) as original,Image.open(io.BytesIO(b)) as actual:
        if original.format!=actual.format or original.format!='PNG' or original.size!=actual.size:return {'equal':False,'reason':'PNG-format-or-dimensions','originalSize':list(original.size),'actualSize':list(actual.size)}
        x=np.asarray(original.convert('RGBA'));y=np.asarray(actual.convert('RGBA'));delta=x.astype(np.int16)-y.astype(np.int16);mask=np.any(delta!=0,axis=2);bad=np.argwhere(mask)
        return {'equal':not bool(len(bad)),'width':original.width,'height':original.height,'maxChannelError':np.max(np.abs(delta),axis=(0,1)).tolist(),'differentPixels':int(np.count_nonzero(mask)),'firstDifference':None if not len(bad) else {'x':int(bad[0][1]),'y':int(bad[0][0]),'original':x[tuple(bad[0])].tolist(),'actual':y[tuple(bad[0])].tolist()},'encodedBytesEqual':a==b}


def compare(a,b,entry):
    if entry.get('expectFailure'):
        original=json.loads(a);actual=json.loads(b)
        return {'equal':original['rejected'] and actual['rejected'] and entry['originalErrorIncludes'] in original['error'] and entry['workerErrorIncludes'] in actual['error'],'originalRejection':original,'workerRejection':actual}
    return compare_png(a,b) if entry['action']=='preprocess' else compare_frames(a,b,'split')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];folder=skill/'assets/fixtures/sheet-prepare';manifest=json.loads((folder/'manifest.json').read_text());frozen=folder/'original'
    for source,sha in manifest['originals'].items():assert hashlib.sha256((skill.parents[1]/source).read_bytes()).hexdigest()==sha,'Original code changed'
    for source,sha in manifest['sources'].items():assert hashlib.sha256((folder/source).read_bytes()).hexdigest()==sha,'Fixture changed'
    assert len({r['id'] for r in manifest['cases']})==len(manifest['cases']),'Duplicate sample IDs'
    if args.freeze and frozen.exists():raise SystemExit('The frozen original corpus already exists and was preserved.')
    originals={};rows=[]
    with zipfile.ZipFile(args.archive) as archive:
        assert len(archive.namelist())==len(set(archive.namelist())),'Duplicate archive members'
        for entry in manifest['cases']:
            ext='json' if entry.get('expectFailure') else 'png' if entry['action']=='preprocess' else 'zip';name=f'{entry["id"]}.{ext}'
            a=archive.read(f'{entry["id"]}/original.{ext}');b=archive.read(f'{entry["id"]}/actual.{ext}');result=compare(a,b,entry)
            if not args.freeze:
                baseline=(frozen/name).read_bytes()
                result['frozenBaselineEqual']=json.loads(a)==json.loads(baseline) if entry.get('expectFailure') else compare(a,baseline,entry)['equal']
            rows.append({'sample':entry['id'],'action':entry['action'],'input':entry['input'],'originalSha256':hashlib.sha256(a).hexdigest(),'actualSha256':hashlib.sha256(b).hexdigest(),**result});originals[name]=a
    failed=[r['sample'] for r in rows if not r['equal'] or not r.get('frozenBaselineEqual',True)]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'cases':rows,'failed':failed},ensure_ascii=False,indent=2)+'\n')
    if args.freeze and not failed:
        frozen.mkdir()
        for name,data in originals.items():(frozen/name).write_bytes(data)
    print(json.dumps({'cases':len(rows),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
