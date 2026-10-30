"""Generate original synthetic audio and abstract artwork; no third-party recordings."""
from pathlib import Path
import sys, math, wave, struct, io, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'source/vendor/python-libs'))
from mutagen.wave import WAVE
from mutagen.id3 import TIT2,TPE1,TALB,TDRC,TRCK,TCON,APIC,USLT
out=ROOT/'source/demo'; out.mkdir(exist_ok=True)
fontfile='C:/Windows/Fonts/msyh.ttc'
def font(n): return ImageFont.truetype(fontfile,n)
items=[('晚风来信','LATE SUMMER','#e8bea8','#849db0','EVENING LETTERS'),('月光航线','LUNAR VOYAGE','#b2b4db','#383f68','MOONLIGHT'),('雨后的街道','AFTER THE RAIN','#9ebdb6','#425c68','AFTER THE RAIN'),('星期天的梦','SUNDAY DREAM','#e9c4cc','#b090b7','SUNDAY DREAMS'),('海岸线','COASTLINE','#b2cedb','#dcbb92','COASTLINE'),('浮光','SOFT REFLECTIONS','#e2b69e','#a0526a','REFLECTIONS'),('未命名的旋律','UNTITLED','#d4c6b5','#877e88','UNTITLED'),('等待春天','WAITING FOR SPRING','#c6d6bc','#7b947e','SPRING AGAIN')]
for i,(title,subtitle,c1,c2,album) in enumerate(items):
    image=Image.new('RGB',(600,600),c1); draw=ImageDraw.Draw(image)
    a=tuple(int(c1[j:j+2],16) for j in (1,3,5)); b=tuple(int(c2[j:j+2],16) for j in (1,3,5))
    for y in range(600):
        t=y/600; color=tuple(int(a[k]*(1-t)+b[k]*t) for k in range(3)); draw.line((0,y,600,y),fill=color)
    draw.ellipse((155,100,445,390),fill=tuple(min(255,v+32) for v in a))
    for z in range(4):
        y=290+z*46
        draw.polygon([(0,y+30),(200,y-30+i*3),(430,y+35),(600,y-20),(600,600),(0,600)], fill=tuple(max(0,min(255,v+z*8)) for v in b))
    draw.text((44,38),'MT  /  SOUND STUDIES',font=font(15),fill='#fff9ef')
    draw.text((40,450),title,font=font(43),fill='#fff9ef')
    draw.text((44,517),subtitle,font=font(18),fill='#fff9ef')
    draw.text((44,555),'ORIGINAL DEMO   /   %02d'%(i+1),font=font(12),fill='#f4ece5')
    buf=io.BytesIO();image.save(buf,format='JPEG',quality=90)
    file=out/f'{i+1:02d} - {title}.wav'
    with wave.open(str(file),'wb') as audio:
        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(22050)
        frequency=220*2**(i/12)
        audio.writeframes(b''.join(struct.pack('<h',int(1900*math.sin(2*math.pi*frequency*n/22050)*min(1,n/2205,(88200-n)/2205))) for n in range(88200)))
    tags=WAVE(file);tags.add_tags();tags.tags.add(TIT2(encoding=3,text=title));tags.tags.add(TPE1(encoding=3,text='Music Tools / 演示音频'))
    if i!=6: tags.tags.add(TALB(encoding=3,text=album));tags.tags.add(TDRC(encoding=3,text='2026'));tags.tags.add(TRCK(encoding=3,text=str(i+1)));tags.tags.add(TCON(encoding=3,text='Ambient'));tags.tags.add(APIC(encoding=3,mime='image/jpeg',type=3,desc='Cover',data=buf.getvalue()))
    if i%3==0:tags.tags.add(USLT(encoding=3,lang='chi',desc='',text='[00:00.00]这是原创合成演示音频\n[00:02.00]用于体验标签编辑，不含商业录音'))
    tags.save()
print(f'Created {len(items)} original WAV demos in {out}')
