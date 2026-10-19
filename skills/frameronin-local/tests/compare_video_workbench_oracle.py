"""Compare actual UI downloads with the fixed original video-workbench recipe."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from compare_sheet_prepare_oracle import compare_png
from compare_video_frames_oracle import compared

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('original',type=Path)
    for key in ['mask','matted','raw','styled','png','index','output']:parser.add_argument('--'+key,type=Path,required=True)
    parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];fixture=skill/'assets/fixtures/video-frames';frozen=fixture/'workbench-original'
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    manifest=json.loads((fixture/'manifest.json').read_text())
    for name,digest in manifest['originals'].items():assert sha(skill.parents[1]/name)==digest
    if args.freeze and frozen.exists():raise SystemExit('Existing video workbench baseline preserved.')
    results={};originals={}
    with zipfile.ZipFile(args.original) as original:
        assert original.namelist()==['mask.png','matted.zip','raw.zip','styled.zip']
        originals={name:original.read(name) for name in original.namelist()}
        results['mask']=compare_png(originals['mask.png'],args.mask.read_bytes())
        for key in ['matted','raw','styled']:results[key]=compared(originals[key+'.zip'],getattr(args,key).read_bytes(),'archive' if key=='matted' else 'compose')
    with zipfile.ZipFile(io.BytesIO(originals['raw.zip'])) as raw:
        results['pngDownload']=compare_png(raw.read('sprite.png'),args.png.read_bytes())
        a=json.loads(raw.read('index.json'));b=json.loads(args.index.read_text());a['frames'].sort(key=lambda row:row['i']);b['frames'].sort(key=lambda row:row['i']);results['indexDownload']={'equal':a==b}
    if not args.freeze:
        results['frozenMask']=compare_png(originals['mask.png'],(frozen/'mask.png').read_bytes())
        for key in ['matted','raw','styled']:results['frozen-'+key]=compared(originals[key+'.zip'],(frozen/(key+'.zip')).read_bytes(),'archive' if key=='matted' else 'compose')
    failed=[key for key,value in results.items() if not value['equal']]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'originalSha256':sha(args.original),'recipeSha256':sha(fixture/'workbench.json'),'downloadHashes':{key:sha(getattr(args,key)) for key in ['mask','matted','raw','styled','png','index']},'comparisons':results,'failed':failed},ensure_ascii=False,indent=2)+'\n')
    if args.freeze and not failed:
        frozen.mkdir()
        for name,data in originals.items():(frozen/name).write_bytes(data)
    print(json.dumps({'comparisons':len(results),'failed':failed,'baselineCreated':args.freeze and not failed}))
    if failed:raise SystemExit(1)

if __name__=='__main__':main()
