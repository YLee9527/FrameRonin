"""Reproduce deterministic standalone-matte samples into a new directory."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import numpy as np
from PIL import Image

SKILL=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=SKILL/'assets/fixtures/matte-tool');args=parser.parse_args()
    folder=args.output;folder.mkdir(parents=True,exist_ok=False)
    y,x=np.indices((37,43));rgba=np.stack([(x*13+y*7)%256,(x*5+y*19)%256,(x*23+y*3)%256,(x*17+y*11)%256],axis=2).astype(np.uint8)
    rgba[0:5,:]=[0,255,0,255];rgba[5:10,:]=[0,0,255,255];rgba[10:15,:]=[240,240,240,255];rgba[15:20,:]=[255,255,255,255]
    Image.fromarray(rgba).save(folder/'color-alpha.png')
    black=np.zeros_like(rgba);white=np.zeros_like(rgba);alpha=rgba[:,:,3:].astype(float)/255
    black[:,:,:3]=np.rint(rgba[:,:,:3]*alpha).astype(np.uint8);white[:,:,:3]=np.rint(rgba[:,:,:3]*alpha+255*(1-alpha)).astype(np.uint8);black[:,:,3]=white[:,:,3]=255
    Image.fromarray(black).save(folder/'black.png');Image.fromarray(white).save(folder/'white.png')
    white[::2,::3,3]=128;Image.fromarray(white).save(folder/'white-alpha.png')
    repair=np.zeros((47,53,4),dtype=np.uint8);repair[4:39,5:45,:3]=[80,120,200]
    repair[4:39,5:45,3]=np.tile(np.array([0,1,10,13,14,20,50,51,80,128,200,255],dtype=np.uint8),117)[:1400].reshape(35,40)
    repair[1,1]=[180,90,30,255];repair[42:45,48:51]=[220,20,80,255];Image.fromarray(repair).save(folder/'repair.png')
    Image.fromarray(repair[10:11,:,:]).save(folder/'thin.png')
    for name,shape in [('islands-16',(801,1000)),('islands-20',(1410,1420))]:
        a=np.zeros((*shape,4),dtype=np.uint8)
        for i,area in enumerate([11,12,15,16,19,20,21]):a[5+i*4,5:5+area]=[100,150,200,255]
        Image.fromarray(a).save(folder/(name+'.png'))
    for name in ['photo.jpg','jpeg-444.jpg','jpeg-422.jpg','jpeg-progressive.jpg','jpeg-gray.jpg','jpeg-cmyk.jpg','oriented.jpg','jpeg-orientation8.jpg','oriented.webp','alpha.webp','profiled.png']:
        shutil.copyfile(SKILL/'assets/fixtures/scatter'/name,folder/name)
    for name in ['threshold1024.png','threshold1025.png']:
        shutil.copyfile(SKILL/'assets/fixtures/visible-watermark'/name,folder/name)
    cases=[]
    def add(sample,inputs,layout):cases.append({'id':sample,'inputs':inputs,'layout':layout})
    chroma={'mode':'chroma','keyColor':'#00ff00','tolerance':35,'smoothness':34,'spill':75,'erosion':77}
    add('chroma-default',['color-alpha.png'],chroma)
    for key,changes in [('blue',{'keyColor':'#0000ff'}),('custom',{'keyColor':'#806432'}),('minimal',{'tolerance':5,'smoothness':5,'spill':5,'erosion':0}),('maximal',{'tolerance':100,'smoothness':100,'spill':100,'erosion':100}),('fractional',{'tolerance':34.5,'smoothness':36.25,'spill':74.5,'erosion':14.9}),('one-pass',{'erosion':5}),('four-passes',{'erosion':44.9})]:
        add('chroma-'+key,['color-alpha.png'],{**chroma,**changes})
    white_key={'mode':'whiteErode','tolerance':35,'smoothness':34,'erosion':77}
    for key,changes in [('default',{}),('no-erosion',{'erosion':0}),('minimum',{'tolerance':5,'smoothness':5,'erosion':5}),('maximum',{'tolerance':100,'smoothness':100,'erosion':100}),('fractional',{'tolerance':34.5,'smoothness':36.25,'erosion':14.9})]:
        add('white-'+key,['color-alpha.png'],{**white_key,**changes})
    for mode,base in [('chroma',chroma),('white',white_key)]:
        for name in ['photo.jpg','jpeg-444.jpg','jpeg-422.jpg','jpeg-progressive.jpg','jpeg-gray.jpg','jpeg-cmyk.jpg','oriented.jpg','jpeg-orientation8.jpg','oriented.webp','alpha.webp','profiled.png']:
            add(mode+'-'+name.replace('.','-'),[name],base)
    for key,parameters in [('default',{'tolerance':70,'edgeContrast':53}),('minimum',{'tolerance':50,'edgeContrast':50}),('maximum',{'tolerance':100,'edgeContrast':100}),('fractional',{'tolerance':71.5,'edgeContrast':62.25})]:
        add('double-'+key,['black.png','white.png'],{'mode':'doubleBg',**parameters})
    add('double-transparent-white-overdraw',['black.png','white-alpha.png'],{'mode':'doubleBg','tolerance':70,'edgeContrast':53})
    for name in ['threshold1024.png','threshold1025.png']:
        add('double-watermark-'+name[:-4],[name,name],{'mode':'doubleBg','tolerance':70,'edgeContrast':53})
    add('double-jpeg-same-source',['photo.jpg','photo.jpg'],{'mode':'doubleBg','tolerance':70,'edgeContrast':53})
    for name in ['repair.png','thin.png','islands-16.png','islands-20.png']:
        add('repair-'+name[:-4],[name],{'mode':'repair'})
    for value in [0,1,14.9,50,100]:add('frontier-'+str(value),['repair.png'],{'mode':'frontier','erosion':value})
    originals=['reference/frontend/src/components/ImageMatte.tsx','reference/frontend/src/lib/doubleBackgroundMatte.ts','reference/frontend/src/lib/geminiWatermark.ts']
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    manifest={'formatVersion':1,'comparison':'Strict dimensions, format and all RGBA channels, including transparent pixels; no tolerance','originals':{p:digest(SKILL.parents[1]/p) for p in originals},'sources':{p.name:digest(p) for p in sorted(folder.iterdir())},'cases':cases}
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'cases':len(cases),'inputs':len(manifest['sources'])}))

if __name__=='__main__':main()
