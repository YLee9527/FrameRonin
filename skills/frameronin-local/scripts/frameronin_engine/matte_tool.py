"""Strict standalone matte recipes, full working-set review and PNG validation."""
import math
import re
from PIL import Image
from .errors import RoninError
from .scatter import source_size

MIB=1024**2
KEYS={'chroma':{'mode','keyColor','tolerance','smoothness','spill','erosion'},'whiteErode':{'mode','tolerance','smoothness','erosion'},'doubleBg':{'mode','tolerance','edgeContrast'},'repair':{'mode'},'frontier':{'mode','erosion'}}

def reject(code,message):raise RoninError(code,message)
def finite(v,low,high):return type(v) in [int,float] and low<=v<=high and math.isfinite(v)

def layout(p):
    if not isinstance(p,dict) or not isinstance(p.get('mode'),str) or p['mode'] not in KEYS or set(p)!=KEYS[p['mode']]:reject('MATTE_TOOL_LAYOUT','Review the supported matte operation and its exact parameters.')
    mode=p['mode']
    if mode=='chroma' and (not isinstance(p['keyColor'],str) or not re.fullmatch(r'#[a-fA-F0-9]{6}',p['keyColor']) or not finite(p['spill'],5,100)) \
        or mode in ['chroma','whiteErode'] and (not finite(p['tolerance'],5,100) or not finite(p['smoothness'],5,100)) \
        or mode in ['chroma','whiteErode','frontier'] and not finite(p['erosion'],0,100) \
        or mode=='doubleBg' and (not finite(p['tolerance'],50,100) or not finite(p['edgeContrast'],50,100)):
        reject('MATTE_TOOL_PARAMETERS','Matte parameters exceed the original control ranges.')
    return mode

def review(versions,parameters,budget):
    mode=layout(parameters['layout'])
    if len(versions)!=(2 if mode=='doubleBg' else 1):reject('MATTE_TOOL_INPUT_COUNT','Double background needs exactly two images; other modes need one.')
    sizes=[];estimate=256*MIB+parameters['frontendBytes']
    for version in versions:
        m=version['metadata'];w,h=source_size(m)
        limit=128*MIB if mode in ['repair','frontier'] and version.get('origin')=='image.matteTool' and m.get('containerFormat')=='PNG' else 20*MIB
        if m.get('kind')!='image' or m.get('containerFormat') not in ['PNG','JPEG','WEBP'] or m.get('frames',1)!=1 or not all(type(v) is int and 1<=v<=30000 for v in [w,h]) or type(m['bytes']) is not int or not 1<=m['bytes']<=limit:reject('MATTE_TOOL_SOURCE','Choose static PNG/JPEG/WebP images up to 20 MiB; controlled matte repair PNGs retain their output limit.')
        sizes.append((w,h));estimate+=w*h*192+m['bytes']*12
    if len(set(sizes))!=1:reject('MATTE_TOOL_SIZE_MISMATCH','Black and white background images must have the same displayed dimensions.')
    if estimate>budget:reject('MATTE_TOOL_RESOURCE_LIMIT','The complete matte working set exceeds the memory budget. Reduce the source dimensions.')
    return estimate,sizes[0]

def validate_result(path,versions,parameters,budget,check):
    _,size=review(versions,parameters,budget);check()
    if path.stat().st_size>128*MIB:reject('MATTE_TOOL_ENCODED_LIMIT','The matte output exceeds 128 MiB.')
    try:
        with Image.open(path) as image:
            if image.format!='PNG' or image.size!=size or getattr(image,'n_frames',1)!=1:reject('MATTE_TOOL_OUTPUT','The Worker must return one PNG with the reviewed dimensions.')
            image.load()
    except (OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('MATTE_TOOL_OUTPUT','The matte output is not a decodable PNG.') from error
    check()
    return {'mode':parameters['layout']['mode'],'width':size[0],'height':size[1],'outputFrames':1}
