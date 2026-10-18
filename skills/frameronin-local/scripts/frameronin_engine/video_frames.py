"""Strict original ParamsStep frame recipes and complete result validation."""
import json
import math
import re
import stat
import zipfile
from pathlib import Path
from PIL import Image
from .errors import RoninError
from .sheet_adjust import archive_info, fields, finite, integer

MIB=1024**2
def reject(code,message):raise RoninError(code,message)
def color(v):return isinstance(v,str) and re.fullmatch(r'#[a-fA-F0-9]{6}',v)
def same_json(a,b):
    if isinstance(b,dict):return isinstance(a,dict) and a.keys()==b.keys() and all(same_json(a[k],v) for k,v in b.items())
    if isinstance(b,list):return isinstance(a,list) and len(a)==len(b) and all(same_json(x,y) for x,y in zip(a,b))
    if type(b) in [int,float]:return type(a) in [int,float] and math.isfinite(a) and a==b
    return type(a) is type(b) and a==b
def selection(v,count):
    if not isinstance(v,list) or not 1<=len(v)<=count or any(not integer(n,0,count-1) or i and n<=v[i-1] for i,n in enumerate(v)):reject('VIDEO_FRAME_SELECTION','Choose existing frame indices in their original order, without duplicates.')

def layout(sizes,p):
    if not isinstance(p,dict) or not 1<=len(sizes)<=2000:reject('VIDEO_FRAME_LAYOUT','Review the supported frame recipe and its exact fields.')
    mode=p.get('mode')
    selected=list(range(len(sizes)));w=h=0
    if mode=='analyze' and fields(p,['mode']):pass
    elif mode=='archive' and fields(p,['mode','selected','kind']) and p['kind'] in ['extracted','matted']:
        selection(p['selected'],len(sizes));selected=p['selected']
    elif mode=='matte' and fields(p,['mode','selected','background','tolerance','feather','mask']) and color(p['background']) and finite(p['tolerance'],1,100) and finite(p['feather'],0,30) and type(p['mask']) is bool:
        selection(p['selected'],len(sizes));selected=p['selected']
    elif mode=='compose' and fields(p,['mode','width','height','padding','spacing','columns','timestamps','strokeWidth','strokeColor']) and finite(p['width'],1,30000) and finite(p['height'],1,30000) and finite(p['padding'],0,64) and finite(p['spacing'],0,64) and integer(p['columns'],1,64) and isinstance(p['timestamps'],list) and len(p['timestamps'])==len(sizes) and all(finite(t,0,86400) for t in p['timestamps']) and finite(p['strokeWidth'],0,16) and color(p['strokeColor']):
        w=math.floor(p['columns']*(p['width']+p['spacing'])-p['spacing']);h=math.floor(math.ceil(len(sizes)/p['columns'])*(p['height']+p['spacing'])-p['spacing'])
        if not integer(w,1,30000) or not integer(h,1,30000):reject('VIDEO_FRAME_SHEET_SIZE','The reviewed sprite sheet exceeds its dimension limit.')
    else:reject('VIDEO_FRAME_LAYOUT','Unknown fields or out-of-range frame recipe parameters.')
    return {'mode':mode,'width':w,'height':h,'inputFrames':len(sizes),'outputFrames':1 if mode=='compose' else 0 if mode=='analyze' else len(selected),'selected':selected}

def review(versions,p,budget,check=None):
    mode=p.get('layout',{}).get('mode') if isinstance(p.get('layout'),dict) else None
    mask=mode=='matte' and p['layout'].get('mask') is True
    if len(versions)!=(2 if mask else 1) or versions[0]['metadata']['kind']!='archive':reject('VIDEO_FRAME_INPUT_COUNT','Select one ordered frame ZIP and only the optional selected brush-mask PNG.')
    sizes,encoded=archive_info(versions[0]['absolutePath'],budget,check=check)
    plan=layout(sizes,p['layout']);max_pixels=max(s['w']*s['h'] for s in sizes)
    if mask:
        m=versions[1]['metadata']
        if m.get('kind')!='image' or m.get('containerFormat')!='PNG' or m.get('frames',1)!=1 or not integer(m['bytes'],1,20*MIB) or not integer(m.get('width'),1,30000) or not integer(m.get('height'),1,30000):reject('VIDEO_FRAME_MASK','Select one static PNG brush mask up to 20 MiB.')
        max_pixels=max(max_pixels,m['width']*m['height']);encoded+=m['bytes']
    if mode=='compose':max_pixels=max(max_pixels,math.ceil(p['layout']['width'])*math.ceil(p['layout']['height']));output_pixels=plan['width']*plan['height']
    else:output_pixels=sum(sizes[i]['w']*sizes[i]['h'] for i in plan['selected']) if mode=='matte' else 0
    estimate=256*MIB+encoded*12+max_pixels*96+output_pixels*32+p['frontendBytes']
    if estimate>budget:reject('VIDEO_FRAME_RESOURCE_LIMIT','The full decoded, intermediate, encoded and frontend frame working set exceeds the budget.')
    return estimate,plan,sizes

def duplicates(hashes):
    groups={}
    for index,value in enumerate(hashes):groups.setdefault(value,[]).append(index)
    result=[];group_id=0
    for indices in groups.values():
        if len(indices)>1:
            result.extend({'index':index,'groupId':group_id,'totalInGroup':len(indices)} for index in indices);group_id+=1
    return result

def sprite_index(p,plan,count):
    return {'version':'1.0','frame_size':{'w':p['width'],'h':p['height']},'sheet_size':{'w':p['columns']*(p['width']+p['spacing'])-p['spacing'],'h':math.ceil(count/p['columns'])*(p['height']+p['spacing'])-p['spacing']},'frames':[{'i':i,'x':i%p['columns']*(p['width']+p['spacing']),'y':math.floor(i/p['columns'])*(p['height']+p['spacing']),'w':p['width'],'h':p['height'],'t':math.floor(p['timestamps'][i]*1000+.5)/1000} for i in range(count)]}

def validate_result(path,versions,p,budget,check):
    _,plan,sizes=review(versions,p,budget,check);s=p['layout'];mode=plan['mode'];check()
    # Header-only review precedes the complete budget check. Publication also
    # requires every selected archive member to decode, including analysis jobs.
    archive_info(versions[0]['absolutePath'],budget,decode=True,check=check)
    check()
    if mode=='matte':
        archive_info(path,budget,decode=True,expected=[sizes[i] for i in plan['selected']],check=check)
        check()
        return {**plan,'frameSizes':[sizes[i] for i in plan['selected']]}
    if Path(path).stat().st_size>128*MIB:reject('VIDEO_FRAME_OUTPUT_LIMIT','The frame output ZIP exceeds 128 MiB.')
    names=['analysis.json'] if mode=='analyze' else ['sprite.png','index.json'] if mode=='compose' else [f"{'frames' if s['kind']=='extracted' else 'matted_frames'}/"]+[f"{'frames/frame' if s['kind']=='extracted' else 'matted_frames/matte'}_{i+1:05d}.png" for i in range(len(plan['selected']))]
    try:
        with zipfile.ZipFile(path) as output:
            entries=output.infolist()
            if [e.filename for e in entries]!=names or sum(e.file_size for e in entries)>128*MIB:reject('VIDEO_FRAME_OUTPUT_ENTRIES','The output differs from the reviewed exact member list or decoded byte limit.')
            for e in entries:
                check();kind=stat.S_IFMT(e.external_attr>>16)
                if e.flag_bits&1 or e.compress_type not in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED] or kind not in ([0,stat.S_IFDIR] if e.filename.endswith('/') else [0,stat.S_IFREG]) or e.filename.endswith('/') and e.file_size:reject('VIDEO_FRAME_OUTPUT_ENTRY','Output entries cannot be links, encrypted files or arbitrary directories.')
            if mode=='analyze':
                if entries[0].file_size>2*MIB:reject('VIDEO_FRAME_ANALYSIS_LIMIT','The duplicate report is too large.')
                data=json.loads(output.read('analysis.json'))
                if not fields(data,['hashes','duplicates','frameCount']) or not integer(data['frameCount'],len(sizes),len(sizes)) or not isinstance(data['hashes'],list) or len(data['hashes'])!=len(sizes) or any(not isinstance(h,str) or not re.fullmatch(r'-?\d{1,10}_-?\d{1,10}',h) or any(not -2**31<=int(n)<2**31 for n in h.split('_')) for h in data['hashes']) or not same_json(data['duplicates'],duplicates(data['hashes'])):reject('VIDEO_FRAME_ANALYSIS','Duplicate groups must match the original sparse hashes and input indices.')
                return {**plan,**data}
            if mode=='compose':
                expected=sprite_index(s,plan,len(sizes))
                if entries[1].file_size>2*MIB or not same_json(json.loads(output.read('index.json')),expected):reject('VIDEO_FRAME_INDEX','The index must match reviewed positions, sizes, order and millisecond timestamps.')
                with output.open('sprite.png') as content,Image.open(content) as image:
                    if image.format!='PNG' or image.size!=(plan['width'],plan['height']) or getattr(image,'n_frames',1)!=1:reject('VIDEO_FRAME_SPRITE','The sprite must be one PNG at the reviewed dimensions.')
                    image.load()
                check();return {**plan,'index':expected}
            with zipfile.ZipFile(versions[0]['absolutePath']) as source:
                for i,index in enumerate(plan['selected']):
                    check()
                    with source.open(f'frame_{index:03d}.png') as a,output.open(names[i+1]) as b:
                        while True:
                            check();x=a.read(MIB);y=b.read(MIB)
                            if x!=y:reject('VIDEO_FRAME_ARCHIVE_COPY','Frame ZIP downloads must retain the selected original PNG bytes.')
                            if not x:break
                    with output.open(names[i+1]) as content,Image.open(content) as image:
                        if image.format!='PNG' or image.size!=(sizes[index]['w'],sizes[index]['h']) or getattr(image,'n_frames',1)!=1:reject('VIDEO_FRAME_ARCHIVE_PNG','Every retained member must be a static PNG at its original dimensions.')
                        image.load()
            check();return {**plan,'frameSizes':[sizes[i] for i in plan['selected']]}
    except (OSError,ValueError,zipfile.BadZipFile,Image.DecompressionBombError) as error:
        raise RoninError('VIDEO_FRAME_OUTPUT_INVALID','The reviewed frame output is not a valid ZIP, JSON or PNG.') from error
