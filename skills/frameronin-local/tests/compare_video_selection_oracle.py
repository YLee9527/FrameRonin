"""Check the skip-matte transport against the original selected PNG bytes."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from compare_video_frames_oracle import compared

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];fixture=skill/'assets/fixtures/video-frames'
    manifest=json.loads((fixture/'manifest.json').read_text());cases=json.loads((fixture/'selection.json').read_text())['cases']
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    for path,digest in manifest['originals'].items():assert sha(skill.parents[1]/path)==digest
    for path,digest in manifest['sources'].items():assert sha(fixture/path)==digest
    rows=[]
    with zipfile.ZipFile(args.archive) as archive,zipfile.ZipFile(fixture/'frames.zip') as source:
        for case in cases:
            name=case['id'];original=archive.read(name+'/original.zip');actual=archive.read(name+'/actual.zip');comparison=compared(original,actual,'archive')
            for data in [original,actual]:
                with zipfile.ZipFile(io.BytesIO(data)) as output:
                    assert output.namelist()==[f'frame_{i:03d}.png' for i in range(len(case['layout']['selected']))]
                    for i,index in enumerate(case['layout']['selected']):assert output.read(f'frame_{i:03d}.png')==source.read(f'frame_{index:03d}.png')
            assert comparison['equal'];rows.append({'sample':name,'layout':case['layout'],**comparison})
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'archiveSha256':sha(args.archive),'cases':rows,'failed':[]},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'copiedFrames':sum(len(c['layout']['selected']) for c in cases),'failed':[]}))

if __name__=='__main__':main()
