export function portraitCrop(width,height,maxHeight=1200){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Видеопоток не готов');
 const cropWidth=Math.min(width,height*3/4),cropHeight=cropWidth*4/3;
 const h=Math.max(4,Math.floor(Math.min(cropHeight,maxHeight)/4)*4);
 return {x:(width-cropWidth)/2,y:(height-cropHeight)/2,cropWidth,cropHeight,width:h*3/4,height:h};
}
export function capturePortrait(video,maxHeight=1200){
 const p=portraitCrop(video.videoWidth,video.videoHeight,maxHeight),canvas=document.createElement('canvas');
 canvas.width=p.width;canvas.height=p.height;
 canvas.getContext('2d').drawImage(video,p.x,p.y,p.cropWidth,p.cropHeight,0,0,p.width,p.height);
 return canvas;
}

export function fullFrameSize(width,height,maxDimension=1200){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Видеопоток не готов');
 const ratio=Math.min(1,maxDimension/Math.max(width,height));return {width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))};
}
export function captureFrame(video,maxDimension=1200){
 const size=fullFrameSize(video.videoWidth,video.videoHeight,maxDimension),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
 canvas.getContext('2d').drawImage(video,0,0,video.videoWidth,video.videoHeight,0,0,size.width,size.height);return canvas;
}
