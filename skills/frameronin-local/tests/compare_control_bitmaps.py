"""Compare game display bitmaps against original Canvas and frozen pixels."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from compare_sheet_prepare_oracle import compare_png


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--freeze',action='store_true',help='Create the first immutable original corpus; never overwrite it.')
    args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1];fixture=skill/'assets/fixtures/control/bitmap'
    digest=lambda data:hashlib.sha256(data).hexdigest()
    rows=[]
    with zipfile.ZipFile(args.archive) as archive:
        checks=json.loads(archive.read('checks.json'))
        expected=['fine-editor/'+name for name in ['source.png','source.jpg','source-oriented.jpg','source-oriented.png','source-lossless.webp','source-lossy.webp','source-oriented.webp']]
        expected+=['decha.png','debg.png','hou384.png','qian384.png','zombie_walk.png','zombie_walk2.png','zombie_walk3.png','zombie_walk4.png']
        assert len(checks)==len(expected) and {r['name'] for r in checks}==set(expected)
        assert set(archive.namelist())=={'checks.json'}|{str(i)+'/' for i in range(len(checks))}|{str(i)+'/'+name+'.png' for i in range(len(checks)) for name in ['original','actual']}
        frozen={'formatVersion':1,'sources':{},'originals':{}}
        if args.freeze:assert not fixture.exists(),'The original corpus must never be overwritten'
        else:frozen=json.loads((fixture/'manifest.json').read_text())
        pending=[]
        for i,row in enumerate(checks):
            source=skill/('assets/fixtures/'+row['name'] if row['name'].startswith('fine-editor/') else 'assets/workbench/public/'+row['name'])
            source_hash=digest(source.read_bytes());original=archive.read(str(i)+'/original.png');actual=archive.read(str(i)+'/actual.png')
            name=row['name'].replace('/','--')+'.png'
            if args.freeze:
                frozen['sources'][row['name']]=source_hash;frozen['originals'][name]=digest(original);pending.append((name,original))
            else:
                assert frozen['sources'][row['name']]==source_hash
                frozen_original=(fixture/name).read_bytes();assert digest(frozen_original)==frozen['originals'][name]
                assert compare_png(frozen_original,original)['equal'],'The current original Canvas differs from its frozen output'
            comparison=compare_png(original,actual)
            assert row['dimensionsEqual'] and row['differentChannels']==0 and row['equal'] and comparison['equal'],row['name']
            rows.append({'sample':row['name'],**comparison})
        if args.freeze:
            fixture.mkdir(parents=True)
            for name,data in pending:(fixture/name).write_bytes(data)
            (fixture/'manifest.json').write_text(json.dumps(frozen,indent=2)+'\n')
    record={'archiveSha256':digest(args.archive.read_bytes()),'fixtureSha256':digest((fixture/'manifest.json').read_bytes()),'cases':rows,'failed':[]}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'failed':[],'frozen':args.freeze}))


if __name__=='__main__':main()
