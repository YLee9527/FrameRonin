"""Strict custom-slice geometry, ZIP inspection and host-output verification."""
import io
import json
import math
import re
import stat
import zipfile
from pathlib import Path
from PIL import Image
from .errors import RoninError
from .scatter import source_size

MAX_CELLS=4096


def reject(code,message):raise RoninError(code,message)
def integer(v,lo,hi):return type(v) is int and lo<=v<=hi
def finite(v,lo,hi):return type(v) in [int,float] and lo<=v<=hi and math.isfinite(v)


def dimensions(width,height):
    if not integer(width,1,30000) or not integer(height,1,30000):reject('CUSTOM_SOURCE_DIMENSIONS','Image sides must be between 1 and 30000 pixels.')


def boundaries(values,total):
    if not isinstance(values,list) or not 2<=len(values)<=MAX_CELLS+1 or values[0]!=0 or values[-1]!=total \
        or any(not integer(v,0,total) or i>0 and v<values[i-1] for i,v in enumerate(values)):
        reject('CUSTOM_BOUNDARIES','Use ordered integer seams from zero to the image edge.')


def band_bounds(cols):
    if len(cols)<=2:return 0,0
    lo=max(cols[j-1]+1-cols[j] for j in range(1,len(cols)-1))
    hi=min(cols[j+1]-1-cols[j] for j in range(1,len(cols)-1))
    return (0,0) if lo>hi else (lo,hi)


def poly_limit(cols,width):
    minimum=min(b-a for a,b in zip(cols,cols[1:]))
    return 1 if minimum<1 else max(1,min(width//2-1,minimum-1))


def layout_sizes(layout,width,height):
    dimensions(width,height)
    if not isinstance(layout,dict):reject('CUSTOM_LAYOUT','Review the slice layout.')
    mode=layout.get('mode')
    if mode=='regions':
        regions=layout.get('regions')
        if set(layout)!={'mode','regions'} or not isinstance(regions,list) or not 1<=len(regions)<=MAX_CELLS:reject('CUSTOM_REGIONS','Select between 1 and 4096 regions.')
        ids=set();sizes=[]
        for r in regions:
            if not isinstance(r,dict) or set(r)!={'id','x','y','w','h'} or not isinstance(r['id'],str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',r['id']) or r['id'] in ids \
                or not finite(r['x'],0,width) or r['x']>=width or not finite(r['y'],0,height) or r['y']>=height or not finite(r['w'],1,30000) or not finite(r['h'],1,30000):
                reject('CUSTOM_REGION','Use unique regions starting inside the selected image.')
            ids.add(r['id']);sizes.append({'w':max(1,min(math.floor(r['w']),width-math.floor(r['x']))),'h':max(1,min(math.floor(r['h']),height-math.floor(r['y'])))})
        return sizes
    if mode=='grid':
        if set(layout)!={'mode','columns','rows'} or not integer(layout['columns'],1,64) or not integer(layout['rows'],1,64):reject('CUSTOM_GRID','Use 1 to 64 grid rows and columns.')
        cols=[i*width//layout['columns'] for i in range(layout['columns']+1)];rows=[i*height//layout['rows'] for i in range(layout['rows']+1)];offsets=[0]*(len(rows)-1)
    elif mode in ['bands','polyline']:
        expected={'mode','colStarts','rowStarts','bandColOffset'} if mode=='bands' else {'mode','colStarts','bendY','deltaX'}
        if set(layout)!=expected:reject('CUSTOM_SEAMS','Review the supported seam fields.')
        cols=layout['colStarts'];boundaries(cols,width)
        if mode=='bands':
            rows=layout['rowStarts'];boundaries(rows,height);offsets=layout['bandColOffset'];lo,hi=band_bounds(cols)
            if not isinstance(offsets,list) or len(offsets)!=len(rows)-1 or any(not integer(v,lo,hi) for v in offsets):reject('CUSTOM_BAND_OFFSET','Keep every row offset inside its neighboring seam bounds.')
        else:
            rows=[0,height];offsets=[0];limit=poly_limit(cols,width)
            if not integer(layout['bendY'],0,height) or not integer(layout['deltaX'],-limit,limit):reject('CUSTOM_POLYLINE','Review the polyline bend and horizontal offset.')
    else:reject('CUSTOM_LAYOUT','Unsupported slice mode.')
    if (len(cols)-1)*(len(rows)-1)>MAX_CELLS:reject('CUSTOM_CELL_LIMIT','Use at most 4096 output cells.')
    sizes=[]
    for row in range(len(rows)-1):
        for col in range(len(cols)-1):
            left=0 if col==0 else cols[col]+offsets[row];right=width if col==len(cols)-2 else cols[col+1]+offsets[row]
            w,h=max(1,right-left),max(1,rows[row+1]-rows[row])
            if mode=='polyline':
                a,b,d=cols[col],cols[col+1],layout['deltaX']
                w=1 if b-a<1 else max(1,min(width,b)-max(0,a)) if layout['bendY']>=height else max(1,min(width,max(a,a+d,b,b+d))-max(0,min(a,a+d,b,b+d)))
                h=height
            sizes.append({'w':w,'h':h})
    return sizes


def validate_plan(value,width,height,parameters):
    fields={'formatVersion','width','height','columns','rows','colStarts','rowStarts','bandColOffset','bendY','deltaX'}
    if not isinstance(value,dict) or set(value)!=fields or type(value['formatVersion']) is not int or value['formatVersion']!=1 or type(value['width']) is not int or type(value['height']) is not int or (value['width'],value['height'])!=(width,height) \
        or not integer(value['columns'],1,MAX_CELLS) or not integer(value['rows'],1,MAX_CELLS):reject('CUSTOM_PLAN_RESULT','The plan does not match the selected image.')
    if parameters['mode']=='grid' and (value['columns'],value['rows'])!=(parameters['columns'],parameters['rows']):reject('CUSTOM_PLAN_GRID','The plan changed the reviewed grid.')
    layout={'mode':'bands','colStarts':value['colStarts'],'rowStarts':value['rowStarts'],'bandColOffset':value['bandColOffset']}
    sizes=layout_sizes(layout,width,height)
    if len(value['colStarts'])!=value['columns']+1 or len(value['rowStarts'])!=value['rows']+1 or value['bendY']!=height//2 or type(value['bendY']) is not int or type(value['deltaX']) is not int or value['deltaX']!=0 or any(value['bandColOffset']):
        reject('CUSTOM_PLAN_RESULT','The plan has inconsistent seams or defaults.')
    return {'plannedCells':len(sizes),'columns':value['columns'],'rows':value['rows'],'outputFrames':0}


def archive_sizes(path,budget,expected=None,decode=False):
    if path.stat().st_size>128*1024**2:reject('CUSTOM_ARCHIVE_LIMIT','The slice ZIP exceeds 128 MiB.')
    try:
        with zipfile.ZipFile(path) as archive:
            entries=archive.infolist();encoded=sum(e.file_size for e in entries)
            if not 1<=len(entries)<=MAX_CELLS or encoded>min(128*1024**2,budget//8) or expected is not None and len(entries)!=len(expected):reject('CUSTOM_ARCHIVE_LIMIT','The ZIP exceeds its reviewed cell count or budget.')
            sizes=[]
            for i,entry in enumerate(entries):
                if entry.filename!=f'frame_{i:03d}.png' or entry.is_dir() or entry.flag_bits&1 or stat.S_IFMT(entry.external_attr>>16) not in [0,stat.S_IFREG] or entry.compress_type not in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED]:reject('CUSTOM_ARCHIVE_ENTRY','Use only ordered PNG frame entries without paths or links.')
                with archive.open(entry) as content,Image.open(content) as image:
                    w,h=image.size;dimensions(w,h)
                    if image.format!='PNG' or getattr(image,'n_frames',1)!=1 or expected is not None and (w,h)!=(expected[i]['w'],expected[i]['h']):reject('CUSTOM_ARCHIVE_PNG','A frame does not match its reviewed PNG dimensions.')
                    if w*h*40+256*1024**2>budget:reject('CUSTOM_RESOURCE_LIMIT','A decoded frame exceeds the memory budget.')
                    if decode:image.load()
                    sizes.append({'w':w,'h':h})
            return sizes,encoded
    except (zipfile.BadZipFile,OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('CUSTOM_ARCHIVE_INVALID','The slice ZIP cannot be decoded safely.') from error


def composition_size(sizes,p):
    if not isinstance(p,dict) or set(p)!={'rows','columns','grid','expandUp','expandDown','expandLeft','expandRight'} \
        or not integer(p['rows'],1,MAX_CELLS) or not integer(p['columns'],1,MAX_CELLS) or p['rows']*p['columns']>MAX_CELLS \
        or not all(integer(p[key],0,149) for key in ['expandUp','expandDown','expandLeft','expandRight']) \
        or not isinstance(p['grid'],list) or len(p['grid'])!=p['rows'] or any(not isinstance(row,list) or len(row)!=p['columns'] or any(not integer(v,-len(sizes),len(sizes)) for v in row) for row in p['grid']):
        reject('CUSTOM_COMPOSE_LAYOUT','Review the composition grid, frame indices and padding.')
    cell_w=max(s['w'] for s in sizes);cell_h=max(s['h'] for s in sizes)
    width=p['columns']*(cell_w+p['expandLeft']+p['expandRight']);height=p['rows']*(cell_h+p['expandUp']+p['expandDown']);dimensions(width,height)
    return width,height


def estimate(version,operation,parameters,budget):
    meta=version['metadata'];frontend=parameters['frontendBytes']
    if operation=='image.customCompose':
        sizes,encoded=archive_sizes(Path(version['absolutePath']),budget)
        width,height=composition_size(sizes,parameters['composition'])
        return 256*1024**2+meta['bytes']*4+encoded*4+max(s['w']*s['h'] for s in sizes)*40+width*height*32+frontend
    width,height=source_size(meta);dimensions(width,height)
    if meta.get('containerFormat') not in ['PNG','JPEG','WEBP'] or meta['bytes']>20*1024**2 or meta.get('frames',1)!=1:reject('CUSTOM_SOURCE_LIMIT','Select a static PNG, JPEG or WebP up to 20 MiB.')
    sizes=layout_sizes(parameters['layout'],width,height) if operation=='image.customSlice' else []
    pixels=[s['w']*s['h'] for s in sizes]
    return 256*1024**2+width*height*40+meta['bytes']*8+frontend+sum(pixels)*16+max(pixels,default=0)*16


def validate_result(path,operation,version,parameters,budget):
    if operation=='image.customCompose':
        sizes,_=archive_sizes(Path(version['absolutePath']),budget);width,height=composition_size(sizes,parameters['composition'])
        try:
            with Image.open(path) as image:
                if image.format!='PNG' or image.size!=(width,height) or getattr(image,'n_frames',1)!=1:reject('CUSTOM_COMPOSE_RESULT','The composition is not a PNG with its reviewed size.')
                image.load()
        except (OSError,ValueError,Image.DecompressionBombError) as error:raise RoninError('CUSTOM_COMPOSE_RESULT','The composition PNG cannot be decoded.') from error
        return {'outputFrames':1,'width':width,'height':height,'sourceFrames':len(sizes)}
    width,height=source_size(version['metadata'])
    if operation=='image.customSlicePlan':
        if path.stat().st_size>1024**2:reject('CUSTOM_PLAN_LIMIT','The seam plan exceeds 1 MiB.')
        try:value=json.loads(path.read_text())
        except (ValueError,UnicodeError) as error:raise RoninError('CUSTOM_PLAN_RESULT','The seam plan is not valid JSON.') from error
        return validate_plan(value,width,height,parameters)
    sizes=layout_sizes(parameters['layout'],width,height)
    archive_sizes(path,budget,sizes,decode=True)
    return {'outputFrames':len(sizes),'frameSizes':sizes}
