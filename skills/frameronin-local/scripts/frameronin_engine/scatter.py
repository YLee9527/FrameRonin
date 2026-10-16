"""Reviewed scatter geometry and encoded results; no archive member is extracted."""
import io
import json
import math
import re
import stat
import unicodedata
import zipfile
from PIL import Image
from .errors import RoninError

MAX_BOXES=4096
MAX_COMPONENTS=16384
DETECT_DEFAULTS={'mode':'auto','colorKey':'#ffffff','threshold':24,'mergeGap':0,'minPixels':4,'minSide':1}


def reject(code,message):
    raise RoninError(code,message)


def integer(value,low,high):
    return type(value) is int and low<=value<=high


def source_size(meta):
    if meta.get('containerFormat')=='WEBP':return meta['width'],meta['height']
    return meta.get('displayWidth',meta['width']),meta.get('displayHeight',meta['height'])


def check_detect(value):
    if not isinstance(value,dict) or set(value)!=set(DETECT_DEFAULTS) or value['mode'] not in ['auto','alpha','colorkey'] \
        or not isinstance(value['colorKey'],str) or not re.fullmatch(r'#[a-fA-F0-9]{6}',value['colorKey']) \
        or not integer(value['threshold'],1,120) or not integer(value['mergeGap'],0,24) \
        or not integer(value['minPixels'],1,900000000) or not integer(value['minSide'],1,30000):
        reject('SCATTER_DETECT_INVALID','Review the scatter detection parameters.')


def check_boxes(boxes,width,height):
    if not isinstance(boxes,list) or len(boxes)>MAX_BOXES:reject('SCATTER_BOX_COUNT','Use at most 4096 reviewed boxes.')
    ids=set()
    for box in boxes:
        if not isinstance(box,dict) or set(box)-{'id','x','y','w','h','row','col','kind','name'} \
            or not isinstance(box.get('id'),str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',box['id']) or box['id'] in ids:
            reject('SCATTER_BOX_INVALID','Boxes need unique IDs and supported fields.')
        values=[box.get(key) for key in ['x','y','w','h']]
        if not all(type(v) in [int,float] and -30000<=v<=30000 and math.isfinite(v) for v in values):reject('SCATTER_BOX_INVALID','Box coordinates must be finite numbers.')
        x,y,w,h=values
        if min(x,y)<0 or min(w,h)<1 or x+w>width or y+h>height:reject('SCATTER_BOX_OUTSIDE','Keep every box inside the selected image.')
        if any(key in box and not integer(box[key],0,4095) for key in ['row','col']) \
            or 'kind' in box and box['kind'] not in ['grid','sprite'] \
            or 'name' in box and (not isinstance(box['name'],str) or len(box['name'])>1000):
            reject('SCATTER_BOX_INVALID','Review box labels and grid metadata.')
        ids.add(box['id'])


def check_layout(layout,width,height):
    if not isinstance(layout,dict) or set(layout)!={'format','quality','entries'} \
        or layout['format'] not in ['png','jpeg','webp'] \
        or type(layout['quality']) not in [int,float] or not .4<=layout['quality']<=1 or not math.isfinite(layout['quality']) \
        or not isinstance(layout['entries'],list) or not 1<=len(layout['entries'])<=MAX_BOXES:
        reject('SCATTER_REVIEW_INVALID','Review the ordered slice entries, format and quality.')
    names=set();boxes=[];suffix='jpg' if layout['format']=='jpeg' else layout['format']
    for entry in layout['entries']:
        if not isinstance(entry,dict) or set(entry)!={'box','name'}:reject('SCATTER_REVIEW_INVALID','Each export entry needs its reviewed name and box.')
        name=entry['name']
        try:size=len(name.encode('utf-8')) if isinstance(name,str) else 256
        except UnicodeError as error:raise RoninError('SCATTER_REVIEW_FILENAME','Use a valid UTF-8 slice filename.') from error
        if not isinstance(name,str) or not name.endswith('.'+suffix) or re.search(r'[\\/<>:"|?*\x00-\x1f]',name) or size>255:
            reject('SCATTER_REVIEW_FILENAME','Use a safe image filename of at most 255 UTF-8 bytes.')
        normalized=unicodedata.normalize('NFC',name).lower()
        if normalized in names:reject('SCATTER_EXPORT_NAME_COLLISION','Rename duplicate slice filenames before exporting.')
        names.add(normalized);boxes.append(entry['box'])
    check_boxes(boxes,width,height)


def estimate(meta,parameters,export=False):
    width,height=source_size(meta)
    if meta.get('containerFormat') not in ['PNG','JPEG','WEBP'] or meta['bytes']>20*1024**2 \
        or not integer(width,1,30000) or not integer(height,1,30000) or meta.get('frames',1)!=1:
        reject('SCATTER_SOURCE_LIMIT','Select a static PNG, JPEG or WebP up to 20 MiB.')
    result=256*1024**2+width*height*32+meta['bytes']*8+parameters['frontendBytes']+MAX_COMPONENTS*512
    if export:
        check_layout(parameters['layout'],width,height)
        pixels=[math.floor(e['box']['w'])*math.floor(e['box']['h']) for e in parameters['layout']['entries']]
        result+=sum(pixels)*16+max(pixels)*16
    else:check_detect(parameters['detect'])
    return result


def validate_result(source,operation,meta,parameters,budget):
    width,height=source_size(meta)
    if operation=='image.scatterDetect':
        if source.stat().st_size>8*1024**2:reject('SCATTER_RESULT_LIMIT','The detection result exceeds its size limit.')
        try:value=json.loads(source.read_text())
        except (ValueError,UnicodeError) as error:raise RoninError('SCATTER_RESULT_INVALID','Detection did not return valid JSON.') from error
        if not isinstance(value,dict) or set(value)!={'formatVersion','width','height','boxes'} or type(value['formatVersion']) is not int or value['formatVersion']!=1 \
            or type(value['width']) is not int or type(value['height']) is not int or (value['width'],value['height'])!=(width,height):
            reject('SCATTER_RESULT_INVALID','The detection result does not match the selected image.')
        check_boxes(value['boxes'],width,height)
        return {'detectedBoxes':len(value['boxes'])}
    layout=parameters['layout'];check_layout(layout,width,height)
    try:
        with zipfile.ZipFile(source) as archive:
            members=archive.infolist();entries=layout['entries']
            if len(members)!=len(entries) or sum(m.file_size for m in members)>min(budget//4,128*1024**2):reject('SCATTER_ARCHIVE_LIMIT','The ZIP exceeds its reviewed entries or encoded budget.')
            expected_format={'png':'PNG','jpeg':'JPEG','webp':'WEBP'}[layout['format']]
            for member,entry in zip(members,entries):
                if member.filename!=entry['name'] or member.is_dir() or member.flag_bits&1 \
                    or stat.S_IFMT(member.external_attr>>16) not in [0,stat.S_IFREG] or member.compress_type not in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED]:
                    reject('SCATTER_ARCHIVE_ENTRY','The ZIP contains an unexpected or unsafe entry.')
                with Image.open(io.BytesIO(archive.read(member))) as image:
                    expected=(math.floor(entry['box']['w']),math.floor(entry['box']['h']))
                    if image.format!=expected_format or image.size!=expected or getattr(image,'n_frames',1)!=1:reject('SCATTER_ARCHIVE_IMAGE','A slice has the wrong format or dimensions.')
                    image.load()
    except (zipfile.BadZipFile,OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('SCATTER_ARCHIVE_INVALID','The ZIP does not contain valid reviewed image slices.') from error
    return {'exportedSlices':len(layout['entries']),'format':layout['format']}
