"""Freeze owned video samples for original native-decoder/capture comparisons."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from PIL import Image,ImageDraw

def main():
    skill=Path(__file__).resolve().parents[1];root=skill.parents[1];folder=skill/'assets/fixtures/video-capture';folder.mkdir(exist_ok=True)
    if (folder/'manifest.json').exists():raise SystemExit('Existing capture fixture preserved.')
    def run(args):subprocess.run(['ffmpeg','-nostdin','-v','error','-y',*map(str,args)],check=True,capture_output=True)
    with tempfile.TemporaryDirectory(prefix='ronin-video-capture-source-') as temp:
        for n in range(16):
            image=Image.new('RGB',(64,48),(20,190,42));draw=ImageDraw.Draw(image);k=n//2
            for y in range(48):
                for x in range(64):
                    if (x+y)%7==0:image.putpixel((x,y),((x*31+k*19)%256,(y*29+k*11)%256,(x*17+y*7+k*23)%256))
            draw.rectangle((k*4,4,k*4+11,28),fill=(210,30+k*7,180-k*11));draw.line((0,47,63,0),fill=(240,220,30),width=2)
            image.save(Path(temp)/f'{n:03d}.png')
        common=['-framerate','12','-i',Path(temp)/'%03d.png','-an']
        run([*common,'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart',folder/'h264.mp4'])
        run([*common,'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-color_range','pc','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',folder/'bt709-full.mp4'])
        run([*common,'-vf','setsar=2','-c:v','libx264','-pix_fmt','yuv420p','-crf','18',folder/'aspect.mp4'])
        run([*common,'-vf','format=gray,format=yuv420p','-c:v','libx264','-pix_fmt','yuv420p','-crf','18',folder/'gray.mp4'])
        run([*common,'-c:v','libvpx-vp9','-pix_fmt','yuv420p','-lossless','1','-cpu-used','4',folder/'vp9.webm'])
        run(['-i',folder/'h264.mp4','-c','copy','-metadata:s:v:0','rotate=90',folder/'rotated.mp4'])
        for name in ['h264.mov','h264.mkv']:run(['-i',folder/'h264.mp4','-c','copy',folder/name])
        run([*common,'-c:v','mpeg4','-q:v','2',folder/'mpeg4.avi'])
    files=[p.name for p in folder.iterdir() if p.suffix in ['.mp4','.webm','.mov','.mkv','.avi']]
    probe={}
    for name in files:
        info=json.loads(subprocess.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(folder/name)],check=True,capture_output=True,text=True).stdout)
        stream=next(s for s in info['streams'] if s.get('codec_type')=='video')
        probe[name]={k:stream.get(k) for k in ['width','height','pix_fmt','codec_name','sample_aspect_ratio','color_range','color_space','side_data_list']};probe[name]['duration']=float(info['format']['duration'])
    base={'start':0,'end':1,'fps':10,'maxFrames':2000,'crop':{'left':0,'top':0,'right':0,'bottom':0}}
    cases=[{'id':name.replace('.','-'),'source':name,'parameters':base} for name in files]
    for suffix,values in [('crop',{'crop':{'left':3,'top':5,'right':7,'bottom':9}}),('fractional-crop',{'crop':{'left':1.5,'top':2.25,'right':3.75,'bottom':4.5}}),('overlapping-crop',{'crop':{'left':40,'top':30,'right':40,'bottom':30}}),('fractional-fps',{'start':.03,'end':.8,'fps':7.5}),('range',{'start':.125,'end':.875,'fps':4}),('max-frames',{'fps':24,'maxFrames':3})]:
        cases.append({'id':suffix,'source':'h264.mp4','parameters':{**base,**values}})
    manifest={'formatVersion':1,'sources':{name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in files},'probe':probe,'originals':{'reference/frontend/src/components/ParamsStep.tsx':hashlib.sha256((root/'reference/frontend/src/components/ParamsStep.tsx').read_bytes()).hexdigest()},'cases':cases,'ffmpeg':subprocess.run(['ffmpeg','-version'],check=True,capture_output=True,text=True).stdout.splitlines()[0]}
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'sources':len(files),'cases':len(cases),'bytes':sum((folder/name).stat().st_size for name in files)}))

if __name__=='__main__':main()
