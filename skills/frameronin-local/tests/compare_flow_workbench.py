"""Compare actual workbench downloads with the frozen 16x512 browser corpus."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image
from compare_sheet_prepare_oracle import compare_png


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('actual',type=Path)
    parser.add_argument('--sheet',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    skill=Path(__file__).resolve().parents[1]
    fixture=skill/'assets/fixtures/flow-tools/workbench'
    manifest=json.loads((fixture/'manifest.json').read_text())
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    for name,expected in manifest['sources'].items():assert digest(fixture/name)==expected
    for name,expected in manifest['originals'].items():assert digest(skill.parents[1]/name)==expected
    rows=[]
    with zipfile.ZipFile(fixture/'original-frames.zip') as original,zipfile.ZipFile(args.actual) as actual:
        names=['frame_'+str(i+1).zfill(3)+'.png' for i in range(manifest['expectedFrames'])]
        assert original.namelist()==actual.namelist()==names
        for name in names:rows.append({'frame':name,**compare_png(original.read(name),actual.read(name))})
        sheet_result=None
        if args.sheet:
            cols=manifest['exportColumns'];height=manifest['height'];width=manifest['width']
            expected=Image.new('RGBA',(cols*width,((len(names)+cols-1)//cols)*height))
            for i,name in enumerate(names):
                with Image.open(io.BytesIO(original.read(name))) as frame:expected.paste(frame.convert('RGBA'),(i%cols*width,i//cols*height))
            encoded=io.BytesIO();expected.save(encoded,format='PNG')
            sheet_result=compare_png(encoded.getvalue(),args.sheet.read_bytes())
    failed=[r['frame'] for r in rows if not r['equal']]
    if sheet_result and not sheet_result['equal']:failed.append('sheet')
    record={'fixtureSha256':digest(fixture/'manifest.json'),'actualSha256':digest(args.actual),'frames':len(rows),'comparisons':rows,'sheetLayoutFromOriginalFrames':sheet_result,'failed':failed}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'frames':len(rows),'failed':failed,'sheetCompared':args.sheet is not None}))
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
