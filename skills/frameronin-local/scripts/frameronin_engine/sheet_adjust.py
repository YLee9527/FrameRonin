"""Original sprite adjustment layouts and bounded archive/result validation."""
import math
import stat
import zipfile
from pathlib import Path
from PIL import Image
from .errors import RoninError

MIB=1024**2
def reject(code,message):raise RoninError(code,message)
def integer(v,lo,hi):return type(v) is int and lo<=v<=hi
def finite(v,lo,hi):return type(v) in [int,float] and math.isfinite(v) and lo<=v<=hi
def fields(v,keys):return isinstance(v,dict) and set(v)==set(keys)
def selection(v,count):
    if not isinstance(v,list) or not 1<=len(v)<=count or any(not integer(i,0,count-1) for i in v) or len(set(v))!=len(v):reject('SHEET_SELECTION','Choose unique existing frame indices.')


def archive_info(path,budget,decode=False,expected=None):
    path=Path(path)
    if path.stat().st_size>128*MIB:reject('SHEET_ARCHIVE_LIMIT','Use a frame ZIP up to 128 MiB.')
    sizes=[]
    try:
        with zipfile.ZipFile(path) as archive:
            entries=archive.infolist();encoded=sum(e.file_size for e in entries)
            if not 1<=len(entries)<=4096 or encoded>min(128*MIB,budget//8):reject('SHEET_ARCHIVE_LIMIT','The frame ZIP exceeds its count or encoded budget.')
            for i,e in enumerate(entries):
                if e.filename!=f'frame_{i:03d}.png' or e.is_dir() or e.flag_bits&1 or e.compress_type not in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED] or stat.S_IFMT(e.external_attr>>16) not in [0,stat.S_IFREG]:reject('SHEET_ARCHIVE_ENTRY','Use only ordered PNG frames without paths, links or encryption.')
                with archive.open(e) as content,Image.open(content) as image:
                    size={'w':image.width,'h':image.height}
                    if image.format!='PNG' or getattr(image,'n_frames',1)!=1 or not all(integer(n,1,30000) for n in image.size):reject('SHEET_ARCHIVE_PNG','Each frame must be one static PNG within the dimension limit.')
                    if expected is not None and (i>=len(expected) or size!=expected[i]):reject('SHEET_RESULT_SIZE','The output frame dimensions changed.')
                    if decode:image.load()
                    sizes.append(size)
            if expected is not None and len(sizes)!=len(expected):reject('SHEET_RESULT_COUNT','The output frame count changed.')
    except (zipfile.BadZipFile,OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('SHEET_ARCHIVE_INVALID','The selected frame ZIP cannot be decoded safely.') from error
    return sizes,path.stat().st_size+encoded


def layout(sizes,p,action):
    if action=='fix':
        if not fields(p,['selected','referenceWidth','referenceHeight','fixes']) or not integer(p['referenceWidth'],1,30000) or not integer(p['referenceHeight'],1,30000) or not isinstance(p['fixes'],list) or not 1<=len(p['fixes'])<=4096:reject('SHEET_PIXEL_FIX','Review the reference dimensions and pixel fixes.')
        selection(p['selected'],len(sizes))
        for fix in p['fixes']:
            if not fields(fix,['imgX','imgY','range','data']) or not integer(fix['range'],1,8) or not integer(fix['imgX'],0,p['referenceWidth']-fix['range']) or not integer(fix['imgY'],0,p['referenceHeight']-fix['range']) or not isinstance(fix['data'],list) or len(fix['data'])!=fix['range']**2*4 or any(not integer(n,0,255) for n in fix['data']):reject('SHEET_PIXEL_PATCH','Pixel patches must stay within the reviewed reference and contain RGBA bytes.')
        return {'outputFrames':len(sizes),'frameSizes':sizes}
    if action not in ['compose','gif'] or not fields(p,['columns','rows','frames']+(['selected','speedScale'] if action=='gif' else [])) or not integer(p['columns'],1,64) or not integer(p['rows'],1,4096) or not isinstance(p['frames'],list) or not 1<=len(p['frames'])<=4096:reject('SHEET_LAYOUT','Review the grid and ordered frame placements.')
    cw=ch=1
    for frame in p['frames']:
        if not fields(frame,['sourceIndex','dx','dy','crop']) or not integer(frame['sourceIndex'],0,len(sizes)-1) or not integer(frame['dx'],-30000,30000) or not integer(frame['dy'],-30000,30000) or not fields(frame['crop'],['top','bottom','left','right']) or any(not finite(v,-30000,30000) for v in frame['crop'].values()):reject('SHEET_PLACEMENT','Use valid frame indices, integer offsets and finite crop/padding values.')
        s=sizes[frame['sourceIndex']];c=frame['crop'];cw=max(cw,s['w']-c['left']-c['right']);ch=max(ch,s['h']-c['top']-c['bottom'])
    w,h=math.floor(cw*p['columns']),math.floor(ch*p['rows'])
    if not all(finite(n,1,30000) for n in ([cw,ch,w,h] if action=='compose' else [cw,ch])):reject('SHEET_OUTPUT_DIMENSIONS','The reviewed output exceeds the dimension limit.')
    if action=='gif':
        selection(p['selected'],len(p['frames']))
        if not finite(p['speedScale'],.25,4):reject('SHEET_SPEED','Animation speed must be between 0.25 and 4.')
        delay=math.floor(max(50,100/p['speedScale'])+.5)
        return {'width':math.floor(cw),'height':math.floor(ch),'outputFrames':len(p['selected']),'durationMs':math.floor(delay/10+.5)*10}
    return {'width':w,'height':h,'cellWidth':cw,'cellHeight':ch,'outputFrames':1}


def review(version,p,action,budget):
    sizes,encoded=archive_info(version['absolutePath'],budget)
    report=layout(sizes,p['layout'],action);s=p['layout'];maximum=max(i['w']*i['h'] for i in sizes);source=sum(i['w']*i['h'] for i in sizes)
    if action=='fix':pixels=s['referenceWidth']*s['referenceHeight'];total=source;patches=sum(len(f['data'])*16 for f in s['fixes'])
    else:pixels=report['width']*report['height'];total=pixels*(report['outputFrames'] if action=='gif' else 1);patches=0
    estimate=256*MIB+encoded*10+p['frontendBytes']+maximum*64+pixels*48+total*8+patches
    return estimate,report,sizes


def validate_result(path,version,p,action,budget):
    estimate,report,sizes=review(version,p,action,budget)
    if estimate>budget:reject('SHEET_RESOURCE_LIMIT','The reviewed adjustment exceeds the complete memory budget.')
    if action=='fix':archive_info(path,budget,decode=True,expected=sizes);return report
    if Path(path).stat().st_size>128*MIB:reject('SHEET_RESULT_LIMIT','The encoded output exceeds 128 MiB.')
    try:
        with Image.open(path) as image:
            if image.format!=('GIF' if action=='gif' else 'PNG') or image.size!=(report['width'],report['height']) or getattr(image,'n_frames',1)!=report['outputFrames']:reject('SHEET_RESULT_LAYOUT','The output differs from the reviewed format, dimensions or frame count.')
            for i in range(report['outputFrames']):
                image.seek(i);image.load()
                if image.size!=(report['width'],report['height']) or action=='gif' and image.info.get('duration')!=report['durationMs']:reject('SHEET_RESULT_FRAME','An output frame differs from the reviewed dimensions or duration.')
    except (OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('SHEET_RESULT_INVALID','The adjustment output cannot be decoded.') from error
    return report
