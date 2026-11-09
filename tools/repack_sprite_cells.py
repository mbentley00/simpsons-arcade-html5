"""Separate spilled poses in a 4x4 generated sprite sheet, preserving source pixels and untouched frames.
Usage: python tools/repack_sprite_cells.py SOURCE.png OUTPUT.png --frames 12,13,14,15
Uses the largest connected opaque silhouette assigned to each cell; no new artwork is drawn.
"""
import argparse
from pathlib import Path
from PIL import Image

p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--frames',default='12,13,14,15');args=p.parse_args()
im=Image.open(args.source).convert('RGBA');w,h=im.size;cw,ch=w//4,h//4
assert w%4==0 and h%4==0
mask=bytearray(v>=128 for v in im.getchannel('A').get_flattened_data());visited=bytearray(w*h);best={}
for start in range(w*h):
    if not mask[start] or visited[start]:continue
    stack=[start];visited[start]=1;points=[];sx=sy=0;left=w;right=0;top=h;bottom=0
    while stack:
        i=stack.pop();points.append(i);y,x=divmod(i,w);sx+=x;sy+=y;left=min(left,x);right=max(right,x);top=min(top,y);bottom=max(bottom,y)
        for yy in range(max(0,y-1),min(h,y+2)):
            for xx in range(max(0,x-1),min(w,x+2)):
                j=yy*w+xx
                if mask[j] and not visited[j]:visited[j]=1;stack.append(j)
    if len(points)<150:continue
    col=min(3,int(sx/len(points)//cw));row=min(3,int(sy/len(points)//ch));frame=row*4+col
    if frame not in best or len(points)>len(best[frame][0]):best[frame]=(points,(left,top,right+1,bottom+1))
result=im.copy()
for frame in [int(v) for v in args.frames.split(',')]:
    assert frame in best,f'No complete silhouette found for frame {frame}'
    points,box=best[frame];left,top,right,bottom=box;component=Image.new('RGBA',(right-left,bottom-top))
    for i in points:
        y,x=divmod(i,w);component.putpixel((x-left,y-top),im.getpixel((x,y)))
    scale=min(1,(cw-8)/component.width,(ch-16)/component.height)
    if scale<1:component=component.resize((round(component.width*scale),round(component.height*scale)),Image.Resampling.NEAREST)
    cell=Image.new('RGBA',(cw,ch));baseline=round(ch*91/96);cell.paste(component,((cw-component.width)//2,baseline-component.height))
    result.paste(cell,((frame%4)*cw,(frame//4)*ch));print(f'frame {frame}: full source bounds {box}, {len(points)} pixels, fitted {component.size}')
args.output.parent.mkdir(parents=True,exist_ok=True);result.save(args.output)
