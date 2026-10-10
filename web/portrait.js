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
