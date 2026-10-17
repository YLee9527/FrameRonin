"""Sprite preparation geometry, preprocess budgets and controlled output checks."""
import math
from pathlib import Path
from PIL import Image,ImageOps
from .sheet_adjust import reject,integer,finite,fields,archive_info
from .scatter import source_size
from .errors import RoninError

MIB=1024**2
DEFAULTS={'watermark':False,'cropTop':0,'cropBottom':0,'cropLeft':0,'cropRight':0,'padTop':0,'padRight':0,'padBottom':0,'padLeft':0,
          'resizeEnabled':False,'resizeW':256,'resizeH':256,'resizeKeepAspect':False,'matteMode':'none','matteTolerance':80,'matteFeather':5}
EDGES=['cropTop','cropBottom','cropLeft','cropRight','padTop','padRight','padBottom','padLeft']
def rounded(v):return math.floor(v+.5)


def source(version,prepared=False):
    m=version['metadata'];w,h=source_size(m)
    # Uploads retain the original 20 MiB limit. A verified preprocessing result
    # can legitimately encode larger than its JPEG/WebP source.
    limit=128*MIB if prepared and version.get('origin')=='image.sheetPreprocess' and m.get('containerFormat')=='PNG' else 20*MIB
    if m.get('kind')!='image' or m.get('containerFormat') not in ['PNG','JPEG','WEBP'] or m.get('frames',1)!=1 or not integer(m['bytes'],1,limit) or not integer(w,1,30000) or not integer(h,1,30000):reject('SHEET_SOURCE_LIMIT','Choose a static PNG, JPEG or WebP up to 20 MiB, or a controlled preprocessing PNG within its output budget.')
    return w,h,m['bytes']


def preprocess_size(w,h,p):
    if not fields(p,DEFAULTS) or any(type(p[k]) is not bool for k in ['watermark','resizeEnabled','resizeKeepAspect']) or any(not finite(p[k],0,4096) for k in EDGES) or not finite(p['resizeW'],1,8192) or not finite(p['resizeH'],1,8192) or p['matteMode'] not in ['none','global','contiguous'] or not finite(p['matteTolerance'],0,441) or not finite(p['matteFeather'],0,64):reject('SHEET_PREPROCESS_PARAMETERS','Review the original preprocess options and ranges.')
    if not (p['watermark'] or p['resizeEnabled'] or p['matteMode']!='none' or any(rounded(p[k]) for k in EDGES)):reject('SHEET_PREPROCESS_NO_EFFECT','The rounded options make no change; retain the existing source version.')
    cropped=(max(1,w-rounded(p['cropLeft'])-rounded(p['cropRight'])),max(1,h-rounded(p['cropTop'])-rounded(p['cropBottom'])))
    padded=(cropped[0]+rounded(p['padLeft'])+rounded(p['padRight']),cropped[1]+rounded(p['padTop'])+rounded(p['padBottom']))
    output=(rounded(p['resizeW']),rounded(p['resizeH'])) if p['resizeEnabled'] else padded
    if any(not integer(v,1,30000) for s in [cropped,padded,output] for v in s):reject('SHEET_PREPROCESS_DIMENSIONS','An intermediate or final image exceeds the dimension limit.')
    return cropped,padded,output


def preparation_sizes(w,h,p,path=None,check=None):
    if not isinstance(p,dict):reject('SHEET_PREPARATION_LAYOUT','Review the split mode.')
    mode=p.get('mode')
    if mode in ['whole','uniform']:
        limit=64 if mode=='whole' else 32
        if not fields(p,['mode','columns','rows']) or not integer(p['columns'],1,limit) or not integer(p['rows'],1,4096 if mode=='whole' else limit) or p['columns']*p['rows']>4096:reject('SHEET_PREPARATION_LAYOUT','Use at most 4096 cells; whole-image mode accepts the row count derived from transparent splitting.')
        cw,ch=w//p['columns'],h//p['rows']
        if mode=='uniform' and (cw<1 or ch<1):reject('SHEET_PREPARATION_DENSE_UNIFORM','The uniform grid has an empty cell.')
        return [{'w':cw,'h':ch} if mode=='uniform' else {'w':max(1,(c+1)*w//p['columns']-c*w//p['columns']),'h':max(1,(r+1)*h//p['rows']-r*h//p['rows'])} for r in range(p['rows']) for c in range(p['columns'])]
    if mode!='transparent' or not fields(p,['mode']):reject('SHEET_PREPARATION_LAYOUT','Review the supported split mode fields.')
    if path is None:return None
    import numpy as np
    try:
        if check:check()
        with Image.open(path) as image:
            oriented=image.copy() if image.format=='WEBP' else ImageOps.exif_transpose(image)
            try:
                if oriented.size!=(w,h):reject('SHEET_PREPARATION_SIZE_CHANGED','The source dimensions changed.')
                with oriented.convert('RGBA') as rgba:
                    with rgba.getchannel('A') as channel:alpha=np.array(channel)
            finally:oriented.close()
    except (OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('SHEET_PREPARATION_SOURCE_INVALID','The source cannot be decoded for transparent splitting.') from error
    def runs(bits):return np.flatnonzero(np.diff(np.pad(bits,1))).reshape(-1,2)
    regions=[]
    for y0,y1 in runs(np.any(alpha!=0,axis=1)):
        if check:check()
        for x0,x1 in runs(np.any(alpha[y0:y1]!=0,axis=0)):
            if len(regions)>=4096:reject('SHEET_PREPARATION_FRAME_LIMIT','Use at most 4096 transparent regions.')
            regions.append((int(x1-x0),int(y1-y0)))
    if not regions:reject('SHEET_PREPARATION_EMPTY','No nontransparent regions were found.')
    maximum=(max(r[0] for r in regions),max(r[1] for r in regions))
    return [{'w':maximum[0],'h':maximum[1]} for _ in regions]


def review(version,p,action,budget,check=None):
    w,h,size=source(version,action=='prepare');f=p['frontendBytes'];options=p['layout']
    if action=='preprocess':
        cropped,padded,output=preprocess_size(w,h,options);maximum=max(w*h,*(a*b for a,b in [cropped,padded,output]))
        estimate=256*MIB+w*h*16+maximum*192+size*12+f
        return estimate,{'width':output[0],'height':output[1],'outputFrames':1,'processingDimensions':{'width':output[0],'height':output[1]}}
    if action!='prepare':reject('SHEET_PREPARATION_OPERATION','Unknown preparation operation.')
    estimate=256*MIB+w*h*48+size*8+f
    if estimate>budget:reject('SHEET_PREPARATION_RESOURCE_LIMIT','The source exceeds the complete preparation budget before decoding.')
    sizes=preparation_sizes(w,h,options,version['absolutePath'],check);estimate+=sum(s['w']*s['h']*16 for s in sizes)
    return estimate,{'outputFrames':len(sizes),'frameSizes':sizes,'sourceWidth':w,'sourceHeight':h}


def validate_result(path,version,p,action,budget,check=None):
    estimate,report=review(version,p,action,budget,check)
    if estimate>budget:reject('SHEET_PREPARATION_RESOURCE_LIMIT','The reviewed task exceeds its complete memory budget.')
    if action=='prepare':archive_info(path,budget,decode=True,expected=report['frameSizes'],check=check);return report
    if Path(path).stat().st_size>128*MIB:reject('SHEET_PREPARATION_ENCODED_LIMIT','The encoded output exceeds 128 MiB.')
    try:
        if check:check()
        with Image.open(path) as image:
            if image.format!='PNG' or image.size!=(report['width'],report['height']) or getattr(image,'n_frames',1)!=1:reject('SHEET_PREPROCESS_OUTPUT','The preprocess result differs from its reviewed PNG dimensions.')
            image.load()
            if check:check()
    except (OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('SHEET_PREPROCESS_OUTPUT_INVALID','The preprocess result cannot be decoded.') from error
    return report
