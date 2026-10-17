"""Strict original standalone/Worker PNG comparisons against fixed sources."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image,ImageChops


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--freeze',action='store_true')
    args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];root=skill.parents[1]
    folder=skill/'assets/fixtures/visible-watermark';manifest=json.loads((folder/'manifest.json').read_text());frozen=folder/'original'
    assert len({case['id'] for case in manifest['cases']})==len(manifest['cases']),'Duplicate sample IDs'
    for name,sha in manifest['originalSources'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha,'Original source changed'
    for name,sha in manifest['sources'].items():assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==sha,'Input fixture changed'
    if args.freeze and frozen.exists():raise SystemExit('The frozen baseline exists; it was not overwritten.')
    rows=[];originals={}
    with zipfile.ZipFile(args.archive) as archive:
        assert len(archive.namelist())==len(set(archive.namelist())),'Duplicate archive members'
        for case in manifest['cases']:
            key=case['id'];original=archive.read(f'{key}/original.png');actual=archive.read(f'{key}/actual-worker.png')
            with Image.open(io.BytesIO(original)) as a,Image.open(io.BytesIO(actual)) as b:
                rgba_a=a.convert('RGBA');rgba_b=b.convert('RGBA')
                equal=a.format==b.format=='PNG' and a.size==b.size and rgba_a.tobytes()==rgba_b.tobytes()
                error=[maximum for minimum,maximum in ImageChops.difference(rgba_a,rgba_b).getextrema()] if a.size==b.size else None
                row={'sample':key,'strictRgbaEqual':equal,'dimensions':list(a.size),'maxChannelError':error,'encodedBytesEqual':original==actual,'originalSha256':hashlib.sha256(original).hexdigest()}
            if not args.freeze:row['frozenBaselineEqual']=(frozen/(key+'.png')).read_bytes()==original
            rows.append(row);originals[key]=original
    failed=[r['sample'] for r in rows if not r['strictRgbaEqual'] or not r.get('frozenBaselineEqual',True)]
    args.output.write_text(json.dumps({'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'cases':rows,'failed':failed},indent=2)+'\n')
    if args.freeze and not failed:
        frozen.mkdir()
        for key,data in originals.items():(frozen/(key+'.png')).write_bytes(data)
    print(json.dumps({'cases':len(rows),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
