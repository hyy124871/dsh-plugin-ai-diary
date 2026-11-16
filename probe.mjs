import { loadImage, createCanvas } from '@napi-rs/canvas';
for (const f of ['assets/characters/_matte/gpt_chibi_v3.png','assets/characters/transparent/variants/gpt_chibi_v3.png']) {
  const img = await loadImage(f);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0,0,img.width,img.height).data;
  let a0=0, a255=0, mid=0;
  for (let i=3;i<d.length;i+=4){ if(d[i]===0)a0++; else if(d[i]===255)a255++; else mid++; }
  console.log(f, img.width+'x'+img.height, 'alpha0='+a0, 'alpha255='+a255, 'mid='+mid);
}
