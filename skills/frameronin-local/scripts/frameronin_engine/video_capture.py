"""Reviewed native-browser capture geometry, bounded output and publication."""
import math
import zipfile
from .errors import RoninError
from .sheet_adjust import archive_info,fields,finite,integer

MIB=1024**2
def reject(code,message):raise RoninError(code,message)
def plan(p,file_bytes,budget,frontend_bytes,physical):
    if not fields(p,['sourceWidth','sourceHeight','start','end','fps','maxFrames','crop']) or not integer(p['sourceWidth'],1,30000) or not integer(p['sourceHeight'],1,30000) or not fields(p['crop'],['left','top','right','bottom']):reject('VIDEO_CAPTURE_LAYOUT','Review the exact video capture fields and displayed dimensions.')
    c=p['crop']
    if not all(finite(c[key],0,p['sourceWidth' if key in ['left','right'] else 'sourceHeight']-1) for key in c):reject('VIDEO_CAPTURE_CROP','Crop margins must stay within the original displayed video bounds.')
    if not finite(p['start'],0,86400) or not finite(p['end'],0,86400) or p['end']<=p['start'] or not finite(p['fps'],1,60) or not integer(p['maxFrames'],1,2000):reject('VIDEO_CAPTURE_RANGE','Review the start/end time, FPS and maximum frame count.')
    if not integer(file_bytes,1,200*MIB) or not integer(frontend_bytes,0,2*1024**3) or not all(integer(physical.get(key),1,30000) for key in ['width','height']):reject('VIDEO_CAPTURE_RESOURCE_LIMIT','The source video exceeds the byte or physical dimension limit.')
    timestamps=[];t=p['start']
    while t<p['end'] and len(timestamps)<p['maxFrames']:timestamps.append(t);t+=1/p['fps']
    crop_width=max(1,p['sourceWidth']-c['left']-c['right']);crop_height=max(1,p['sourceHeight']-c['top']-c['bottom']);width=math.floor(crop_width);height=math.floor(crop_height)
    cache=min(128*MIB,len(timestamps)*(width*height*5+height+1024));pixels=max(p['sourceWidth']*p['sourceHeight'],physical['width']*physical['height'])
    estimate=256*MIB+file_bytes*2+pixels*96+cache*8+frontend_bytes
    if estimate>budget:reject('VIDEO_CAPTURE_RESOURCE_LIMIT','The bounded video decoder, frame, encoded output and frontend working set exceeds the memory budget.')
    return {'timestamps':timestamps,'width':width,'height':height,'cropWidth':crop_width,'cropHeight':crop_height,'encodedCacheBytes':cache,'estimatedBytes':estimate,'outputFrames':len(timestamps)}

def review(version,p,budget):
    m=version['metadata']
    duration=m.get('durationSeconds')
    if m.get('kind')!='video' or type(duration) not in [int,float] or not math.isfinite(duration) or duration<=0:reject('VIDEO_CAPTURE_SOURCE','Select a video with finite duration.')
    result=plan(p['layout'],m['bytes'],budget,p['frontendBytes'],m)
    # Native presentation duration may differ slightly from container rounding.
    # The host also checks its actual duration and displayed dimensions before
    # requesting any frame. Physical pixels enter this budget independently.
    if p['layout']['end']>m['durationSeconds']+1:reject('VIDEO_CAPTURE_RANGE','The requested range exceeds the selected video duration.')
    return result

def validate_result(path,version,p,budget,check):
    result=review(version,p,budget);check()
    try:
        with zipfile.ZipFile(path) as output:
            if sum(e.file_size for e in output.infolist())>result['encodedCacheBytes']:reject('VIDEO_CAPTURE_ENCODED_LIMIT','The captured PNG cache exceeds the reviewed bounded allocation.')
    except (OSError,zipfile.BadZipFile) as error:
        raise RoninError('VIDEO_CAPTURE_OUTPUT_INVALID','The capture output is not a readable frame ZIP.') from error
    archive_info(path,budget,decode=True,expected=[{'w':result['width'],'h':result['height']}]*result['outputFrames'],check=check)
    check();return result
