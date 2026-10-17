"""Reviewed sprite-sheet row grouping and bounded GIF ZIP validation."""
import math
import stat
import zipfile
from PIL import Image
from .custom_slice import layout_sizes
from .scatter import source_size
from .errors import RoninError


def reject(code,message):raise RoninError(code,message)
def integer(v,lo,hi):return type(v) is int and lo<=v<=hi


def rows(width,height,p):
    if not isinstance(p,dict) or set(p)!={'columns','rows','order','framesPerRow','duration'} \
        or not integer(p['columns'],1,64) or not integer(p['rows'],1,64) or not integer(p['framesPerRow'],1,128) or not integer(p['duration'],20,500) \
        or not isinstance(p['order'],list) or not 1<=len(p['order'])<=4096 \
        or any(not integer(v,0,p['columns']*p['rows']-1) for v in p['order']) or len(set(p['order']))!=len(p['order']):
        reject('SPRITE_GIF_LAYOUT','Review the original grid, unique selected frame order, row width and duration.')
    sizes=layout_sizes({'mode':'grid','columns':p['columns'],'rows':p['rows']},width,height)
    result=[]
    for start in range(0,len(p['order']),p['framesPerRow']):
        indices=p['order'][start:start+p['framesPerRow']]
        result.append({'width':max(sizes[i]['w'] for i in indices),'height':max(sizes[i]['h'] for i in indices),
                       'frames':len(indices),'durationMs':math.floor(p['duration']/10+.5)*10})
    return result


def estimate(version,p):
    meta=version['metadata'];width,height=source_size(meta)
    if meta.get('containerFormat') not in ['PNG','JPEG','WEBP'] or meta['bytes']>20*1024**2 or meta.get('frames',1)!=1:
        reject('SPRITE_GIF_SOURCE_LIMIT','Select a static PNG, JPEG or WebP up to 20 MiB.')
    grouped=rows(width,height,p['layout'])
    total=sum(r['width']*r['height']*r['frames'] for r in grouped);maximum=max(r['width']*r['height'] for r in grouped)
    return 256*1024**2+width*height*40+meta['bytes']*8+p['frontendBytes']+maximum*64+total*8+len(grouped)*8192


def validate_result(path,version,p,budget):
    width,height=source_size(version['metadata']);expected=rows(width,height,p['layout'])
    if path.stat().st_size>128*1024**2:reject('SPRITE_GIF_ARCHIVE_LIMIT','The GIF ZIP exceeds 128 MiB.')
    try:
        with zipfile.ZipFile(path) as archive:
            entries=archive.infolist()
            if len(entries)!=len(expected) or sum(e.file_size for e in entries)>min(128*1024**2,budget//8):reject('SPRITE_GIF_ARCHIVE_LIMIT','The GIF ZIP exceeds its reviewed row count or encoded budget.')
            for i,(entry,row) in enumerate(zip(entries,expected)):
                if entry.filename!=f'row_{i+1:02d}.gif' or entry.is_dir() or entry.flag_bits&1 or stat.S_IFMT(entry.external_attr>>16) not in [0,stat.S_IFREG] or entry.compress_type not in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED]:
                    reject('SPRITE_GIF_ARCHIVE_ENTRY','Use only ordered GIF row entries without paths or links.')
                with archive.open(entry) as content,Image.open(content) as image:
                    if image.format!='GIF' or image.size!=(row['width'],row['height']) or image.n_frames!=row['frames']:
                        reject('SPRITE_GIF_ROW','The GIF dimensions or frame count differ from the reviewed row.')
                    for frame in range(row['frames']):
                        image.seek(frame);image.load()
                        if image.size!=(row['width'],row['height']) or image.info.get('duration')!=row['durationMs']:
                            reject('SPRITE_GIF_FRAME','The GIF frame dimensions or duration differ from the reviewed row.')
    except (zipfile.BadZipFile,OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('SPRITE_GIF_ARCHIVE_INVALID','The GIF ZIP cannot be decoded safely.') from error
    return {'outputRows':len(expected),'outputFrames':len(p['layout']['order']),'gifRows':expected}
