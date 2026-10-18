"""Deterministic ParamsStep frame inputs and original-recipe oracle cases."""
import hashlib
import json
from pathlib import Path
import zipfile
from PIL import Image

def main():
    skill=Path(__file__).resolve().parents[1];root=skill.parents[1];folder=skill/'assets/fixtures/video-frames';folder.mkdir(exist_ok=True)
    if (folder/'manifest.json').exists():raise SystemExit('Existing frame fixture preserved; choose an explicit new corpus before changing it.')
    frames=[]
    for n,(w,h) in enumerate([(17,13),(17,13),(17,13),(1,1),(7,9),(2,5),(31,9)]):
        image=Image.new('RGBA',(w,h))
        for y in range(h):
            for x in range(w):
                seed=0 if n==1 else n
                alpha=[0,1,4,5,6,120,127,254,255][(x*3+y*7+seed)%9]
                if 2<=x<w-2 and 2<=y<h-2:alpha=255
                image.putpixel((x,y),((x*37+y*3+seed*19)%256,(x*5+y*47+seed*13)%256,(x*71+y*11+seed*7)%256,alpha))
        name=f'frame_{n:03d}.png';image.save(folder/name);frames.append(name)
    mask=Image.new('RGBA',(17,13))
    for y in range(13):
        for x in range(17):mask.putpixel((x,y),(200,30,140,[0,1,5,64,127,128,200,254,255][(x+y*3)%9]))
    mask.save(folder/'brush.png')
    with zipfile.ZipFile(folder/'frames.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for name in frames:archive.write(folder/name,name)
    cases=[{'id':'analyze','layout':{'mode':'analyze'}}]
    for suffix,tolerance,feather in [('default',40,10),('hard',1,0),('wide',100,30),('fractional',37.5,8.25)]:
        for brush in [False,True]:cases.append({'id':f'matte-{suffix}'+('-brush' if brush else ''),'layout':{'mode':'matte','selected':[0,2,3,4,5,6],'background':'#263b40','tolerance':tolerance,'feather':feather,'mask':brush}})
    base={'mode':'compose','width':23,'height':21,'padding':2,'spacing':3,'columns':3,'timestamps':[0,.1,.2005,.3005,.4,.9999,1.234567],'strokeWidth':0,'strokeColor':'#8325cd'}
    variants=[('default',{}),('unused-columns',{'columns':12}),('fractional',{'width':23.5,'height':21.25,'padding':2.5,'spacing':1.25}),('no-upscale',{'width':64,'height':64,'padding':0}),('negative-inner',{'width':8,'height':7,'padding':6}),('one-column',{'columns':1,'padding':0,'spacing':0})]
    for name,values in variants:cases.append({'id':'compose-'+name,'layout':{**base,**values}})
    for width in [.5,1,3,16]:cases.append({'id':f'compose-stroke-{width}','layout':{**base,'strokeWidth':width}})
    for kind in ['extracted','matted']:cases.append({'id':'archive-'+kind,'layout':{'mode':'archive','kind':kind,'selected':[0,2,3,6]}})
    originals=['reference/frontend/src/components/ParamsStep.tsx','reference/frontend/src/components/ParamsStep/utils.ts']
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    manifest={'formatVersion':1,'sources':{name:sha(folder/name) for name in frames+['brush.png','frames.zip']},'originals':{name:sha(root/name) for name in originals},'frames':frames,'cases':cases,'comparison':{'png':'strict decoded RGBA and dimensions; record encoded equality','json':'exact object fields; compose frames compared by stable i because original async image loads can reorder index rows','archive':'exact names and selected PNG bytes; ZIP metadata ignored'}}
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'cases':len(cases),'frames':len(frames)}))

if __name__=='__main__':main()
